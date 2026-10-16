import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function repositoryFile(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function shellFunction(source, name) {
    const startMarker = `${name}()\n{`;
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing shell function: ${name}`);
    const end = source.indexOf("\n}\n", start);
    assert.notEqual(end, -1, `unterminated shell function: ${name}`);
    return source.slice(start, end);
}

function assertAppearsBefore(source, earlier, later) {
    const earlierIndex = source.indexOf(earlier);
    const laterIndex = source.indexOf(later);
    assert.notEqual(earlierIndex, -1, `missing earlier guard: ${earlier}`);
    assert.notEqual(laterIndex, -1, `missing guarded operation: ${later}`);
    assert.ok(earlierIndex < laterIndex, `${earlier} must precede ${later}`);
}

test("the long-running dev site and validation build never share Next output", async () => {
    const [packageJson, nextConfig] = await Promise.all([
        repositoryFile("package.json").then(JSON.parse),
        repositoryFile("next.config.ts"),
    ]);
    const devOutput = packageJson.scripts.dev.match(/LERNIQA_NEXT_DIST_DIR=([^ ]+)/u)?.[1];
    const buildOutput = packageJson.scripts.build.match(/LERNIQA_NEXT_DIST_DIR=([^ ]+)/u)?.[1];
    const startOutput = packageJson.scripts.start.match(/LERNIQA_NEXT_DIST_DIR=([^ ]+)/u)?.[1];

    assert.equal(devOutput, ".next-dev");
    assert.equal(buildOutput, ".next-build");
    assert.equal(startOutput, buildOutput);
    assert.notEqual(devOutput, buildOutput);
    assert.match(nextConfig, /distDir:\s*process\.env\.LERNIQA_NEXT_DIST_DIR\s*\?\?\s*"\.next"/u);
});

test("the admin preview uses dedicated web, build, and PostgreSQL resources", async () => {
    const [packageJson, tsconfig, adminPostgres] = await Promise.all([
        repositoryFile("package.json").then(JSON.parse),
        repositoryFile("tsconfig.json").then(JSON.parse),
        repositoryFile("scripts/admin-postgres.sh"),
    ]);
    const scripts = packageJson.scripts;
    const adminDev = scripts["admin:dev"];
    const adminBuild = scripts["admin:build"];
    const adminStart = scripts["admin:start"];

    assert.equal(scripts["preadmin:dev"], "npm run test:runtime-guardrails && npm run admin:db:status");
    assert.equal(scripts["preadmin:build"], "npm run test:runtime-guardrails && npm run admin:db:status");
    assert.equal(scripts["preadmin:start"], "npm run test:runtime-guardrails && npm run admin:db:status");

    assert.match(adminDev, /NEXT_TELEMETRY_DISABLED=1/u);
    assert.match(adminDev, /LERNIQA_NEXT_DIST_DIR=\.next-admin(?:\s|$)/u);
    assert.match(adminDev, /next dev -H 127\.0\.0\.1 -p 3617/u);
    assert.match(adminBuild, /NEXT_TELEMETRY_DISABLED=1/u);
    assert.match(adminBuild, /LERNIQA_NEXT_DIST_DIR=\.next-admin-build(?:\s|$)/u);
    assert.match(adminStart, /NEXT_TELEMETRY_DISABLED=1/u);
    assert.match(adminStart, /LERNIQA_NEXT_DIST_DIR=\.next-admin-build(?:\s|$)/u);
    assert.match(adminStart, /next start -H 127\.0\.0\.1 -p 3617/u);

    for (const command of [adminDev, adminBuild, adminStart]) {
        assert.match(command, /LOCAL_PG_SOCKET=\$PWD\/local-data\/admin-e2e\/socket/u);
        assert.match(command, /LOCAL_PG_PORT=55439/u);
        assert.match(command, /LOCAL_PG_DATABASE=lerniqa_admin_e2e/u);
        assert.doesNotMatch(command, /(?:^|\D)(?:3500|8443|55432)(?:\D|$)/u);
    }

    assert.equal(scripts["admin:db:init"], "sh scripts/admin-postgres.sh init");
    assert.equal(scripts["admin:db:start"], "sh scripts/admin-postgres.sh start");
    assert.equal(scripts["admin:db:status"], "sh scripts/admin-postgres.sh status");
    assert.equal(scripts["admin:db:migrate"], "sh scripts/admin-postgres.sh migrate");
    assert.equal(scripts["admin:db:ensure"], "sh scripts/admin-postgres.sh ensure");
    assert.equal(scripts["admin:db:stop"], "sh scripts/admin-postgres.sh stop");

    assert.ok(tsconfig.include.includes(".next-admin/types/**/*.ts"));
    assert.ok(tsconfig.include.includes(".next-admin-build/types/**/*.ts"));

    assert.match(adminPostgres, /admin_data_directory="\$local_data_directory\/admin-e2e"/u);
    assert.match(adminPostgres, /cluster_directory="\$admin_data_directory\/postgres"/u);
    assert.match(adminPostgres, /socket_directory="\$admin_data_directory\/socket"/u);
    assert.match(adminPostgres, /database_name="lerniqa_admin_e2e"/u);
    assert.match(adminPostgres, /database_port="55439"/u);
    assert.match(adminPostgres, /marker_value="lerniqa-admin-postgres-v1"/u);
    assert.match(adminPostgres, /operation_lock_directory="\$admin_data_directory\/\.operation-lock"/u);
    assert.match(adminPostgres, /checksum_manifest_file="\$admin_data_directory\/migration-checksums-v1\.sha256"/u);
    assert.match(adminPostgres, /acquire_operation_lock/u);
    assert.match(adminPostgres, /--auth-host=reject/u);
    assert.match(adminPostgres, /-o "-h '' -k '\$socket_directory' -p \$database_port -c unix_socket_permissions=0700"/u);
    assert.match(adminPostgres, /unset DATABASE_URL PGDATA/u);
    assert.match(adminPostgres, /unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER/u);
    assert.match(adminPostgres, /SHOW data_directory/u);
    assert.match(adminPostgres, /SHOW listen_addresses/u);
    assert.match(adminPostgres, /SHOW unix_socket_directories/u);
    assert.match(adminPostgres, /SHOW unix_socket_permissions/u);
    assert.match(adminPostgres, /SELECT current_database\(\)/u);
    assert.match(adminPostgres, /SELECT inet_server_addr\(\) IS NULL/u);
    assert.match(adminPostgres, /migration_snapshot_directory="\$\(mktemp -d/u);
    assert.match(adminPostgres, /shasum -a 256 "\$migration_snapshot_path"/u);
    assert.doesNotMatch(adminPostgres, /cluster_directory="\$repository_root\/local-data\/postgres"/u);
    assert.doesNotMatch(adminPostgres, /(?:^|\D)(?:3500|8443|55432)(?:\D|$)/u);

    const initializeCluster = shellFunction(adminPostgres, "initialize_cluster");
    const startCluster = shellFunction(adminPostgres, "start_cluster");
    const stopCluster = shellFunction(adminPostgres, "stop_cluster");
    const showStatus = shellFunction(adminPostgres, "show_status");
    const migrateDatabase = shellFunction(adminPostgres, "migrate_database");
    const ensureDatabase = shellFunction(adminPostgres, "ensure_database");
    const buildMigrationManifest = shellFunction(adminPostgres, "build_migration_manifest");
    const checksumManifestPrefix = shellFunction(adminPostgres, "assert_checksum_manifest_prefix");
    const recordMigrationChecksum = shellFunction(adminPostgres, "record_migration_checksum");
    const runMigrationFile = shellFunction(adminPostgres, "run_migration_file");

    assertAppearsBefore(initializeCluster, "acquire_operation_lock", "initdb \\");
    assertAppearsBefore(startCluster, "acquire_operation_lock", "pg_ctl \\");
    assertAppearsBefore(startCluster, "server_started_here=1", "pg_ctl \\");
    assertAppearsBefore(stopCluster, "acquire_operation_lock", "pg_ctl -D");
    assertAppearsBefore(showStatus, "acquire_operation_lock", "verify_server_identity");
    assertAppearsBefore(showStatus, "require_command shasum", "build_migration_manifest");
    assertAppearsBefore(migrateDatabase, "acquire_operation_lock", "ensure_database");
    assertAppearsBefore(migrateDatabase, "assert_applied_prefix initialize", "run_migration_file");
    assertAppearsBefore(migrateDatabase, "assert_applied_identity_prefix", "record_migration_checksum \"$migration_index\"");
    assert.match(migrateDatabase, /record_migration_checksum "\$migration_index"\n\s+assert_applied_prefix\n\s+done/u);
    assertAppearsBefore(ensureDatabase, "verify_server_identity", "createdb \\");
    assertAppearsBefore(buildMigrationManifest, "cp \"$migration_path\"", "shasum -a 256");
    assert.match(checksumManifestPrefix, /\[ ! -e "\$checksum_manifest_file" \]/u);
    assert.match(checksumManifestPrefix, /\[ "\$applied_count" -eq 0 \] && \[ "\$checksum_manifest_mode" = "initialize" \]/u);
    assert.match(checksumManifestPrefix, /資料庫已有 \$applied_count 版 migration，但缺少隔離 checksum manifest/u);
    assert.match(checksumManifestPrefix, /cmp -s "\$expected_checksum_prefix_file" "\$checksum_manifest_file"/u);
    assertAppearsBefore(recordMigrationChecksum, "mktemp", "mv \"$checksum_update_file\" \"$checksum_manifest_file\"");
    assertAppearsBefore(runMigrationFile, "assert_managed_cluster", "psql \\");
    assertAppearsBefore(runMigrationFile, "verify_target_database", "psql \\");
});
