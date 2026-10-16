import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    compareHanlinAnswerChain,
    databaseConfiguration,
    HanlinAnswerChainVerificationError,
} from "../scripts/verify-hanlin-answer-chain.mjs";
import { deterministicUuid } from "../scripts/lib/hanlin-chinese-import.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function syntheticFixture() {
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const partId = deterministicUuid(`question-part:${revisionId}:main`);
    const firstOptionId = deterministicUuid(`question-option:${partId}:A`);
    const secondOptionId = deterministicUuid(`question-option:${partId}:B`);
    const answerId = deterministicUuid(`question-answer:${partId}:0`);
    const batchId = "77777777-7777-4777-8777-777777777777";
    const sourceDocumentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const importItemId = deterministicUuid(`import-item:${batchId}:${sourceDocumentId}:0`);
    const structured = {
        kind: "choice",
        questionTypeCode: "single-choice",
        difficultyCode: "basic",
        prompt: "Synthetic prompt",
        parts: [{
            stableKey: "main",
            prompt: "",
            answerMode: "single_choice",
            gradingPolicy: "automatic",
            options: [
                { key: "A", text: "Synthetic option A" },
                { key: "B", text: "Synthetic option B" },
            ],
            answer: { answerKey: "B" },
        }],
        explanation: "Synthetic explanation",
        pendingReasons: [],
    };
    return {
        expected: [{
            sourceNumber: "synthetic-001",
            questionId: "11111111-1111-4111-8111-111111111111",
            revisionId,
            batchId,
            batchIdempotencyKey: "synthetic-idempotency-key",
            questionBankId: "05050505-0505-4505-8505-050505050505",
            importPrincipalId: "06060606-0606-4606-8606-060606060606",
            parserVersion: "synthetic-parser-v1",
            gradeId: "88888888-8888-4888-8888-888888888888",
            subjectId: "99999999-9999-4999-8999-999999999999",
            semesterId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            bookVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            targetUnitId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            volumeUnitId: "04040404-0404-4404-8404-040404040404",
            publisherId: "03030303-0303-4303-8303-030303030303",
            sourceCategoryId: "02020202-0202-4202-8202-020202020202",
            questionTypeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            difficultyLevelId: "01010101-0101-4101-8101-010101010101",
            target: {
                gradeCode: "junior-high-1",
                gradeName: "Synthetic grade",
                semesterCode: "semester-1",
                semesterName: "Synthetic semester",
                subjectCode: "synthetic-subject",
                subjectName: "Synthetic subject",
                publisherCode: "synthetic-publisher",
                publisherName: "Synthetic publisher",
                bookName: "Synthetic book",
                volumeCode: "volume-1",
                volumeName: "Synthetic volume",
                unitCode: "lesson-4",
                unitName: "Synthetic lesson",
                sourceCategoryCode: "publisher-test-bank",
                sourceCategoryName: "Synthetic source category",
            },
            sourceDocumentId,
            sourceAssetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            batchDocumentPosition: 0,
            importItemId,
            sourcePage: 1,
            sourceOrder: 0,
            sourceQuestionNumber: "synthetic-001",
            sourceFileName: "synthetic.doc",
            originalSha256: "a".repeat(64),
            sanitizedSha256: "b".repeat(64),
            structured,
        }],
        database: {
            questions: [{
                question_id: "11111111-1111-4111-8111-111111111111",
                question_status: "published",
                revision_id: revisionId,
                revision_status: "published",
                grade_id: "88888888-8888-4888-8888-888888888888",
                subject_id: "99999999-9999-4999-8999-999999999999",
                semester_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                book_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                question_type_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                question_type_code: "single-choice",
                question_type_status: "active",
                difficulty_level_id: "01010101-0101-4101-8101-010101010101",
                difficulty_code: "basic",
                difficulty_status: "active",
                source_category_id: "02020202-0202-4202-8202-020202020202",
                source_category_code: "publisher-test-bank",
                source_category_name: "Synthetic source category",
                source_category_status: "active",
                grade_stage: "junior_high",
                grade_code: "junior-high-1",
                grade_name: "Synthetic grade",
                grade_status: "active",
                semester_code: "semester-1",
                semester_name: "Synthetic semester",
                semester_status: "active",
                subject_code: "synthetic-subject",
                subject_name: "Synthetic subject",
                subject_kind: "leaf",
                subject_status: "active",
                publisher_id: "03030303-0303-4303-8303-030303030303",
                publisher_code: "synthetic-publisher",
                publisher_name: "Synthetic publisher",
                publisher_status: "active",
                book_name: "Synthetic book",
                book_subject_id: "99999999-9999-4999-8999-999999999999",
                book_grade_id: "88888888-8888-4888-8888-888888888888",
                book_publisher_id: "03030303-0303-4303-8303-030303030303",
                book_status: "active",
                primary_unit_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                assignment_type: "native",
                assignment_value_source: "document",
                assignment_confidence: "1.0000",
                unit_assignment_count: "1",
                unit_subject_id: "99999999-9999-4999-8999-999999999999",
                unit_grade_id: "88888888-8888-4888-8888-888888888888",
                unit_semester_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                unit_book_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                unit_parent_id: "04040404-0404-4404-8404-040404040404",
                unit_type: "lesson",
                unit_code: "lesson-4",
                unit_name: "Synthetic lesson",
                unit_position: 4,
                unit_status: "active",
                volume_unit_id: "04040404-0404-4404-8404-040404040404",
                volume_subject_id: "99999999-9999-4999-8999-999999999999",
                volume_grade_id: "88888888-8888-4888-8888-888888888888",
                volume_semester_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                volume_book_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                volume_unit_type: "volume",
                volume_unit_code: "volume-1",
                volume_unit_name: "Synthetic volume",
                volume_unit_status: "active",
                import_item_id: importItemId,
                import_batch_id: batchId,
                source_document_id: sourceDocumentId,
                source_question_number: "synthetic-001",
                item_source_page: 1,
                item_source_order: 0,
                item_recognition_confidence: "1.000",
                item_question_id: "11111111-1111-4111-8111-111111111111",
                item_question_revision_id: revisionId,
                item_reviewed_by_user_id: "06060606-0606-4606-8606-060606060606",
                item_reviewed_at: new Date("2026-01-01T00:00:00Z"),
                review_status: "approved",
                batch_status: "confirmed",
                recognizer_version: "synthetic-parser-v1",
                batch_question_bank_id: "05050505-0505-4505-8505-050505050505",
                batch_learner_id: null,
                batch_created_by_user_id: "06060606-0606-4606-8606-060606060606",
                batch_idempotency_key: "synthetic-idempotency-key",
                batch_confirmed_at: new Date("2026-01-01T00:00:00Z"),
                source_asset_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                source_document_status: "ready",
                source_document_input_type: "document",
                source_document_file_name: "synthetic.doc",
                source_asset_checksum: "b".repeat(64),
                source_asset_scan_status: "clean",
                source_asset_purpose: "source_document",
                source_asset_sensitivity: "private",
                source_asset_deleted_at: null,
                batch_document_count: "1",
                batch_document_position: 0,
                batch_document_total_count: "1",
                batch_item_count: "1",
                revision_source_count: "1",
                primary_revision_source_count: "1",
                primary_revision_source_page: 1,
                primary_revision_source_question_number: "synthetic-001",
                primary_revision_source_crop_asset_id: null,
                primary_revision_source_matches: true,
                snapshot_file_name: "synthetic.doc",
                snapshot_original_sha256: "a".repeat(64),
                snapshot_sanitized_sha256: "b".repeat(64),
                snapshot_source_page: 1,
                snapshot_source_question_number: "synthetic-001",
                snapshot_normalized_number: "synthetic-001",
                snapshot_pending_reasons: [],
                primary_unit_count: "1",
                structured,
                root_prompt: "Synthetic prompt",
                explanation: "Synthetic explanation",
            }],
            parts: [{
                id: partId,
                question_revision_id: revisionId,
                parent_part_id: null,
                stable_key: "main",
                position: 0,
                answer_mode: "single_choice",
                grading_policy: "automatic",
                is_independently_gradable: true,
                prompt: "",
            }],
            options: [
                {
                    id: firstOptionId,
                    question_part_id: partId,
                    option_key: "A",
                    position: 0,
                    text: "Synthetic option A",
                },
                {
                    id: secondOptionId,
                    question_part_id: partId,
                    option_key: "B",
                    position: 1,
                    text: "Synthetic option B",
                },
            ],
            answers: [{
                id: answerId,
                question_part_id: partId,
                answer_key: "B",
                accepted_value: null,
                position: 0,
            }],
        },
    };
}

test("the answer-chain comparator accepts an exact source, snapshot, and database match", () => {
    const fixture = syntheticFixture();
    const result = compareHanlinAnswerChain(fixture.expected, fixture.database);

    assert.deepEqual(result.stats, {
        questions: 1,
        parts: 1,
        options: 2,
        answers: 1,
        automaticAnswerKeys: 1,
        manualAcceptedValues: 0,
    });
    assert.equal(result.mismatches.count, 0);
    assert.deepEqual(result.mismatches.examples, []);
});

test("mismatch evidence is fail-closed without printing answer or prompt content", () => {
    const fixture = syntheticFixture();
    fixture.expected[0].structured.parts[0].answer.answerKey = "TOP-SECRET-EXPECTED";
    fixture.database.answers[0].answer_key = "TOP-SECRET-ACTUAL";
    fixture.database.parts[0].prompt = "PRIVATE-PROMPT-CONTENT";
    fixture.database.questions[0].structured = {
        "TOP-SECRET-OBJECT-KEY": "PRIVATE-OBJECT-VALUE",
    };

    const result = compareHanlinAnswerChain(fixture.expected, fixture.database);
    const serialized = JSON.stringify(result.mismatches.examples);

    assert.ok(result.mismatches.count >= 2);
    assert.match(serialized, /answer_key/u);
    assert.match(serialized, /prompt/u);
    assert.doesNotMatch(serialized, /TOP-SECRET|PRIVATE-PROMPT-CONTENT|PRIVATE-OBJECT-VALUE/u);
});

test("classification and relational provenance mismatches fail closed", () => {
    const fixture = syntheticFixture();
    fixture.database.questions[0].primary_unit_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    fixture.database.questions[0].primary_revision_source_matches = false;
    fixture.database.questions[0].subject_status = "archived";

    const result = compareHanlinAnswerChain(fixture.expected, fixture.database);
    const fields = result.mismatches.examples.map((example) => example.field);

    assert.ok(result.mismatches.count >= 2);
    assert.ok(fields.includes("approved_classification"));
    assert.ok(fields.includes("active_catalog_contract"));
    assert.ok(fields.includes("relational_source_provenance"));
});

test("non-deterministic child IDs and extra batch records cannot pass", () => {
    const fixture = syntheticFixture();
    const replacementPartId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    fixture.database.questions[0].batch_document_total_count = "2";
    fixture.database.questions[0].batch_item_count = "2";
    fixture.database.questions[0].revision_source_count = "2";
    fixture.database.parts[0].id = replacementPartId;
    fixture.database.options.forEach((option, index) => {
        option.question_part_id = replacementPartId;
        option.id = index === 0
            ? "12121212-1212-4212-8212-121212121212"
            : "34343434-3434-4434-8434-343434343434";
    });
    fixture.database.answers[0].id = "56565656-5656-4656-8656-565656565656";
    fixture.database.answers[0].question_part_id = replacementPartId;

    const result = compareHanlinAnswerChain(fixture.expected, fixture.database);
    const fields = result.mismatches.examples.map((example) => example.field);

    assert.ok(fields.includes("relational_source_provenance"));
    assert.equal(fields.filter((field) => field === "deterministic_id").length, 4);
});

test("missing page provenance cannot pass through numeric null coercion", () => {
    const fixture = syntheticFixture();
    fixture.database.questions[0].item_source_page = null;
    fixture.database.questions[0].snapshot_source_page = null;
    fixture.database.questions[0].primary_revision_source_page = null;

    const result = compareHanlinAnswerChain(fixture.expected, fixture.database);
    const fields = result.mismatches.examples.map((example) => example.field);

    assert.ok(fields.includes("approved_import_item"));
    assert.ok(fields.includes("relational_source_provenance"));
});

test("missing database rows cannot be reported as a passing answer chain", () => {
    const fixture = syntheticFixture();
    const result = compareHanlinAnswerChain(fixture.expected, {
        questions: [],
        parts: [],
        options: [],
        answers: [],
    });

    assert.ok(result.mismatches.count > 0);
    assert.equal(result.stats.questions, 0);
    assert.equal(result.stats.answers, 0);
});

test("database configuration rejects TCP and unrelated socket paths", () => {
    assert.throws(
        () => databaseConfiguration({
            LERNIQA_ANSWER_CHAIN_PGHOST: "127.0.0.1",
            LERNIQA_ANSWER_CHAIN_PGPORT: "55432",
            LERNIQA_ANSWER_CHAIN_PGDATABASE: "lerniqa_local",
            LERNIQA_ANSWER_CHAIN_PGUSER: "synthetic_user",
        }),
        (error) => error instanceof HanlinAnswerChainVerificationError
            && error.code === "UNSAFE_DATABASE_HOST",
    );
    assert.throws(
        () => databaseConfiguration({
            LERNIQA_ANSWER_CHAIN_PGHOST: "/var/run/postgresql",
            LERNIQA_ANSWER_CHAIN_PGPORT: "55432",
            LERNIQA_ANSWER_CHAIN_PGDATABASE: "lerniqa_local",
            LERNIQA_ANSWER_CHAIN_PGUSER: "synthetic_user",
        }),
        (error) => error instanceof HanlinAnswerChainVerificationError
            && error.code === "UNSAFE_DATABASE_HOST",
    );
});

test("the integration verifier enforces read-only SQL and avoids learner attempt tables", async () => {
    const source = await readFile(
        path.join(repositoryRoot, "scripts", "verify-hanlin-answer-chain.mjs"),
        "utf8",
    );

    assert.match(source, /default_transaction_read_only=on/u);
    assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
    assert.match(source, /current_setting\('transaction_read_only'\)/u);
    assert.doesNotMatch(source, /\b(?:learners|answer_attempts|answer_part_results)\b/u);
});
