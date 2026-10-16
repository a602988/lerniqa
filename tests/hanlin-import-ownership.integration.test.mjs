import assert from "node:assert/strict";
import os from "node:os";
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
const socketDirectory = path.join(repositoryRoot, "local-data", "postgres-socket");

const ids = Object.freeze({
    userId: "10000000-0000-4000-8000-000000000001",
    learnerId: "10000000-0000-4000-8000-000000000002",
    roleId: deterministicUuid("local-practice:role:learner"),
    learnerAccessId: deterministicUuid("local-practice:learner-access"),
    gradeId: deterministicUuid("catalog:grade:junior-high-1"),
    semesterId: deterministicUuid("catalog:semester:semester-1"),
    publisherId: deterministicUuid("catalog:publisher:hanlin"),
    subjectId: deterministicUuid("catalog:subject:chinese"),
    subjectAliasId: deterministicUuid("catalog:subject-alias:chinese:國文"),
    bookVersionId: deterministicUuid("catalog:book:chinese:junior-high-1:hanlin:volume-1"),
    volumeUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1"),
    targetUnitId: deterministicUuid("catalog:unit:hanlin:chinese:volume-1:lesson-4"),
    learnerSubjectSettingId: deterministicUuid("local-practice:learner-subject:chinese"),
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
    target: TARGET_CLASSIFICATION,
    batchId: deterministicUuid("test:hanlin-real-data-ownership:batch"),
});

test("system-owned import rows satisfy deferred audit constraints without fixture ownership", async (context) => {
    const client = new Client({
        host: socketDirectory,
        port: 55432,
        database: "lerniqa_local",
        user: os.userInfo().username,
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
            inet_server_addr() IS NULL AS uses_unix_socket,
            current_database() AS database_name
    `);
    assert.deepEqual(identity.rows[0], {
        data_directory: path.join(repositoryRoot, "local-data", "postgres"),
        listen_addresses: "",
        socket_directories: socketDirectory,
        uses_unix_socket: true,
        database_name: "lerniqa_local",
    });

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
               membership.learner_id,
               learner.display_name AS learner_name
        FROM question_banks AS bank
        JOIN question_bank_learners AS membership
          ON membership.question_bank_id = bank.id
        JOIN learners AS learner ON learner.id = membership.learner_id
        WHERE bank.id = $1
          AND membership.learner_id = $2
    `, [ids.questionBankId, ids.learnerId]);
    assert.deepEqual(boundary.rows, [{
        origin: "system",
        owner_user_id: null,
        created_role: null,
        learner_id: ids.learnerId,
        learner_name: "合成驗證學習者",
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
