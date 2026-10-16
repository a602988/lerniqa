#!/bin/sh

set -eu

fail()
{
    echo "資料庫 migration 驗證失敗：$*" >&2
    exit 1
}

script_directory="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
repository_root="$(CDPATH= cd -P "$script_directory/.." && pwd)"
migration_directory="$repository_root/database/migrations"
test_directory="$repository_root/database/tests"
down_test_directory="$test_directory/down"

command -v node >/dev/null 2>&1 || fail "缺少必要指令：node"
if ! node "$script_directory/with-local-postgres-test-lock.mjs" \
    --verify-child-proof >/dev/null
then
    fail "必須透過受鎖定的 npm run db:test 執行 migration 驗證"
fi

existing_server_mode="${LERNIQA_DB_TEST_EXISTING:-0}"
case "$existing_server_mode" in
    0|1) ;;
    *) fail "LERNIQA_DB_TEST_EXISTING 只能是 0 或 1" ;;
esac

for required_command in cp createdb diff dirname dropdb id mkdir mktemp pg_dump psql rm sed sleep sort
do
    command -v "$required_command" >/dev/null 2>&1 \
        || fail "缺少必要指令：$required_command"
done

if [ "$existing_server_mode" -eq 0 ]; then
    for required_command in initdb pg_ctl
    do
        command -v "$required_command" >/dev/null 2>&1 \
            || fail "缺少必要指令：$required_command"
    done
fi

[ -d "$migration_directory" ] || fail "找不到 migration 目錄"
[ -d "$test_directory" ] || fail "找不到 migration 測試目錄"

database_user="$(id -un)"

canonicalize_single_socket_directory()
{
    candidate_socket_directory=$1

    case "$candidate_socket_directory" in
        /*) ;;
        *) return 1 ;;
    esac
    case "$candidate_socket_directory" in
        *,*) return 1 ;;
    esac
    [ -d "$candidate_socket_directory" ] || return 1
    CDPATH= cd -P "$candidate_socket_directory" && pwd
}

if [ "$existing_server_mode" -eq 1 ]; then
    socket_directory="${LERNIQA_DB_TEST_SOCKET:-}"
    database_port="${LERNIQA_DB_TEST_PORT:-}"
    expected_data_directory="${LERNIQA_DB_TEST_DATA_DIRECTORY:-}"

    [ -n "$socket_directory" ] \
        || fail "existing-local-server 模式必須明確設定 LERNIQA_DB_TEST_SOCKET"
    case "$socket_directory" in
        /*) ;;
        *) fail "existing-local-server 模式只接受絕對 Unix socket 目錄" ;;
    esac
    [ -d "$socket_directory" ] \
        || fail "找不到 existing-local-server Unix socket 目錄：$socket_directory"
    socket_directory="$(canonicalize_single_socket_directory "$socket_directory")" \
        || fail "existing-local-server Unix socket 必須是單一 canonical 目錄"

    [ -n "$database_port" ] \
        || fail "existing-local-server 模式必須明確設定 LERNIQA_DB_TEST_PORT"
    case "$database_port" in
        ''|*[!0-9]*) fail "LERNIQA_DB_TEST_PORT 必須是 1 到 65535 的整數" ;;
    esac
    [ "$database_port" -ge 1 ] && [ "$database_port" -le 65535 ] \
        || fail "LERNIQA_DB_TEST_PORT 必須是 1 到 65535 的整數"

    [ -n "$expected_data_directory" ] \
        || fail "existing-local-server 模式必須明確設定 LERNIQA_DB_TEST_DATA_DIRECTORY"
    case "$expected_data_directory" in
        /*) ;;
        *) fail "LERNIQA_DB_TEST_DATA_DIRECTORY 必須是絕對路徑" ;;
    esac
    [ -d "$expected_data_directory" ] \
        || fail "找不到 existing-local-server data_directory：$expected_data_directory"
    expected_data_directory="$(CDPATH= cd -P "$expected_data_directory" && pwd)"
else
    database_port=$((49152 + $$ % 15000))
    expected_data_directory=""
fi

test_root="$(mktemp -d /tmp/lerniqa-db-test.XXXXXX)"
cluster_directory="$test_root/postgres"
owned_socket_directory="$test_root/socket"
snapshot_directory="$test_root/snapshots"
postgres_log="$test_root/postgres.log"
migration_paths_file="$test_root/migration-paths.txt"
migration_names_file="$test_root/migration-names.txt"
reverse_migration_names_file="$test_root/reverse-migration-names.txt"
database_registry_file="$test_root/database-names.txt"
dropped_database_registry_file="$test_root/dropped-database-names.txt"
expected_records_file="$test_root/expected-records.txt"
actual_records_file="$test_root/actual-records.txt"
actual_tables_file="$test_root/actual-tables.txt"
schema_diff_file="$test_root/schema.diff"
test_nonce=${test_root##*.}
case "$test_nonce" in
    ''|*[!0-9A-Za-z]*) fail "無法建立安全的 migration test nonce" ;;
esac
database_name="lerniqa_schema_test_$$_$test_nonce"
database_ownership_comment="lerniqa-isolated-migration-test:$$_$test_nonce"

if [ "$existing_server_mode" -eq 0 ]; then
    socket_directory="$owned_socket_directory"
fi

server_start_attempted=0

query_postgres_for_cleanup()
{
    cleanup_query_sql=$1

    psql \
        -X \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d postgres \
        -A \
        -t \
        -q \
        -v ON_ERROR_STOP=1 \
        -c "$cleanup_query_sql"
}

verify_existing_server_identity_for_cleanup()
{
    cleanup_connection_kind="$(query_postgres_for_cleanup \
        "SELECT COALESCE(inet_server_addr()::text, 'unix_socket')")" \
        || return 1
    cleanup_current_user="$(query_postgres_for_cleanup "SELECT current_user")" \
        || return 1
    cleanup_session_user="$(query_postgres_for_cleanup "SELECT session_user")" \
        || return 1
    cleanup_server_port="$(query_postgres_for_cleanup "SHOW port")" \
        || return 1
    cleanup_recovery_state="$(query_postgres_for_cleanup \
        "SELECT pg_catalog.pg_is_in_recovery()")" \
        || return 1
    cleanup_socket_directory="$(query_postgres_for_cleanup \
        "SHOW unix_socket_directories")" \
        || return 1
    cleanup_data_directory="$(query_postgres_for_cleanup "SHOW data_directory")" \
        || return 1

    cleanup_socket_directory="$(canonicalize_single_socket_directory \
        "$cleanup_socket_directory")" || {
            echo "existing-local-server cleanup 無法確認單一 canonical socket 目錄" >&2
            return 1
        }

    if [ ! -d "$cleanup_data_directory" ]; then
        echo "existing-local-server cleanup 無法確認 data_directory" >&2
        return 1
    fi
    cleanup_data_directory="$(CDPATH= cd -P "$cleanup_data_directory" && pwd)" \
        || return 1

    if [ "$cleanup_connection_kind" != "unix_socket" ] \
        || [ "$cleanup_current_user" != "$database_user" ] \
        || [ "$cleanup_session_user" != "$database_user" ] \
        || [ "$cleanup_server_port" != "$database_port" ] \
        || [ "$cleanup_recovery_state" != "f" ] \
        || [ "$cleanup_socket_directory" != "$socket_directory" ] \
        || [ "$cleanup_data_directory" != "$expected_data_directory" ]
    then
        echo "existing-local-server cleanup 身分不符；拒絕刪除任何資料庫" >&2
        return 1
    fi
}

existing_database_ownership_state()
{
    ownership_database_name=$1

    query_postgres_for_cleanup "
        SELECT CASE
            WHEN NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_database
                WHERE datname = '$ownership_database_name'
            ) THEN 'absent'
            WHEN (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = '$ownership_database_name'
            ) = '$database_ownership_comment' THEN 'owned'
            WHEN (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = '$ownership_database_name'
            ) IS NULL THEN 'unmarked'
            ELSE 'foreign'
        END
    "
}

database_was_explicitly_dropped()
{
    dropped_database_name=$1
    [ -f "$dropped_database_registry_file" ] || return 1

    while IFS= read -r registered_dropped_database
    do
        if [ "$registered_dropped_database" = "$dropped_database_name" ]; then
            return 0
        fi
    done < "$dropped_database_registry_file"
    return 1
}

cleanup_existing_test_databases()
{
    [ -f "$database_registry_file" ] || return 0

    cleanup_database_list="$test_root/cleanup-database-names.txt"
    if ! LC_ALL=C sort -r -u \
        "$database_registry_file" > "$cleanup_database_list"
    then
        echo "無法建立 migration test 資料庫 cleanup 清單" >&2
        return 1
    fi
    cleanup_database_list_complete_marker="!lerniqa-cleanup-list-complete:$test_nonce!"
    if ! printf '%s\n' "$cleanup_database_list_complete_marker" \
        >> "$cleanup_database_list"
    then
        echo "無法完成 migration test 資料庫 cleanup 清單" >&2
        return 1
    fi
    cleanup_database_status=0
    cleanup_database_list_was_complete=0

    while IFS= read -r cleanup_database_name
    do
        if [ "$cleanup_database_name" = "$cleanup_database_list_complete_marker" ]; then
            cleanup_database_list_was_complete=1
            continue
        fi
        if [ "$cleanup_database_list_was_complete" -eq 1 ]; then
            echo "migration test 資料庫 cleanup 清單在完整讀取 marker 後仍有內容" >&2
            cleanup_database_status=1
            continue
        fi
        [ -n "$cleanup_database_name" ] || continue
        case "$cleanup_database_name" in
            "$database_name"|"$database_name"_*) ;;
            *)
                echo "拒絕清理不屬於本次 migration test 的資料庫：$cleanup_database_name" >&2
                cleanup_database_status=1
                continue
                ;;
        esac

        if database_was_explicitly_dropped "$cleanup_database_name"; then
            continue
        fi

        if ! verify_existing_server_identity_for_cleanup; then
            cleanup_database_status=1
            continue
        fi

        cleanup_ownership_state="$(existing_database_ownership_state \
            "$cleanup_database_name")" || {
                echo "無法確認 migration test 資料庫 ownership：$cleanup_database_name" >&2
                cleanup_database_status=1
                continue
            }
        if [ "$cleanup_ownership_state" = "absent" ]; then
            continue
        fi
        if [ "$cleanup_ownership_state" != "owned" ]; then
            echo "migration test 資料庫 ownership marker 不符；拒絕清理：$cleanup_database_name" >&2
            cleanup_database_status=1
            continue
        fi

        if ! dropdb \
            -w \
            -h "$socket_directory" \
            -p "$database_port" \
            -U "$database_user" \
            --maintenance-db=postgres \
            --force \
            "$cleanup_database_name" >/dev/null 2>&1
        then
            echo "無法清理 migration test 資料庫：$cleanup_database_name" >&2
            cleanup_database_status=1
            continue
        fi

        cleanup_ownership_state="$(existing_database_ownership_state \
            "$cleanup_database_name")" || {
                echo "無法確認 migration test 資料庫已刪除：$cleanup_database_name" >&2
                cleanup_database_status=1
                continue
            }
        if [ "$cleanup_ownership_state" != "absent" ]; then
            echo "migration test 資料庫未確認刪除：$cleanup_database_name" >&2
            cleanup_database_status=1
        fi
    done < "$cleanup_database_list"

    if [ "$cleanup_database_list_was_complete" -ne 1 ]; then
        echo "無法完整讀取 migration test 資料庫 cleanup 清單" >&2
        return 1
    fi

    return "$cleanup_database_status"
}

stop_private_test_postgres()
{
    if pg_ctl -D "$cluster_directory" status >/dev/null 2>&1; then
        private_server_status=0
    else
        private_server_status=$?
    fi

    case "$private_server_status" in
        0)
            if ! pg_ctl -D "$cluster_directory" -m fast -w stop >/dev/null 2>&1; then
                echo "無法停止隔離 PostgreSQL cluster：$cluster_directory" >&2
                return 1
            fi
            if pg_ctl -D "$cluster_directory" status >/dev/null 2>&1; then
                echo "隔離 PostgreSQL cluster 停止後仍在執行：$cluster_directory" >&2
                return 1
            else
                private_server_status=$?
            fi
            if [ "$private_server_status" -ne 3 ]; then
                echo "無法確認隔離 PostgreSQL cluster 已停止：$cluster_directory" >&2
                return 1
            fi
            ;;
        3)
            ;;
        *)
            echo "無法判斷隔離 PostgreSQL cluster 狀態：$cluster_directory" >&2
            return 1
            ;;
    esac

    server_start_attempted=0
}

cleanup()
{
    cleanup_status=$?
    cleanup_resources_confirmed=1
    trap - EXIT HUP INT TERM

    if [ "$existing_server_mode" -eq 1 ]; then
        if ! cleanup_existing_test_databases; then
            if [ "$cleanup_status" -eq 0 ]; then
                cleanup_status=1
            fi
            cleanup_resources_confirmed=0
        fi
    elif [ "$server_start_attempted" -eq 1 ]; then
        if ! stop_private_test_postgres; then
            if [ "$cleanup_status" -eq 0 ]; then
                cleanup_status=1
            fi
            cleanup_resources_confirmed=0
        fi
    fi

    if [ "$cleanup_resources_confirmed" -eq 0 ] \
        || [ "$cleanup_status" -ne 0 ]
    then
        if [ "$cleanup_resources_confirmed" -eq 0 ]; then
            echo "隔離服務或資料庫尚未確認清理；保留 migration test 目錄：$test_root" >&2
        else
            echo "migration test 失敗；已確認服務與資料庫 cleanup，保留測試目錄供檢查：$test_root" >&2
        fi
        exit "$cleanup_status"
    fi

    case "$test_root" in
        /tmp/lerniqa-db-test.*)
            if ! rm -rf "$test_root"; then
                echo "無法刪除 migration 測試暫存目錄：$test_root" >&2
                if [ "$cleanup_status" -eq 0 ]; then
                    cleanup_status=1
                fi
            fi
            ;;
        *)
            echo "拒絕刪除不符合安全規則的暫存目錄：$test_root" >&2
            cleanup_status=1
            ;;
    esac

    exit "$cleanup_status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$existing_server_mode" -eq 1 ]; then
    mkdir -m 700 "$snapshot_directory"
else
    mkdir -m 700 "$cluster_directory" "$socket_directory" "$snapshot_directory"
fi
: > "$database_registry_file"
: > "$dropped_database_registry_file"

: > "$migration_paths_file"
for migration_path in "$migration_directory"/*.up.sql
do
    [ -f "$migration_path" ] || continue
    printf '%s\n' "$migration_path" >> "$migration_paths_file"
done

[ -s "$migration_paths_file" ] || fail "沒有找到任何 .up.sql migration"
LC_ALL=C sort "$migration_paths_file" -o "$migration_paths_file"

: > "$migration_names_file"
migration_count=0
previous_version=""

while IFS= read -r migration_path
do
    migration_filename=${migration_path##*/}
    migration_name=${migration_filename%.up.sql}

    case "$migration_name" in
        [0-9][0-9][0-9][0-9]_*) ;;
        *) fail "migration 檔名格式錯誤：$migration_filename" ;;
    esac

    case "$migration_name" in
        *[!0-9a-z_]*) fail "migration 檔名只能使用小寫英數字與底線：$migration_filename" ;;
    esac

    migration_version=${migration_name%%_*}
    migration_label=${migration_name#*_}
    [ -n "$migration_label" ] || fail "migration 名稱不可為空：$migration_filename"

    if [ "$migration_version" = "$previous_version" ]; then
        fail "migration 版本重複：$migration_version"
    fi

    down_path="$migration_directory/$migration_name.down.sql"
    test_path="$test_directory/$migration_name.sql"
    [ -f "$down_path" ] || fail "缺少回滾 migration：$down_path"
    [ -f "$test_path" ] || fail "缺少 migration 測試：$test_path"

    printf '%s\n' "$migration_name" >> "$migration_names_file"
    previous_version=$migration_version
    migration_count=$((migration_count + 1))
done < "$migration_paths_file"

for down_path in "$migration_directory"/*.down.sql
do
    [ -f "$down_path" ] || continue
    down_filename=${down_path##*/}
    down_name=${down_filename%.down.sql}
    [ -f "$migration_directory/$down_name.up.sql" ] \
        || fail "找到沒有對應前進 migration 的回滾檔：$down_path"
    [ -f "$test_directory/$down_name.sql" ] \
        || fail "找到沒有對應測試的回滾 migration：$down_path"
done

for test_path in "$test_directory"/[0-9][0-9][0-9][0-9]_*.sql
do
    [ -f "$test_path" ] || continue
    test_filename=${test_path##*/}
    test_name=${test_filename%.sql}
    [ -f "$migration_directory/$test_name.up.sql" ] \
        || fail "找到沒有對應前進 migration 的測試：$test_path"
    [ -f "$migration_directory/$test_name.down.sql" ] \
        || fail "找到沒有對應回滾 migration 的測試：$test_path"
done

if [ -d "$down_test_directory" ]; then
    for down_test_path in "$down_test_directory"/[0-9][0-9][0-9][0-9]_*.sql
    do
        [ -f "$down_test_path" ] || continue
        down_test_filename=${down_test_path##*/}
        down_test_name=${down_test_filename%.sql}
        [ -f "$migration_directory/$down_test_name.up.sql" ] \
            || fail "找到沒有對應前進 migration 的回滾後測試：$down_test_path"
        [ -f "$migration_directory/$down_test_name.down.sql" ] \
            || fail "找到沒有對應回滾 migration 的回滾後測試：$down_test_path"
    done
fi

LC_ALL=C sort -r "$migration_names_file" > "$reverse_migration_names_file"

unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
export PSQLRC=/dev/null
export PGCONNECT_TIMEOUT=5
export PGSSLMODE=disable
export PGAPPNAME=lerniqa-migration-test

if [ "$existing_server_mode" -eq 0 ]; then
    initdb \
        -D "$cluster_directory" \
        --username="$database_user" \
        --auth-local=trust \
        --auth-host=reject \
        --encoding=UTF8 \
        --no-locale > "$test_root/initdb.log"

    server_start_attempted=1
    pg_ctl \
        -D "$cluster_directory" \
        -l "$postgres_log" \
        -o "-F -h '' -k $socket_directory -p $database_port -c unix_socket_permissions=0700" \
        -w start >/dev/null
fi

query_database()
{
    query_database_name=$1
    query_database_sql=$2

    psql \
        -X \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$query_database_name" \
        -A \
        -t \
        -q \
        -v ON_ERROR_STOP=1 \
        -c "$query_database_sql"
}

run_sql_file_in_database()
{
    target_database_name=$1
    sql_file=$2
    shift 2

    psql \
        -X \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$target_database_name" \
        -v ON_ERROR_STOP=1 \
        "$@" \
        -f "$sql_file" >/dev/null
}

run_sql_file()
{
    run_sql_file_in_database "$database_name" "$1"
}

run_sql_command_in_database()
{
    target_database_name=$1
    sql_command=$2

    psql \
        -X \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$target_database_name" \
        -v ON_ERROR_STOP=1 \
        -c "$sql_command" >/dev/null
}

capture_tables()
{
    table_output_path=$1
    query_database "$database_name" \
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename" \
        > "$table_output_path"
}

capture_records()
{
    record_output_path=$1
    query_database "$database_name" \
        "SELECT version || '|' || name FROM schema_migrations ORDER BY version" \
        > "$record_output_path"
}

capture_schema_for_database()
{
    target_database_name=$1
    schema_output_path=$2
    raw_schema_output_path="$schema_output_path.raw"

    pg_dump \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$target_database_name" \
        --schema-only \
        --no-owner \
        --no-privileges > "$raw_schema_output_path"

    sed '/^\\restrict /d; /^\\unrestrict /d' \
        "$raw_schema_output_path" > "$schema_output_path"
    rm "$raw_schema_output_path"
}

capture_schema()
{
    capture_schema_for_database "$database_name" "$1"
}

assert_files_equal()
{
    comparison_label=$1
    expected_file=$2
    actual_file=$3

    if ! diff -u "$expected_file" "$actual_file" > "$schema_diff_file"; then
        echo "$comparison_label 不一致：" >&2
        sed -n '1,240p' "$schema_diff_file" >&2
        exit 1
    fi
}

clone_test_database()
{
    cloned_database_name=$1

    create_test_database "$cloned_database_name" "$database_name"
}

create_test_database()
{
    created_database_name=$1
    template_database_name=$2

    case "$created_database_name" in
        "$database_name"|"$database_name"_*) ;;
        *) fail "拒絕建立不屬於本次 migration test 的資料庫：$created_database_name" ;;
    esac
    case "$created_database_name" in
        *[!0-9A-Za-z_]*) fail "migration test 資料庫名稱含有不安全字元：$created_database_name" ;;
    esac
    [ "${#created_database_name}" -le 63 ] \
        || fail "migration test 資料庫名稱超過 PostgreSQL 63-byte 上限：$created_database_name"
    case "$template_database_name" in
        template0|"$database_name") ;;
        *) fail "拒絕使用非隔離 template 建立 migration test 資料庫：$template_database_name" ;;
    esac

    created_database_exists="$(query_database postgres \
        "SELECT count(*) FROM pg_catalog.pg_database WHERE datname = '$created_database_name'")"
    [ "$created_database_exists" -eq 0 ] \
        || fail "migration test 資料庫名稱已存在：$created_database_name"

    # Register before CREATE so normal failures and handled signals cannot leave
    # an untracked database on an existing local server.
    printf '%s\n' "$created_database_name" >> "$database_registry_file"

    createdb \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        --maintenance-db=postgres \
        --template="$template_database_name" \
        "$created_database_name"

    if [ "$existing_server_mode" -eq 1 ]; then
        query_database postgres \
            "COMMENT ON DATABASE \"$created_database_name\" IS '$database_ownership_comment'" \
            >/dev/null
        created_database_ownership_state="$(existing_database_ownership_state \
            "$created_database_name")"
        [ "$created_database_ownership_state" = "owned" ] \
            || fail "無法確認 migration test 資料庫 ownership marker：$created_database_name"
    fi
}

drop_test_database()
{
    cloned_database_name=$1

    case "$cloned_database_name" in
        "$database_name"|"$database_name"_*) ;;
        *) fail "拒絕刪除不屬於本次 migration test 的資料庫：$cloned_database_name" ;;
    esac

    if [ "$existing_server_mode" -eq 1 ]; then
        verify_existing_server_identity_for_cleanup \
            || fail "existing-local-server 身分不符；拒絕刪除 migration test 資料庫"
        explicit_drop_ownership_state="$(existing_database_ownership_state \
            "$cloned_database_name")"
        [ "$explicit_drop_ownership_state" = "owned" ] \
            || fail "migration test 資料庫 ownership marker 不符；拒絕刪除：$cloned_database_name"
    fi

    dropdb \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        --maintenance-db=postgres \
        "$cloned_database_name"

    if [ "$existing_server_mode" -eq 1 ]; then
        explicit_drop_ownership_state="$(existing_database_ownership_state \
            "$cloned_database_name")"
        [ "$explicit_drop_ownership_state" = "absent" ] \
            || fail "migration test 資料庫未確認刪除：$cloned_database_name"
        printf '%s\n' "$cloned_database_name" \
            >> "$dropped_database_registry_file"
    fi
}

verify_0011_legacy_score_upgrade()
{
    upgrade_database_name="${database_name}_0011_legacy"
    upgrade_fixture="$test_directory/fixtures/0011_legacy_score_upgrade.sql"
    expected_pre_upgrade_migrations="0001:identity_and_catalog,0002:question_core,0003:import_and_collections,0004:practice_and_attempts,0005:similarity_analytics_and_audit,0006:source_documents_word,0007:practice_answer_integrity,0008:auth_and_import_integrity,0009:automatic_answer_completeness,0010:account_role_and_self_learner"

    [ -f "$upgrade_fixture" ] \
        || fail "缺少 0011 legacy score upgrade fixture：$upgrade_fixture"

    base_migrations="$(query_database "$database_name" \
        "SELECT string_agg(version || ':' || name, ',' ORDER BY version) FROM schema_migrations")"
    [ "$base_migrations" = "$expected_pre_upgrade_migrations" ] \
        || fail "0011 legacy upgrade clone 必須從精確的 0001–0010 schema 建立：$base_migrations"

    clone_test_database "$upgrade_database_name"

    cloned_migrations="$(query_database "$upgrade_database_name" \
        "SELECT string_agg(version || ':' || name, ',' ORDER BY version) FROM schema_migrations")"
    [ "$cloned_migrations" = "$expected_pre_upgrade_migrations" ] \
        || fail "0011 legacy upgrade clone 的 migration 狀態不符：$cloned_migrations"

    run_sql_file_in_database "$upgrade_database_name" "$upgrade_fixture"
    run_sql_file_in_database \
        "$upgrade_database_name" \
        "$migration_directory/0011_score_session_aggregates.up.sql"
    run_sql_file_in_database \
        "$upgrade_database_name" \
        "$test_directory/0011_score_session_aggregates.sql"

    upgraded_migration_count="$(query_database "$upgrade_database_name" \
        "SELECT count(*) FROM schema_migrations WHERE version = '0011' AND name = 'score_session_aggregates'")"
    [ "$upgraded_migration_count" -eq 1 ] \
        || fail "0011 legacy upgrade clone 沒有精確留下 migration 紀錄"

    drop_test_database "$upgrade_database_name"
}

verify_0011_incomplete_completed_preflight()
{
    preflight_database_name="${database_name}_0011_incomplete_completed"
    preflight_before_schema="$snapshot_directory/0011-incomplete-completed-before.schema.sql"
    preflight_after_schema="$snapshot_directory/0011-incomplete-completed-after.schema.sql"
    preflight_error_log="$test_root/0011-incomplete-completed-preflight.log"

    clone_test_database "$preflight_database_name"
    run_sql_command_in_database "$preflight_database_name" "
        INSERT INTO practice_sessions (
            id,
            learner_id,
            created_by_user_id,
            mode,
            check_mode,
            status,
            completed_at
        )
        VALUES (
            '11f00000-0000-4000-8000-000000000001',
            '30000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001',
            'practice',
            'score',
            'completed',
            transaction_timestamp()
        );

        INSERT INTO practice_session_items (
            id,
            practice_session_id,
            question_id,
            question_revision_id,
            question_part_id,
            position,
            selection_reason
        )
        VALUES (
            '11f00000-0000-4000-8000-000000000002',
            '11f00000-0000-4000-8000-000000000001',
            '83000000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000001',
            '85000000-0000-0000-0000-000000000001',
            0,
            'fixed'
        );
    "
    capture_schema_for_database "$preflight_database_name" "$preflight_before_schema"

    if run_sql_file_in_database \
        "$preflight_database_name" \
        "$migration_directory/0011_score_session_aggregates.up.sql" \
        2> "$preflight_error_log"
    then
        fail "0011 接受已完成但缺少作答的 legacy score session"
    fi

    preflight_error_message="$(sed -n \
        '/completed legacy score session is missing one or more answer attempts/p' \
        "$preflight_error_log")"
    [ -n "$preflight_error_message" ] \
        || fail "0011 incomplete completed score preflight 沒有回傳預期錯誤"

    capture_schema_for_database "$preflight_database_name" "$preflight_after_schema"
    assert_files_equal \
        "0011 incomplete completed score preflight 失敗後的 schema 原子性" \
        "$preflight_before_schema" \
        "$preflight_after_schema"

    preflight_migration_count="$(query_database "$preflight_database_name" \
        "SELECT count(*) FROM schema_migrations WHERE version = '0011'")"
    [ "$preflight_migration_count" -eq 0 ] \
        || fail "0011 incomplete completed score preflight 失敗後仍留下 migration 紀錄"

    drop_test_database "$preflight_database_name"
}

verify_0009_preflight_failure()
{
    preflight_status=$1
    preflight_database_name="${database_name}_0009_${preflight_status}"
    preflight_before_schema="$snapshot_directory/0009-${preflight_status}-before.schema.sql"
    preflight_after_schema="$snapshot_directory/0009-${preflight_status}-after.schema.sql"
    preflight_error_log="$test_root/0009-${preflight_status}-preflight.log"

    clone_test_database "$preflight_database_name"
    run_sql_file_in_database \
        "$preflight_database_name" \
        "$test_directory/0009_automatic_answer_completeness.sql" \
        -v prepare_0009_preflight=1 \
        -v preflight_status="$preflight_status"
    capture_schema_for_database "$preflight_database_name" "$preflight_before_schema"

    if run_sql_file_in_database \
        "$preflight_database_name" \
        "$migration_directory/0009_automatic_answer_completeness.up.sql" \
        2> "$preflight_error_log"
    then
        fail "0009 接受既有 ${preflight_status} 自動判分小題缺少答案"
    fi

    preflight_error_message="$(sed -n \
        '/existing published or superseded automatic question part has no complete reference answer/p' \
        "$preflight_error_log")"
    [ -n "$preflight_error_message" ] \
        || fail "0009 ${preflight_status} preflight 沒有回傳預期錯誤"

    capture_schema_for_database "$preflight_database_name" "$preflight_after_schema"
    assert_files_equal \
        "0009 ${preflight_status} preflight 失敗後的 schema 原子性" \
        "$preflight_before_schema" \
        "$preflight_after_schema"

    preflight_migration_count="$(query_database "$preflight_database_name" \
        "SELECT count(*) FROM schema_migrations WHERE version = '0009'")"
    [ "$preflight_migration_count" -eq 0 ] \
        || fail "0009 ${preflight_status} preflight 失敗後仍留下 migration 紀錄"

    drop_test_database "$preflight_database_name"
}

verify_0009_concurrency_lock()
{
    concurrency_database_name="${database_name}_0009_concurrency"
    concurrency_barrier_key=9009009
    concurrency_barrier_log="$test_root/0009-concurrency-barrier.log"
    concurrency_child_one_log="$test_root/0009-concurrency-child-one.log"
    concurrency_child_two_log="$test_root/0009-concurrency-child-two.log"
    concurrency_publisher_log="$test_root/0009-concurrency-publisher.log"
    concurrency_final_publish_log="$test_root/0009-concurrency-final-publish.log"
    concurrency_direct_barrier_log="$test_root/0009-concurrency-direct-barrier.log"
    concurrency_direct_child_log="$test_root/0009-concurrency-direct-child.log"
    concurrency_direct_publisher_log="$test_root/0009-concurrency-direct-publisher.log"

    clone_test_database "$concurrency_database_name"
    run_sql_file_in_database \
        "$concurrency_database_name" \
        "$test_directory/0009_automatic_answer_completeness.sql" \
        -v prepare_0009_concurrency=1

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0009-barrier';
        SELECT pg_advisory_lock($concurrency_barrier_key);
        SELECT pg_sleep(300);
    " > "$concurrency_barrier_log" 2>&1 &
    concurrency_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0009-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0009 concurrency barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0009-child-one';
        BEGIN;
        DELETE FROM question_answers
        WHERE id = '09900000-0000-0000-0000-000000000114';
        SELECT pg_advisory_xact_lock_shared($concurrency_barrier_key);
        COMMIT;
    " > "$concurrency_child_one_log" 2>&1 &
    concurrency_child_one_pid=$!

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0009-child-two';
        BEGIN;
        DELETE FROM question_answers
        WHERE id = '09900000-0000-0000-0000-000000000115';
        SELECT pg_advisory_xact_lock_shared($concurrency_barrier_key);
        COMMIT;
    " > "$concurrency_child_two_log" 2>&1 &
    concurrency_child_two_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name IN (
                'lerniqa-0009-child-one',
                'lerniqa-0009-child-two'
            )
            AND held_lock.locktype = 'advisory'
            AND NOT held_lock.granted
    ")" -ne 2 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0009 concurrency child transactions 未到達同步屏障"
        sleep 1
    done

    if run_sql_command_in_database "$concurrency_database_name" "
        SET statement_timeout = '1s';
        BEGIN;
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09900000-0000-0000-0000-000000000111';
        COMMIT;
    " > "$concurrency_publisher_log" 2>&1
    then
        fail "0009 publisher 未等待並行 child mutation 的 parent revision lock"
    fi

    concurrency_timeout_message="$(sed -n \
        '/canceling statement due to statement timeout/p' \
        "$concurrency_publisher_log")"
    [ -n "$concurrency_timeout_message" ] \
        || fail "0009 publisher 並行失敗不是等待 parent revision lock 逾時"

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0009-barrier'
    " >/dev/null
    wait "$concurrency_barrier_pid" || true

    if ! wait "$concurrency_child_one_pid"; then
        fail "0009 concurrency child-one 交易失敗"
    fi
    if ! wait "$concurrency_child_two_pid"; then
        fail "0009 concurrency child-two 交易失敗"
    fi

    concurrency_answer_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM question_answers
        WHERE question_part_id = '09900000-0000-0000-0000-000000000112'
    ")"
    [ "$concurrency_answer_count" -eq 0 ] \
        || fail "0009 concurrency child deletions 未完整提交"

    if run_sql_command_in_database "$concurrency_database_name" "
        BEGIN;
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09900000-0000-0000-0000-000000000111';
        COMMIT;
    " > "$concurrency_final_publish_log" 2>&1
    then
        fail "0009 允許並行刪除後的無答案版本發布"
    fi

    concurrency_completeness_message="$(sed -n \
        '/已發布或已取代版本的自動判分小題必須有完整參考答案/p' \
        "$concurrency_final_publish_log")"
    [ -n "$concurrency_completeness_message" ] \
        || fail "0009 並行刪除後沒有回傳答案完整性錯誤"

    concurrency_revision_status="$(query_database "$concurrency_database_name" "
        SELECT status
        FROM question_revisions
        WHERE id = '09900000-0000-0000-0000-000000000111'
    ")"
    [ "$concurrency_revision_status" = "draft" ] \
        || fail "0009 並行發布失敗後 revision 未保留 draft"

    # Exercise the direct question_revision_id path independently from the
    # nested option/answer path above. The child INSERT must hold a parent row
    # lock before its statement finishes, so publication cannot pass it.
    concurrency_direct_barrier_key=9009010
    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0009-direct-barrier';
        SELECT pg_advisory_lock($concurrency_direct_barrier_key);
        SELECT pg_sleep(300);
    " > "$concurrency_direct_barrier_log" 2>&1 &
    concurrency_direct_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0009-direct-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0009 direct-child concurrency barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0009-direct-child';
        BEGIN;
        INSERT INTO question_content_blocks (
            id,
            question_revision_id,
            placement,
            content_type,
            position,
            text_content
        )
        VALUES (
            '09900000-0000-0000-0000-000000000122',
            '09900000-0000-0000-0000-000000000121',
            'prompt',
            'text',
            0,
            'concurrent direct child'
        );
        SELECT pg_advisory_xact_lock_shared($concurrency_direct_barrier_key);
        COMMIT;
    " > "$concurrency_direct_child_log" 2>&1 &
    concurrency_direct_child_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0009-direct-child'
            AND held_lock.locktype = 'advisory'
            AND NOT held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0009 direct child transaction 未到達同步屏障"
        sleep 1
    done

    if run_sql_command_in_database "$concurrency_database_name" "
        SET statement_timeout = '1s';
        BEGIN;
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09900000-0000-0000-0000-000000000121';
        COMMIT;
    " > "$concurrency_direct_publisher_log" 2>&1
    then
        fail "0009 publisher 未等待並行 direct child mutation 的 parent revision lock"
    fi

    concurrency_timeout_message="$(sed -n \
        '/canceling statement due to statement timeout/p' \
        "$concurrency_direct_publisher_log")"
    [ -n "$concurrency_timeout_message" ] \
        || fail "0009 direct child publisher 失敗不是等待 parent lock 逾時"

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0009-direct-barrier'
    " >/dev/null
    wait "$concurrency_direct_barrier_pid" || true

    if ! wait "$concurrency_direct_child_pid"; then
        fail "0009 direct child 交易失敗"
    fi

    run_sql_command_in_database "$concurrency_database_name" "
        BEGIN;
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09900000-0000-0000-0000-000000000121';
        COMMIT;
    "

    concurrency_direct_child_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM question_content_blocks
        WHERE id = '09900000-0000-0000-0000-000000000122'
            AND question_revision_id = '09900000-0000-0000-0000-000000000121'
    ")"
    [ "$concurrency_direct_child_count" -eq 1 ] \
        || fail "0009 direct child mutation 未在發布前提交"

    concurrency_revision_status="$(query_database "$concurrency_database_name" "
        SELECT status
        FROM question_revisions
        WHERE id = '09900000-0000-0000-0000-000000000121'
    ")"
    [ "$concurrency_revision_status" = "published" ] \
        || fail "0009 direct child 提交後 revision 未成功發布"

    drop_test_database "$concurrency_database_name"
}

verify_0008_archived_learner_upgrade_race()
{
    concurrency_database_name="${database_name}_0008_archive_race"
    concurrency_barrier_key=1008008
    concurrency_barrier_log="$test_root/0008-archive-barrier.log"
    concurrency_archiver_log="$test_root/0008-archiver.log"
    concurrency_migration_log="$test_root/0008-migration.log"
    concurrency_before_schema="$snapshot_directory/0008-archive-race-before.schema.sql"
    concurrency_after_schema="$snapshot_directory/0008-archive-race-after.schema.sql"

    clone_test_database "$concurrency_database_name"

    run_sql_command_in_database "$concurrency_database_name" "
        INSERT INTO users (id, display_name)
        VALUES (
            '08a00000-0000-4000-8000-000000000001',
            '0008 archive race learner'
        );

        INSERT INTO user_roles (id, user_id, role, granted_by_type)
        VALUES (
            '08a00000-0000-4000-8000-000000000002',
            '08a00000-0000-4000-8000-000000000001',
            'learner',
            'bootstrap_admin'
        );

        INSERT INTO learners (
            id,
            display_name,
            education_status,
            status
        )
        VALUES (
            '08a00000-0000-4000-8000-000000000003',
            '0008 archive race learner',
            'not_enrolled',
            'active'
        );

        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_manage_settings,
            accepted_at
        )
        VALUES (
            '08a00000-0000-4000-8000-000000000004',
            '08a00000-0000-4000-8000-000000000003',
            '08a00000-0000-4000-8000-000000000001',
            'learner',
            true,
            transaction_timestamp()
        );

        INSERT INTO auth_sessions (
            id,
            user_id,
            token_hash,
            active_role,
            active_learner_id,
            expires_at
        )
        VALUES (
            '08a00000-0000-4000-8000-000000000005',
            '08a00000-0000-4000-8000-000000000001',
            '0008-archive-race-token-hash',
            'learner',
            '08a00000-0000-4000-8000-000000000003',
            transaction_timestamp() + INTERVAL '1 hour'
        );
    "

    capture_schema_for_database \
        "$concurrency_database_name" \
        "$concurrency_before_schema"

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0008-archive-barrier';
        SELECT pg_advisory_lock($concurrency_barrier_key);
        SELECT pg_sleep(300);
    " > "$concurrency_barrier_log" 2>&1 &
    concurrency_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0008-archive-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0008 archive-race barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0008-archiver';
        BEGIN;
        UPDATE learners
        SET status = 'archived'
        WHERE id = '08a00000-0000-4000-8000-000000000003';
        SELECT pg_advisory_xact_lock_shared($concurrency_barrier_key);
        COMMIT;
    " > "$concurrency_archiver_log" 2>&1 &
    concurrency_archiver_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0008-archiver'
            AND held_lock.locktype = 'advisory'
            AND NOT held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0008 archiver 未到達同步屏障"
        sleep 1
    done

    run_sql_file_in_database \
        "$concurrency_database_name" \
        "$migration_directory/0008_auth_and_import_integrity.up.sql" \
        -c "SET application_name = 'lerniqa-0008-migration';" \
        > "$concurrency_migration_log" 2>&1 &
    concurrency_migration_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS pending_lock
        JOIN pg_stat_activity AS activity ON activity.pid = pending_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0008-migration'
            AND pending_lock.locktype = 'relation'
            AND pending_lock.relation = 'learners'::regclass
            AND pending_lock.mode = 'ShareRowExclusiveLock'
            AND NOT pending_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0008 migration 未等待並行 learner archive 的 table lock"
        sleep 1
    done

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0008-archive-barrier'
    " >/dev/null
    wait "$concurrency_barrier_pid" || true

    if ! wait "$concurrency_archiver_pid"; then
        fail "0008 並行 learner archive 交易失敗"
    fi

    if wait "$concurrency_migration_pid"; then
        fail "0008 在 active session 指向 archived learner 時仍成功升級"
    fi

    concurrency_preflight_message="$(sed -n \
        '/an active auth session references an archived learner; revoke it before migration/p' \
        "$concurrency_migration_log")"
    [ -n "$concurrency_preflight_message" ] \
        || fail "0008 archive race 沒有回傳預期 preflight 錯誤"

    archived_learner_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM learners AS learner
        JOIN auth_sessions AS session
            ON session.active_learner_id = learner.id
            AND session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
        WHERE learner.id = '08a00000-0000-4000-8000-000000000003'
            AND learner.status = 'archived'
    ")"
    [ "$archived_learner_count" -eq 1 ] \
        || fail "0008 archive-race fixture 未保留預期 invalid legacy state"

    migration_record_count="$(query_database "$concurrency_database_name" \
        "SELECT count(*) FROM schema_migrations WHERE version = '0008'")"
    [ "$migration_record_count" -eq 0 ] \
        || fail "0008 archive-race preflight 失敗後仍留下 migration 紀錄"

    capture_schema_for_database \
        "$concurrency_database_name" \
        "$concurrency_after_schema"
    assert_files_equal \
        "0008 archive-race preflight 失敗後的 schema 原子性" \
        "$concurrency_before_schema" \
        "$concurrency_after_schema"

    drop_test_database "$concurrency_database_name"
}

verify_0010_archived_learner_upgrade_race()
{
    concurrency_database_name="${database_name}_0010_archive_race"
    concurrency_barrier_key=1010010
    concurrency_barrier_log="$test_root/0010-archive-barrier.log"
    concurrency_archiver_log="$test_root/0010-archiver.log"
    concurrency_migration_log="$test_root/0010-migration.log"
    concurrency_before_schema="$snapshot_directory/0010-archive-race-before.schema.sql"
    concurrency_after_schema="$snapshot_directory/0010-archive-race-after.schema.sql"

    clone_test_database "$concurrency_database_name"

    run_sql_command_in_database "$concurrency_database_name" "
        INSERT INTO users (id, display_name)
        VALUES (
            '10a00000-0000-4000-8000-000000000001',
            '0010 archive race learner'
        );

        INSERT INTO user_roles (id, user_id, role, granted_by_type)
        VALUES (
            '10a00000-0000-4000-8000-000000000002',
            '10a00000-0000-4000-8000-000000000001',
            'learner',
            'bootstrap_admin'
        );

        INSERT INTO learners (
            id,
            display_name,
            education_status,
            status
        )
        VALUES (
            '10a00000-0000-4000-8000-000000000003',
            '0010 archive race learner',
            'not_enrolled',
            'active'
        );

        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_manage_settings,
            accepted_at
        )
        VALUES (
            '10a00000-0000-4000-8000-000000000004',
            '10a00000-0000-4000-8000-000000000003',
            '10a00000-0000-4000-8000-000000000001',
            'learner',
            true,
            transaction_timestamp()
        );

        INSERT INTO auth_sessions (
            id,
            user_id,
            token_hash,
            active_role,
            active_learner_id,
            expires_at
        )
        VALUES (
            '10a00000-0000-4000-8000-000000000005',
            '10a00000-0000-4000-8000-000000000001',
            '0010-archive-race-token-hash',
            'learner',
            '10a00000-0000-4000-8000-000000000003',
            transaction_timestamp() + INTERVAL '1 hour'
        );

        -- Recreate only the narrow historical 0008 install window: the old
        -- preflight had passed but its deferred learner-status trigger was not
        -- installed yet. Other 0008 protections remain enabled.
        ALTER TABLE learners DISABLE TRIGGER learners_auth_sessions_check;
    "

    capture_schema_for_database \
        "$concurrency_database_name" \
        "$concurrency_before_schema"

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-archive-barrier';
        SELECT pg_advisory_lock($concurrency_barrier_key);
        SELECT pg_sleep(300);
    " > "$concurrency_barrier_log" 2>&1 &
    concurrency_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-archive-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 archive-race barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-archiver';
        BEGIN;
        UPDATE learners
        SET status = 'archived'
        WHERE id = '10a00000-0000-4000-8000-000000000003';
        SELECT pg_advisory_xact_lock_shared($concurrency_barrier_key);
        COMMIT;
    " > "$concurrency_archiver_log" 2>&1 &
    concurrency_archiver_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-archiver'
            AND held_lock.locktype = 'advisory'
            AND NOT held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 archiver 未到達同步屏障"
        sleep 1
    done

    run_sql_file_in_database \
        "$concurrency_database_name" \
        "$migration_directory/0010_account_role_and_self_learner.up.sql" \
        -c "SET application_name = 'lerniqa-0010-migration';" \
        > "$concurrency_migration_log" 2>&1 &
    concurrency_migration_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS pending_lock
        JOIN pg_stat_activity AS activity ON activity.pid = pending_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-migration'
            AND pending_lock.locktype = 'relation'
            AND pending_lock.relation = 'learners'::regclass
            AND pending_lock.mode = 'ShareRowExclusiveLock'
            AND NOT pending_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 migration 未等待並行 learner archive 的 table lock"
        sleep 1
    done

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-archive-barrier'
    " >/dev/null
    wait "$concurrency_barrier_pid" || true

    if ! wait "$concurrency_archiver_pid"; then
        fail "0010 並行 learner archive 交易失敗"
    fi

    if wait "$concurrency_migration_pid"; then
        fail "0010 在 active session 指向 archived learner 時仍成功升級"
    fi

    concurrency_preflight_message="$(sed -n \
        '/an active auth session references an archived learner; revoke it before migration/p' \
        "$concurrency_migration_log")"
    [ -n "$concurrency_preflight_message" ] \
        || fail "0010 archive race 沒有回傳預期 preflight 錯誤"

    archived_learner_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM learners AS learner
        JOIN auth_sessions AS session
            ON session.active_learner_id = learner.id
            AND session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
        WHERE learner.id = '10a00000-0000-4000-8000-000000000003'
            AND learner.status = 'archived'
    ")"
    [ "$archived_learner_count" -eq 1 ] \
        || fail "0010 archive-race fixture 未保留預期 invalid legacy state"

    migration_record_count="$(query_database "$concurrency_database_name" \
        "SELECT count(*) FROM schema_migrations WHERE version = '0010'")"
    [ "$migration_record_count" -eq 0 ] \
        || fail "0010 archive-race preflight 失敗後仍留下 migration 紀錄"

    account_role_column_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'account_role'
    ")"
    [ "$account_role_column_count" -eq 0 ] \
        || fail "0010 archive-race preflight 失敗後仍留下 account_role 欄位"

    capture_schema_for_database \
        "$concurrency_database_name" \
        "$concurrency_after_schema"
    assert_files_equal \
        "0010 archive-race preflight 失敗後的 schema 原子性" \
        "$concurrency_before_schema" \
        "$concurrency_after_schema"

    drop_test_database "$concurrency_database_name"
}

verify_0010_deterministic_backfill()
{
    backfill_database_name="${database_name}_0010_backfill"

    clone_test_database "$backfill_database_name"

    run_sql_command_in_database "$backfill_database_name" "
        INSERT INTO users (id, display_name)
        VALUES
            ('10b00000-0000-4000-8000-000000000001', 'session role account'),
            ('10b00000-0000-4000-8000-000000000002', 'fallback role account'),
            ('10b00000-0000-4000-8000-000000000003', 'temporary learner mode'),
            ('10b00000-0000-4000-8000-000000000004', 'self repair account'),
            ('10b00000-0000-4000-8000-000000000005', 'registration tutor'),
            ('10b00000-0000-4000-8000-000000000006', 'invited tutor'),
            ('10b00000-0000-4000-8000-000000000007', 'role only account');

        INSERT INTO account_identities (
            id,
            user_id,
            provider,
            provider_subject,
            email_normalized,
            password_hash,
            verified_at
        )
        SELECT
            ('10b00000-0000-4000-8000-' || lpad(account.ordinal::text, 12, '0'))::uuid,
            account.user_id,
            'email',
            account.email,
            account.email,
            'synthetic-password-hash',
            transaction_timestamp()
        FROM (
            VALUES
                (11, '10b00000-0000-4000-8000-000000000001'::uuid, '0010-session@example.invalid'),
                (12, '10b00000-0000-4000-8000-000000000002'::uuid, '0010-fallback@example.invalid'),
                (13, '10b00000-0000-4000-8000-000000000003'::uuid, '0010-mode@example.invalid'),
                (14, '10b00000-0000-4000-8000-000000000004'::uuid, '0010-repair@example.invalid'),
                (15, '10b00000-0000-4000-8000-000000000005'::uuid, '0010-registration-tutor@example.invalid'),
                (16, '10b00000-0000-4000-8000-000000000006'::uuid, '0010-invited-tutor@example.invalid'),
                (17, '10b00000-0000-4000-8000-000000000007'::uuid, '0010-role-only@example.invalid')
        ) AS account(ordinal, user_id, email);

        INSERT INTO user_roles (id, user_id, role, granted_by_type)
        VALUES
            ('10b00000-0000-4000-8000-000000000021', '10b00000-0000-4000-8000-000000000001', 'parent', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000022', '10b00000-0000-4000-8000-000000000001', 'tutor', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000023', '10b00000-0000-4000-8000-000000000002', 'parent', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000024', '10b00000-0000-4000-8000-000000000002', 'tutor', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000025', '10b00000-0000-4000-8000-000000000003', 'parent', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000026', '10b00000-0000-4000-8000-000000000003', 'learner', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000027', '10b00000-0000-4000-8000-000000000004', 'learner', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000028', '10b00000-0000-4000-8000-000000000005', 'tutor', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-000000000029', '10b00000-0000-4000-8000-000000000006', 'tutor', 'bootstrap_admin'),
            ('10b00000-0000-4000-8000-00000000002a', '10b00000-0000-4000-8000-000000000007', 'tutor', 'bootstrap_admin');

        INSERT INTO learners (
            id,
            display_name,
            education_status,
            status
        )
        VALUES
            ('10b00000-0000-4000-8000-000000000031', 'session managed learner', 'not_enrolled', 'active'),
            ('10b00000-0000-4000-8000-000000000032', 'fallback managed learner', 'not_enrolled', 'active'),
            ('10b00000-0000-4000-8000-000000000033', 'mode managed learner', 'not_enrolled', 'active'),
            ('10b00000-0000-4000-8000-000000000034', 'stale self name', 'not_enrolled', 'active'),
            ('10b00000-0000-4000-8000-000000000035', 'registration tutor learner', 'not_enrolled', 'active'),
            ('10b00000-0000-4000-8000-000000000036', 'invited tutor learner', 'not_enrolled', 'active');

        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_manage_settings,
            invited_by_user_id,
            accepted_at
        )
        VALUES
            ('10b00000-0000-4000-8000-000000000041', '10b00000-0000-4000-8000-000000000031', '10b00000-0000-4000-8000-000000000001', 'parent', true, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000042', '10b00000-0000-4000-8000-000000000031', '10b00000-0000-4000-8000-000000000001', 'tutor', true, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000043', '10b00000-0000-4000-8000-000000000032', '10b00000-0000-4000-8000-000000000002', 'parent', true, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000044', '10b00000-0000-4000-8000-000000000032', '10b00000-0000-4000-8000-000000000002', 'tutor', true, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000045', '10b00000-0000-4000-8000-000000000033', '10b00000-0000-4000-8000-000000000003', 'parent', true, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000046', '10b00000-0000-4000-8000-000000000034', '10b00000-0000-4000-8000-000000000004', 'learner', false, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000047', '10b00000-0000-4000-8000-000000000035', '10b00000-0000-4000-8000-000000000005', 'tutor', false, NULL, transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000048', '10b00000-0000-4000-8000-000000000036', '10b00000-0000-4000-8000-000000000006', 'tutor', false, '10b00000-0000-4000-8000-000000000001', transaction_timestamp());

        INSERT INTO auth_sessions (
            id,
            user_id,
            token_hash,
            active_role,
            active_learner_id,
            expires_at,
            last_seen_at
        )
        VALUES
            ('10b00000-0000-4000-8000-000000000051', '10b00000-0000-4000-8000-000000000001', '0010-session-role-token', 'tutor', '10b00000-0000-4000-8000-000000000031', transaction_timestamp() + INTERVAL '1 hour', transaction_timestamp()),
            ('10b00000-0000-4000-8000-000000000052', '10b00000-0000-4000-8000-000000000003', '0010-temporary-mode-token', 'learner', '10b00000-0000-4000-8000-000000000033', transaction_timestamp() + INTERVAL '1 hour', transaction_timestamp());
    "

    run_sql_file_in_database \
        "$backfill_database_name" \
        "$migration_directory/0010_account_role_and_self_learner.up.sql"

    session_role="$(query_database "$backfill_database_name" "
        SELECT account_role
        FROM users
        WHERE id = '10b00000-0000-4000-8000-000000000001'
    ")"
    [ "$session_role" = "tutor" ] \
        || fail "0010 未優先採用最新且有同 role learner access 的有效 session"

    fallback_role="$(query_database "$backfill_database_name" "
        SELECT account_role
        FROM users
        WHERE id = '10b00000-0000-4000-8000-000000000002'
    ")"
    [ "$fallback_role" = "parent" ] \
        || fail "0010 access_role fallback 不具 deterministic parent 優先序"

    temporary_mode_role="$(query_database "$backfill_database_name" "
        SELECT account_role
        FROM users
        WHERE id = '10b00000-0000-4000-8000-000000000003'
    ")"
    [ "$temporary_mode_role" = "parent" ] \
        || fail "0010 將沒有 self access 的暫時 learner mode 誤回填為 learner identity"

    role_only_fallback="$(query_database "$backfill_database_name" "
        SELECT account_role
        FROM users
        WHERE id = '10b00000-0000-4000-8000-000000000007'
    ")"
    [ "$role_only_fallback" = "tutor" ] \
        || fail "0010 未以 deterministic active user_role fallback 映射尚無 learner access 的帳號"

    self_repair_count="$(query_database "$backfill_database_name" "
        SELECT count(*)
        FROM users AS app_user
        JOIN learner_access AS access
            ON access.user_id = app_user.id
            AND access.access_role = 'learner'
            AND access.revoked_at IS NULL
        JOIN learners AS learner ON learner.id = access.learner_id
        WHERE app_user.id = '10b00000-0000-4000-8000-000000000004'
            AND app_user.account_role = 'learner'
            AND learner.display_name = app_user.display_name
            AND access.can_manage_settings
    ")"
    [ "$self_repair_count" -eq 1 ] \
        || fail "0010 未完整修補既有 self learner 名稱或管理權限"

    tutor_permission_count="$(query_database "$backfill_database_name" "
        SELECT count(*)
        FROM learner_access
        WHERE (
            id = '10b00000-0000-4000-8000-000000000047'
            AND can_manage_settings
        ) OR (
            id = '10b00000-0000-4000-8000-000000000048'
            AND NOT can_manage_settings
        )
    ")"
    [ "$tutor_permission_count" -eq 2 ] \
        || fail "0010 tutor 權限修補擴及受邀 tutor 或漏掉註冊 tutor"

    drop_test_database "$backfill_database_name"
}

verify_0010_role_only_learner_preflight()
{
    preflight_database_name="${database_name}_0010_role_only_learner"
    preflight_before_schema="$snapshot_directory/0010-role-only-before.schema.sql"
    preflight_after_schema="$snapshot_directory/0010-role-only-after.schema.sql"
    preflight_error_log="$test_root/0010-role-only-preflight.log"

    clone_test_database "$preflight_database_name"

    run_sql_command_in_database "$preflight_database_name" "
        INSERT INTO users (id, display_name)
        VALUES (
            '10c00000-0000-4000-8000-000000000001',
            'role-only learner identity'
        );

        INSERT INTO account_identities (
            id,
            user_id,
            provider,
            provider_subject,
            email_normalized,
            password_hash,
            verified_at
        )
        VALUES (
            '10c00000-0000-4000-8000-000000000002',
            '10c00000-0000-4000-8000-000000000001',
            'email',
            '0010-role-only-learner@example.invalid',
            '0010-role-only-learner@example.invalid',
            'synthetic-password-hash',
            transaction_timestamp()
        );

        INSERT INTO user_roles (id, user_id, role, granted_by_type)
        VALUES (
            '10c00000-0000-4000-8000-000000000003',
            '10c00000-0000-4000-8000-000000000001',
            'learner',
            'bootstrap_admin'
        );
    "

    capture_schema_for_database \
        "$preflight_database_name" \
        "$preflight_before_schema"

    if run_sql_file_in_database \
        "$preflight_database_name" \
        "$migration_directory/0010_account_role_and_self_learner.up.sql" \
        2> "$preflight_error_log"
    then
        fail "0010 接受沒有 active accepted self access 的 learner identity"
    fi

    preflight_error_message="$(sed -n \
        '/存在無法對應有效一般角色的登入帳號，無法回填 users.account_role/p' \
        "$preflight_error_log")"
    [ -n "$preflight_error_message" ] \
        || fail "0010 role-only learner preflight 沒有回傳預期錯誤"

    capture_schema_for_database \
        "$preflight_database_name" \
        "$preflight_after_schema"
    assert_files_equal \
        "0010 role-only learner preflight 失敗後的 schema 原子性" \
        "$preflight_before_schema" \
        "$preflight_after_schema"

    migration_record_count="$(query_database "$preflight_database_name" \
        "SELECT count(*) FROM schema_migrations WHERE version = '0010'")"
    [ "$migration_record_count" -eq 0 ] \
        || fail "0010 role-only learner preflight 失敗後仍留下 migration 紀錄"

    drop_test_database "$preflight_database_name"
}

verify_0010_status_lock_order()
{
    concurrency_database_name="${database_name}_0010_lock_order"
    concurrency_barrier_key=1010011
    concurrency_barrier_log="$test_root/0010-lock-order-barrier.log"
    concurrency_parent_log="$test_root/0010-lock-order-parent.log"
    concurrency_archive_log="$test_root/0010-lock-order-archive.log"

    clone_test_database "$concurrency_database_name"

    run_sql_command_in_database "$concurrency_database_name" "
        INSERT INTO users (id, display_name)
        VALUES
            ('10d00000-0000-4000-8000-000000000001', 'lock-order self'),
            ('10d00000-0000-4000-8000-000000000002', 'lock-order parent');

        INSERT INTO learners (
            id,
            display_name,
            education_status,
            status
        )
        VALUES (
            '10d00000-0000-4000-8000-000000000003',
            'lock-order self',
            'not_enrolled',
            'active'
        );

        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_manage_settings,
            accepted_at
        )
        VALUES
            (
                '10d00000-0000-4000-8000-000000000004',
                '10d00000-0000-4000-8000-000000000003',
                '10d00000-0000-4000-8000-000000000001',
                'learner',
                true,
                transaction_timestamp()
            ),
            (
                '10d00000-0000-4000-8000-000000000005',
                '10d00000-0000-4000-8000-000000000003',
                '10d00000-0000-4000-8000-000000000002',
                'parent',
                true,
                transaction_timestamp()
            );
    "

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-lock-order-barrier';
        SELECT pg_advisory_lock($concurrency_barrier_key);
        SELECT pg_sleep(300);
    " > "$concurrency_barrier_log" 2>&1 &
    concurrency_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-lock-order-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 lock-order barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-parent-lock-path';
        SET statement_timeout = '30s';
        BEGIN;
        SELECT lerniqa_lock_auth_user(
            '10d00000-0000-4000-8000-000000000002'
        );
        SELECT pg_advisory_xact_lock_shared($concurrency_barrier_key);
        SELECT lerniqa_lock_auth_learner(
            '10d00000-0000-4000-8000-000000000003'
        );
        COMMIT;
    " > "$concurrency_parent_log" 2>&1 &
    concurrency_parent_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-parent-lock-path'
            AND wait_event_type = 'Lock'
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 parent lock path 未到達同步屏障"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-status-archive';
        SET statement_timeout = '30s';
        BEGIN;
        UPDATE learners
        SET status = 'archived'
        WHERE id = '10d00000-0000-4000-8000-000000000003';
        COMMIT;
    " > "$concurrency_archive_log" 2>&1 &
    concurrency_archive_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-status-archive'
            AND wait_event_type = 'Lock'
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 status archive 未等待已鎖定的 parent user"
        sleep 1
    done

    archive_granted_advisory_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-status-archive'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")"
    [ "$archive_granted_advisory_count" -eq 1 ] \
        || fail "0010 status path 在取得所有 access users 前先鎖 learner，仍有 ABBA 風險"

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-lock-order-barrier'
    " >/dev/null
    wait "$concurrency_barrier_pid" || true

    if ! wait "$concurrency_parent_pid"; then
        fail "0010 parent→learner lock path 交易失敗"
    fi
    if ! wait "$concurrency_archive_pid"; then
        fail "0010 all-access-users→learner status 交易失敗"
    fi

    learner_status="$(query_database "$concurrency_database_name" "
        SELECT status
        FROM learners
        WHERE id = '10d00000-0000-4000-8000-000000000003'
    ")"
    [ "$learner_status" = "archived" ] \
        || fail "0010 lock-order regression 後 learner 未成功封存"

    drop_test_database "$concurrency_database_name"
}

verify_0010_deferred_invariant_concurrency()
{
    concurrency_database_name="${database_name}_0010_invariants"
    role_barrier_key=1010012
    self_barrier_key=1010013
    role_barrier_log="$test_root/0010-role-barrier.log"
    role_switch_log="$test_root/0010-role-switch.log"
    role_revoke_log="$test_root/0010-role-revoke.log"
    self_barrier_log="$test_root/0010-self-barrier.log"
    self_insert_log="$test_root/0010-self-insert.log"
    self_rename_log="$test_root/0010-self-rename.log"

    clone_test_database "$concurrency_database_name"

    run_sql_command_in_database "$concurrency_database_name" "
        INSERT INTO users (id, display_name, account_role)
        VALUES
            ('10e00000-0000-4000-8000-000000000001', 'role race account', 'parent'),
            ('10e00000-0000-4000-8000-000000000002', 'self race account', 'parent');

        INSERT INTO user_roles (id, user_id, role, granted_by_type)
        VALUES
            ('10e00000-0000-4000-8000-000000000021', '10e00000-0000-4000-8000-000000000001', 'parent', 'bootstrap_admin'),
            ('10e00000-0000-4000-8000-000000000022', '10e00000-0000-4000-8000-000000000001', 'tutor', 'bootstrap_admin'),
            ('10e00000-0000-4000-8000-000000000023', '10e00000-0000-4000-8000-000000000002', 'parent', 'bootstrap_admin');

        INSERT INTO account_identities (
            id,
            user_id,
            provider,
            provider_subject,
            email_normalized,
            password_hash,
            verified_at
        )
        VALUES
            (
                '10e00000-0000-4000-8000-000000000011',
                '10e00000-0000-4000-8000-000000000001',
                'email',
                '0010-role-race@example.invalid',
                '0010-role-race@example.invalid',
                'synthetic-password-hash',
                transaction_timestamp()
            ),
            (
                '10e00000-0000-4000-8000-000000000012',
                '10e00000-0000-4000-8000-000000000002',
                'email',
                '0010-self-race@example.invalid',
                '0010-self-race@example.invalid',
                'synthetic-password-hash',
                transaction_timestamp()
            );

        INSERT INTO learners (id, display_name, education_status, status)
        VALUES (
            '10e00000-0000-4000-8000-000000000031',
            'self race account',
            'not_enrolled',
            'active'
        );
    "

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-role-barrier';
        SELECT pg_advisory_lock($role_barrier_key);
        SELECT pg_sleep(300);
    " > "$role_barrier_log" 2>&1 &
    role_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-role-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 role invariant barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-role-switch';
        SET statement_timeout = '30s';
        BEGIN;
        UPDATE users
        SET account_role = 'tutor'
        WHERE id = '10e00000-0000-4000-8000-000000000001';
        SELECT pg_advisory_xact_lock_shared($role_barrier_key);
        COMMIT;
    " > "$role_switch_log" 2>&1 &
    role_switch_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-role-switch'
            AND wait_event_type = 'Lock'
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 role switch 未到達同步屏障"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-role-revoke';
        SET statement_timeout = '30s';
        BEGIN;
        UPDATE user_roles
        SET revoked_by_type = 'bootstrap_admin',
            revoked_at = transaction_timestamp()
        WHERE id = '10e00000-0000-4000-8000-000000000022';
        COMMIT;
    " > "$role_revoke_log" 2>&1 &
    role_revoke_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-role-revoke'
            AND wait_event_type = 'Lock'
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 role grant revoke 未等待 account role user lock"
        sleep 1
    done

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-role-barrier'
    " >/dev/null
    wait "$role_barrier_pid" || true

    if ! wait "$role_switch_pid"; then
        fail "0010 account role 切換交易失敗"
    fi
    if wait "$role_revoke_pid"; then
        fail "0010 允許並行撤銷目前 account role 的唯一有效 grant"
    fi

    role_revoke_message="$(sed -n \
        '/有效登入身分必須具有 account_role 與相符角色/p' \
        "$role_revoke_log")"
    [ -n "$role_revoke_message" ] \
        || fail "0010 並行 grant 撤銷沒有回傳 account role invariant 錯誤"

    role_invariant_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM users AS app_user
        JOIN user_roles AS role
            ON role.user_id = app_user.id
            AND role.role = app_user.account_role
            AND role.revoked_at IS NULL
        WHERE app_user.id = '10e00000-0000-4000-8000-000000000001'
            AND app_user.account_role = 'tutor'
    ")"
    [ "$role_invariant_count" -eq 1 ] \
        || fail "0010 並行 role/grant 交易後沒有保留一致狀態"

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-self-barrier';
        SELECT pg_advisory_lock($self_barrier_key);
        SELECT pg_sleep(300);
    " > "$self_barrier_log" 2>&1 &
    self_barrier_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_locks AS held_lock
        JOIN pg_stat_activity AS activity ON activity.pid = held_lock.pid
        WHERE activity.datname = '$concurrency_database_name'
            AND activity.application_name = 'lerniqa-0010-self-barrier'
            AND held_lock.locktype = 'advisory'
            AND held_lock.granted
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 self invariant barrier 未取得 advisory lock"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-self-insert';
        SET statement_timeout = '30s';
        BEGIN;
        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_manage_settings,
            accepted_at
        )
        VALUES (
            '10e00000-0000-4000-8000-000000000041',
            '10e00000-0000-4000-8000-000000000031',
            '10e00000-0000-4000-8000-000000000002',
            'learner',
            true,
            transaction_timestamp()
        );
        SELECT pg_advisory_xact_lock_shared($self_barrier_key);
        COMMIT;
    " > "$self_insert_log" 2>&1 &
    self_insert_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-self-insert'
            AND wait_event_type = 'Lock'
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 self access insert 未到達同步屏障"
        sleep 1
    done

    run_sql_command_in_database "$concurrency_database_name" "
        SET application_name = 'lerniqa-0010-self-rename';
        SET statement_timeout = '30s';
        BEGIN;
        UPDATE learners
        SET display_name = 'drifted self race learner'
        WHERE id = '10e00000-0000-4000-8000-000000000031';
        COMMIT;
    " > "$self_rename_log" 2>&1 &
    self_rename_pid=$!

    concurrency_poll_count=0
    while [ "$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-self-rename'
            AND wait_event_type = 'Lock'
    ")" -ne 1 ]
    do
        concurrency_poll_count=$((concurrency_poll_count + 1))
        [ "$concurrency_poll_count" -lt 10 ] \
            || fail "0010 learner rename 未等待並行 self access"
        sleep 1
    done

    query_database "$concurrency_database_name" "
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '$concurrency_database_name'
            AND application_name = 'lerniqa-0010-self-barrier'
    " >/dev/null
    wait "$self_barrier_pid" || true

    if ! wait "$self_insert_pid"; then
        fail "0010 self access insert 交易失敗"
    fi
    if wait "$self_rename_pid"; then
        fail "0010 允許並行 learner rename 破壞 self learner 名稱同步"
    fi

    self_rename_message="$(sed -n \
        '/啟用且已接受的本人學習者關聯必須同步帳號名稱並可管理設定/p' \
        "$self_rename_log")"
    [ -n "$self_rename_message" ] \
        || fail "0010 並行 learner rename 沒有回傳 self learner invariant 錯誤"

    self_invariant_count="$(query_database "$concurrency_database_name" "
        SELECT count(*)
        FROM users AS app_user
        JOIN learner_access AS access
            ON access.user_id = app_user.id
            AND access.access_role = 'learner'
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
            AND access.can_manage_settings
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        WHERE app_user.id = '10e00000-0000-4000-8000-000000000002'
            AND learner.display_name = app_user.display_name
    ")"
    [ "$self_invariant_count" -eq 1 ] \
        || fail "0010 並行 self access/learner rename 後沒有保留一致狀態"

    drop_test_database "$concurrency_database_name"
}

if [ "$existing_server_mode" -eq 0 ]; then
    listen_addresses="$(query_database postgres "SHOW listen_addresses")"
    [ -z "$listen_addresses" ] || fail "隔離 PostgreSQL 仍啟用了 TCP：$listen_addresses"

    configured_socket_directory="$(query_database postgres "SHOW unix_socket_directories")"
    [ "$configured_socket_directory" = "$socket_directory" ] \
        || fail "PostgreSQL socket 不在隔離目錄"
fi

connection_kind="$(query_database postgres "SELECT COALESCE(inet_server_addr()::text, 'unix_socket')")"
[ "$connection_kind" = "unix_socket" ] || fail "資料庫連線不是 Unix socket"

connected_user="$(query_database postgres "SELECT current_user")"
[ "$connected_user" = "$database_user" ] \
    || fail "PostgreSQL 連線使用者不是本機使用者 $database_user：$connected_user"

connected_session_user="$(query_database postgres "SELECT session_user")"
[ "$connected_session_user" = "$database_user" ] \
    || fail "PostgreSQL session user 不是本機使用者 $database_user：$connected_session_user"

connected_server_port="$(query_database postgres "SHOW port")"
[ "$connected_server_port" = "$database_port" ] \
    || fail "PostgreSQL server port 與明確設定不符：$connected_server_port"

recovery_state="$(query_database postgres "SELECT pg_catalog.pg_is_in_recovery()")"
[ "$recovery_state" = "f" ] || fail "拒絕在 recovery 中的 PostgreSQL 執行 migration test"

if [ "$existing_server_mode" -eq 1 ]; then
    actual_socket_directory="$(query_database postgres "SHOW unix_socket_directories")"
    actual_socket_directory="$(canonicalize_single_socket_directory \
        "$actual_socket_directory")" \
        || fail "existing-local-server 回傳的 socket 不是單一 canonical 目錄"
    [ "$actual_socket_directory" = "$socket_directory" ] \
        || fail "existing-local-server socket 不符：$actual_socket_directory"

    actual_data_directory="$(query_database postgres "SHOW data_directory")"
    [ -d "$actual_data_directory" ] \
        || fail "existing-local-server 回傳不存在的 data_directory：$actual_data_directory"
    actual_data_directory="$(CDPATH= cd -P "$actual_data_directory" && pwd)"
    [ "$actual_data_directory" = "$expected_data_directory" ] \
        || fail "existing-local-server data_directory 不符：$actual_data_directory"
fi

create_test_database "$database_name" template0

empty_schema_file="$snapshot_directory/0000_empty.schema.sql"
empty_tables_file="$snapshot_directory/0000_empty.tables.txt"
first_schema_file="$snapshot_directory/first-full.schema.sql"
second_schema_file="$snapshot_directory/second-full.schema.sql"

: > "$empty_tables_file"
: > "$expected_records_file"
capture_schema "$empty_schema_file"

echo "第一次前進：執行 $migration_count 組 migration 與限制測試"
while IFS= read -r migration_name
do
    migration_version=${migration_name%%_*}
    migration_label=${migration_name#*_}
    echo "  up + test $migration_name"

    if [ "$migration_name" = "0009_automatic_answer_completeness" ]; then
        echo "    preflight rejects incomplete published/superseded data atomically"
        verify_0009_preflight_failure published
        verify_0009_preflight_failure superseded
    fi

    if [ "$migration_name" = "0008_auth_and_import_integrity" ]; then
        echo "    archived learner upgrade race fails atomically"
        verify_0008_archived_learner_upgrade_race
    fi

    if [ "$migration_name" = "0010_account_role_and_self_learner" ]; then
        echo "    learner identity without self access fails atomically"
        verify_0010_role_only_learner_preflight
        echo "    session-first and deterministic access/grant backfill"
        verify_0010_deterministic_backfill
        echo "    archived learner upgrade race fails atomically"
        verify_0010_archived_learner_upgrade_race
    fi

    if [ "$migration_name" = "0011_score_session_aggregates" ]; then
        echo "    legacy score aggregates, detail, and assets upgrade safely"
        verify_0011_legacy_score_upgrade
        echo "    incomplete completed legacy score sessions fail atomically"
        verify_0011_incomplete_completed_preflight
    fi

    run_sql_file "$migration_directory/$migration_name.up.sql"
    run_sql_file "$test_directory/$migration_name.sql"

    if [ "$migration_name" = "0009_automatic_answer_completeness" ]; then
        echo "    concurrent child mutation serializes with publication"
        verify_0009_concurrency_lock
    fi

    if [ "$migration_name" = "0010_account_role_and_self_learner" ]; then
        echo "    learner status locks all access users before learner"
        verify_0010_status_lock_order
        echo "    deferred account-role and self-learner invariants serialize"
        verify_0010_deferred_invariant_concurrency
    fi

    printf '%s|%s\n' "$migration_version" "$migration_label" \
        >> "$expected_records_file"
    capture_records "$actual_records_file"
    assert_files_equal \
        "$migration_name 的 schema_migrations 紀錄" \
        "$expected_records_file" \
        "$actual_records_file"

    capture_tables "$snapshot_directory/$migration_name.tables.txt"
    capture_schema "$snapshot_directory/$migration_name.schema.sql"
    cp "$expected_records_file" "$snapshot_directory/$migration_name.records.txt"
done < "$migration_names_file"

capture_schema "$first_schema_file"

echo "反向回滾：逐階段驗證 migration 紀錄與上一層 schema"
remaining_migration_count=$migration_count

while IFS= read -r migration_name
do
    echo "  down $migration_name"
    run_sql_file "$migration_directory/$migration_name.down.sql"

    down_test_path="$down_test_directory/$migration_name.sql"
    if [ -f "$down_test_path" ]; then
        echo "    test after down $migration_name"
        run_sql_file "$down_test_path"
    fi

    remaining_migration_count=$((remaining_migration_count - 1))

    if [ "$remaining_migration_count" -eq 0 ]; then
        expected_tables_file=$empty_tables_file
        expected_schema_file=$empty_schema_file
        schema_migrations_table="$(query_database "$database_name" \
            "SELECT COALESCE(to_regclass('public.schema_migrations')::text, '')")"
        [ -z "$schema_migrations_table" ] \
            || fail "完整回滾後 schema_migrations 仍存在"
    else
        previous_migration_name="$(sed -n "${remaining_migration_count}p" "$migration_names_file")"
        expected_tables_file="$snapshot_directory/$previous_migration_name.tables.txt"
        expected_schema_file="$snapshot_directory/$previous_migration_name.schema.sql"

        capture_records "$actual_records_file"
        assert_files_equal \
            "$migration_name 回滾後的 schema_migrations 紀錄" \
            "$snapshot_directory/$previous_migration_name.records.txt" \
            "$actual_records_file"
    fi

    capture_tables "$actual_tables_file"
    assert_files_equal \
        "$migration_name 回滾後的上一層資料表" \
        "$expected_tables_file" \
        "$actual_tables_file"

    rollback_schema_file="$snapshot_directory/$migration_name.rollback.schema.sql"
    capture_schema "$rollback_schema_file"
    assert_files_equal \
        "$migration_name 回滾後的 schema" \
        "$expected_schema_file" \
        "$rollback_schema_file"
done < "$reverse_migration_names_file"

remaining_relations="$(query_database "$database_name" \
    "SELECT c.relkind::text || ':' || c.relname
     FROM pg_catalog.pg_class AS c
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY c.relkind, c.relname")"
[ -z "$remaining_relations" ] \
    || fail "完整回滾後 public schema 仍有 relation：$remaining_relations"

remaining_functions="$(query_database "$database_name" \
    "SELECT p.oid::regprocedure::text
     FROM pg_catalog.pg_proc AS p
     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname ~ '^lerniqa_'
     ORDER BY 1")"
[ -z "$remaining_functions" ] \
    || fail "完整回滾後仍有 lerniqa_ function：$remaining_functions"

echo "第二次前進：重跑全部 migration 與限制測試"
while IFS= read -r migration_name
do
    echo "  up + test $migration_name"
    run_sql_file "$migration_directory/$migration_name.up.sql"
    run_sql_file "$test_directory/$migration_name.sql"

    capture_records "$actual_records_file"
    assert_files_equal \
        "$migration_name 第二次前進的 schema_migrations 紀錄" \
        "$snapshot_directory/$migration_name.records.txt" \
        "$actual_records_file"

    capture_tables "$actual_tables_file"
    assert_files_equal \
        "$migration_name 第二次前進的資料表" \
        "$snapshot_directory/$migration_name.tables.txt" \
        "$actual_tables_file"
done < "$migration_names_file"

capture_schema "$second_schema_file"
assert_files_equal \
    "兩次完整前進的 schema parity" \
    "$first_schema_file" \
    "$second_schema_file"

echo "$migration_count 組 migration 的前進、限制測試、逐階段回滾、再次前進與 schema parity 均通過"
