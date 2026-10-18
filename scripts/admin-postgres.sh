#!/bin/sh

set -eu
umask 077

fail()
{
    echo "管理後台 PostgreSQL 操作失敗：$*" >&2
    exit 1
}

script_directory="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
repository_root="$(CDPATH= cd -P "$script_directory/.." && pwd)"
local_data_directory="$repository_root/local-data"
admin_data_directory="$local_data_directory/admin-e2e"
cluster_directory="$admin_data_directory/postgres"
socket_directory="$admin_data_directory/socket"
postgres_log="$admin_data_directory/postgres.log"
cluster_marker="$cluster_directory/.lerniqa-admin-postgres"
migration_directory="$repository_root/database/migrations"
operation_lock_directory="$admin_data_directory/.operation-lock"
checksum_manifest_file="$admin_data_directory/migration-checksums-v1.sha256"
database_name="lerniqa_admin_e2e"
database_user="$(id -un)"
database_port="55439"
marker_value="lerniqa-admin-postgres-v1"

operation_lock_acquired=0
migration_paths_file=""
expected_records_file=""
expected_checksums_file=""
actual_records_file=""
expected_prefix_file=""
expected_checksum_prefix_file=""
checksum_update_file=""
migration_snapshot_directory=""
server_started_here=0

cleanup()
{
    cleanup_status=$?
    trap - EXIT HUP INT TERM

    if [ "$cleanup_status" -ne 0 ] && [ "$server_started_here" -eq 1 ]; then
        if ! pg_ctl -D "$cluster_directory" -m fast -w stop >/dev/null 2>&1; then
            echo "無法停止本次啟動的隔離 PostgreSQL：$cluster_directory" >&2
        fi
    fi

    for temporary_file in \
        "$migration_paths_file" \
        "$expected_records_file" \
        "$expected_checksums_file" \
        "$actual_records_file" \
        "$expected_prefix_file" \
        "$expected_checksum_prefix_file" \
        "$checksum_update_file"
    do
        if [ -n "$temporary_file" ] && [ -f "$temporary_file" ]; then
            if ! rm -f "$temporary_file"; then
                echo "無法移除 migration 暫存檔：$temporary_file" >&2
                cleanup_status=1
            fi
        fi
    done

    if [ -n "$migration_snapshot_directory" ] && [ -d "$migration_snapshot_directory" ]; then
        for snapshot_file in "$migration_snapshot_directory"/*
        do
            if [ -f "$snapshot_file" ] && ! rm -f "$snapshot_file"; then
                echo "無法移除 migration 快照：$snapshot_file" >&2
                cleanup_status=1
            fi
        done
        if ! rmdir "$migration_snapshot_directory"; then
            echo "無法移除 migration 快照目錄：$migration_snapshot_directory" >&2
            cleanup_status=1
        fi
    fi

    if [ "$operation_lock_acquired" -eq 1 ]; then
        if ! rmdir "$operation_lock_directory"; then
            echo "無法釋放管理後台 PostgreSQL 操作鎖：$operation_lock_directory" >&2
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

assert_safe_paths()
{
    [ "$admin_data_directory" = "$repository_root/local-data/admin-e2e" ] \
        || fail "admin data 路徑不是固定隔離目錄：$admin_data_directory"
    [ "$cluster_directory" = "$repository_root/local-data/admin-e2e/postgres" ] \
        || fail "PGDATA 不是固定隔離目錄：$cluster_directory"
    [ "$socket_directory" = "$repository_root/local-data/admin-e2e/socket" ] \
        || fail "socket 不是固定隔離目錄：$socket_directory"
    [ "$cluster_directory" != "$repository_root/local-data/postgres" ] \
        || fail "拒絕使用一般本機 PostgreSQL cluster"

    for protected_path in \
        "$local_data_directory" \
        "$admin_data_directory" \
        "$cluster_directory" \
        "$socket_directory" \
        "$postgres_log" \
        "$checksum_manifest_file"
    do
        [ ! -L "$protected_path" ] \
            || fail "拒絕使用符號連結：$protected_path"
    done
}

prepare_environment()
{
    assert_safe_paths

    unset DATABASE_URL PGDATA
    unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER
    unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
    unset PGSSLCERT PGSSLKEY PGSSLROOTCERT PGSSLCRL PGSSLCRLDIR
    unset PGCHANNELBINDING PGREQUIREAUTH PGREQUIREPEER PGTARGETSESSIONATTRS
    export PSQLRC=/dev/null
    export PGCONNECT_TIMEOUT=5
    export PGSSLMODE=disable
    export PGAPPNAME=lerniqa-admin-postgres
    export LC_ALL=C
}

prepare_directories()
{
    [ ! -e "$local_data_directory" ] || [ -d "$local_data_directory" ] \
        || fail "local-data 不是目錄：$local_data_directory"
    [ ! -e "$admin_data_directory" ] || [ -d "$admin_data_directory" ] \
        || fail "admin-e2e 不是目錄：$admin_data_directory"
    [ ! -e "$socket_directory" ] || [ -d "$socket_directory" ] \
        || fail "socket 路徑不是目錄：$socket_directory"

    mkdir -p "$admin_data_directory" "$socket_directory"
    chmod 700 "$admin_data_directory" "$socket_directory"
}

acquire_operation_lock()
{
    [ "$operation_lock_acquired" -eq 0 ] || return
    prepare_directories

    if ! mkdir "$operation_lock_directory" 2>/dev/null; then
        fail "另一個管理後台 PostgreSQL 操作可能正在執行；若確認沒有，請人工檢查 $operation_lock_directory"
    fi
    operation_lock_acquired=1
}

directory_is_empty()
{
    checked_directory=$1

    for directory_entry in \
        "$checked_directory"/* \
        "$checked_directory"/.[!.]* \
        "$checked_directory"/..?*
    do
        if [ -e "$directory_entry" ] || [ -L "$directory_entry" ]; then
            return 1
        fi
    done
    return 0
}

assert_managed_cluster()
{
    [ -d "$cluster_directory" ] \
        || fail "管理後台 cluster 尚未初始化；請先執行 npm run admin:db:init"
    [ -f "$cluster_directory/PG_VERSION" ] \
        || fail "PGDATA 缺少 PG_VERSION，拒絕操作：$cluster_directory"
    [ -f "$cluster_marker" ] \
        || fail "PGDATA 不是由管理後台隔離 runner 建立，拒絕操作：$cluster_directory"
    [ ! -L "$cluster_marker" ] \
        || fail "管理標記不可為符號連結：$cluster_marker"

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

verify_connection_identity()
{
    connection_database=$1
    expected_database=$2

    connected_database="$(query_database "$connection_database" 'SELECT current_database()')"
    [ "$connected_database" = "$expected_database" ] \
        || fail "目前連線資料庫不符：$connected_database"

    server_data_directory="$(query_database "$connection_database" 'SHOW data_directory')"
    [ "$server_data_directory" = "$cluster_directory" ] \
        || fail "socket 連到非預期 PGDATA：$server_data_directory"

    server_listen_addresses="$(query_database "$connection_database" 'SHOW listen_addresses')"
    [ -z "$server_listen_addresses" ] \
        || fail "隔離 PostgreSQL 不可啟用 TCP：$server_listen_addresses"

    server_socket_directory="$(query_database "$connection_database" 'SHOW unix_socket_directories')"
    [ "$server_socket_directory" = "$socket_directory" ] \
        || fail "PostgreSQL socket 目錄不符：$server_socket_directory"

    server_socket_permissions="$(query_database "$connection_database" 'SHOW unix_socket_permissions')"
    [ "$server_socket_permissions" = "0700" ] \
        || fail "PostgreSQL socket 權限不是 0700：$server_socket_permissions"

    server_port="$(query_database "$connection_database" 'SHOW port')"
    [ "$server_port" = "$database_port" ] \
        || fail "PostgreSQL port 不符：$server_port"

    server_uses_unix_socket="$(query_database "$connection_database" 'SELECT inet_server_addr() IS NULL')"
    [ "$server_uses_unix_socket" = "t" ] \
        || fail "目前連線不是 Unix socket，拒絕繼續"
}

verify_server_identity()
{
    assert_managed_cluster
    pg_isready \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d postgres \
        -q \
        || fail "管理後台隔離 PostgreSQL 尚未接受連線"
    verify_connection_identity postgres postgres
}

database_exists()
{
    query_database postgres \
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = '$database_name')"
}

verify_target_database()
{
    [ "$(database_exists)" = "t" ] \
        || fail "管理後台資料庫尚未建立：$database_name"
    pg_isready \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$database_name" \
        -q \
        || fail "管理後台資料庫尚未接受連線：$database_name"
    verify_connection_identity "$database_name" "$database_name"
}

initialize_cluster()
{
    require_command initdb
    prepare_environment
    acquire_operation_lock

    if [ -e "$cluster_directory" ]; then
        [ -d "$cluster_directory" ] \
            || fail "PGDATA 路徑不是目錄：$cluster_directory"

        if [ -f "$cluster_directory/PG_VERSION" ]; then
            assert_managed_cluster
            echo "管理後台 PostgreSQL cluster 已初始化：$cluster_directory"
            return
        fi

        if ! directory_is_empty "$cluster_directory"; then
            fail "PGDATA 非空但沒有有效管理標記，拒絕操作：$cluster_directory"
        fi
    fi

    [ -d "$cluster_directory" ] || mkdir "$cluster_directory"
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
    echo "已初始化管理後台隔離 PostgreSQL cluster：$cluster_directory"
}

start_cluster()
{
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    prepare_environment
    acquire_operation_lock
    assert_managed_cluster

    if cluster_is_running; then
        verify_server_identity
        echo "管理後台 PostgreSQL 已在執行"
        return
    fi

    server_started_here=1
    pg_ctl \
        -D "$cluster_directory" \
        -l "$postgres_log" \
        -o "-h '' -k '$socket_directory' -p $database_port -c unix_socket_permissions=0700" \
        -w start >/dev/null

    verify_server_identity
    server_started_here=0
    echo "已啟動管理後台隔離 PostgreSQL（Unix socket only，port $database_port）"
}

stop_cluster()
{
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    prepare_environment
    acquire_operation_lock

    if [ ! -e "$cluster_directory" ]; then
        echo "管理後台 PostgreSQL 尚未初始化，視為已停止"
        return
    fi

    assert_managed_cluster
    if ! cluster_is_running; then
        echo "管理後台 PostgreSQL 已停止"
        return
    fi

    verify_server_identity
    pg_ctl -D "$cluster_directory" -m fast -w stop >/dev/null
    echo "已停止管理後台 PostgreSQL；資料保留於 $cluster_directory"
}

show_status()
{
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    require_command cmp
    require_command cp
    require_command mktemp
    require_command sed
    require_command shasum
    require_command tr
    require_command wc
    prepare_environment
    acquire_operation_lock

    if [ ! -e "$cluster_directory" ]; then
        echo "管理後台 PostgreSQL 尚未初始化"
        return 1
    fi

    assert_managed_cluster
    if ! cluster_is_running; then
        echo "管理後台 PostgreSQL 已停止；資料位於 $cluster_directory"
        return 1
    fi

    verify_server_identity
    if [ "$(database_exists)" != "t" ]; then
        echo "管理後台 PostgreSQL 執行中，但資料庫尚未建立：$database_name"
        return 1
    fi
    verify_target_database
    [ -d "$migration_directory" ] \
        || fail "找不到 migration 目錄：$migration_directory"
    build_migration_manifest
    assert_applied_prefix
    if ! cmp -s "$expected_records_file" "$actual_records_file"; then
        fail "管理後台資料庫 migration 尚未更新到 repository 最新版本"
    fi
    echo "管理後台 PostgreSQL 執行中：socket=$socket_directory port=$database_port database=$database_name user=$database_user"
}

ensure_database()
{
    assert_managed_cluster
    verify_server_identity

    if [ "$(database_exists)" != "t" ]; then
        createdb \
            -w \
            -h "$socket_directory" \
            -p "$database_port" \
            -U "$database_user" \
            --maintenance-db=postgres \
            --template=template0 \
            --encoding=UTF8 \
            "$database_name"
        echo "已建立管理後台隔離資料庫：$database_name"
    fi

    verify_target_database
}

build_migration_manifest()
{
    migration_paths_file="$(mktemp "$admin_data_directory/.migration-paths.XXXXXX")"
    expected_records_file="$(mktemp "$admin_data_directory/.migration-expected.XXXXXX")"
    expected_checksums_file="$(mktemp "$admin_data_directory/.migration-checksums-expected.XXXXXX")"
    actual_records_file="$(mktemp "$admin_data_directory/.migration-actual.XXXXXX")"
    expected_prefix_file="$(mktemp "$admin_data_directory/.migration-prefix.XXXXXX")"
    expected_checksum_prefix_file="$(mktemp "$admin_data_directory/.migration-checksum-prefix.XXXXXX")"
    migration_snapshot_directory="$(mktemp -d "$admin_data_directory/.migration-snapshot.XXXXXX")"

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

        migration_snapshot_path="$migration_snapshot_directory/$migration_filename"
        cp "$migration_path" "$migration_snapshot_path"
        cmp -s "$migration_path" "$migration_snapshot_path" \
            || fail "migration 在建立隔離快照時被修改，拒絕執行：$migration_filename"

        migration_checksum="$(shasum -a 256 "$migration_snapshot_path" | sed 's/[[:space:]].*$//')"
        case "$migration_checksum" in
            ''|*[!0-9a-f]*) fail "無法計算 migration SHA-256：$migration_filename" ;;
        esac
        [ "${#migration_checksum}" -eq 64 ] \
            || fail "migration SHA-256 長度不正確：$migration_filename"

        printf '%s\n' "$migration_snapshot_path" >> "$migration_paths_file"
        printf '%s|%s\n' "$migration_version" "$migration_label" >> "$expected_records_file"
        printf '%s|%s|%s\n' \
            "$migration_version" \
            "$migration_label" \
            "$migration_checksum" \
            >> "$expected_checksums_file"
    done

    [ "$migration_count" -gt 0 ] \
        || fail "沒有找到任何 .up.sql migration：$migration_directory"
}

assert_checksum_manifest_path()
{
    [ ! -L "$checksum_manifest_file" ] \
        || fail "migration checksum manifest 不可為符號連結：$checksum_manifest_file"
    [ ! -e "$checksum_manifest_file" ] || [ -f "$checksum_manifest_file" ] \
        || fail "migration checksum manifest 不是一般檔案：$checksum_manifest_file"
}

initialize_checksum_manifest()
{
    assert_checksum_manifest_path
    [ ! -e "$checksum_manifest_file" ] \
        || fail "migration checksum manifest 已存在，拒絕覆寫：$checksum_manifest_file"

    checksum_update_file="$(mktemp "$admin_data_directory/.migration-checksum-update.XXXXXX")"
    : > "$checksum_update_file"
    chmod 600 "$checksum_update_file"
    mv "$checksum_update_file" "$checksum_manifest_file"
    checksum_update_file=""
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

assert_applied_identity_prefix()
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

assert_checksum_manifest_prefix()
{
    applied_count=$1
    checksum_manifest_mode=${2:-verify}

    assert_checksum_manifest_path
    if [ ! -e "$checksum_manifest_file" ]; then
        if [ "$applied_count" -eq 0 ] && [ "$checksum_manifest_mode" = "initialize" ]; then
            initialize_checksum_manifest
        elif [ "$applied_count" -eq 0 ]; then
            fail "migration checksum manifest 尚未建立；請執行 npm run admin:db:migrate 初始化"
        else
            fail "資料庫已有 $applied_count 版 migration，但缺少隔離 checksum manifest；拒絕默認信任已套用 SQL，請重建 admin-e2e 資料庫或經人工核對後重建 manifest"
        fi
    fi

    if [ "$applied_count" -eq 0 ]; then
        [ ! -s "$checksum_manifest_file" ] \
            || fail "資料庫沒有已套用 migration，但 checksum manifest 不為空；請重建 admin-e2e 資料庫或人工核對"
        return
    fi

    [ -s "$checksum_manifest_file" ] \
        || fail "資料庫已有 migration，但 checksum manifest 為空；拒絕默認信任已套用 SQL"

    checksum_record_count="$(wc -l < "$checksum_manifest_file" | tr -d '[:space:]')"
    case "$checksum_record_count" in
        ''|*[!0-9]*) fail "無法判讀 checksum manifest 紀錄數量" ;;
    esac
    [ "$checksum_record_count" -eq "$applied_count" ] \
        || fail "checksum manifest 與資料庫已套用 migration 數量不一致；可能是中斷的升級，請人工核對或重建 admin-e2e 資料庫"

    sed -n "1,${applied_count}p" "$expected_checksums_file" \
        > "$expected_checksum_prefix_file"
    if ! cmp -s "$expected_checksum_prefix_file" "$checksum_manifest_file"; then
        echo "migration checksum manifest 與 repository SQL 不符。" >&2
        echo "預期 checksum：" >&2
        sed -n '1,120p' "$expected_checksum_prefix_file" >&2
        echo "已記錄 checksum：" >&2
        sed -n '1,120p' "$checksum_manifest_file" >&2
        fail "已套用 migration SQL 曾被修改；拒絕繼續，請重建 admin-e2e 資料庫或人工核對"
    fi
}

assert_applied_prefix()
{
    checksum_manifest_mode=${1:-verify}
    assert_applied_identity_prefix
    assert_checksum_manifest_prefix "$applied_count" "$checksum_manifest_mode"
}

record_migration_checksum()
{
    checksum_index=$1
    assert_checksum_manifest_path
    [ -f "$checksum_manifest_file" ] \
        || fail "無法記錄 migration checksum：manifest 不存在"

    checksum_record_count="$(wc -l < "$checksum_manifest_file" | tr -d '[:space:]')"
    expected_prior_count=$((checksum_index - 1))
    [ "$checksum_record_count" -eq "$expected_prior_count" ] \
        || fail "記錄 migration checksum 前的 manifest 長度不符，拒絕覆寫"

    checksum_update_file="$(mktemp "$admin_data_directory/.migration-checksum-update.XXXXXX")"
    if [ "$checksum_record_count" -gt 0 ]; then
        cp "$checksum_manifest_file" "$checksum_update_file"
    else
        : > "$checksum_update_file"
    fi
    sed -n "${checksum_index}p" "$expected_checksums_file" >> "$checksum_update_file"
    updated_checksum_count="$(wc -l < "$checksum_update_file" | tr -d '[:space:]')"
    [ "$updated_checksum_count" -eq "$checksum_index" ] \
        || fail "無法建立完整的 migration checksum manifest"
    chmod 600 "$checksum_update_file"
    mv "$checksum_update_file" "$checksum_manifest_file"
    checksum_update_file=""
}

run_migration_file()
{
    migration_path=$1
    assert_managed_cluster
    verify_target_database
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
    require_command cp
    require_command createdb
    require_command mktemp
    require_command pg_ctl
    require_command pg_isready
    require_command psql
    require_command sed
    require_command shasum
    require_command tr
    require_command wc
    require_command mv
    prepare_environment
    acquire_operation_lock
    [ -d "$migration_directory" ] \
        || fail "找不到 migration 目錄：$migration_directory"
    assert_managed_cluster
    cluster_is_running \
        || fail "管理後台 PostgreSQL 尚未啟動；請先執行 npm run admin:db:start"
    verify_server_identity

    ensure_database
    build_migration_manifest
    assert_applied_prefix initialize
    applied_count="$(wc -l < "$actual_records_file" | tr -d '[:space:]')"
    migration_index=0

    while IFS= read -r migration_path
    do
        migration_index=$((migration_index + 1))
        if [ "$migration_index" -le "$applied_count" ]; then
            continue
        fi

        migration_filename=${migration_path##*/}
        echo "套用管理後台 migration：$migration_filename"
        run_migration_file "$migration_path"
        assert_applied_identity_prefix
        current_applied_count="$(wc -l < "$actual_records_file" | tr -d '[:space:]')"
        [ "$current_applied_count" -eq "$migration_index" ] \
            || fail "$migration_filename 未留下正確的 schema_migrations 紀錄"
        record_migration_checksum "$migration_index"
        assert_applied_prefix
    done < "$migration_paths_file"

    assert_applied_prefix
    if ! cmp -s "$expected_records_file" "$actual_records_file"; then
        fail "migration 執行後仍未達 repository 最新版本"
    fi

    echo "管理後台資料庫 migration 已是最新，共 $migration_index 版"
}

usage()
{
    echo "用法：sh scripts/admin-postgres.sh {init|start|status|migrate|ensure|stop}" >&2
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
    status)
        show_status
        ;;
    migrate)
        migrate_database
        ;;
    ensure)
        initialize_cluster
        start_cluster
        migrate_database
        ;;
    stop)
        stop_cluster
        ;;
    *)
        usage
        ;;
esac
