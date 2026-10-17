#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
    AUTHORIZED_FOURTH_LESSON_FILE,
    AUTHORIZED_FOURTH_LESSON_SHA256,
    deterministicUuid,
    prepareHanlinChineseImport,
    stableJson,
} from "./lib/hanlin-chinese-import.mjs";
import {
    HANLIN_IMPORT_PRINCIPAL,
    validateHanlinPostgresPlan,
} from "./lib/hanlin-postgres-writer.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_CLEAN_DOCX_SHA256 = "c7ba4a74c2cfe8c7f30b8032e89ae551fd2038c5879c59648e1fef607a60e129";
const APPROVED_QUESTION_COUNT = 279;
const APPROVED_PART_COUNT = 337;
const APPROVED_OPTION_COUNT = 1_049;
const APPROVED_AUTOMATIC_PART_COUNT = 253;
const APPROVED_MANUAL_PART_COUNT = 84;
const MAX_MISMATCH_EXAMPLES = 20;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
const SAFE_USER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,62}$/u;

const SOURCE_PATH = path.join(
    REPOSITORY_ROOT,
    "local-data",
    "assets",
    "quarantine",
    "source-documents",
    `${AUTHORIZED_FOURTH_LESSON_SHA256}.doc`,
);
const CLEAN_DOCX_PATH = path.join(
    REPOSITORY_ROOT,
    "local-data",
    "assets",
    "sanitized-source-documents",
    `${AUTHORIZED_FOURTH_LESSON_SHA256}.docx`,
);

export class HanlinAnswerChainVerificationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "HanlinAnswerChainVerificationError";
        this.code = code;
        this.details = details;
    }
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
    return sha256(await readFile(filePath));
}

async function requireRegularFile(filePath, label) {
    const metadata = await lstat(filePath).catch(() => null);
    if (!metadata || !metadata.isFile() || metadata.isSymbolicLink()) {
        throw new HanlinAnswerChainVerificationError(
            "SOURCE_FILE_UNAVAILABLE",
            `${label}不存在、不是一般檔案或不可使用。`,
        );
    }
}

function safeShape(value) {
    if (value === null || value === undefined) return { type: "missing" };
    if (Array.isArray(value)) return { type: "array", count: value.length };
    if (typeof value === "object") {
        return { type: "object", fieldCount: Object.keys(value).length };
    }
    if (typeof value === "string") return { type: "string", present: value.length > 0 };
    return { type: typeof value };
}

function anonymousReference(scope, value) {
    return sha256(`${scope}:${String(value)}`).slice(0, 12);
}

function isPositiveIntegerValue(value) {
    return value !== null
        && value !== undefined
        && value !== ""
        && Number.isInteger(Number(value))
        && Number(value) > 0;
}

function mismatchCollector() {
    let count = 0;
    const examples = [];
    return {
        add(scope, reference, field, expected, actual) {
            count += 1;
            if (examples.length >= MAX_MISMATCH_EXAMPLES) return;
            examples.push({
                scope,
                ref: anonymousReference(scope, reference),
                field,
                expected: safeShape(expected),
                actual: safeShape(actual),
            });
        },
        result() {
            return { count, examples };
        },
    };
}

function groupBy(values, keyOf) {
    const groups = new Map();
    for (const value of values) {
        const key = keyOf(value);
        const current = groups.get(key) ?? [];
        current.push(value);
        groups.set(key, current);
    }
    return groups;
}

function questionTypeId(plan, code) {
    return {
        "single-choice": plan.ids.questionTypeChoiceId,
        "multi-choice": plan.ids.questionTypeMultiId,
        written: plan.ids.questionTypeWrittenId,
    }[code];
}

function difficultyLevelId(plan, code) {
    return {
        basic: plan.ids.difficultyBasicId,
        intermediate: plan.ids.difficultyIntermediateId,
        advanced: plan.ids.difficultyAdvancedId,
    }[code];
}

function expectedQuestionsFromPlan(plan) {
    return plan.questionGroups.filter((group) => group.publishable).map((group) => ({
        sourceNumber: group.number,
        questionId: group.questionId,
        revisionId: group.revisionId,
        batchId: plan.batchId,
        batchIdempotencyKey: plan.idempotencyKey,
        questionBankId: plan.ids.questionBankId,
        importPrincipalId: HANLIN_IMPORT_PRINCIPAL.userId,
        parserVersion: plan.parserVersion,
        gradeId: plan.ids.gradeId,
        subjectId: plan.ids.subjectId,
        semesterId: plan.ids.semesterId,
        bookVersionId: plan.ids.bookVersionId,
        targetUnitId: plan.ids.targetUnitId,
        volumeUnitId: plan.ids.volumeUnitId,
        publisherId: plan.ids.publisherId,
        sourceCategoryId: plan.ids.sourceCategoryId,
        questionTypeId: questionTypeId(plan, group.canonical.record.structured.questionTypeCode),
        difficultyLevelId: difficultyLevelId(plan, group.canonical.record.structured.difficultyCode),
        target: plan.target,
        sourceDocumentId: group.canonical.document.sourceDocumentId,
        sourceAssetId: group.canonical.document.assetId,
        batchDocumentPosition: group.canonical.document.documentIndex,
        importItemId: deterministicUuid(
            `import-item:${plan.batchId}:${group.canonical.document.sourceDocumentId}:${group.canonical.record.sourceOrder}`,
        ),
        sourcePage: group.canonical.record.sourcePage,
        sourceOrder: group.canonical.record.sourceOrder,
        sourceQuestionNumber: group.canonical.record.sourceQuestionNumber.length <= 80
            ? group.canonical.record.sourceQuestionNumber
            : null,
        sourceFileName: group.canonical.document.relativePath,
        originalSha256: group.canonical.document.originalSha256,
        sanitizedSha256: group.canonical.document.sanitizedSha256,
        structured: group.canonical.record.structured,
    }));
}

/**
 * Compares parser output with the current published database projection.
 * Mismatch examples contain only anonymous references and value shapes.
 */
export function compareHanlinAnswerChain(expectedQuestions, databaseRows) {
    const mismatches = mismatchCollector();
    const questionsBySource = groupBy(databaseRows.questions, (row) => row.source_question_number ?? "<missing>");
    const partsByRevision = groupBy(databaseRows.parts, (row) => row.question_revision_id);
    const answersByPart = groupBy(databaseRows.answers, (row) => row.question_part_id);
    const optionsByPart = groupBy(databaseRows.options, (row) => row.question_part_id);
    const expectedSourceNumbers = new Set(expectedQuestions.map((question) => question.sourceNumber));
    const seenPartIds = new Set();
    const seenOptionIds = new Set();
    const seenAnswerIds = new Set();

    if (expectedQuestions.length !== databaseRows.questions.length) {
        mismatches.add("catalog", "lesson-4", "question_count", expectedQuestions, databaseRows.questions);
    }

    for (const expected of expectedQuestions) {
        const questionRows = questionsBySource.get(expected.sourceNumber) ?? [];
        if (questionRows.length !== 1) {
            mismatches.add("question", expected.sourceNumber, "current_question_row_count", [expected], questionRows);
            if (questionRows.length === 0) continue;
        }
        const actual = questionRows[0];
        if (actual.question_id !== expected.questionId) {
            mismatches.add("question", expected.sourceNumber, "question_id", expected.questionId, actual.question_id);
        }
        if (actual.revision_id !== expected.revisionId) {
            mismatches.add("question", expected.sourceNumber, "revision_id", expected.revisionId, actual.revision_id);
        }
        if (actual.question_status !== "published" || actual.revision_status !== "published") {
            mismatches.add("question", expected.sourceNumber, "published_status", "published", {
                question: actual.question_status,
                revision: actual.revision_status,
            });
        }
        if (actual.review_status !== "approved") {
            mismatches.add("question", expected.sourceNumber, "import_review_status", "approved", actual.review_status);
        }
        if (actual.grade_id !== expected.gradeId
            || actual.subject_id !== expected.subjectId
            || actual.semester_id !== expected.semesterId
            || actual.book_version_id !== expected.bookVersionId
            || actual.primary_unit_id !== expected.targetUnitId
            || actual.assignment_type !== "native"
            || actual.assignment_value_source !== "document"
            || Number(actual.assignment_confidence) !== 1
            || Number(actual.unit_assignment_count) !== 1) {
            mismatches.add("question", expected.sourceNumber, "approved_classification", {
                gradeId: expected.gradeId,
                subjectId: expected.subjectId,
                semesterId: expected.semesterId,
                bookVersionId: expected.bookVersionId,
                unitId: expected.targetUnitId,
                assignmentType: "native",
                valueSource: "document",
                confidence: 1,
                assignmentCount: 1,
            }, {
                gradeId: actual.grade_id,
                subjectId: actual.subject_id,
                semesterId: actual.semester_id,
                bookVersionId: actual.book_version_id,
                unitId: actual.primary_unit_id,
                assignmentType: actual.assignment_type,
                valueSource: actual.assignment_value_source,
                confidence: actual.assignment_confidence,
                assignmentCount: actual.unit_assignment_count,
            });
        }
        if (actual.question_type_id !== expected.questionTypeId
            || actual.question_type_code !== expected.structured.questionTypeCode
            || actual.question_type_status !== "active"
            || actual.difficulty_level_id !== expected.difficultyLevelId
            || actual.difficulty_code !== expected.structured.difficultyCode
            || actual.difficulty_status !== "active"
            || actual.source_category_id !== expected.sourceCategoryId
            || actual.source_category_code !== expected.target.sourceCategoryCode
            || actual.source_category_name !== expected.target.sourceCategoryName
            || actual.source_category_status !== "active"
            || actual.grade_stage !== "junior_high"
            || actual.grade_code !== expected.target.gradeCode
            || actual.grade_name !== expected.target.gradeName
            || actual.grade_status !== "active"
            || actual.semester_code !== expected.target.semesterCode
            || actual.semester_name !== expected.target.semesterName
            || actual.semester_status !== "active"
            || actual.subject_code !== expected.target.subjectCode
            || actual.subject_name !== expected.target.subjectName
            || actual.subject_kind !== "leaf"
            || actual.subject_status !== "active"
            || actual.publisher_id !== expected.publisherId
            || actual.publisher_code !== expected.target.publisherCode
            || actual.publisher_name !== expected.target.publisherName
            || actual.publisher_status !== "active"
            || actual.book_name !== expected.target.bookName
            || actual.book_subject_id !== expected.subjectId
            || actual.book_grade_id !== expected.gradeId
            || actual.book_publisher_id !== expected.publisherId
            || actual.book_status !== "active"
            || actual.unit_subject_id !== expected.subjectId
            || actual.unit_grade_id !== expected.gradeId
            || actual.unit_semester_id !== expected.semesterId
            || actual.unit_book_version_id !== expected.bookVersionId
            || actual.unit_parent_id !== expected.volumeUnitId
            || actual.unit_type !== "lesson"
            || actual.unit_code !== expected.target.unitCode
            || actual.unit_name !== expected.target.unitName
            || Number(actual.unit_position) !== 4
            || actual.unit_status !== "active"
            || actual.volume_unit_id !== expected.volumeUnitId
            || actual.volume_subject_id !== expected.subjectId
            || actual.volume_grade_id !== expected.gradeId
            || actual.volume_semester_id !== expected.semesterId
            || actual.volume_book_version_id !== expected.bookVersionId
            || actual.volume_unit_type !== "volume"
            || actual.volume_unit_code !== expected.target.volumeCode
            || actual.volume_unit_name !== expected.target.volumeName
            || actual.volume_unit_status !== "active") {
            mismatches.add("question", expected.sourceNumber, "active_catalog_contract", {
                questionTypeId: expected.questionTypeId,
                questionTypeCode: expected.structured.questionTypeCode,
                difficultyLevelId: expected.difficultyLevelId,
                difficultyCode: expected.structured.difficultyCode,
                sourceCategoryId: expected.sourceCategoryId,
                gradeId: expected.gradeId,
                semesterId: expected.semesterId,
                subjectId: expected.subjectId,
                publisherId: expected.publisherId,
                bookVersionId: expected.bookVersionId,
                volumeUnitId: expected.volumeUnitId,
                targetUnitId: expected.targetUnitId,
                target: expected.target,
                status: "active",
            }, {
                questionTypeId: actual.question_type_id,
                questionTypeCode: actual.question_type_code,
                questionTypeStatus: actual.question_type_status,
                difficultyLevelId: actual.difficulty_level_id,
                difficultyCode: actual.difficulty_code,
                difficultyStatus: actual.difficulty_status,
                sourceCategoryId: actual.source_category_id,
                sourceCategoryCode: actual.source_category_code,
                sourceCategoryName: actual.source_category_name,
                sourceCategoryStatus: actual.source_category_status,
                gradeStatus: actual.grade_status,
                semesterStatus: actual.semester_status,
                subjectStatus: actual.subject_status,
                publisherStatus: actual.publisher_status,
                bookStatus: actual.book_status,
                unitStatus: actual.unit_status,
                volumeUnitStatus: actual.volume_unit_status,
            });
        }
        if (actual.import_batch_id !== expected.batchId
            || actual.batch_status !== "confirmed"
            || actual.recognizer_version !== expected.parserVersion
            || actual.batch_question_bank_id !== expected.questionBankId
            || actual.batch_learner_id !== null
            || actual.batch_created_by_user_id !== expected.importPrincipalId
            || actual.batch_idempotency_key !== expected.batchIdempotencyKey
            || actual.batch_confirmed_at === null) {
            mismatches.add("snapshot", expected.sourceNumber, "confirmed_parser_batch", {
                batchId: expected.batchId,
                status: "confirmed",
                parserVersion: expected.parserVersion,
                questionBankId: expected.questionBankId,
                learnerId: null,
                createdByUserId: expected.importPrincipalId,
                idempotencyKey: expected.batchIdempotencyKey,
                confirmed: true,
            }, {
                batchId: actual.import_batch_id,
                status: actual.batch_status,
                parserVersion: actual.recognizer_version,
                questionBankId: actual.batch_question_bank_id,
                learnerId: actual.batch_learner_id,
                createdByUserId: actual.batch_created_by_user_id,
                idempotencyKey: actual.batch_idempotency_key,
                confirmed: actual.batch_confirmed_at !== null,
            });
        }
        if (actual.import_item_id !== expected.importItemId
            || actual.item_question_id !== expected.questionId
            || actual.item_question_revision_id !== expected.revisionId
            || !isPositiveIntegerValue(actual.item_source_page)
            || !isPositiveIntegerValue(actual.snapshot_source_page)
            || Number(actual.item_source_page) !== Number(actual.snapshot_source_page)
            || Number(actual.item_source_order) !== expected.sourceOrder
            || actual.source_question_number !== expected.sourceQuestionNumber
            || actual.source_question_number !== actual.snapshot_source_question_number
            || Number(actual.item_recognition_confidence) !== 1
            || actual.item_reviewed_by_user_id !== expected.importPrincipalId
            || actual.item_reviewed_at === null) {
            mismatches.add("snapshot", expected.sourceNumber, "approved_import_item", {
                importItemId: expected.importItemId,
                questionId: expected.questionId,
                revisionId: expected.revisionId,
                sourcePage: actual.snapshot_source_page,
                sourceOrder: expected.sourceOrder,
                sourceQuestionNumber: expected.sourceQuestionNumber,
                recognitionConfidence: 1,
                reviewedByUserId: expected.importPrincipalId,
                reviewed: true,
            }, {
                importItemId: actual.import_item_id,
                questionId: actual.item_question_id,
                revisionId: actual.item_question_revision_id,
                sourcePage: actual.item_source_page,
                sourceOrder: actual.item_source_order,
                sourceQuestionNumber: actual.source_question_number,
                recognitionConfidence: actual.item_recognition_confidence,
                reviewedByUserId: actual.item_reviewed_by_user_id,
                reviewed: actual.item_reviewed_at !== null,
            });
        }
        if (actual.snapshot_file_name !== expected.sourceFileName
            || actual.snapshot_original_sha256 !== expected.originalSha256
            || actual.snapshot_sanitized_sha256 !== expected.sanitizedSha256
            || actual.snapshot_normalized_number !== expected.sourceNumber
            || stableJson(actual.snapshot_pending_reasons) !== "[]") {
            mismatches.add("snapshot", expected.sourceNumber, "source_evidence", {
                fileName: expected.sourceFileName,
                originalSha256: expected.originalSha256,
                sanitizedSha256: expected.sanitizedSha256,
                normalizedNumber: expected.sourceNumber,
                pendingReasons: [],
            }, {
                fileName: actual.snapshot_file_name,
                originalSha256: actual.snapshot_original_sha256,
                sanitizedSha256: actual.snapshot_sanitized_sha256,
                normalizedNumber: actual.snapshot_normalized_number,
                pendingReasons: actual.snapshot_pending_reasons,
            });
        }
        if (actual.source_document_id !== expected.sourceDocumentId
            || actual.source_asset_id !== expected.sourceAssetId
            || actual.source_document_status !== "ready"
            || actual.source_document_input_type !== "document"
            || actual.source_document_file_name !== expected.sourceFileName
            || actual.source_asset_checksum !== expected.sanitizedSha256
            || actual.source_asset_scan_status !== "clean"
            || actual.source_asset_purpose !== "source_document"
            || actual.source_asset_sensitivity !== "private"
            || actual.source_asset_deleted_at !== null
            || Number(actual.batch_document_count) !== 1
            || Number(actual.batch_document_total_count) !== 1
            || Number(actual.batch_document_position) !== expected.batchDocumentPosition
            || Number(actual.batch_item_count) !== expectedQuestions.length
            || Number(actual.revision_source_count) !== 1
            || Number(actual.primary_revision_source_count) !== 1
            || actual.primary_revision_source_matches !== true
            || !isPositiveIntegerValue(actual.primary_revision_source_page)
            || Number(actual.primary_revision_source_page) !== Number(actual.item_source_page)
            || actual.primary_revision_source_question_number !== actual.source_question_number
            || actual.primary_revision_source_crop_asset_id !== null) {
            mismatches.add("snapshot", expected.sourceNumber, "relational_source_provenance", {
                sourceDocumentId: expected.sourceDocumentId,
                sourceAssetId: expected.sourceAssetId,
                status: "ready",
                inputType: "document",
                fileName: expected.sourceFileName,
                checksum: expected.sanitizedSha256,
                scanStatus: "clean",
                purpose: "source_document",
                sensitivity: "private",
                deletedAt: null,
                batchDocumentCount: 1,
                batchDocumentTotalCount: 1,
                batchDocumentPosition: expected.batchDocumentPosition,
                batchItemCount: expectedQuestions.length,
                revisionSourceCount: 1,
                primaryRevisionSourceCount: 1,
                primaryRevisionSourceMatches: true,
                primaryRevisionSourcePage: actual.item_source_page,
                primaryRevisionSourceQuestionNumber: actual.source_question_number,
                primaryRevisionSourceCropAssetId: null,
            }, {
                sourceDocumentId: actual.source_document_id,
                sourceAssetId: actual.source_asset_id,
                status: actual.source_document_status,
                inputType: actual.source_document_input_type,
                fileName: actual.source_document_file_name,
                checksum: actual.source_asset_checksum,
                scanStatus: actual.source_asset_scan_status,
                purpose: actual.source_asset_purpose,
                sensitivity: actual.source_asset_sensitivity,
                deletedAt: actual.source_asset_deleted_at,
                batchDocumentCount: actual.batch_document_count,
                batchDocumentTotalCount: actual.batch_document_total_count,
                batchDocumentPosition: actual.batch_document_position,
                batchItemCount: actual.batch_item_count,
                revisionSourceCount: actual.revision_source_count,
                primaryRevisionSourceCount: actual.primary_revision_source_count,
                primaryRevisionSourceMatches: actual.primary_revision_source_matches,
                primaryRevisionSourcePage: actual.primary_revision_source_page,
                primaryRevisionSourceQuestionNumber: actual.primary_revision_source_question_number,
                primaryRevisionSourceCropAssetId: actual.primary_revision_source_crop_asset_id,
            });
        }
        if (Number(actual.primary_unit_count) !== 1) {
            mismatches.add("question", expected.sourceNumber, "primary_unit_count", 1, Number(actual.primary_unit_count));
        }
        if (stableJson(actual.structured) !== stableJson(expected.structured)) {
            mismatches.add("snapshot", expected.sourceNumber, "structured_payload", expected.structured, actual.structured);
        }
        if (actual.root_prompt !== expected.structured.prompt) {
            mismatches.add("question", expected.sourceNumber, "root_prompt", expected.structured.prompt, actual.root_prompt);
        }
        if (actual.explanation !== expected.structured.explanation) {
            mismatches.add("question", expected.sourceNumber, "explanation", expected.structured.explanation, actual.explanation);
        }

        const actualParts = partsByRevision.get(actual.revision_id) ?? [];
        const actualPartsByKey = groupBy(actualParts, (part) => part.stable_key);
        if (actualParts.length !== expected.structured.parts.length) {
            mismatches.add("question", expected.sourceNumber, "part_count", expected.structured.parts, actualParts);
        }
        const expectedPartKeys = new Set(expected.structured.parts.map((part) => part.stableKey));

        for (const [expectedPartIndex, expectedPart] of expected.structured.parts.entries()) {
            const reference = `${expected.sourceNumber}:${expectedPart.stableKey}`;
            const expectedPartId = deterministicUuid(`question-part:${expected.revisionId}:${expectedPart.stableKey}`);
            const matchingParts = actualPartsByKey.get(expectedPart.stableKey) ?? [];
            if (matchingParts.length !== 1) {
                mismatches.add("part", reference, "part_row_count", [expectedPart], matchingParts);
                if (matchingParts.length === 0) continue;
            }
            const actualPart = matchingParts[0];
            seenPartIds.add(actualPart.id);
            if (actualPart.id !== expectedPartId) {
                mismatches.add("part", reference, "deterministic_id", expectedPartId, actualPart.id);
            }
            if (actualPart.answer_mode !== expectedPart.answerMode) {
                mismatches.add("part", reference, "answer_mode", expectedPart.answerMode, actualPart.answer_mode);
            }
            if (actualPart.grading_policy !== expectedPart.gradingPolicy) {
                mismatches.add("part", reference, "grading_policy", expectedPart.gradingPolicy, actualPart.grading_policy);
            }
            if (Number(actualPart.position) !== expectedPartIndex) {
                mismatches.add("part", reference, "position", expectedPartIndex, actualPart.position);
            }
            if (actualPart.parent_part_id !== null || actualPart.is_independently_gradable !== true) {
                mismatches.add("part", reference, "gradable_relation", null, {
                    parent: actualPart.parent_part_id,
                    independentlyGradable: actualPart.is_independently_gradable,
                });
            }
            if (actualPart.prompt !== expectedPart.prompt) {
                mismatches.add("part", reference, "prompt", expectedPart.prompt, actualPart.prompt);
            }

            const actualOptions = optionsByPart.get(actualPart.id) ?? [];
            const actualOptionsByKey = groupBy(actualOptions, (option) => option.option_key);
            if (actualOptions.length !== expectedPart.options.length) {
                mismatches.add("part", reference, "option_count", expectedPart.options, actualOptions);
            }
            const expectedOptionKeys = new Set(expectedPart.options.map((option) => option.key));
            for (const [expectedOptionIndex, expectedOption] of expectedPart.options.entries()) {
                const optionReference = `${reference}:${expectedOption.key}`;
                const expectedOptionId = deterministicUuid(`question-option:${expectedPartId}:${expectedOption.key}`);
                const matchingOptions = actualOptionsByKey.get(expectedOption.key) ?? [];
                if (matchingOptions.length !== 1) {
                    mismatches.add("option", optionReference, "option_row_count", [expectedOption], matchingOptions);
                    if (matchingOptions.length === 0) continue;
                }
                const actualOption = matchingOptions[0];
                seenOptionIds.add(actualOption.id);
                if (actualOption.id !== expectedOptionId) {
                    mismatches.add("option", optionReference, "deterministic_id", expectedOptionId, actualOption.id);
                }
                if (Number(actualOption.position) !== expectedOptionIndex) {
                    mismatches.add("option", optionReference, "position", expectedOptionIndex, actualOption.position);
                }
                if (actualOption.text !== expectedOption.text) {
                    mismatches.add("option", optionReference, "text", expectedOption.text, actualOption.text);
                }
            }
            for (const option of actualOptions) {
                if (!expectedOptionKeys.has(option.option_key)) {
                    seenOptionIds.add(option.id);
                    mismatches.add("option", `${reference}:${option.option_key}`, "unexpected_option", null, option);
                }
            }

            const actualAnswers = answersByPart.get(actualPart.id) ?? [];
            if (actualAnswers.length !== 1) {
                mismatches.add("answer", reference, "answer_row_count", [expectedPart.answer], actualAnswers);
                if (actualAnswers.length === 0) continue;
            }
            const actualAnswer = actualAnswers[0];
            seenAnswerIds.add(actualAnswer.id);
            const expectedAnswerId = deterministicUuid(`question-answer:${expectedPartId}:0`);
            if (actualAnswer.id !== expectedAnswerId) {
                mismatches.add("answer", reference, "deterministic_id", expectedAnswerId, actualAnswer.id);
            }
            if (Number(actualAnswer.position) !== 0) {
                mismatches.add("answer", reference, "position", 0, actualAnswer.position);
            }
            if (actualAnswer.answer_key !== (expectedPart.answer?.answerKey ?? null)) {
                mismatches.add("answer", reference, "answer_key", expectedPart.answer?.answerKey ?? null, actualAnswer.answer_key);
            }
            if (actualAnswer.accepted_value !== (expectedPart.answer?.acceptedValue ?? null)) {
                mismatches.add("answer", reference, "accepted_value", expectedPart.answer?.acceptedValue ?? null, actualAnswer.accepted_value);
            }
        }

        for (const part of actualParts) {
            if (!expectedPartKeys.has(part.stable_key)) {
                seenPartIds.add(part.id);
                mismatches.add("part", `${expected.sourceNumber}:${part.stable_key}`, "unexpected_part", null, part);
            }
        }
    }

    for (const [sourceNumber, rows] of questionsBySource) {
        if (!expectedSourceNumbers.has(sourceNumber)) {
            mismatches.add("question", sourceNumber, "unexpected_current_question", null, rows);
        }
    }
    for (const part of databaseRows.parts) {
        if (!seenPartIds.has(part.id)) mismatches.add("part", part.id, "unmatched_part", null, part);
    }
    for (const option of databaseRows.options) {
        if (!seenOptionIds.has(option.id)) mismatches.add("option", option.id, "unmatched_option", null, option);
    }
    for (const answer of databaseRows.answers) {
        if (!seenAnswerIds.has(answer.id)) mismatches.add("answer", answer.id, "unmatched_answer", null, answer);
    }

    const automaticAnswerKeys = databaseRows.answers.filter((answer) => answer.answer_key !== null).length;
    const manualAcceptedValues = databaseRows.answers.filter((answer) => answer.accepted_value !== null).length;
    return {
        stats: {
            questions: databaseRows.questions.length,
            parts: databaseRows.parts.length,
            options: databaseRows.options.length,
            answers: databaseRows.answers.length,
            automaticAnswerKeys,
            manualAcceptedValues,
        },
        mismatches: mismatches.result(),
    };
}

function validateApprovedPlan(prepared) {
    validateHanlinPostgresPlan(prepared.plan);
    const document = prepared.plan.documents[0];
    const expectedQuestions = expectedQuestionsFromPlan(prepared.plan);
    const expectedParts = expectedQuestions.flatMap((question) => question.structured.parts);
    const expectedOptions = expectedParts.flatMap((part) => part.options);
    const automaticParts = expectedParts.filter((part) => part.gradingPolicy === "automatic");
    const manualParts = expectedParts.filter((part) => part.gradingPolicy === "manual_review");
    const invalidAnswers = expectedParts.filter((part) => part.answer === null);

    const valid = prepared.plan.sourceKind === "file"
        && prepared.plan.documents.length === 1
        && document.fileName.normalize("NFC") === AUTHORIZED_FOURTH_LESSON_FILE.normalize("NFC")
        && document.originalSha256 === AUTHORIZED_FOURTH_LESSON_SHA256
        && document.sanitizedSha256 === APPROVED_CLEAN_DOCX_SHA256
        && prepared.summary.sourceFiles === 1
        && prepared.summary.parsed === APPROVED_QUESTION_COUNT
        && prepared.summary.published === APPROVED_QUESTION_COUNT
        && prepared.summary.pendingReview === 0
        && prepared.summary.failed === 0
        && expectedQuestions.length === APPROVED_QUESTION_COUNT
        && expectedParts.length === APPROVED_PART_COUNT
        && expectedOptions.length === APPROVED_OPTION_COUNT
        && automaticParts.length === APPROVED_AUTOMATIC_PART_COUNT
        && manualParts.length === APPROVED_MANUAL_PART_COUNT
        && invalidAnswers.length === 0;

    if (!valid) {
        throw new HanlinAnswerChainVerificationError(
            "PARSER_OUTPUT_MISMATCH",
            "核准來源重新解析後的題目、答案或 checksum 不符合固定契約。",
            {
                parsed: prepared.summary.parsed,
                published: prepared.summary.published,
                pendingReview: prepared.summary.pendingReview,
                questions: expectedQuestions.length,
                parts: expectedParts.length,
                options: expectedOptions.length,
                automaticParts: automaticParts.length,
                manualParts: manualParts.length,
                invalidAnswers: invalidAnswers.length,
            },
        );
    }
    return { document, expectedQuestions };
}

async function prepareApprovedSource() {
    await Promise.all([
        requireRegularFile(SOURCE_PATH, "核准隔離原始文件"),
        requireRegularFile(CLEAN_DOCX_PATH, "核准清理後文件"),
    ]);
    const [originalChecksum, cleanChecksum] = await Promise.all([
        sha256File(SOURCE_PATH),
        sha256File(CLEAN_DOCX_PATH),
    ]);
    if (originalChecksum !== AUTHORIZED_FOURTH_LESSON_SHA256 || !SHA256_PATTERN.test(originalChecksum)) {
        throw new HanlinAnswerChainVerificationError(
            "SOURCE_CHECKSUM_MISMATCH",
            "隔離原始文件 checksum 不符合核准來源。",
        );
    }
    if (cleanChecksum !== APPROVED_CLEAN_DOCX_SHA256 || !SHA256_PATTERN.test(cleanChecksum)) {
        throw new HanlinAnswerChainVerificationError(
            "CLEAN_SOURCE_CHECKSUM_MISMATCH",
            "清理後 DOCX checksum 不符合核准來源。",
        );
    }

    const namedSourceRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-hanlin-answer-chain-"));
    const namedSourcePath = path.join(namedSourceRoot, AUTHORIZED_FOURTH_LESSON_FILE);
    try {
        await copyFile(SOURCE_PATH, namedSourcePath);
        const prepared = await prepareHanlinChineseImport(namedSourcePath, { allowDirectory: false });
        return {
            prepared,
            cleanup: async () => {
                try {
                    await prepared.cleanup();
                }
                finally {
                    await rm(namedSourceRoot, { recursive: true, force: true });
                }
            },
        };
    }
    catch (error) {
        await rm(namedSourceRoot, { recursive: true, force: true });
        throw error;
    }
}

export function databaseConfiguration(environment = process.env) {
    const host = path.resolve(
        environment.LERNIQA_ANSWER_CHAIN_PGHOST
            ?? path.join(REPOSITORY_ROOT, "local-data", "postgres-socket"),
    );
    const port = Number.parseInt(environment.LERNIQA_ANSWER_CHAIN_PGPORT ?? "55432", 10);
    const database = environment.LERNIQA_ANSWER_CHAIN_PGDATABASE ?? "lerniqa_local";
    const user = environment.LERNIQA_ANSWER_CHAIN_PGUSER ?? environment.PGUSER ?? environment.USER;
    const allowedSocketRoots = [
        `${path.join(REPOSITORY_ROOT, "local-data")}${path.sep}`,
        `${path.resolve(os.tmpdir())}${path.sep}`,
    ];
    if (!path.isAbsolute(host) || !allowedSocketRoots.some((root) => `${host}${path.sep}`.startsWith(root))) {
        throw new HanlinAnswerChainVerificationError(
            "UNSAFE_DATABASE_HOST",
            "答案鏈驗證只允許 repository local-data 或系統暫存區內的 Unix socket。",
        );
    }
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new HanlinAnswerChainVerificationError("INVALID_DATABASE_PORT", "答案鏈驗證資料庫 port 無效。");
    }
    if (!SAFE_DATABASE_NAME.test(database) || !SAFE_USER_NAME.test(user ?? "")) {
        throw new HanlinAnswerChainVerificationError("INVALID_DATABASE_IDENTITY", "答案鏈驗證資料庫名稱或使用者無效。");
    }
    return {
        host,
        port,
        database,
        user,
        password: environment.LERNIQA_ANSWER_CHAIN_PGPASSWORD,
    };
}

async function readDatabaseRows(configuration, targetUnitId) {
    const client = new Client({
        ...configuration,
        application_name: "lerniqa-hanlin-answer-chain-read-only",
        options: "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000",
    });
    let transactionOpen = false;
    try {
        await client.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        transactionOpen = true;
        const readOnly = await client.query("SELECT current_setting('transaction_read_only') AS value");
        if (readOnly.rows[0]?.value !== "on") {
            throw new HanlinAnswerChainVerificationError(
                "READ_ONLY_TRANSACTION_REQUIRED",
                "資料庫連線未進入唯讀交易，拒絕繼續。",
            );
        }

        const questionResult = await client.query(`
            SELECT
                question.id AS question_id,
                question.status AS question_status,
                revision.id AS revision_id,
                revision.status AS revision_status,
                revision.grade_id,
                revision.subject_id,
                revision.semester_id,
                revision.book_version_id,
                revision.question_type_id,
                question_type.code AS question_type_code,
                question_type.status AS question_type_status,
                revision.difficulty_level_id,
                difficulty.code AS difficulty_code,
                difficulty.status AS difficulty_status,
                revision.source_category_id,
                source_category.code AS source_category_code,
                source_category.name AS source_category_name,
                source_category.status AS source_category_status,
                grade.stage AS grade_stage,
                grade.code AS grade_code,
                grade.name AS grade_name,
                grade.status AS grade_status,
                semester.code AS semester_code,
                semester.name AS semester_name,
                semester.status AS semester_status,
                subject.code AS subject_code,
                subject.name AS subject_name,
                subject.subject_kind,
                subject.status AS subject_status,
                publisher.id AS publisher_id,
                publisher.code AS publisher_code,
                publisher.name AS publisher_name,
                publisher.status AS publisher_status,
                book.name AS book_name,
                book.subject_id AS book_subject_id,
                book.grade_id AS book_grade_id,
                book.publisher_id AS book_publisher_id,
                book.status AS book_status,
                assignment.curriculum_unit_id AS primary_unit_id,
                assignment.assignment_type,
                assignment.value_source AS assignment_value_source,
                assignment.confidence AS assignment_confidence,
                (
                    SELECT count(*)
                    FROM question_revision_units AS any_assignment
                    WHERE any_assignment.question_revision_id = revision.id
                ) AS unit_assignment_count,
                unit.subject_id AS unit_subject_id,
                unit.grade_id AS unit_grade_id,
                unit.semester_id AS unit_semester_id,
                unit.book_version_id AS unit_book_version_id,
                unit.parent_unit_id AS unit_parent_id,
                unit.unit_type,
                unit.code AS unit_code,
                unit.name AS unit_name,
                unit.position AS unit_position,
                unit.status AS unit_status,
                volume_unit.id AS volume_unit_id,
                volume_unit.subject_id AS volume_subject_id,
                volume_unit.grade_id AS volume_grade_id,
                volume_unit.semester_id AS volume_semester_id,
                volume_unit.book_version_id AS volume_book_version_id,
                volume_unit.unit_type AS volume_unit_type,
                volume_unit.code AS volume_unit_code,
                volume_unit.name AS volume_unit_name,
                volume_unit.status AS volume_unit_status,
                item.id AS import_item_id,
                item.import_batch_id,
                item.source_document_id,
                item.source_question_number,
                item.source_page AS item_source_page,
                item.source_order AS item_source_order,
                item.recognition_confidence AS item_recognition_confidence,
                item.question_id AS item_question_id,
                item.question_revision_id AS item_question_revision_id,
                item.reviewed_by_user_id AS item_reviewed_by_user_id,
                item.reviewed_at AS item_reviewed_at,
                item.review_status,
                batch.status AS batch_status,
                batch.recognizer_version,
                batch.question_bank_id AS batch_question_bank_id,
                batch.learner_id AS batch_learner_id,
                batch.created_by_user_id AS batch_created_by_user_id,
                batch.idempotency_key AS batch_idempotency_key,
                batch.confirmed_at AS batch_confirmed_at,
                source_document.asset_id AS source_asset_id,
                source_document.status AS source_document_status,
                source_document.input_type AS source_document_input_type,
                source_document.original_file_name AS source_document_file_name,
                source_asset.checksum AS source_asset_checksum,
                source_asset.scan_status AS source_asset_scan_status,
                source_asset.purpose AS source_asset_purpose,
                source_asset.sensitivity AS source_asset_sensitivity,
                source_asset.deleted_at AS source_asset_deleted_at,
                item.draft_payload ->> 'relativeFileName' AS snapshot_file_name,
                item.draft_payload ->> 'originalSha256' AS snapshot_original_sha256,
                item.draft_payload ->> 'sanitizedSha256' AS snapshot_sanitized_sha256,
                item.draft_payload -> 'sourcePage' AS snapshot_source_page,
                item.draft_payload ->> 'sourceQuestionNumber' AS snapshot_source_question_number,
                item.draft_payload ->> 'normalizedQuestionNumber' AS snapshot_normalized_number,
                item.draft_payload -> 'pendingReasons' AS snapshot_pending_reasons,
                item.draft_payload -> 'structured' AS structured,
                (
                    SELECT count(*)
                    FROM import_batch_documents AS batch_document
                    WHERE batch_document.import_batch_id = item.import_batch_id
                        AND batch_document.source_document_id = item.source_document_id
                ) AS batch_document_count,
                (
                    SELECT batch_document.position
                    FROM import_batch_documents AS batch_document
                    WHERE batch_document.import_batch_id = item.import_batch_id
                        AND batch_document.source_document_id = item.source_document_id
                ) AS batch_document_position,
                (
                    SELECT count(*)
                    FROM import_batch_documents AS batch_document
                    WHERE batch_document.import_batch_id = item.import_batch_id
                ) AS batch_document_total_count,
                (
                    SELECT count(*)
                    FROM import_items AS batch_item
                    WHERE batch_item.import_batch_id = item.import_batch_id
                ) AS batch_item_count,
                (
                    SELECT count(*)
                    FROM question_revision_sources AS revision_source
                    WHERE revision_source.question_revision_id = revision.id
                ) AS revision_source_count,
                (
                    SELECT count(*)
                    FROM question_revision_sources AS revision_source
                    WHERE revision_source.question_revision_id = revision.id
                        AND revision_source.is_primary = true
                ) AS primary_revision_source_count,
                primary_revision_source.source_page AS primary_revision_source_page,
                primary_revision_source.source_question_number AS primary_revision_source_question_number,
                primary_revision_source.crop_asset_id AS primary_revision_source_crop_asset_id,
                EXISTS (
                    SELECT 1
                    FROM question_revision_sources AS revision_source
                    WHERE revision_source.question_revision_id = revision.id
                        AND revision_source.is_primary = true
                        AND revision_source.source_document_id = item.source_document_id
                        AND revision_source.import_item_id = item.id
                        AND revision_source.source_question_number
                            IS NOT DISTINCT FROM item.source_question_number
                ) AS primary_revision_source_matches,
                (
                    SELECT count(*)
                    FROM question_revision_units AS primary_assignment
                    WHERE primary_assignment.question_revision_id = revision.id
                        AND primary_assignment.is_primary = true
                ) AS primary_unit_count,
                COALESCE((
                    SELECT string_agg(block.text_content, '' ORDER BY block.position, block.id)
                    FROM question_content_blocks AS block
                    WHERE block.question_revision_id = revision.id
                        AND block.question_part_id IS NULL
                        AND block.question_option_id IS NULL
                        AND block.placement = 'prompt'
                        AND block.content_type = 'text'
                ), '') AS root_prompt,
                COALESCE((
                    SELECT string_agg(block.text_content, '' ORDER BY block.position, block.id)
                    FROM question_content_blocks AS block
                    WHERE block.question_revision_id = revision.id
                        AND block.question_part_id IS NULL
                        AND block.question_option_id IS NULL
                        AND block.placement = 'explanation'
                        AND block.content_type = 'text'
                ), '') AS explanation
            FROM questions AS question
            JOIN question_revisions AS revision ON revision.id = question.current_revision_id
            JOIN question_revision_units AS assignment
                ON assignment.question_revision_id = revision.id
                AND assignment.is_primary = true
            JOIN curriculum_units AS unit
                ON unit.id = assignment.curriculum_unit_id
                AND unit.id = $1::uuid
            LEFT JOIN curriculum_units AS volume_unit ON volume_unit.id = unit.parent_unit_id
            LEFT JOIN grades AS grade ON grade.id = revision.grade_id
            LEFT JOIN semesters AS semester ON semester.id = revision.semester_id
            LEFT JOIN subjects AS subject ON subject.id = revision.subject_id
            LEFT JOIN book_versions AS book ON book.id = revision.book_version_id
            LEFT JOIN publishers AS publisher ON publisher.id = book.publisher_id
            LEFT JOIN question_types AS question_type ON question_type.id = revision.question_type_id
            LEFT JOIN difficulty_levels AS difficulty ON difficulty.id = revision.difficulty_level_id
            LEFT JOIN source_categories AS source_category ON source_category.id = revision.source_category_id
            LEFT JOIN import_items AS item ON item.question_revision_id = revision.id
            LEFT JOIN import_batches AS batch ON batch.id = item.import_batch_id
            LEFT JOIN source_documents AS source_document ON source_document.id = item.source_document_id
            LEFT JOIN assets AS source_asset ON source_asset.id = source_document.asset_id
            LEFT JOIN question_revision_sources AS primary_revision_source
                ON primary_revision_source.question_revision_id = revision.id
                AND primary_revision_source.is_primary = true
            WHERE question.status = 'published'
                AND revision.status = 'published'
            ORDER BY item.source_question_number NULLS LAST, item.id NULLS LAST
        `, [targetUnitId]);
        const revisionIds = [...new Set(questionResult.rows.map((row) => row.revision_id).filter(Boolean))];
        const partResult = revisionIds.length === 0 ? { rows: [] } : await client.query(`
            SELECT
                part.id,
                part.question_revision_id,
                part.parent_part_id,
                part.stable_key,
                part.position,
                part.answer_mode,
                part.grading_policy,
                part.is_independently_gradable,
                COALESCE((
                    SELECT string_agg(block.text_content, '' ORDER BY block.position, block.id)
                    FROM question_content_blocks AS block
                    WHERE block.question_part_id = part.id
                        AND block.question_option_id IS NULL
                        AND block.placement = 'prompt'
                        AND block.content_type = 'text'
                ), '') AS prompt
            FROM question_parts AS part
            WHERE part.question_revision_id = ANY($1::uuid[])
            ORDER BY part.question_revision_id, part.position, part.id
        `, [revisionIds]);
        const partIds = partResult.rows.map((row) => row.id);
        const optionResult = partIds.length === 0 ? { rows: [] } : await client.query(`
            SELECT
                option.id,
                option.question_part_id,
                option.option_key,
                option.position,
                COALESCE((
                    SELECT string_agg(block.text_content, '' ORDER BY block.position, block.id)
                    FROM question_content_blocks AS block
                    WHERE block.question_option_id = option.id
                        AND block.placement = 'option'
                        AND block.content_type = 'text'
                ), '') AS text
            FROM question_options AS option
            WHERE option.question_part_id = ANY($1::uuid[])
            ORDER BY option.question_part_id, option.position, option.id
        `, [partIds]);
        const answerResult = partIds.length === 0 ? { rows: [] } : await client.query(`
            SELECT id, question_part_id, answer_key, accepted_value, position
            FROM question_answers
            WHERE question_part_id = ANY($1::uuid[])
            ORDER BY question_part_id, position, id
        `, [partIds]);

        await client.query("COMMIT");
        transactionOpen = false;
        return {
            questions: questionResult.rows,
            parts: partResult.rows,
            options: optionResult.rows,
            answers: answerResult.rows,
        };
    }
    catch (error) {
        if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        await client.end().catch(() => undefined);
    }
}

export async function verifyHanlinAnswerChain(options = {}) {
    const source = await prepareApprovedSource();
    try {
        const { document, expectedQuestions } = validateApprovedPlan(source.prepared);
        const databaseRows = await readDatabaseRows(
            databaseConfiguration(options.environment),
            expectedQuestions[0].targetUnitId,
        );
        const comparison = compareHanlinAnswerChain(expectedQuestions, databaseRows);
        if (comparison.mismatches.count > 0) {
            throw new HanlinAnswerChainVerificationError(
                "ANSWER_CHAIN_MISMATCH",
                "核准來源、匯入快照與目前已發布答案鏈不一致。",
                {
                    ...comparison.stats,
                    mismatchCount: comparison.mismatches.count,
                    mismatchExamples: comparison.mismatches.examples,
                },
            );
        }
        if (comparison.stats.questions !== APPROVED_QUESTION_COUNT
            || comparison.stats.parts !== APPROVED_PART_COUNT
            || comparison.stats.options !== APPROVED_OPTION_COUNT
            || comparison.stats.answers !== APPROVED_PART_COUNT
            || comparison.stats.automaticAnswerKeys !== APPROVED_AUTOMATIC_PART_COUNT
            || comparison.stats.manualAcceptedValues !== APPROVED_MANUAL_PART_COUNT) {
            throw new HanlinAnswerChainVerificationError(
                "ANSWER_CHAIN_COUNT_MISMATCH",
                "答案鏈總數不符合核准契約。",
                comparison.stats,
            );
        }
        return {
            ok: true,
            source: {
                originalChecksumVerified: document.originalSha256 === AUTHORIZED_FOURTH_LESSON_SHA256,
                cleanChecksumVerified: document.sanitizedSha256 === APPROVED_CLEAN_DOCX_SHA256,
                parsedQuestions: source.prepared.summary.parsed,
                publishedQuestions: source.prepared.summary.published,
                pendingReview: source.prepared.summary.pendingReview,
            },
            database: comparison.stats,
            mismatchCount: 0,
        };
    }
    finally {
        await source.cleanup();
    }
}

function safeFailure(error) {
    if (error instanceof HanlinAnswerChainVerificationError) {
        return { ok: false, code: error.code, message: error.message, ...error.details };
    }
    return {
        ok: false,
        code: "ANSWER_CHAIN_VERIFICATION_FAILED",
        message: "答案鏈驗證無法完成；來源、parser 或唯讀資料庫連線不可用。",
    };
}

async function main() {
    try {
        process.stdout.write(`${JSON.stringify(await verifyHanlinAnswerChain())}\n`);
    }
    catch (error) {
        process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
