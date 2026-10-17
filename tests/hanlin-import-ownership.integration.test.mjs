import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
    deterministicUuid,
    TARGET_CLASSIFICATION,
} from "../scripts/lib/hanlin-chinese-import.mjs";
import {
    HANLIN_IMPORT_PRINCIPAL,
    recordHanlinSystemRevisionTransition,
    seedHanlinCatalog,
} from "../scripts/lib/hanlin-postgres-writer.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ISOLATED_ROOT_PATTERN = /^lerniqa-import-ownership-test\.[A-Za-z0-9_-]+$/u;
const ISOLATED_DATABASE_PATTERN = /^lerniqa_import_ownership_test_[a-z0-9_]+$/u;
const ISOLATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const ISOLATION_MARKER_FILE = ".lerniqa-import-ownership-test";
const SYSTEM_TEMPORARY_DIRECTORY = "/tmp";
const DATABASE_OWNERSHIP_COMMENT_PREFIX = "lerniqa-import-ownership-test:";

function requiredEnvironment(name) {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} is required; run the isolated ownership harness instead of this test directly`);
    return value;
}

async function isolatedDatabaseConfig() {
    const configuredRoot = requiredEnvironment("LERNIQA_IMPORT_OWNERSHIP_TEST_ROOT");
    assert.equal(path.isAbsolute(configuredRoot), true);
    const isolatedTestRoot = path.resolve(configuredRoot);
    assert.match(path.basename(isolatedTestRoot), ISOLATED_ROOT_PATTERN);
    assert.notEqual(isolatedTestRoot, repositoryRoot);
    assert.equal(isolatedTestRoot.startsWith(`${repositoryRoot}${path.sep}`), false);

    const [canonicalRoot, canonicalTemporaryDirectory] = await Promise.all([
        realpath(isolatedTestRoot),
        realpath(SYSTEM_TEMPORARY_DIRECTORY),
    ]);
    assert.equal(canonicalRoot, isolatedTestRoot);
    assert.equal(path.dirname(canonicalRoot), canonicalTemporaryDirectory);

    const rootMetadata = await lstat(canonicalRoot);
    assert.equal(rootMetadata.isDirectory(), true);
    assert.equal(rootMetadata.isSymbolicLink(), false);
    assert.equal(rootMetadata.mode & 0o077, 0);

    const token = requiredEnvironment("LERNIQA_IMPORT_OWNERSHIP_TEST_TOKEN");
    assert.match(token, ISOLATION_TOKEN_PATTERN);
    const markerPath = path.join(canonicalRoot, ISOLATION_MARKER_FILE);
    const markerMetadata = await lstat(markerPath);
    assert.equal(markerMetadata.isFile(), true);
    assert.equal(markerMetadata.isSymbolicLink(), false);
    assert.equal(markerMetadata.mode & 0o077, 0);
    assert.equal((await readFile(markerPath, "utf8")).trim(), token);

    const existingServerMode = process.env.LERNIQA_IMPORT_OWNERSHIP_TEST_EXISTING?.trim() ?? "0";
    assert.ok(["0", "1"].includes(existingServerMode),
        "LERNIQA_IMPORT_OWNERSHIP_TEST_EXISTING must be 0 or 1");
    const borrowedExistingServer = existingServerMode === "1";
    const socketDirectory = path.resolve(requiredEnvironment("LOCAL_PG_SOCKET"));
    let dataDirectory = path.join(canonicalRoot, "postgres");
    let isolatedDirectories = [socketDirectory, dataDirectory];
    if (borrowedExistingServer) {
        const approvedSocket = requiredEnvironment("LERNIQA_IMPORT_OWNERSHIP_TEST_SOCKET");
        const approvedDataDirectory = requiredEnvironment("LERNIQA_IMPORT_OWNERSHIP_TEST_DATA_DIRECTORY");
        const approvedPort = requiredEnvironment("LERNIQA_IMPORT_OWNERSHIP_TEST_PORT");
        assert.equal(path.isAbsolute(approvedSocket), true);
        assert.equal(path.isAbsolute(approvedDataDirectory), true);
        assert.match(approvedPort, /^\d+$/u);
        assert.equal(socketDirectory, path.resolve(approvedSocket));
        dataDirectory = path.resolve(approvedDataDirectory);
        isolatedDirectories = [];
    }
    else {
        assert.equal(socketDirectory, path.join(canonicalRoot, "socket"));
    }
    assert.equal(await realpath(socketDirectory), socketDirectory);
    assert.equal(await realpath(dataDirectory), dataDirectory);
    for (const directory of isolatedDirectories) {
        const metadata = await lstat(directory);
        assert.equal(metadata.isDirectory(), true);
        assert.equal(metadata.isSymbolicLink(), false);
        assert.equal(metadata.mode & 0o077, 0);
    }
    for (const directory of [socketDirectory, dataDirectory]) {
        const metadata = await lstat(directory);
        assert.equal(metadata.isDirectory(), true);
        assert.equal(metadata.isSymbolicLink(), false);
    }

    const database = requiredEnvironment("LOCAL_PG_DATABASE");
    assert.match(database, ISOLATED_DATABASE_PATTERN);
    const user = requiredEnvironment("LOCAL_PG_USER");
    assert.equal(user, userInfo().username);
    const rawPort = requiredEnvironment("LOCAL_PG_PORT");
    assert.match(rawPort, /^\d+$/u);
    const port = Number(rawPort);
    assert.ok(Number.isInteger(port) && port >= 1 && port <= 65_535);
    if (borrowedExistingServer) {
        assert.equal(String(port), requiredEnvironment("LERNIQA_IMPORT_OWNERSHIP_TEST_PORT"));
    }

    return {
        borrowedExistingServer,
        dataDirectory,
        database,
        isolatedTestRoot,
        ownershipComment: borrowedExistingServer
            ? `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${token}`
            : null,
        port,
        socketDirectory,
        user,
    };
}

const ids = Object.freeze({
    gradeId: deterministicUuid("catalog:grade:junior-high-1"),
    semesterId: deterministicUuid("catalog:semester:semester-1"),
    publisherId: deterministicUuid("catalog:publisher:hanlin"),
    subjectId: deterministicUuid("catalog:subject:chinese"),
    subjectAliasId: deterministicUuid("catalog:subject-alias:chinese:國文"),
    bookVersionId: deterministicUuid("catalog:book:chinese:junior-high-1:hanlin:volume-1"),
    volumeUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1"),
    targetUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1:lesson-4"),
    questionBankId: deterministicUuid("local-practice:question-bank:default"),
    sourceCategoryId: deterministicUuid("catalog:source-category:publisher-test-bank"),
    questionTypeChoiceId: deterministicUuid("catalog:question-type:single-choice"),
    questionTypeMultiId: deterministicUuid("catalog:question-type:multi-choice"),
    questionTypeWrittenId: deterministicUuid("catalog:question-type:written"),
    difficultyBasicId: deterministicUuid("catalog:difficulty:basic"),
    difficultyIntermediateId: deterministicUuid("catalog:difficulty:intermediate"),
    difficultyAdvancedId: deterministicUuid("catalog:difficulty:advanced"),
});

const plan = Object.freeze({
    ids,
    target: Object.freeze({ ...TARGET_CLASSIFICATION, unitPosition: 4 }),
    batchId: deterministicUuid("test:hanlin-real-data-ownership:batch"),
});

test("system-owned import rows satisfy deferred audit constraints without fixture ownership", async (context) => {
    const config = await isolatedDatabaseConfig();
    const client = new Client({
        host: config.socketDirectory,
        port: config.port,
        database: config.database,
        user: config.user,
        password: async () => {
            throw new Error("isolated ownership PostgreSQL must not request a password");
        },
        ssl: false,
        connectionTimeoutMillis: 5_000,
        application_name: "lerniqa-hanlin-ownership-test",
    });
    await client.connect();
    let transactionOpen = false;
    context.after(async () => {
        if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
    });

    const identity = await client.query(`
        SELECT
            current_setting('data_directory') AS data_directory,
            current_setting('listen_addresses') AS listen_addresses,
            current_setting('unix_socket_directories') AS socket_directories,
            current_setting('unix_socket_permissions') AS socket_permissions,
            current_setting('port') AS server_port,
            inet_server_addr() IS NULL AS uses_unix_socket,
            current_database() AS database_name,
            current_user AS database_user,
            session_user AS session_user,
            pg_catalog.pg_is_in_recovery() AS in_recovery,
            (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = current_database()
            ) AS database_comment
    `);
    const actualIdentity = identity.rows[0];
    const [actualDataDirectory, actualSocketDirectory] = await Promise.all([
        realpath(actualIdentity.data_directory).catch(() => null),
        realpath(actualIdentity.socket_directories).catch(() => null),
    ]);
    assert.equal(actualDataDirectory, config.dataDirectory);
    assert.equal(actualSocketDirectory, config.socketDirectory);
    assert.equal(actualIdentity.server_port, String(config.port));
    assert.equal(actualIdentity.uses_unix_socket, true);
    assert.equal(actualIdentity.database_name, config.database);
    assert.equal(actualIdentity.database_user, config.user);
    assert.equal(actualIdentity.session_user, config.user);
    assert.equal(actualIdentity.in_recovery, false);
    assert.equal(actualIdentity.database_comment, config.ownershipComment);
    if (!config.borrowedExistingServer) {
        assert.equal(actualIdentity.listen_addresses, "");
        assert.equal(actualIdentity.socket_permissions, "0700");
    }

    await client.query("BEGIN");
    transactionOpen = true;
    await seedHanlinCatalog(client, plan);

    const principal = await client.query(`
        SELECT app_user.display_name, app_user.status,
               count(role.id)::integer AS role_count
        FROM users AS app_user
        LEFT JOIN user_roles AS role ON role.user_id = app_user.id
        WHERE app_user.id = $1
        GROUP BY app_user.id
    `, [HANLIN_IMPORT_PRINCIPAL.userId]);
    assert.deepEqual(principal.rows, [{
        display_name: HANLIN_IMPORT_PRINCIPAL.displayName,
        status: "active",
        role_count: 0,
    }]);

    const boundary = await client.query(`
        SELECT bank.origin, bank.owner_user_id, bank.created_role,
               count(membership.learner_id)::integer AS membership_count
        FROM question_banks AS bank
        LEFT JOIN question_bank_learners AS membership
          ON membership.question_bank_id = bank.id
        WHERE bank.id = $1
        GROUP BY bank.id
    `, [ids.questionBankId]);
    assert.deepEqual(boundary.rows, [{
        origin: "system",
        owner_user_id: null,
        created_role: null,
        membership_count: 0,
    }]);

    const fixtureIdentityRows = await client.query(`
        SELECT
            (SELECT count(*)::integer FROM users
                WHERE id <> $1) AS non_import_users,
            (SELECT count(*)::integer FROM learners) AS learners,
            (SELECT count(*)::integer FROM learner_access) AS learner_access,
            (SELECT count(*)::integer FROM learner_preferences) AS learner_preferences,
            (SELECT count(*)::integer FROM learner_subject_settings) AS learner_subject_settings,
            (SELECT count(*)::integer FROM question_bank_learners) AS bank_memberships
    `, [HANLIN_IMPORT_PRINCIPAL.userId]);
    assert.deepEqual(fixtureIdentityRows.rows, [{
        non_import_users: 0,
        learners: 0,
        learner_access: 0,
        learner_preferences: 0,
        learner_subject_settings: 0,
        bank_memberships: 0,
    }]);

    const questionId = deterministicUuid("test:hanlin-real-data-ownership:question");
    const revisionId = deterministicUuid("test:hanlin-real-data-ownership:revision");
    await client.query(`
        INSERT INTO questions (
            id, origin, owner_user_id, status, created_method, created_by_user_id
        ) VALUES ($1, 'system', NULL, 'draft', 'import', $2)
    `, [questionId, HANLIN_IMPORT_PRINCIPAL.userId]);
    await client.query(`
        INSERT INTO question_revisions (
            id, question_id, revision_number, question_type_id,
            subject_id, grade_id, semester_id, book_version_id,
            source_category_id, search_text, status,
            created_by_type, created_by_user_id
        ) VALUES (
            $1, $2, 1, $3,
            $4, $5, $6, $7,
            $8, 'ownership integration test', 'draft',
            'user', $9
        )
    `, [
        revisionId,
        questionId,
        ids.questionTypeChoiceId,
        ids.subjectId,
        ids.gradeId,
        ids.semesterId,
        ids.bookVersionId,
        ids.sourceCategoryId,
        HANLIN_IMPORT_PRINCIPAL.userId,
    ]);
    await client.query(`
        UPDATE question_revisions
        SET status = 'published', published_at = transaction_timestamp()
        WHERE id = $1
    `, [revisionId]);
    await recordHanlinSystemRevisionTransition(client, plan, revisionId, "draft", "published");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(`
        UPDATE question_revisions
        SET status = 'superseded'
        WHERE id = $1
    `, [revisionId]);
    await recordHanlinSystemRevisionTransition(client, plan, revisionId, "published", "superseded");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    const evidence = await client.query(`
        SELECT review.from_status, review.to_status,
               review.reviewer_type, review.reviewer_user_id,
               audit.actor_type, audit.actor_user_id,
               audit.before_data, audit.after_data
        FROM question_revision_reviews AS review
        JOIN admin_audit_logs AS audit
          ON audit.target_type = 'question_revision'
         AND audit.target_id = review.question_revision_id
         AND audit.created_at = review.created_at
         AND audit.before_data->>'status' = review.from_status
         AND audit.after_data->>'status' = review.to_status
        WHERE review.question_revision_id = $1
        ORDER BY review.created_at, review.from_status
    `, [revisionId]);
    assert.deepEqual(evidence.rows, [
        {
            from_status: "draft",
            to_status: "published",
            reviewer_type: "bootstrap_admin",
            reviewer_user_id: null,
            actor_type: "bootstrap_admin",
            actor_user_id: null,
            before_data: { status: "draft" },
            after_data: { status: "published" },
        },
        {
            from_status: "published",
            to_status: "superseded",
            reviewer_type: "bootstrap_admin",
            reviewer_user_id: null,
            actor_type: "bootstrap_admin",
            actor_user_id: null,
            before_data: { status: "published" },
            after_data: { status: "superseded" },
        },
    ]);

    await client.query("ROLLBACK");
    transactionOpen = false;
});
