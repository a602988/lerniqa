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

for required_command in cp createdb diff dirname id initdb mkdir mktemp pg_ctl pg_dump psql rm sed sort
do
    command -v "$required_command" >/dev/null 2>&1 \
        || fail "缺少必要指令：$required_command"
done

[ -d "$migration_directory" ] || fail "找不到 migration 目錄"
[ -d "$test_directory" ] || fail "找不到 migration 測試目錄"

test_root="$(mktemp -d /tmp/lerniqa-db-test.XXXXXX)"
cluster_directory="$test_root/postgres"
socket_directory="$test_root/socket"
snapshot_directory="$test_root/snapshots"
postgres_log="$test_root/postgres.log"
migration_paths_file="$test_root/migration-paths.txt"
migration_names_file="$test_root/migration-names.txt"
reverse_migration_names_file="$test_root/reverse-migration-names.txt"
expected_records_file="$test_root/expected-records.txt"
actual_records_file="$test_root/actual-records.txt"
actual_tables_file="$test_root/actual-tables.txt"
schema_diff_file="$test_root/schema.diff"
database_name="lerniqa_schema_test_$$"
database_user="$(id -un)"
database_port=$((49152 + $$ % 15000))
server_started=0

cleanup()
{
    cleanup_status=$?
    trap - EXIT HUP INT TERM

    if [ "$server_started" -eq 1 ]; then
        if ! pg_ctl -D "$cluster_directory" -m fast -w stop >/dev/null 2>&1; then
            echo "無法停止隔離 PostgreSQL cluster：$cluster_directory" >&2
            if [ "$cleanup_status" -eq 0 ]; then
                cleanup_status=1
            fi
        fi
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

mkdir -m 700 "$cluster_directory" "$socket_directory" "$snapshot_directory"

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

LC_ALL=C sort -r "$migration_names_file" > "$reverse_migration_names_file"

unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER
unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
export PSQLRC=/dev/null
export PGCONNECT_TIMEOUT=5
export PGSSLMODE=disable
export PGAPPNAME=lerniqa-migration-test

initdb \
    -D "$cluster_directory" \
    --username="$database_user" \
    --auth-local=trust \
    --auth-host=reject \
    --encoding=UTF8 \
    --no-locale > "$test_root/initdb.log"

pg_ctl \
    -D "$cluster_directory" \
    -l "$postgres_log" \
    -o "-F -h '' -k $socket_directory -p $database_port -c unix_socket_permissions=0700" \
    -w start >/dev/null
server_started=1

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

run_sql_file()
{
    sql_file=$1

    psql \
        -X \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$database_name" \
        -v ON_ERROR_STOP=1 \
        -f "$sql_file" >/dev/null
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

capture_schema()
{
    schema_output_path=$1
    raw_schema_output_path="$schema_output_path.raw"

    pg_dump \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$database_name" \
        --schema-only \
        --no-owner \
        --no-privileges > "$raw_schema_output_path"

    sed '/^\\restrict /d; /^\\unrestrict /d' \
        "$raw_schema_output_path" > "$schema_output_path"
    rm "$raw_schema_output_path"
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

listen_addresses="$(query_database postgres "SHOW listen_addresses")"
[ -z "$listen_addresses" ] || fail "隔離 PostgreSQL 仍啟用了 TCP：$listen_addresses"

configured_socket_directory="$(query_database postgres "SHOW unix_socket_directories")"
[ "$configured_socket_directory" = "$socket_directory" ] \
    || fail "PostgreSQL socket 不在隔離目錄"

connection_kind="$(query_database postgres "SELECT COALESCE(inet_server_addr()::text, 'unix_socket')")"
[ "$connection_kind" = "unix_socket" ] || fail "資料庫連線不是 Unix socket"

createdb \
    -w \
    -h "$socket_directory" \
    -p "$database_port" \
    -U "$database_user" \
    --maintenance-db=postgres \
    --template=template0 \
    "$database_name"

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

    run_sql_file "$migration_directory/$migration_name.up.sql"
    run_sql_file "$test_directory/$migration_name.sql"

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
