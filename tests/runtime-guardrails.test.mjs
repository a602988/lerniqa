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
    assert.match(packageJson.scripts.dev, /next dev -p 3500 --hostname 127\.0\.0\.1/u);
    assert.match(packageJson.scripts.start, /next start --hostname 127\.0\.0\.1/u);
    assert.doesNotMatch(packageJson.scripts.dev, /--hostname 0\.0\.0\.0/u);
    assert.doesNotMatch(packageJson.scripts.start, /--hostname 0\.0\.0\.0/u);
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

test("local practice responses containing learner data are private and never cacheable", async () => {
    const [shared, questions, sessions, attempts, history, asset] = await Promise.all([
        repositoryFile("app/api/v1/local-practice/_shared.ts"),
        repositoryFile("app/api/v1/local-practice/questions/route.ts"),
        repositoryFile("app/api/v1/local-practice/sessions/route.ts"),
        repositoryFile("app/api/v1/local-practice/attempts/route.ts"),
        repositoryFile("app/api/v1/local-practice/history/route.ts"),
        repositoryFile("app/api/v1/local-practice/assets/[assetId]/route.ts"),
    ]);
    const jsonRoutes = [questions, sessions, attempts, history];

    assert.match(shared, /headers\.set\("Cache-Control", "private, no-store"\)/u);
    assert.match(shared, /return localPracticeJsonResponse\(\{ error:/u);
    for (const route of jsonRoutes) {
        assert.match(route, /localPracticeJsonResponse/u);
        assert.doesNotMatch(route, /NextResponse\.json/u);
    }
    assert.match(asset, /"Cache-Control": "private, no-store"/u);
});

test("legacy fixture data cannot be read, overwritten, imported, or reset over HTTP", async () => {
    const [guard, bootstrap, state, reset, questions, imports, assets] = await Promise.all([
        repositoryFile("app/api/v1/_legacy-fixture.ts"),
        repositoryFile("app/api/v1/bootstrap/route.ts"),
        repositoryFile("app/api/v1/state/route.ts"),
        repositoryFile("app/api/v1/reset/route.ts"),
        repositoryFile("app/api/v1/questions/route.ts"),
        repositoryFile("app/api/v1/imports/route.ts"),
        repositoryFile("app/api/v1/assets/[storageKey]/route.ts"),
    ]);

    assert.match(guard, /status: 410/u);
    assert.match(guard, /"Cache-Control": "private, no-store"/u);
    for (const route of [bootstrap, state, reset, questions, imports, assets]) {
        assert.match(route, /legacyFixtureApiGone\(\)/u);
        assert.doesNotMatch(route, /readDatabase|updateDatabase|resetDatabase|readFile|writeDataImage/u);
    }

    const workspace = await repositoryFile("app/page.tsx");
    assert.doesNotMatch(workspace, /\/api\/v1\/(?:bootstrap|state)/u);
});

test("borrowed PostgreSQL migration cleanup is explicit and ownership-token guarded", async () => {
    const runner = await repositoryFile("scripts/verify-database-migrations.sh");
    const cleanupStart = runner.indexOf("cleanup_existing_test_databases()\n");
    const cleanupEnd = runner.indexOf("\nstop_private_test_postgres()\n", cleanupStart);
    const privateStopStart = cleanupEnd + 1;
    const privateStopEnd = runner.indexOf("\ncleanup()\n", privateStopStart);
    const outerCleanupStart = privateStopEnd + 1;
    const outerCleanupEnd = runner.indexOf("\ntrap cleanup EXIT", outerCleanupStart);
    const createStart = runner.indexOf("create_test_database()\n");
    const createEnd = runner.indexOf("\ndrop_test_database()\n", createStart);
    const dropStart = createEnd + 1;
    const dropEnd = runner.indexOf("\nverify_0011_legacy_score_upgrade()\n", dropStart);

    assert.notEqual(cleanupStart, -1);
    assert.notEqual(cleanupEnd, -1);
    assert.notEqual(privateStopStart, -1);
    assert.notEqual(privateStopEnd, -1);
    assert.notEqual(outerCleanupEnd, -1);
    assert.notEqual(createStart, -1);
    assert.notEqual(createEnd, -1);
    assert.notEqual(dropEnd, -1);

    assert.match(runner, /socket_directory="\$\{LERNIQA_DB_TEST_SOCKET:-\}"/u);
    assert.match(runner, /database_port="\$\{LERNIQA_DB_TEST_PORT:-\}"/u);
    assert.match(runner, /database_ownership_comment="lerniqa-isolated-migration-test:/u);
    assert.match(runner, /verify_existing_server_identity_for_cleanup\(\)/u);
    assert.match(runner, /SHOW unix_socket_directories/u);
    assert.match(runner, /SHOW data_directory/u);
    assert.match(runner, /SELECT session_user/u);
    assert.match(runner, /pg_catalog\.pg_is_in_recovery\(\)/u);
    assert.match(runner, /canonicalize_single_socket_directory/u);
    assert.ok((runner.match(/canonicalize_single_socket_directory/g) ?? []).length >= 4);

    const proofIndex = runner.indexOf("--verify-child-proof");
    assert.notEqual(proofIndex, -1);
    assert.ok(proofIndex < runner.indexOf('existing_server_mode="${LERNIQA_DB_TEST_EXISTING:-0}"'));
    assert.ok(proofIndex < runner.indexOf('test_root="$(mktemp'));
    assert.ok(proofIndex < runner.indexOf("\n    initdb "));

    const cleanup = runner.slice(cleanupStart, cleanupEnd);
    assert.match(cleanup, /database_was_explicitly_dropped/u);
    assert.match(cleanup, /verify_existing_server_identity_for_cleanup/u);
    assert.match(cleanup, /existing_database_ownership_state/u);
    assert.match(cleanup, /cleanup_ownership_state" != "owned"/u);
    assert.doesNotMatch(cleanup, /--if-exists/u);
    assert.match(cleanup, /if ! LC_ALL=C sort -r -u/u);
    assert.match(cleanup, /cleanup_database_list_complete_marker/u);
    assert.match(cleanup, /cleanup_database_list_was_complete" -ne 1/u);
    assert.ok(cleanup.indexOf("sort -r -u") < cleanup.indexOf("while IFS= read"));
    assert.ok(cleanup.indexOf("verify_existing_server_identity_for_cleanup")
        < cleanup.indexOf("existing_database_ownership_state"));
    assert.ok(cleanup.indexOf("existing_database_ownership_state")
        < cleanup.indexOf("dropdb"));

    const create = runner.slice(createStart, createEnd);
    assert.match(create, /COMMENT ON DATABASE/u);
    assert.match(create, /created_database_ownership_state" = "owned"/u);
    assert.ok(create.indexOf('>> "$database_registry_file"') < create.indexOf("createdb"));
    assert.ok(create.indexOf("createdb") < create.indexOf("COMMENT ON DATABASE"));
    assert.ok(create.indexOf("COMMENT ON DATABASE")
        < create.indexOf("created_database_ownership_state"));

    const drop = runner.slice(dropStart, dropEnd);
    assert.match(drop, /verify_existing_server_identity_for_cleanup/u);
    assert.match(drop, /explicit_drop_ownership_state" = "owned"/u);
    assert.match(drop, /explicit_drop_ownership_state" = "absent"/u);
    assert.match(drop, /dropped_database_registry_file/u);
    assert.ok(drop.indexOf("verify_existing_server_identity_for_cleanup")
        < drop.indexOf("existing_database_ownership_state"));
    assert.ok(drop.indexOf("existing_database_ownership_state") < drop.indexOf("dropdb"));
    assert.ok(drop.indexOf("dropdb") < drop.lastIndexOf("existing_database_ownership_state"));
    assert.ok(drop.lastIndexOf("existing_database_ownership_state")
        < drop.indexOf("dropped_database_registry_file"));

    const outerCleanup = runner.slice(outerCleanupStart, outerCleanupEnd);
    assert.match(outerCleanup, /if \[ "\$existing_server_mode" -eq 1 \]; then[\s\S]*cleanup_existing_test_databases[\s\S]*elif \[ "\$server_start_attempted" -eq 1 \]; then[\s\S]*stop_private_test_postgres/u);

    const privateStop = runner.slice(privateStopStart, privateStopEnd);
    assert.match(privateStop, /pg_ctl -D "\$cluster_directory" status/u);
    assert.match(privateStop, /pg_ctl -D "\$cluster_directory" -m fast -w stop/u);
    assert.ok(privateStop.indexOf('pg_ctl -D "$cluster_directory" status')
        < privateStop.indexOf('pg_ctl -D "$cluster_directory" -m fast -w stop'));
    assert.ok(privateStop.indexOf('pg_ctl -D "$cluster_directory" -m fast -w stop')
        < privateStop.lastIndexOf('pg_ctl -D "$cluster_directory" status'));
    const startAttemptIndex = runner.indexOf("server_start_attempted=1");
    const serverStartIndex = runner.indexOf("-w start >/dev/null");
    assert.notEqual(startAttemptIndex, -1);
    assert.notEqual(serverStartIndex, -1);
    assert.ok(startAttemptIndex < serverStartIndex);

    assert.match(runner, /cleanup_resources_confirmed=0/u);
    assert.match(runner, /保留 migration test 目錄/u);
    assert.match(outerCleanup, /cleanup_status" -ne 0/u);
    assert.match(outerCleanup, /migration test 失敗；已確認服務與資料庫 cleanup，保留測試目錄供檢查/u);
});

test("all PostgreSQL integration runners share one fail-closed canonical tmp lock", async () => {
    const [packageJson, wrapper, importRunner, practiceRunner] = await Promise.all([
        repositoryFile("package.json").then(JSON.parse),
        repositoryFile("scripts/with-local-postgres-test-lock.mjs"),
        repositoryFile("scripts/run-hanlin-import-ownership-isolated.mjs"),
        repositoryFile("scripts/run-local-practice-isolated.mjs"),
    ]);
    const lockedScripts = ["db:test", "test:local-practice", "test:import-ownership"];
    for (const scriptName of lockedScripts) {
        assert.match(
            packageJson.scripts[scriptName],
            /^node scripts\/with-local-postgres-test-lock\.mjs -- /u,
            `${scriptName} must acquire the shared PostgreSQL test lock`,
        );
    }
    assert.match(wrapper, /realpath\("\/tmp"\)/u);
    assert.match(wrapper, /lerniqa-postgres-test-runner\.lock/u);
    assert.doesNotMatch(wrapper, /process\.env\.[A-Z0-9_]*LOCK/u);
    assert.match(wrapper, /error\?\.code === "EEXIST"/u);
    assert.match(wrapper, /existing 或 stale lock 都不會自動移除/u);
    assert.match(wrapper, /owner\.token !== lock\.token/u);
    assert.match(wrapper, /entries\.length !== 1/u);
    assert.match(wrapper, /LERNIQA_POSTGRES_TEST_LOCK_DIRECTORY/u);
    assert.match(wrapper, /LERNIQA_POSTGRES_TEST_LOCK_TOKEN/u);
    assert.match(wrapper, /LERNIQA_POSTGRES_TEST_LOCK_WRAPPER_PID/u);
    assert.match(wrapper, /verifyLocalPostgresTestLockProof/u);
    assert.match(wrapper, /--verify-child-proof/u);
    assert.match(wrapper, /owner\.token !== proofToken \|\| owner\.pid !== parsedWrapperPid/u);
    assert.match(wrapper, /requireDirectParent && process\.ppid !== parsedWrapperPid/u);
    assert.match(wrapper, /SIGHUP: 129, SIGINT: 130, SIGTERM: 143/u);
    assert.match(wrapper, /if \(signalState\.signal !== null\) return;/u);
    assert.match(wrapper, /signalState\.child\.kill\(signal\)/u);
    for (const runner of [importRunner, practiceRunner]) {
        assert.match(runner, /verifyLocalPostgresTestLockProof\(\{ requireDirectParent: true \}\)/u);
    }
});
