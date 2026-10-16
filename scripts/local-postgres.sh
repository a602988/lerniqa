#!/bin/sh

set -eu

fail()
{
    echo "本機 PostgreSQL 操作失敗：$*" >&2
    exit 1
}

script_directory="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
repository_root="$(CDPATH= cd -P "$script_directory/.." && pwd)"
local_data_directory="$repository_root/local-data"
cluster_directory="$local_data_directory/postgres"
socket_directory="$local_data_directory/postgres-socket"
postgres_log="$local_data_directory/postgres.log"
cluster_marker="$cluster_directory/.lerniqa-local-postgres"
migration_directory="$repository_root/database/migrations"
migration_lock_directory="$local_data_directory/.migration-lock"
database_name="lerniqa_local"
database_user="$(id -un)"
database_port="55432"
marker_value="lerniqa-local-postgres-v1"

migration_lock_acquired=0
migration_paths_file=""
expected_records_file=""
actual_records_file=""
expected_prefix_file=""

cleanup()
{
    cleanup_status=$?
    trap - EXIT HUP INT TERM

    for temporary_file in \
        "$migration_paths_file" \
        "$expected_records_file" \
        "$actual_records_file" \
        "$expected_prefix_file"
    do
        if [ -n "$temporary_file" ] && [ -f "$temporary_file" ]; then
            if ! rm -f "$temporary_file"; then
                echo "無法移除暫存檔：$temporary_file" >&2
                cleanup_status=1
            fi
        fi
    done

    if [ "$migration_lock_acquired" -eq 1 ]; then
        if ! rmdir "$migration_lock_directory"; then
            echo "無法釋放 migration 鎖：$migration_lock_directory" >&2
            cleanup_status=1
        fi
    fi

    exit "$cleanup_status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

require_command()
{
    command -v "$1" >/dev/null 2>&1 \
        || fail "缺少必要指令：$1（請先安裝本機 PostgreSQL 工具）"
}

prepare_environment()
{
    [ ! -L "$local_data_directory" ] \
        || fail "拒絕使用符號連結作為 local-data：$local_data_directory"
    [ ! -L "$cluster_directory" ] \
        || fail "拒絕使用符號連結作為 PGDATA：$cluster_directory"
    [ ! -L "$socket_directory" ] \
        || fail "拒絕使用符號連結作為 socket 目錄：$socket_directory"
    [ ! -L "$postgres_log" ] \
        || fail "拒絕使用符號連結作為 PostgreSQL log：$postgres_log"

    mkdir -p "$local_data_directory" "$socket_directory"
    chmod 700 "$local_data_directory" "$socket_directory"

    unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER
    unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
    export PSQLRC=/dev/null
    export PGCONNECT_TIMEOUT=5
    export PGSSLMODE=disable
    export PGAPPNAME=lerniqa-local-postgres
    export LC_ALL=C
}

assert_managed_cluster()
{
    [ -d "$cluster_directory" ] \
        || fail "尚未初始化本機 cluster；請先執行 npm run db:local:init"
    [ -f "$cluster_directory/PG_VERSION" ] \
        || fail "PGDATA 缺少 PG_VERSION，拒絕操作：$cluster_directory"
    [ -f "$cluster_marker" ] \
        || fail "PGDATA 不是由 Lerniqa 管理，拒絕操作：$cluster_directory"

    actual_marker="$(sed -n '1p' "$cluster_marker")"
    [ "$actual_marker" = "$marker_value" ] \
        || fail "PGDATA 管理標記不符，拒絕操作：$cluster_directory"
}

cluster_is_running()
{
    pg_ctl -D "$cluster_directory" status >/dev/null 2>&1
}

query_database()
{
    query_database_name=$1
    query_sql=$2

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
        -c "$query_sql"
}

verify_server_identity()
{
    pg_isready \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d postgres \
        -q \
        || fail "隔離 PostgreSQL 尚未接受連線"

    server_data_directory="$(query_database postgres 'SHOW data_directory')"
    [ "$server_data_directory" = "$cluster_directory" ] \
        || fail "socket 連到非預期 PGDATA：$server_data_directory"

    server_listen_addresses="$(query_database postgres 'SHOW listen_addresses')"
    [ -z "$server_listen_addresses" ] \
        || fail "隔離 PostgreSQL 不可啟用 TCP：$server_listen_addresses"

    server_socket_directory="$(query_database postgres 'SHOW unix_socket_directories')"
    [ "$server_socket_directory" = "$socket_directory" ] \
        || fail "PostgreSQL socket 目錄不符：$server_socket_directory"

    server_socket_permissions="$(query_database postgres 'SHOW unix_socket_permissions')"
    [ "$server_socket_permissions" = "0700" ] \
        || fail "PostgreSQL socket 權限不是 0700：$server_socket_permissions"

    server_port="$(query_database postgres 'SHOW port')"
    [ "$server_port" = "$database_port" ] \
        || fail "PostgreSQL port 不符：$server_port"

    server_uses_unix_socket="$(query_database postgres 'SELECT inet_server_addr() IS NULL')"
    [ "$server_uses_unix_socket" = "t" ] \
        || fail "目前連線不是 Unix socket，拒絕繼續"
}

initialize_cluster()
{
    require_command initdb
    prepare_environment

    if [ -e "$cluster_directory" ]; then
        [ -d "$cluster_directory" ] \
            || fail "PGDATA 路徑不是目錄：$cluster_directory"

        if [ -f "$cluster_directory/PG_VERSION" ]; then
            assert_managed_cluster
            echo "本機 PostgreSQL cluster 已初始化：$cluster_directory"
            return
        fi

        if find "$cluster_directory" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
            fail "PGDATA 非空但尚未初始化，請人工檢查後再處理：$cluster_directory"
        fi
    else
        mkdir "$cluster_directory"
    fi

    chmod 700 "$cluster_directory"
    initdb \
        -D "$cluster_directory" \
        --username="$database_user" \
        --auth-local=trust \
        --auth-host=reject \
        --encoding=UTF8 \
        --no-locale

    printf '%s\n' "$marker_value" > "$cluster_marker"
    chmod 600 "$cluster_marker"
    echo "已初始化隔離 PostgreSQL cluster：$cluster_directory"
}

start_cluster()
{
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    initialize_cluster
    assert_managed_cluster

    if cluster_is_running; then
        verify_server_identity
        echo "本機 PostgreSQL 已在執行"
        return
    fi

    pg_ctl \
        -D "$cluster_directory" \
        -l "$postgres_log" \
        -o "-h '' -k $socket_directory -p $database_port -c unix_socket_permissions=0700" \
        -w start >/dev/null

    verify_server_identity
    echo "已啟動本機 PostgreSQL（Unix socket only，port $database_port）"
}

stop_cluster()
{
    require_command pg_ctl
    prepare_environment

    if [ ! -e "$cluster_directory" ]; then
        echo "本機 PostgreSQL 尚未初始化，視為已停止"
        return
    fi

    assert_managed_cluster
    if ! cluster_is_running; then
        echo "本機 PostgreSQL 已停止"
        return
    fi

    pg_ctl -D "$cluster_directory" -m fast -w stop >/dev/null
    echo "已停止本機 PostgreSQL；資料保留於 $cluster_directory"
}

show_status()
{
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    prepare_environment

    if [ ! -e "$cluster_directory" ]; then
        echo "本機 PostgreSQL 尚未初始化"
        return 1
    fi

    assert_managed_cluster
    if ! cluster_is_running; then
        echo "本機 PostgreSQL 已停止；資料位於 $cluster_directory"
        return 1
    fi

    verify_server_identity
    echo "本機 PostgreSQL 執行中：socket=$socket_directory port=$database_port database=$database_name user=$database_user"
}

database_exists()
{
    query_database postgres \
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = '$database_name')"
}

ensure_database()
{
    if [ "$(database_exists)" = "t" ]; then
        return
    fi

    createdb \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        --maintenance-db=postgres \
        --template=template0 \
        --encoding=UTF8 \
        "$database_name"
    echo "已建立本機資料庫：$database_name"
}

build_migration_manifest()
{
    migration_paths_file="$(mktemp "$local_data_directory/.migration-paths.XXXXXX")"
    expected_records_file="$(mktemp "$local_data_directory/.migration-expected.XXXXXX")"
    actual_records_file="$(mktemp "$local_data_directory/.migration-actual.XXXXXX")"
    expected_prefix_file="$(mktemp "$local_data_directory/.migration-prefix.XXXXXX")"

    migration_count=0
    for migration_path in "$migration_directory"/*.up.sql
    do
        [ -f "$migration_path" ] || continue
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
        [ -n "$migration_label" ] \
            || fail "migration 名稱不可為空：$migration_filename"

        migration_count=$((migration_count + 1))
        expected_version="$(printf '%04d' "$migration_count")"
        [ "$migration_version" = "$expected_version" ] \
            || fail "migration 版本斷裂：預期 $expected_version，實際為 $migration_version"

        printf '%s\n' "$migration_path" >> "$migration_paths_file"
        printf '%s|%s\n' "$migration_version" "$migration_label" >> "$expected_records_file"
    done

    [ "$migration_count" -gt 0 ] \
        || fail "沒有找到任何 .up.sql migration：$migration_directory"
}

capture_applied_migrations()
{
    schema_migrations_exists="$(query_database "$database_name" \
        "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"

    if [ "$schema_migrations_exists" = "f" ]; then
        public_relation_count="$(query_database "$database_name" \
            "SELECT count(*) FROM pg_catalog.pg_class AS relation JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')")"
        [ "$public_relation_count" = "0" ] \
            || fail "資料庫已有 public 物件但缺少 schema_migrations，拒絕推測其版本"
        : > "$actual_records_file"
        return
    fi

    query_database "$database_name" \
        "SELECT version || '|' || name FROM schema_migrations ORDER BY version" \
        > "$actual_records_file"

    [ -s "$actual_records_file" ] \
        || fail "schema_migrations 存在但沒有任何版本紀錄，拒絕繼續"
}

assert_applied_prefix()
{
    capture_applied_migrations
    applied_count="$(wc -l < "$actual_records_file" | tr -d '[:space:]')"
    migration_count="$(wc -l < "$expected_records_file" | tr -d '[:space:]')"

    case "$applied_count" in
        ''|*[!0-9]*) fail "無法判讀已套用的 migration 數量" ;;
    esac
    [ "$applied_count" -le "$migration_count" ] \
        || fail "資料庫 migration 比 repository 更新，拒絕降版或覆寫"

    : > "$expected_prefix_file"
    if [ "$applied_count" -gt 0 ]; then
        sed -n "1,${applied_count}p" "$expected_records_file" > "$expected_prefix_file"
    fi

    if ! cmp -s "$expected_prefix_file" "$actual_records_file"; then
        echo "資料庫 migration 不是 repository manifest 的完整前綴。" >&2
        echo "預期前綴：" >&2
        sed -n '1,120p' "$expected_prefix_file" >&2
        echo "實際紀錄：" >&2
        sed -n '1,120p' "$actual_records_file" >&2
        fail "偵測到未知版本、跳號或名稱不符"
    fi
}

run_migration_file()
{
    migration_path=$1
    psql \
        -X \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$database_name" \
        -v ON_ERROR_STOP=1 \
        -f "$migration_path" >/dev/null
}

migrate_database()
{
    require_command cmp
    require_command createdb
    require_command mktemp
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    require_command sed
    require_command tr
    require_command wc
    prepare_environment
    [ -d "$migration_directory" ] \
        || fail "找不到 migration 目錄：$migration_directory"
    assert_managed_cluster
    cluster_is_running \
        || fail "本機 PostgreSQL 尚未啟動；請先執行 npm run db:local:start"
    verify_server_identity

    if ! mkdir "$migration_lock_directory" 2>/dev/null; then
        fail "另一個 migration 可能正在執行；若確認沒有，請人工移除 $migration_lock_directory"
    fi
    migration_lock_acquired=1

    ensure_database
    build_migration_manifest
    assert_applied_prefix
    applied_count="$(wc -l < "$actual_records_file" | tr -d '[:space:]')"
    migration_index=0

    while IFS= read -r migration_path
    do
        migration_index=$((migration_index + 1))
        if [ "$migration_index" -le "$applied_count" ]; then
            continue
        fi

        migration_filename=${migration_path##*/}
        echo "套用 migration：$migration_filename"
        run_migration_file "$migration_path"
        assert_applied_prefix
        current_applied_count="$(wc -l < "$actual_records_file" | tr -d '[:space:]')"
        [ "$current_applied_count" -eq "$migration_index" ] \
            || fail "$migration_filename 未留下正確的 schema_migrations 紀錄"
    done < "$migration_paths_file"

    assert_applied_prefix
    if ! cmp -s "$expected_records_file" "$actual_records_file"; then
        fail "migration 執行後仍未達 repository 最新版本"
    fi

    echo "本機資料庫 migration 已是最新，共 $migration_index 版"
}

usage()
{
    echo "用法：sh scripts/local-postgres.sh {init|start|stop|status|migrate|ensure}" >&2
    exit 2
}

command_name=${1:-}
case "$command_name" in
    init)
        initialize_cluster
        ;;
    start)
        start_cluster
        ;;
    stop)
        stop_cluster
        ;;
    status)
        show_status
        ;;
    migrate)
        migrate_database
        ;;
    ensure)
        start_cluster
        migrate_database
        ;;
    *)
        usage
        ;;
esac
