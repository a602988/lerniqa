#!/bin/sh

set -eu

# Database dumps contain account and learner data. Keep every generated file
# private even when the caller has a permissive umask.
umask 077

fail()
{
    echo "本機資料備份失敗：$*" >&2
    exit 1
}

script_directory="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
repository_root="$(CDPATH= cd -P "$script_directory/.." && pwd)"
local_data_directory="$repository_root/local-data"
cluster_directory="$local_data_directory/postgres"
socket_directory="$local_data_directory/postgres-socket"
cluster_marker="$cluster_directory/.lerniqa-local-postgres"
assets_directory="$local_data_directory/assets"
backups_directory="$local_data_directory/backups"
backup_lock_directory="$local_data_directory/.backup-lock"
database_name="lerniqa_local"
database_user="$(id -un)"
database_port="55432"
marker_value="lerniqa-local-postgres-v1"

backup_lock_acquired=0
bundle_directory=""

cleanup()
{
    cleanup_status=$?
    trap - EXIT HUP INT TERM

    if [ "$backup_lock_acquired" -eq 1 ]; then
        if ! rmdir "$backup_lock_directory"; then
            echo "無法釋放備份鎖：$backup_lock_directory" >&2
            cleanup_status=1
        fi
    fi

    if [ "$cleanup_status" -ne 0 ] && [ -n "$bundle_directory" ]; then
        echo "未完成的備份已保留供檢查：$bundle_directory" >&2
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

file_size()
{
    file_size_path=$1
    if file_size_value="$(stat -f '%z' "$file_size_path" 2>/dev/null)"; then
        printf '%s\n' "$file_size_value"
        return
    fi
    stat -c '%s' "$file_size_path"
}

file_sha256()
{
    file_sha256_output="$(shasum -a 256 "$1")"
    printf '%s\n' "${file_sha256_output%% *}"
}

prepare_environment()
{
    [ ! -L "$local_data_directory" ] \
        || fail "拒絕使用符號連結作為 local-data：$local_data_directory"
    [ -d "$local_data_directory" ] \
        || fail "找不到 local-data；請先執行 npm run db:local:init"
    [ ! -L "$cluster_directory" ] \
        || fail "拒絕使用符號連結作為 PGDATA：$cluster_directory"
    [ ! -L "$socket_directory" ] \
        || fail "拒絕使用符號連結作為 socket 目錄：$socket_directory"
    [ ! -L "$backups_directory" ] \
        || fail "拒絕使用符號連結作為備份目錄：$backups_directory"

    mkdir -p "$backups_directory"
    chmod 700 "$local_data_directory" "$backups_directory"

    unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER
    unset PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSWORD PGPASSFILE
    export PSQLRC=/dev/null
    export PGCONNECT_TIMEOUT=5
    export PGSSLMODE=disable
    export PGAPPNAME=lerniqa-local-backup
    export LC_ALL=C
}

assert_local_database()
{
    [ -d "$cluster_directory" ] \
        || fail "尚未初始化本機 PostgreSQL；請先執行 npm run db:local:init"
    [ -f "$cluster_directory/PG_VERSION" ] \
        || fail "PGDATA 缺少 PG_VERSION，拒絕操作：$cluster_directory"
    [ -f "$cluster_marker" ] \
        || fail "PGDATA 不是由 Lerniqa 管理，拒絕操作：$cluster_directory"

    actual_marker="$(sed -n '1p' "$cluster_marker")"
    [ "$actual_marker" = "$marker_value" ] \
        || fail "PGDATA 管理標記不符，拒絕操作：$cluster_directory"

    pg_ctl -D "$cluster_directory" status >/dev/null 2>&1 \
        || fail "本機 PostgreSQL 尚未啟動；請先執行 npm run db:local:ensure"
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

    database_exists="$(query_database postgres \
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = '$database_name')")"
    [ "$database_exists" = "t" ] \
        || fail "找不到本機資料庫：$database_name"
}

reserve_bundle_directory()
{
    backup_timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
    bundle_prefix="lerniqa-local-$backup_timestamp"
    bundle_counter=0

    while :
    do
        if [ "$bundle_counter" -eq 0 ]; then
            bundle_name="$bundle_prefix"
        else
            bundle_name="$bundle_prefix-$(printf '%02d' "$bundle_counter")"
        fi
        bundle_directory="$backups_directory/$bundle_name"
        if mkdir "$bundle_directory" 2>/dev/null; then
            chmod 700 "$bundle_directory"
            printf 'created_at_utc=%s\n' "$backup_timestamp" \
                > "$bundle_directory/INCOMPLETE"
            return
        fi
        bundle_counter=$((bundle_counter + 1))
        [ "$bundle_counter" -le 99 ] \
            || fail "同一秒已有 100 份備份，拒絕覆寫任何既有目錄"
    done
}

backup_database()
{
    database_dump="$bundle_directory/database.dump"
    database_restore_list="$bundle_directory/database.restore-list.txt"

    pg_dump \
        -w \
        -h "$socket_directory" \
        -p "$database_port" \
        -U "$database_user" \
        -d "$database_name" \
        --format=custom \
        --no-owner \
        --no-privileges \
        --file="$database_dump"

    pg_restore --list "$database_dump" > "$database_restore_list"
    [ -s "$database_restore_list" ] \
        || fail "pg_restore 無法列出剛建立的 database.dump"
}

backup_assets()
{
    assets_included="no"
    assets_file_count="0"
    assets_archive=""
    assets_archive_list=""

    if [ ! -e "$assets_directory" ]; then
        return
    fi
    [ -d "$assets_directory" ] \
        || fail "本機資產路徑不是目錄：$assets_directory"
    [ ! -L "$assets_directory" ] \
        || fail "拒絕備份符號連結資產目錄：$assets_directory"

    first_asset_symlink="$(find "$assets_directory" -type l -print -quit)"
    [ -z "$first_asset_symlink" ] \
        || fail "資產目錄含有符號連結，拒絕跨界讀取：$first_asset_symlink"

    first_asset_file="$(find "$assets_directory" \
        -path "$assets_directory/.staging" -prune -o \
        -type f -print -quit)"
    if [ -z "$first_asset_file" ]; then
        return
    fi

    assets_included="yes"
    assets_archive="$bundle_directory/assets.tar.gz"
    assets_archive_list="$bundle_directory/assets.archive-list.txt"

    tar \
        --exclude='assets/.staging' \
        -C "$local_data_directory" \
        -czf "$assets_archive" \
        assets
    tar -tzf "$assets_archive" > "$assets_archive_list"
    assets_file_count="$(sed -n '/\/$/!p' "$assets_archive_list" | wc -l | tr -d '[:space:]')"
    case "$assets_file_count" in
        ''|*[!0-9]*) fail "無法判讀資產備份檔案數" ;;
    esac
    [ "$assets_file_count" -gt 0 ] \
        || fail "資產封存檔沒有任何檔案"
}

write_and_verify_manifests()
{
    checksum_manifest="$bundle_directory/checksums.sha256"
    backup_manifest="$bundle_directory/manifest.txt"
    backup_manifest_checksum="$bundle_directory/manifest.sha256"

    (
        cd "$bundle_directory"
        shasum -a 256 database.dump database.restore-list.txt
        if [ "$assets_included" = "yes" ]; then
            shasum -a 256 assets.tar.gz assets.archive-list.txt
        fi
    ) > "$checksum_manifest"

    (
        cd "$bundle_directory"
        shasum -a 256 -c checksums.sha256 >/dev/null
    )

    completed_at_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    database_dump_sha256="$(file_sha256 "$database_dump")"
    database_dump_bytes="$(file_size "$database_dump")"
    checksum_manifest_sha256="$(file_sha256 "$checksum_manifest")"

    {
        printf 'format=lerniqa-local-backup-v1\n'
        printf 'created_at_utc=%s\n' "$backup_timestamp"
        printf 'completed_at_utc=%s\n' "$completed_at_utc"
        printf 'database=%s\n' "$database_name"
        printf 'database_dump=database.dump\n'
        printf 'database_dump_format=postgresql-custom\n'
        printf 'database_dump_bytes=%s\n' "$database_dump_bytes"
        printf 'database_dump_sha256=%s\n' "$database_dump_sha256"
        printf 'database_restore_list=database.restore-list.txt\n'
        printf 'assets_included=%s\n' "$assets_included"
        printf 'assets_file_count=%s\n' "$assets_file_count"
        if [ "$assets_included" = "yes" ]; then
            printf 'assets_archive=assets.tar.gz\n'
            printf 'assets_archive_bytes=%s\n' "$(file_size "$assets_archive")"
            printf 'assets_archive_sha256=%s\n' "$(file_sha256 "$assets_archive")"
            printf 'assets_archive_list=assets.archive-list.txt\n'
        fi
        printf 'checksums=checksums.sha256\n'
        printf 'checksums_sha256=%s\n' "$checksum_manifest_sha256"
    } > "$backup_manifest"

    (
        cd "$bundle_directory"
        shasum -a 256 manifest.txt > manifest.sha256
        shasum -a 256 -c manifest.sha256 >/dev/null
    )

    printf 'completed_at_utc=%s\n' "$completed_at_utc" \
        > "$bundle_directory/COMPLETE"
    rm "$bundle_directory/INCOMPLETE"
}

usage()
{
    echo "用法：sh scripts/backup-local-data.sh" >&2
    exit 2
}

[ "$#" -eq 0 ] || usage

for required_command in \
    date find id mkdir pg_ctl pg_dump pg_isready pg_restore psql \
    rmdir sed shasum stat tar tr wc
do
    require_command "$required_command"
done

prepare_environment
assert_local_database

if ! mkdir "$backup_lock_directory" 2>/dev/null; then
    fail "另一個備份可能正在執行；若確認沒有，請人工移除 $backup_lock_directory"
fi
backup_lock_acquired=1

reserve_bundle_directory
backup_database
backup_assets
write_and_verify_manifests

echo "本機資料備份完成：$bundle_directory"
