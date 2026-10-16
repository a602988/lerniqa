import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
    deterministicUuid,
    HanlinImportError,
    PARSER_VERSION,
    SANITIZER_VERSION,
    stableJson,
    TARGET_CLASSIFICATION,
} from "./hanlin-chinese-import.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXPECTED_MIGRATIONS = Object.freeze([
    ["0001", "identity_and_catalog"],
    ["0002", "question_core"],
    ["0003", "import_and_collections"],
    ["0004", "practice_and_attempts"],
    ["0005", "similarity_analytics_and_audit"],
    ["0006", "source_documents_word"],
    ["0007", "practice_answer_integrity"],
    ["0008", "auth_and_import_integrity"],
    ["0009", "automatic_answer_completeness"],
    ["0010", "account_role_and_self_learner"],
    ["0011", "score_session_aggregates"],
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_STORAGE_SEGMENT = /^(?!\.{1,2}$)[^/\\\0]+$/;
const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const LOCAL_SOCKET = path.join(REPOSITORY_ROOT, "local-data", "postgres-socket");
const LOCAL_ASSET_ROOT = path.join(REPOSITORY_ROOT, "local-data", "assets");
const ISOLATED_TEST_ROOT_PATTERN = /^lerniqa-practice-test\.[A-Za-z0-9_-]+$/u;
const ISOLATED_TEST_DATABASE_PATTERN = /^lerniqa_practice_test_[a-z0-9_]+$/u;
const ISOLATED_TEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ISOLATED_TEST_MARKER = ".lerniqa-isolated-practice-test";
const ISOLATED_DATABASE_OWNERSHIP_COMMENT_PREFIX = "lerniqa-isolated-practice-test:";

export const HANLIN_IMPORT_PRINCIPAL = Object.freeze({
    userId: deterministicUuid("system-user:hanlin-curriculum-import"),
    displayName: "翰林題庫匯入服務",
});

export const HANLIN_REAL_DATA_OWNERSHIP = Object.freeze({
    origin: "system",
    ownerUserId: null,
    batchLearnerId: null,
});

function fail(code, message, fileName = null) {
    throw new HanlinImportError(code, message, fileName);
}

function assertObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是物件。`);
    }
    return value;
}

function assertArray(value, label, { nonEmpty = false } = {}) {
    if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是${nonEmpty ? "非空" : ""}陣列。`);
    }
    return value;
}

function assertString(value, label, maximumLength = null, { nonEmpty = true } = {}) {
    if (typeof value !== "string" || (nonEmpty && value.trim() === "") || value.includes("\0")) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是有效字串。`);
    }
    if (maximumLength !== null && value.length > maximumLength) {
        fail("INVALID_IMPORT_PLAN", `${label} 超過 ${maximumLength} 字元。`);
    }
    return value;
}

function assertUuid(value, label) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是 UUID。`);
    }
    return value.toLowerCase();
}

function assertSha256(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是 SHA-256。`);
    }
    return value.toLowerCase();
}

function assertInteger(value, label, { minimum = 0 } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是大於等於 ${minimum} 的整數。`);
    }
    return value;
}

function assertPositiveInteger(value, label) {
    return assertInteger(value, label, { minimum: 1 });
}

function assertStorageKey(value, label) {
    assertString(value, label, 500);
    if (path.posix.isAbsolute(value)
        || value.includes("\\")
        || value.startsWith("local-data/assets/")
        || !value.split("/").every((segment) => SAFE_STORAGE_SEGMENT.test(segment))) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是資產根目錄內的安全相對路徑。`);
    }
    return value;
}

function assertRelativeFileName(value, label) {
    assertString(value, label, 255);
    if (path.posix.isAbsolute(value)
        || value.includes("\\")
        || value.split("/").some((segment) => !SAFE_STORAGE_SEGMENT.test(segment))) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須是安全相對檔名。`);
    }
    return value;
}

function assertFiniteConfidence(value, label) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        fail("INVALID_IMPORT_PLAN", `${label} 必須介於 0 與 1。`);
    }
    return value;
}

function assertNoPrivatePathMetadata(value, label) {
    const text = assertString(value, label, null, { nonEmpty: false });
    if (/(?:^|[\s"'])\/(?:Users|home)\//i.test(text)
        || /file:\/\//i.test(text)
        || /[A-Z]:\\Users\\/i.test(text)) {
        fail("PRIVATE_METADATA_REJECTED", `${label} 含本機絕對路徑。`);
    }
    return text;
}

function assertUnique(values, label) {
    if (new Set(values).size !== values.length) {
        fail("INVALID_IMPORT_PLAN", `${label} 不可重複。`);
    }
}

function sha256Text(value) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertCatalogPlan(plan) {
    const target = assertObject(plan.target, "plan.target");
    const ids = assertObject(plan.ids, "plan.ids");
    const requiredTargetFields = [
        "key",
        "gradeCode",
        "gradeName",
        "semesterCode",
        "semesterName",
        "subjectCode",
        "subjectName",
        "subjectAlias",
        "publisherCode",
        "publisherName",
        "bookName",
        "volumeCode",
        "volumeName",
        "unitCode",
        "unitName",
        "sourceCategoryCode",
        "sourceCategoryName",
    ];
    for (const field of requiredTargetFields) assertString(target[field], `plan.target.${field}`, 160);
    for (const field of requiredTargetFields) {
        if (target[field] !== TARGET_CLASSIFICATION[field]) {
            fail("WRONG_TARGET_CLASSIFICATION", `plan.target.${field} 不是固定的第四課目標分類。`);
        }
    }

    const requiredIds = [
        "gradeId",
        "semesterId",
        "publisherId",
        "subjectId",
        "subjectAliasId",
        "bookVersionId",
        "volumeUnitId",
        "targetUnitId",
        "questionBankId",
        "sourceCategoryId",
        "questionTypeChoiceId",
        "questionTypeMultiId",
        "questionTypeWrittenId",
        "difficultyBasicId",
        "difficultyIntermediateId",
        "difficultyAdvancedId",
    ];
    for (const field of requiredIds) assertUuid(ids[field], `plan.ids.${field}`);
    const expectedIds = {
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
    };
    for (const [field, expected] of Object.entries(expectedIds)) {
        if (ids[field] !== expected) fail("INVALID_IMPORT_PLAN", `plan.ids.${field} 不是固定本機識別。`);
    }
}

function assertStructuredQuestion(structured, label) {
    assertObject(structured, label);
    if (!["choice", "multi-choice", "written"].includes(structured.kind)) {
        fail("INVALID_IMPORT_PLAN", `${label}.kind 不受支援。`);
    }
    if (!["single-choice", "multi-choice", "written"].includes(structured.questionTypeCode)) {
        fail("INVALID_IMPORT_PLAN", `${label}.questionTypeCode 不受支援。`);
    }
    if (structured.difficultyCode !== null
        && !["basic", "intermediate", "advanced"].includes(structured.difficultyCode)) {
        fail("INVALID_IMPORT_PLAN", `${label}.difficultyCode 不受支援。`);
    }
    assertString(structured.prompt, `${label}.prompt`, null, { nonEmpty: false });
    assertString(structured.explanation, `${label}.explanation`, null, { nonEmpty: false });
    assertArray(structured.pendingReasons, `${label}.pendingReasons`);
    for (const reason of structured.pendingReasons) assertString(reason, `${label}.pendingReasons[]`, 120);
    assertArray(structured.parts, `${label}.parts`);
    for (const [partIndex, part] of structured.parts.entries()) {
        assertObject(part, `${label}.parts[${partIndex}]`);
        assertString(part.stableKey, `${label}.parts[${partIndex}].stableKey`, 80);
        assertString(part.prompt, `${label}.parts[${partIndex}].prompt`, null, { nonEmpty: false });
        if (!["single_choice", "multiple_choice", "boolean", "text"].includes(part.answerMode)) {
            fail("INVALID_IMPORT_PLAN", `${label}.parts[${partIndex}].answerMode 不受支援。`);
        }
        if (!["automatic", "manual_review", "ai_assisted_review"].includes(part.gradingPolicy)) {
            fail("INVALID_IMPORT_PLAN", `${label}.parts[${partIndex}].gradingPolicy 不受支援。`);
        }
        assertArray(part.options, `${label}.parts[${partIndex}].options`);
        for (const [optionIndex, option] of part.options.entries()) {
            assertObject(option, `${label}.parts[${partIndex}].options[${optionIndex}]`);
            assertString(option.key, `${label}.parts[${partIndex}].options[${optionIndex}].key`, 30);
            assertString(option.text, `${label}.parts[${partIndex}].options[${optionIndex}].text`, null);
        }
        assertUnique(part.options.map((option) => option.key), `${label}.parts[${partIndex}] 選項 key`);
        if (part.answer !== null) {
            assertObject(part.answer, `${label}.parts[${partIndex}].answer`);
            const representations = [part.answer.answerKey, part.answer.acceptedValue]
                .filter((value) => value !== undefined && value !== null);
            if (representations.length !== 1) {
                fail("INVALID_IMPORT_PLAN", `${label}.parts[${partIndex}].answer 必須只有一種答案表示。`);
            }
            if (part.answer.answerKey !== undefined) {
                assertString(part.answer.answerKey, `${label}.parts[${partIndex}].answer.answerKey`, 80);
            }
            if (part.answer.acceptedValue !== undefined) {
                assertString(part.answer.acceptedValue, `${label}.parts[${partIndex}].answer.acceptedValue`, null);
            }
        }
    }
    assertUnique(structured.parts.map((part) => part.stableKey), `${label} part stableKey`);
}

function assertPublishableRecord(record, label) {
    const structured = record.structured;
    if (record.sourcePage === null
        || !record.normalizedQuestionNumber
        || structured.difficultyCode === null
        || structured.parts.length === 0
        || (!structured.prompt && structured.parts.every((part) => !part.prompt))) {
        fail("UNRELIABLE_PUBLISHABLE_GROUP", `${label} 缺少可發布所需的頁碼、題號、難度或題幹。`);
    }
    for (const [partIndex, part] of structured.parts.entries()) {
        if (part.answer === null) {
            fail("UNRELIABLE_PUBLISHABLE_GROUP", `${label} 第 ${partIndex + 1} 小題沒有標準答案。`);
        }
        if (part.answerMode === "single_choice") {
            const answerKey = part.answer.answerKey;
            if (part.gradingPolicy !== "automatic"
                || part.options.length < 2
                || !answerKey
                || !part.options.some((option) => option.key === answerKey)) {
                fail("UNRELIABLE_PUBLISHABLE_GROUP", `${label} 第 ${partIndex + 1} 小題選項或答案不完整。`);
            }
        }
        if (part.answerMode === "text"
            && (part.gradingPolicy !== "manual_review" || !part.answer.acceptedValue)) {
            fail("UNRELIABLE_PUBLISHABLE_GROUP", `${label} 第 ${partIndex + 1} 小題文字答案不完整。`);
        }
    }
}

export function validateHanlinPostgresPlan(plan) {
    assertObject(plan, "plan");
    assertString(plan.parserVersion, "plan.parserVersion", 80);
    if (plan.parserVersion !== PARSER_VERSION) {
        fail("INVALID_IMPORT_PLAN", "plan.parserVersion 與目前匯入器版本不一致。 ");
    }
    assertString(plan.idempotencyKey, "plan.idempotencyKey", 120);
    assertUuid(plan.batchId, "plan.batchId");
    assertSha256(plan.sourceSetHash, "plan.sourceSetHash");
    assertInteger(plan.duplicatesSkipped, "plan.duplicatesSkipped");
    assertCatalogPlan(plan);
    const documents = assertArray(plan.documents, "plan.documents", { nonEmpty: true });
    const groups = assertArray(plan.questionGroups, "plan.questionGroups");

    assertUnique(documents.map((document) => document.sourceDocumentId), "sourceDocumentId");
    assertUnique(documents.map((document) => document.documentIndex), "documentIndex");
    assertUnique(documents.map((document) => document.storageKey), "sanitized storageKey");
    assertUnique(documents.map((document) => document.originalStorageKey), "quarantine storageKey");

    const occurrenceKeys = new Set();
    const recordsByKey = new Map();
    for (const [documentOffset, document] of documents.entries()) {
        assertObject(document, `plan.documents[${documentOffset}]`);
        assertInteger(document.documentIndex, `documents[${documentOffset}].documentIndex`);
        if (document.documentIndex !== documentOffset) {
            fail("INVALID_IMPORT_PLAN", "documentIndex 必須是連續且與文件排序一致。 ");
        }
        assertRelativeFileName(document.relativePath, `documents[${documentOffset}].relativePath`);
        assertRelativeFileName(document.fileName, `documents[${documentOffset}].fileName`);
        if (document.relativePath !== document.fileName.normalize("NFC")) {
            fail("INVALID_IMPORT_PLAN", `${document.fileName} 的 relativePath 與檔名不一致。`, document.fileName);
        }
        assertString(document.originalTitle, `documents[${documentOffset}].originalTitle`, 300);
        assertSha256(document.originalSha256, `documents[${documentOffset}].originalSha256`);
        assertPositiveInteger(document.originalByteSize, `documents[${documentOffset}].originalByteSize`);
        assertString(document.originalMimeType, `documents[${documentOffset}].originalMimeType`, 120);
        assertStorageKey(document.originalStorageKey, `documents[${documentOffset}].originalStorageKey`);
        assertUuid(document.originalAssetId, `documents[${documentOffset}].originalAssetId`);
        assertArray(document.originalMacroMarkers, `documents[${documentOffset}].originalMacroMarkers`);
        assertSha256(document.sanitizedSha256, `documents[${documentOffset}].sanitizedSha256`);
        assertPositiveInteger(document.sanitizedByteSize, `documents[${documentOffset}].sanitizedByteSize`);
        assertString(document.sanitizedMimeType, `documents[${documentOffset}].sanitizedMimeType`, 120);
        assertStorageKey(document.storageKey, `documents[${documentOffset}].storageKey`);
        assertUuid(document.assetId, `documents[${documentOffset}].assetId`);
        assertUuid(document.sourceDocumentId, `documents[${documentOffset}].sourceDocumentId`);
        if (document.originalStorageKey !== `quarantine/source-documents/${document.originalSha256}.doc`
            || document.storageKey !== `sanitized-source-documents/${document.originalSha256}.docx`
            || document.originalAssetId !== deterministicUuid(`asset:quarantine-source-document:${document.originalSha256}`)
            || document.assetId !== deterministicUuid(`asset:sanitized-source-document:${SANITIZER_VERSION}:${document.originalSha256}`)
            || document.sourceDocumentId !== deterministicUuid(`source-document:sanitized-docx:${SANITIZER_VERSION}:${document.originalSha256}`)) {
            fail("INVALID_IMPORT_PLAN", `${document.fileName} 的來源資產固定識別不一致。`, document.fileName);
        }
        assertObject(document.sanitization, `documents[${documentOffset}].sanitization`);
        if (document.sanitization.version !== SANITIZER_VERSION) {
            fail("INVALID_IMPORT_PLAN", `${document.fileName} 的清理器版本不一致。`, document.fileName);
        }
        assertNoPrivatePathMetadata(document.sanitization.tool, `documents[${documentOffset}].sanitization.tool`);
        assertNoPrivatePathMetadata(document.sanitization.policy, `documents[${documentOffset}].sanitization.policy`);
        assertPositiveInteger(document.pageCount, `documents[${documentOffset}].pageCount`);
        assertInteger(document.htmlImageCount, `documents[${documentOffset}].htmlImageCount`);
        assertInteger(document.pdfImageCount, `documents[${documentOffset}].pdfImageCount`);
        assertArray(document.records, `documents[${documentOffset}].records`, { nonEmpty: true });

        for (const [recordOffset, record] of document.records.entries()) {
            assertObject(record, `${document.fileName}.records[${recordOffset}]`);
            assertInteger(record.recordIndex, `${document.fileName}.records[${recordOffset}].recordIndex`);
            assertInteger(record.sourceOrder, `${document.fileName}.records[${recordOffset}].sourceOrder`);
            if (record.documentIndex !== document.documentIndex
                || record.sourceDocumentId !== document.sourceDocumentId) {
                fail("INVALID_IMPORT_PLAN", `${document.fileName} 的題目來源識別不一致。`, document.fileName);
            }
            if (record.sourcePage !== null) assertPositiveInteger(record.sourcePage, `${document.fileName}.sourcePage`);
            assertString(record.sourceQuestionNumber, `${document.fileName}.sourceQuestionNumber`, null, { nonEmpty: false });
            assertString(record.normalizedQuestionNumber, `${document.fileName}.normalizedQuestionNumber`, null, { nonEmpty: false });
            assertString(record.originalType, `${document.fileName}.originalType`, 120);
            assertString(record.originalDifficulty, `${document.fileName}.originalDifficulty`, null, { nonEmpty: false });
            assertString(record.originalKnowledge, `${document.fileName}.originalKnowledge`, null, { nonEmpty: false });
            assertString(record.originalSource, `${document.fileName}.originalSource`, null, { nonEmpty: false });
            assertString(record.originalUnit, `${document.fileName}.originalUnit`, null, { nonEmpty: false });
            assertStructuredQuestion(record.structured, `${document.fileName}.records[${recordOffset}].structured`);
            assertArray(record.pendingReasons, `${document.fileName}.records[${recordOffset}].pendingReasons`);
            for (const reason of record.pendingReasons) assertString(reason, `${document.fileName}.pendingReasons[]`, 120);
            assertSha256(record.contentFingerprint, `${document.fileName}.contentFingerprint`);
            assertArray(record.images, `${document.fileName}.records[${recordOffset}].images`);
            for (const [imageOffset, image] of record.images.entries()) {
                assertObject(image, `${document.fileName}.images[${imageOffset}]`);
                assertUuid(image.assetId, `${document.fileName}.images[${imageOffset}].assetId`);
                assertSha256(image.checksum, `${document.fileName}.images[${imageOffset}].checksum`);
                assertStorageKey(image.storageKey, `${document.fileName}.images[${imageOffset}].storageKey`);
                assertString(image.mimeType, `${document.fileName}.images[${imageOffset}].mimeType`, 120);
                assertPositiveInteger(image.byteSize, `${document.fileName}.images[${imageOffset}].byteSize`);
                if (image.width !== null) assertPositiveInteger(image.width, `${document.fileName}.images[${imageOffset}].width`);
                if (image.height !== null) assertPositiveInteger(image.height, `${document.fileName}.images[${imageOffset}].height`);
                if (image.assetId !== deterministicUuid(`asset:question-content:${image.checksum}`)) {
                    fail("INVALID_IMPORT_PLAN", `${document.fileName} 的題目圖片固定識別不一致。`, document.fileName);
                }
            }
            const key = `${document.sourceDocumentId}:${record.recordIndex}`;
            if (recordsByKey.has(key)) fail("INVALID_IMPORT_PLAN", "題目 occurrence 識別重複。", document.fileName);
            recordsByKey.set(key, { document, record });
        }
    }
    const sortedFileNames = documents.map((document) => document.fileName)
        .sort((first, second) => first.localeCompare(second, "zh-Hant"));
    if (!documents.every((document, index) => document.fileName === sortedFileNames[index])) {
        fail("INVALID_IMPORT_PLAN", "documents 必須維持標準檔名排序。 ");
    }
    assertUnique(documents.flatMap((document) => document.records.map((record) => record.sourceOrder)), "sourceOrder");

    for (const [groupIndex, group] of groups.entries()) {
        assertObject(group, `plan.questionGroups[${groupIndex}]`);
        assertString(group.identityKey, `questionGroups[${groupIndex}].identityKey`, null);
        assertSha256(group.contentFingerprint, `questionGroups[${groupIndex}].contentFingerprint`);
        assertString(group.publisherIdentifier, `questionGroups[${groupIndex}].publisherIdentifier`, 120);
        if (typeof group.publishable !== "boolean") fail("INVALID_IMPORT_PLAN", "questionGroup.publishable 必須是 boolean。");
        const occurrences = assertArray(group.occurrences, `questionGroups[${groupIndex}].occurrences`, { nonEmpty: true });
        for (const [occurrenceIndex, occurrence] of occurrences.entries()) {
            assertObject(occurrence, `questionGroups[${groupIndex}].occurrences[${occurrenceIndex}]`);
            const key = `${occurrence.document?.sourceDocumentId}:${occurrence.record?.recordIndex}`;
            const trustedOccurrence = recordsByKey.get(key);
            if (!trustedOccurrence) fail("INVALID_IMPORT_PLAN", "questionGroup occurrence 不在 documents 內。");
            if (occurrence.document !== trustedOccurrence.document || occurrence.record !== trustedOccurrence.record) {
                fail("INVALID_IMPORT_PLAN", "questionGroup occurrence 必須引用已驗證的 document/record 物件。 ");
            }
            if (occurrenceKeys.has(key)) fail("INVALID_IMPORT_PLAN", "questionGroup occurrence 重複。 ");
            occurrenceKeys.add(key);
        }
        const canonicalKey = `${group.canonical?.document?.sourceDocumentId}:${group.canonical?.record?.recordIndex}`;
        const trustedCanonical = recordsByKey.get(canonicalKey);
        if (!trustedCanonical
            || group.canonical.document !== trustedCanonical.document
            || group.canonical.record !== trustedCanonical.record) {
            fail("INVALID_IMPORT_PLAN", "questionGroup canonical 必須引用已驗證的 document/record 物件。 ");
        }
        const expectedIdentityKey = `${trustedCanonical.document.originalSha256}:${trustedCanonical.record.normalizedQuestionNumber || `record-${trustedCanonical.record.recordIndex}`}`;
        const expectedPublisherIdentifier = `${trustedCanonical.document.originalSha256.slice(0, 16)}:${group.number}`;
        if (group.number !== trustedCanonical.record.normalizedQuestionNumber
            || group.identityKey !== expectedIdentityKey
            || group.publisherIdentifier !== (expectedPublisherIdentifier.length <= 120
                ? expectedPublisherIdentifier
                : `${trustedCanonical.document.originalSha256.slice(0, 16)}:${sha256Text(group.number)}`)) {
            fail("INVALID_IMPORT_PLAN", "questionGroup 題號或來源固定識別不一致。 ");
        }
        if (!occurrenceKeys.has(canonicalKey)
            || !occurrences.some((occurrence) => `${occurrence.document.sourceDocumentId}:${occurrence.record.recordIndex}` === canonicalKey)) {
            fail("INVALID_IMPORT_PLAN", "questionGroup canonical 不在其 occurrences 內。");
        }
        if (group.publishable) {
            assertString(group.number, `questionGroups[${groupIndex}].number`, 120);
            assertUuid(group.questionId, `questionGroups[${groupIndex}].questionId`);
            assertUuid(group.revisionId, `questionGroups[${groupIndex}].revisionId`);
            if (group.questionId !== deterministicUuid(`question:hanlin:${group.identityKey}`)
                || group.revisionId !== deterministicUuid(`revision:${plan.batchId}:${group.identityKey}:${group.contentFingerprint}`)) {
                fail("INVALID_IMPORT_PLAN", "publishable group 的題目或版本固定識別不一致。 ");
            }
            if (occurrences.some(({ record }) => record.pendingReasons.length > 0)
                || new Set(occurrences.map(({ record }) => record.contentFingerprint)).size !== 1
                || occurrences[0].record.contentFingerprint !== group.contentFingerprint) {
                fail("INVALID_IMPORT_PLAN", "publishable group 含待核對或內容不一致題目。 ");
            }
            for (const [occurrenceIndex, occurrence] of occurrences.entries()) {
                assertPublishableRecord(
                    occurrence.record,
                    `questionGroups[${groupIndex}].occurrences[${occurrenceIndex}]`,
                );
            }
        }
    }
    if (occurrenceKeys.size !== recordsByKey.size) {
        fail("INVALID_IMPORT_PLAN", "每筆解析題目必須恰好出現在一個 questionGroup。 ");
    }
    const sourceOrders = documents.flatMap((document) => document.records.map((record) => record.sourceOrder));
    if (!sourceOrders.every((sourceOrder, index) => sourceOrder === index)) {
        fail("INVALID_IMPORT_PLAN", "sourceOrder 必須從 0 起連續排列。 ");
    }
    const manifest = documents.map((document) => ({
        relativePath: document.relativePath,
        originalSha256: document.originalSha256,
    }));
    const expectedSourceSetHash = sha256Text(stableJson(manifest));
    const expectedIdempotencyKey = `${plan.parserVersion}:${plan.target.key}:${expectedSourceSetHash}`;
    if (plan.sourceSetHash !== expectedSourceSetHash
        || plan.idempotencyKey !== expectedIdempotencyKey
        || plan.batchId !== deterministicUuid(`import-batch:${expectedIdempotencyKey}`)) {
        fail("INVALID_IMPORT_PLAN", "來源集合、冪等鍵或批次固定識別不一致。 ");
    }
}

function quoteIdentifier(identifier) {
    if (!COLUMN_NAME_PATTERN.test(identifier) && !TABLE_NAME_PATTERN.test(identifier)) {
        fail("INTERNAL_WRITER_ERROR", `不安全的 SQL 識別字：${identifier}`);
    }
    return `"${identifier}"`;
}

function normalizedComparable(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalizedComparable);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedComparable(value[key])]));
    }
    return value;
}

function valuesMatch(actual, expected) {
    if (expected === null || expected === undefined) return actual === null || actual === undefined;
    if (typeof expected === "number") return Number(actual) === expected;
    return JSON.stringify(normalizedComparable(actual)) === JSON.stringify(normalizedComparable(expected));
}

async function ensureRow(client, table, row, keyColumns, compareColumns = Object.keys(row)) {
    if (!TABLE_NAME_PATTERN.test(table)) fail("INTERNAL_WRITER_ERROR", `不安全的資料表名稱：${table}`);
    const columns = Object.keys(row);
    for (const column of [...columns, ...keyColumns, ...compareColumns]) quoteIdentifier(column);
    const insertSql = `
        INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
        VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})
        ON CONFLICT DO NOTHING
    `;
    await client.query(insertSql, columns.map((column) => row[column]));
    const conditions = keyColumns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(" AND ");
    const result = await client.query(
        `SELECT ${compareColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)} WHERE ${conditions}`,
        keyColumns.map((column) => row[column]),
    );
    if (result.rowCount !== 1) {
        fail("DATABASE_IDENTITY_CONFLICT", `${table} 的固定識別與既有唯一資料衝突。`);
    }
    for (const column of compareColumns) {
        if (!valuesMatch(result.rows[0][column], row[column])) {
            fail("DATABASE_IDENTITY_CONFLICT", `${table}.${column} 與既有資料不一致；未覆寫既有資料。`);
        }
    }
    return result.rows[0];
}

function connectionConfig(pgConfig = {}, pgEnv = process.env) {
    const options = pgConfig ?? {};
    const environment = pgEnv ?? {};
    assertObject(options, "pgConfig");
    assertObject(environment, "pgEnv");
    if (options.password !== undefined || options.ssl !== undefined) {
        fail("UNSAFE_DATABASE_CONFIG", "本機匯入器不接受密碼或 TLS 設定。 ");
    }
    const host = options.host ?? options.socket ?? environment.LOCAL_PG_SOCKET ?? LOCAL_SOCKET;
    if (typeof host !== "string" || !path.isAbsolute(host)) {
        fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL host 必須是本機 Unix socket 絕對路徑。 ");
    }
    const rawPort = options.port ?? environment.LOCAL_PG_PORT ?? 55432;
    const port = typeof rawPort === "string" && /^\d+$/.test(rawPort) ? Number(rawPort) : rawPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL port 必須介於 1 與 65535。 ");
    }
    const database = options.database ?? environment.LOCAL_PG_DATABASE ?? "lerniqa_local";
    const user = options.user ?? environment.LOCAL_PG_USER ?? os.userInfo().username;
    assertString(database, "PostgreSQL database", 63);
    assertString(user, "PostgreSQL user", 63);
    const isolatedRootValue = environment.LERNIQA_ISOLATED_TEST_ROOT;
    if (isolatedRootValue !== undefined) {
        if (typeof isolatedRootValue !== "string"
            || isolatedRootValue.trim() === ""
            || !path.isAbsolute(isolatedRootValue)) {
            fail("UNSAFE_DATABASE_CONFIG", "LERNIQA_ISOLATED_TEST_ROOT 必須是非空的絕對路徑。");
        }
        const isolatedTestRoot = path.resolve(isolatedRootValue);
        const isolatedTestToken = environment.LERNIQA_ISOLATED_TEST_TOKEN;
        const existingServerMode = environment.LERNIQA_PRACTICE_TEST_EXISTING ?? "0";
        if (!["0", "1"].includes(existingServerMode)) {
            fail("UNSAFE_DATABASE_CONFIG", "LERNIQA_PRACTICE_TEST_EXISTING 只接受 0 或 1。");
        }
        const borrowingExistingServer = existingServerMode === "1";
        let expectedSocket = path.join(isolatedTestRoot, "socket");
        let expectedDataDirectory = path.join(isolatedTestRoot, "postgres");
        if (borrowingExistingServer) {
            const approvedSocket = environment.LERNIQA_PRACTICE_TEST_SOCKET;
            const approvedPort = environment.LERNIQA_PRACTICE_TEST_PORT;
            const approvedDataDirectory = environment.LERNIQA_PRACTICE_TEST_DATA_DIRECTORY;
            if (typeof approvedSocket !== "string"
                || !path.isAbsolute(approvedSocket)
                || typeof approvedPort !== "string"
                || !/^\d+$/u.test(approvedPort)
                || Number(approvedPort) !== port
                || typeof approvedDataDirectory !== "string"
                || !path.isAbsolute(approvedDataDirectory)) {
                fail("UNSAFE_DATABASE_CONFIG", "existing-local-server 隔離匯入缺少明確且一致的 socket、port 或 data_directory 核准設定。");
            }
            expectedSocket = path.resolve(approvedSocket);
            expectedDataDirectory = path.resolve(approvedDataDirectory);
        }
        if (!ISOLATED_TEST_ROOT_PATTERN.test(path.basename(isolatedTestRoot))
            || isolatedTestRoot === REPOSITORY_ROOT
            || isolatedTestRoot.startsWith(`${REPOSITORY_ROOT}${path.sep}`)
            || path.resolve(host) !== expectedSocket
            || !ISOLATED_TEST_DATABASE_PATTERN.test(database)
            || typeof isolatedTestToken !== "string"
            || !ISOLATED_TEST_TOKEN_PATTERN.test(isolatedTestToken)
            || user !== os.userInfo().username) {
            fail(
                "UNSAFE_DATABASE_CONFIG",
                "隔離匯入只允許本次臨時目錄的 Unix socket、lerniqa_practice_test_* 資料庫與目前使用者。",
            );
        }
        return {
            host,
            port,
            database,
            user,
            isolatedTestRoot,
            isolatedTestToken,
            borrowingExistingServer,
            expectedSocket,
            expectedDataDirectory,
        };
    }
    if (environment.LERNIQA_PRACTICE_TEST_EXISTING !== undefined) {
        fail("UNSAFE_DATABASE_CONFIG", "existing-local-server 模式只能搭配具一次性 marker 的隔離練習 runner。 ");
    }
    if (path.resolve(host) !== path.resolve(LOCAL_SOCKET)
        || port !== 55432
        || database !== "lerniqa_local"
        || user !== os.userInfo().username) {
        fail(
            "UNSAFE_DATABASE_CONFIG",
            "匯入器只允許 repository 管理的 lerniqa_local Unix socket 與目前作業系統使用者。",
        );
    }
    return {
        host,
        port,
        database,
        user,
        isolatedTestRoot: null,
        isolatedTestToken: null,
        borrowingExistingServer: false,
        expectedSocket: path.resolve(LOCAL_SOCKET),
        expectedDataDirectory: path.join(REPOSITORY_ROOT, "local-data", "postgres"),
    };
}

async function assertSchema(client) {
    const result = await client.query("SELECT version, name FROM schema_migrations ORDER BY version");
    const actual = result.rows.map(({ version, name }) => [version, name]);
    if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_MIGRATIONS)) {
        fail(
            "SCHEMA_VERSION_MISMATCH",
            `本機資料庫 migration 必須精確為 0001–0011；目前為 ${actual.map(([version]) => version).join(", ") || "空"}。`,
        );
    }
}

async function assertIsolatedServer(client, config) {
    const result = await client.query(`
        SELECT
            current_user AS current_user_name,
            session_user AS session_user_name,
            current_setting('listen_addresses') AS listen_addresses,
            current_setting('unix_socket_directories') AS socket_directories,
            current_setting('unix_socket_permissions') AS socket_permissions,
            current_setting('port') AS port,
            current_setting('data_directory') AS data_directory,
            inet_server_addr() IS NULL AS uses_unix_socket,
            current_database() AS database_name,
            pg_catalog.pg_is_in_recovery() AS in_recovery,
            (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = current_database()
            ) AS database_comment
    `);
    const server = result.rows[0];
    const expectedDataDirectory = config.expectedDataDirectory;
    let canonicalExpectedSocket = await realpath(config.expectedSocket).catch(() => null);
    let canonicalExpectedDataDirectory = await realpath(expectedDataDirectory).catch(() => null);
    if (config.isolatedTestRoot !== null) {
        const markerPath = path.join(config.isolatedTestRoot, ISOLATED_TEST_MARKER);
        const [canonicalTempRoot, canonicalRoot, canonicalMarker] = await Promise.all([
            realpath(os.tmpdir()).catch(() => null),
            realpath(config.isolatedTestRoot).catch(() => null),
            realpath(markerPath).catch(() => null),
        ]);
        const [rootMetadata, markerMetadata, markerToken] = await Promise.all([
            stat(config.isolatedTestRoot).catch(() => null),
            stat(markerPath).catch(() => null),
            readFile(markerPath, "utf8").catch(() => null),
        ]);
        if (canonicalTempRoot === null
            || canonicalRoot !== config.isolatedTestRoot
            || path.dirname(canonicalRoot) !== canonicalTempRoot
            || canonicalMarker !== markerPath
            || !rootMetadata?.isDirectory()
            || !markerMetadata?.isFile()
            || (rootMetadata.mode & 0o077) !== 0
            || (markerMetadata.mode & 0o077) !== 0
            || markerToken?.trim() !== config.isolatedTestToken) {
            fail("UNSAFE_DATABASE_TARGET", "隔離 runner 必須位於系統臨時目錄、使用私有真實目錄，並附帶本次正確 marker。");
        }
        if (!config.borrowingExistingServer) {
            const [socketMetadata, dataMetadata] = await Promise.all([
                stat(config.host).catch(() => null),
                stat(expectedDataDirectory).catch(() => null),
            ]);
            if (canonicalExpectedSocket !== config.host
                || canonicalExpectedDataDirectory !== expectedDataDirectory
                || !socketMetadata?.isDirectory()
                || !dataMetadata?.isDirectory()
                || (socketMetadata.mode & 0o077) !== 0
                || (dataMetadata.mode & 0o077) !== 0) {
                fail("UNSAFE_DATABASE_TARGET", "自建隔離 PostgreSQL 必須位於本次私有暫存目錄。 ");
            }
        }
    }
    const [canonicalServerSocket, canonicalServerDataDirectory] = await Promise.all([
        realpath(server?.socket_directories).catch(() => null),
        realpath(server?.data_directory).catch(() => null),
    ]);
    const commonIdentityMismatch = !server
        || server.current_user_name !== config.user
        || server.session_user_name !== config.user
        || Number(server.port) !== config.port
        || server.uses_unix_socket !== true
        || server.database_name !== config.database
        || server.in_recovery !== false
        || canonicalExpectedSocket === null
        || canonicalServerSocket !== canonicalExpectedSocket
        || canonicalExpectedDataDirectory === null
        || canonicalServerDataDirectory !== canonicalExpectedDataDirectory;
    const modeSpecificMismatch = config.borrowingExistingServer
        ? server?.database_comment !== `${ISOLATED_DATABASE_OWNERSHIP_COMMENT_PREFIX}${config.isolatedTestToken}`
        : server?.listen_addresses !== ""
            || server?.socket_permissions !== "0700";
    if (commonIdentityMismatch || modeSpecificMismatch) {
        fail(
            "UNSAFE_DATABASE_TARGET",
            config.borrowingExistingServer
                ? "PostgreSQL existing-local-server 身分或隔離資料庫 ownership marker 不符。"
                : "PostgreSQL 不是指定的私有 Unix-socket-only Lerniqa 隔離資料庫。",
        );
    }
}

export async function seedHanlinCatalog(client, plan) {
    const { ids, target } = plan;
    await ensureRow(client, "users", {
        id: HANLIN_IMPORT_PRINCIPAL.userId,
        display_name: HANLIN_IMPORT_PRINCIPAL.displayName,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "grades", {
        id: ids.gradeId,
        stage: "junior_high",
        code: target.gradeCode,
        name: target.gradeName,
        sort_order: 7,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "semesters", {
        id: ids.semesterId,
        code: target.semesterCode,
        name: target.semesterName,
        sort_order: 1,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "publishers", {
        id: ids.publisherId,
        code: target.publisherCode,
        name: target.publisherName,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "subjects", {
        id: ids.subjectId,
        code: target.subjectCode,
        name: target.subjectName,
        normalized_name: target.subjectName.normalize("NFKC"),
        parent_subject_id: null,
        subject_kind: "leaf",
        origin: "system",
        owner_user_id: null,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "subject_aliases", {
        id: ids.subjectAliasId,
        subject_id: ids.subjectId,
        alias: target.subjectAlias,
        normalized_alias: target.subjectAlias.normalize("NFKC"),
        status: "active",
    }, ["id"]);
    await ensureRow(client, "grade_subjects", {
        grade_id: ids.gradeId,
        subject_id: ids.subjectId,
        is_default: true,
        sort_order: 0,
        active_from: null,
        active_until: null,
    }, ["grade_id", "subject_id"]);
    await ensureRow(client, "book_versions", {
        id: ids.bookVersionId,
        subject_id: ids.subjectId,
        grade_id: ids.gradeId,
        publisher_id: ids.publisherId,
        name: target.bookName,
        origin: "system",
        owner_user_id: null,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "curriculum_units", {
        id: ids.volumeUnitId,
        subject_id: ids.subjectId,
        grade_id: ids.gradeId,
        semester_id: ids.semesterId,
        book_version_id: ids.bookVersionId,
        parent_unit_id: null,
        unit_type: "volume",
        code: target.volumeCode,
        name: target.volumeName,
        position: 0,
        status: "active",
        origin: "system",
        owner_user_id: null,
    }, ["id"]);
    await ensureRow(client, "curriculum_units", {
        id: ids.targetUnitId,
        subject_id: ids.subjectId,
        grade_id: ids.gradeId,
        semester_id: ids.semesterId,
        book_version_id: ids.bookVersionId,
        parent_unit_id: ids.volumeUnitId,
        unit_type: "lesson",
        code: target.unitCode,
        name: target.unitName,
        position: 4,
        status: "active",
        origin: "system",
        owner_user_id: null,
    }, ["id"]);
    await ensureRow(client, "source_categories", {
        id: ids.sourceCategoryId,
        code: target.sourceCategoryCode,
        name: target.sourceCategoryName,
        exam_program_id: null,
        status: "active",
        sort_order: 0,
        origin: "system",
        owner_user_id: null,
    }, ["id"]);
    const dimensions = ["grade", "semester", "book_version", "unit"];
    for (const [index, dimension] of dimensions.entries()) {
        await ensureRow(client, "source_category_dimensions", {
            source_category_id: ids.sourceCategoryId,
            dimension,
            native_requirement: "required",
            sort_order: index,
        }, ["source_category_id", "dimension"]);
    }
    await ensureRow(client, "question_types", {
        id: ids.questionTypeChoiceId,
        code: "single-choice",
        name: "單一選擇題",
        supports_parts: false,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "question_types", {
        id: ids.questionTypeMultiId,
        code: "multi-choice",
        name: "多小題選擇題",
        supports_parts: true,
        status: "active",
    }, ["id"]);
    await ensureRow(client, "question_types", {
        id: ids.questionTypeWrittenId,
        code: "written",
        name: "文字作答題",
        supports_parts: true,
        status: "active",
    }, ["id"]);
    const difficulties = [
        [ids.difficultyBasicId, "basic", "基礎", 0],
        [ids.difficultyIntermediateId, "intermediate", "中等", 1],
        [ids.difficultyAdvancedId, "advanced", "進階", 2],
    ];
    for (const [id, code, name, sortOrder] of difficulties) {
        await ensureRow(client, "difficulty_levels", {
            id,
            code,
            name,
            sort_order: sortOrder,
            status: "active",
        }, ["id"]);
    }
    await ensureRow(client, "question_banks", {
        id: ids.questionBankId,
        name: "翰林國文題庫",
        origin: HANLIN_REAL_DATA_OWNERSHIP.origin,
        owner_user_id: HANLIN_REAL_DATA_OWNERSHIP.ownerUserId,
        created_role: null,
        is_default: true,
        status: "active",
    }, ["id"]);
}

function safeDraftPayload(plan, document, record) {
    const structured = {
        kind: record.structured.kind,
        questionTypeCode: record.structured.questionTypeCode,
        difficultyCode: record.structured.difficultyCode,
        prompt: record.structured.prompt,
        parts: record.structured.parts.map((part) => ({
            stableKey: part.stableKey,
            prompt: part.prompt,
            answerMode: part.answerMode,
            gradingPolicy: part.gradingPolicy,
            options: part.options.map((option) => ({ key: option.key, text: option.text })),
            answer: part.answer === null
                ? null
                : {
                    ...(part.answer.answerKey !== undefined ? { answerKey: part.answer.answerKey } : {}),
                    ...(part.answer.acceptedValue !== undefined ? { acceptedValue: part.answer.acceptedValue } : {}),
                },
        })),
        explanation: record.structured.explanation,
        pendingReasons: [...new Set(record.structured.pendingReasons)],
    };
    return {
        schemaVersion: 1,
        relativeFileName: document.relativePath,
        originalTitle: document.originalTitle,
        originalUnit: record.originalUnit,
        originalSha256: document.originalSha256,
        originalScanStatus: "rejected",
        macroQuarantined: document.originalMacroMarkers.length > 0,
        sanitizedSha256: document.sanitizedSha256,
        sanitization: {
            tool: document.sanitization.tool,
            policy: document.sanitization.policy,
        },
        sourceQuestionNumber: record.sourceQuestionNumber,
        normalizedQuestionNumber: record.normalizedQuestionNumber,
        sourcePage: record.sourcePage,
        sourceOrder: record.sourceOrder,
        originalLabels: {
            type: record.originalType,
            difficulty: record.originalDifficulty,
            knowledge: record.originalKnowledge,
            source: record.originalSource,
        },
        structured,
        pendingReasons: [...new Set(record.pendingReasons)],
        contentFingerprint: record.contentFingerprint,
        targetClassification: {
            grade: plan.target.gradeName,
            subject: plan.target.subjectAlias,
            publisher: plan.target.publisherName,
            volume: plan.target.volumeName,
            unit: plan.target.unitName,
        },
    };
}

async function writeAssetsAndDocuments(client, plan) {
    const seenImageAssets = new Set();
    for (const document of plan.documents) {
        await ensureRow(client, "assets", {
            id: document.originalAssetId,
            storage_key: document.originalStorageKey,
            mime_type: document.originalMimeType,
            byte_size: document.originalByteSize,
            width: null,
            height: null,
            checksum: document.originalSha256,
            purpose: "source_document",
            sensitivity: "private",
            scan_status: "rejected",
            created_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
            deleted_at: null,
        }, ["id"]);
        await ensureRow(client, "assets", {
            id: document.assetId,
            storage_key: document.storageKey,
            mime_type: document.sanitizedMimeType,
            byte_size: document.sanitizedByteSize,
            width: null,
            height: null,
            checksum: document.sanitizedSha256,
            purpose: "source_document",
            sensitivity: "private",
            scan_status: "clean",
            created_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
            deleted_at: null,
        }, ["id"]);
        await ensureRow(client, "source_documents", {
            id: document.sourceDocumentId,
            owner_user_id: HANLIN_REAL_DATA_OWNERSHIP.ownerUserId,
            asset_id: document.assetId,
            input_type: "document",
            original_file_name: document.relativePath,
            pasted_text: null,
            document_title: document.originalTitle,
            status: "ready",
        }, ["id"]);
        const candidateId = deterministicUuid(`classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:unit:${document.originalTitle}`);
        await ensureRow(client, "source_document_classification_candidates", {
            id: candidateId,
            source_document_id: document.sourceDocumentId,
            dimension: "unit",
            raw_value: document.originalTitle,
            publisher_id: null,
            subject_id: null,
            grade_id: null,
            semester_id: null,
            book_version_id: null,
            exam_program_id: null,
            exam_program_level_id: null,
            curriculum_unit_id: null,
            curriculum_code_id: null,
            source_category_id: null,
            parser_version: plan.parserVersion,
            confidence: null,
            review_status: "pending",
            reviewed_by_user_id: null,
            reviewed_at: null,
        }, ["id"]);
        await client.query(`
            UPDATE source_document_classification_candidates
            SET review_status = 'rejected',
                reviewed_by_user_id = $3,
                reviewed_at = transaction_timestamp()
            WHERE source_document_id = $1
              AND dimension = 'unit'
              AND review_status = 'approved'
              AND curriculum_unit_id IS NOT NULL
              AND curriculum_unit_id <> $2
        `, [document.sourceDocumentId, plan.ids.targetUnitId, HANLIN_IMPORT_PRINCIPAL.userId]);
        const approvedCandidates = [
            ["grade", plan.target.gradeName, "grade_id", plan.ids.gradeId],
            ["semester", plan.target.semesterName, "semester_id", plan.ids.semesterId],
            ["subject", plan.target.subjectAlias, "subject_id", plan.ids.subjectId],
            ["publisher", plan.target.publisherName, "publisher_id", plan.ids.publisherId],
            ["book_version", plan.target.bookName, "book_version_id", plan.ids.bookVersionId],
            ["unit", plan.target.unitName, "curriculum_unit_id", plan.ids.targetUnitId],
            ["source_category", plan.target.sourceCategoryName, "source_category_id", plan.ids.sourceCategoryId],
        ];
        for (const [dimension, rawValue, targetColumn, targetId] of approvedCandidates) {
            const columns = {
                publisher_id: null,
                subject_id: null,
                grade_id: null,
                semester_id: null,
                book_version_id: null,
                exam_program_id: null,
                exam_program_level_id: null,
                curriculum_unit_id: null,
                curriculum_code_id: null,
                source_category_id: null,
            };
            columns[targetColumn] = targetId;
            const row = {
                id: deterministicUuid(`classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:${dimension}:approved:${targetId}`),
                source_document_id: document.sourceDocumentId,
                dimension,
                raw_value: rawValue,
                ...columns,
                parser_version: plan.parserVersion,
                confidence: 1,
                review_status: "approved",
                reviewed_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
            };
            await client.query(`
                UPDATE source_document_classification_candidates
                SET review_status = 'rejected',
                    reviewed_by_user_id = $3,
                    reviewed_at = transaction_timestamp()
                WHERE source_document_id = $1
                  AND dimension = $2
                  AND review_status = 'approved'
                  AND id <> $4
            `, [document.sourceDocumentId, dimension, HANLIN_IMPORT_PRINCIPAL.userId, row.id]);
            await client.query(`
                UPDATE source_document_classification_candidates
                SET review_status = 'approved',
                    reviewed_by_user_id = $2,
                    reviewed_at = transaction_timestamp()
                WHERE id = $1
                  AND review_status <> 'approved'
            `, [row.id, HANLIN_IMPORT_PRINCIPAL.userId]);
            const rowColumns = Object.keys(row);
            await client.query(`
                INSERT INTO source_document_classification_candidates (
                    ${rowColumns.map(quoteIdentifier).join(", ")}, reviewed_at
                ) VALUES (
                    ${rowColumns.map((_, index) => `$${index + 1}`).join(", ")}, transaction_timestamp()
                )
                ON CONFLICT DO NOTHING
            `, rowColumns.map((column) => row[column]));
            const result = await client.query(`
                SELECT ${rowColumns.map(quoteIdentifier).join(", ")},
                       (reviewed_at IS NOT NULL) AS has_reviewed_at
                FROM source_document_classification_candidates
                WHERE id = $1
            `, [row.id]);
            if (result.rowCount !== 1 || !result.rows[0].has_reviewed_at) {
                fail("DATABASE_IDENTITY_CONFLICT", "來源文件正式分類候選與既有資料衝突。 ");
            }
            for (const column of rowColumns) {
                if (!valuesMatch(result.rows[0][column], row[column])) {
                    fail("DATABASE_IDENTITY_CONFLICT", `來源文件正式分類 ${dimension} 與既有資料不一致。`);
                }
            }
        }

        for (const record of document.records) {
            for (const image of record.images) {
                if (seenImageAssets.has(image.assetId)) continue;
                seenImageAssets.add(image.assetId);
                await ensureRow(client, "assets", {
                    id: image.assetId,
                    storage_key: image.storageKey,
                    mime_type: image.mimeType,
                    byte_size: image.byteSize,
                    width: image.width,
                    height: image.height,
                    checksum: image.checksum,
                    purpose: "question_content",
                    sensitivity: "private",
                    scan_status: "clean",
                    created_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
                    deleted_at: null,
                }, ["id"]);
            }
        }
    }
}

async function ensureBatch(client, plan) {
    await ensureRow(client, "import_batches", {
        id: plan.batchId,
        question_bank_id: plan.ids.questionBankId,
        learner_id: HANLIN_REAL_DATA_OWNERSHIP.batchLearnerId,
        created_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
        status: "draft",
        idempotency_key: plan.idempotencyKey,
        recognizer_version: plan.parserVersion,
        confirmed_at: null,
    }, ["id"], [
        "id", "question_bank_id", "learner_id", "created_by_user_id", "idempotency_key", "recognizer_version",
    ]);
    for (const document of plan.documents) {
        await ensureRow(client, "import_batch_documents", {
            import_batch_id: plan.batchId,
            source_document_id: document.sourceDocumentId,
            position: document.documentIndex,
        }, ["import_batch_id", "source_document_id"]);
    }
}

function questionTypeId(plan, code) {
    const value = {
        "single-choice": plan.ids.questionTypeChoiceId,
        "multi-choice": plan.ids.questionTypeMultiId,
        written: plan.ids.questionTypeWrittenId,
    }[code];
    if (!value) fail("INVALID_IMPORT_PLAN", `不支援的題型代碼：${code}`);
    return value;
}

function difficultyId(plan, code) {
    return {
        basic: plan.ids.difficultyBasicId,
        intermediate: plan.ids.difficultyIntermediateId,
        advanced: plan.ids.difficultyAdvancedId,
    }[code] ?? null;
}

function importItemId(plan, document, record) {
    return deterministicUuid(`import-item:${plan.batchId}:${document.sourceDocumentId}:${record.sourceOrder}`);
}

async function insertImportItem(client, plan, document, record, link = null) {
    const approved = link !== null;
    const row = {
        id: importItemId(plan, document, record),
        import_batch_id: plan.batchId,
        source_document_id: document.sourceDocumentId,
        source_page: record.sourcePage,
        source_question_number: record.sourceQuestionNumber.length <= 80 ? record.sourceQuestionNumber : null,
        source_order: record.sourceOrder,
        draft_payload: safeDraftPayload(plan, document, record),
        recognition_confidence: approved ? 1 : null,
        review_status: approved ? "approved" : "pending",
        question_id: link?.questionId ?? null,
        question_revision_id: link?.revisionId ?? null,
        reviewed_by_user_id: approved ? HANLIN_IMPORT_PRINCIPAL.userId : null,
    };
    const columns = Object.keys(row);
    await client.query(`
        INSERT INTO import_items (${columns.map(quoteIdentifier).join(", ")}, reviewed_at)
        VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")}, ${approved ? "transaction_timestamp()" : "NULL"})
        ON CONFLICT DO NOTHING
    `, columns.map((column) => row[column]));
    const result = await client.query(`
        SELECT id, import_batch_id, source_document_id, source_page, source_question_number,
               source_order, draft_payload, recognition_confidence, review_status,
               question_id, question_revision_id, reviewed_by_user_id,
               (reviewed_at IS NOT NULL) AS has_reviewed_at
        FROM import_items
        WHERE id = $1
    `, [row.id]);
    if (result.rowCount !== 1) fail("DATABASE_IDENTITY_CONFLICT", "import_items 固定識別與既有資料衝突。 ");
    const actual = result.rows[0];
    for (const column of columns) {
        if (!valuesMatch(actual[column], row[column])) {
            fail("DATABASE_IDENTITY_CONFLICT", `import_items.${column} 與既有資料不一致。`);
        }
    }
    if (actual.has_reviewed_at !== approved) {
        fail("DATABASE_IDENTITY_CONFLICT", "import_items 審核時間與狀態不一致。 ");
    }
    return row.id;
}

async function resolveQuestionId(client, plan, group) {
    const sourcePairs = group.occurrences.map(({ document, record }) => [
        document.sourceDocumentId,
        record.normalizedQuestionNumber,
    ]);
    const existingIds = new Set();
    for (const [sourceDocumentId, normalizedValue] of sourcePairs) {
        const result = await client.query(`
            SELECT question_id
            FROM question_identifiers
            WHERE identifier_type = 'source_document_question'
              AND source_document_id = $1
              AND normalized_value = $2
        `, [sourceDocumentId, normalizedValue]);
        for (const row of result.rows) existingIds.add(row.question_id);
    }
    const publisher = await client.query(`
        SELECT question_id
        FROM question_identifiers
        WHERE identifier_type = 'publisher_question'
          AND publisher_id = $1
          AND book_version_id = $2
          AND normalized_value = $3
    `, [
        plan.ids.publisherId,
        plan.ids.bookVersionId,
        group.publisherIdentifier.normalize("NFKC").toLowerCase(),
    ]);
    for (const row of publisher.rows) existingIds.add(row.question_id);
    const planned = await client.query("SELECT id FROM questions WHERE id = $1", [group.questionId]);
    if (planned.rowCount === 1) existingIds.add(group.questionId);
    if (existingIds.size > 1) {
        fail("QUESTION_IDENTITY_CONFLICT", "同一匯入群組已連到不同既有題目；未合併或覆寫。 ");
    }
    return existingIds.size === 1 ? [...existingIds][0] : group.questionId;
}

async function ensureQuestion(client, plan, questionId) {
    await ensureRow(client, "questions", {
        id: questionId,
        origin: HANLIN_REAL_DATA_OWNERSHIP.origin,
        owner_user_id: HANLIN_REAL_DATA_OWNERSHIP.ownerUserId,
        current_revision_id: null,
        status: "draft",
        created_method: "import",
        created_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
        archived_at: null,
    }, ["id"], ["id", "origin", "owner_user_id", "created_method", "created_by_user_id", "archived_at"]);
    const result = await client.query(`
        SELECT id, origin, owner_user_id, current_revision_id, status, created_method, created_by_user_id
        FROM questions
        WHERE id = $1
        FOR UPDATE
    `, [questionId]);
    const question = result.rows[0];
    if (!question
        || question.origin !== HANLIN_REAL_DATA_OWNERSHIP.origin
        || question.owner_user_id !== HANLIN_REAL_DATA_OWNERSHIP.ownerUserId
        || question.created_method !== "import"
        || question.created_by_user_id !== HANLIN_IMPORT_PRINCIPAL.userId
        || !["draft", "published"].includes(question.status)) {
        fail("QUESTION_IDENTITY_CONFLICT", "既有題目不是此匯入服務可安全延續的系統題目。 ");
    }
    return question;
}

async function insertQuestionIdentifiers(client, plan, group, questionId) {
    await ensureRow(client, "question_identifiers", {
        id: deterministicUuid(`question-identifier:publisher:${plan.ids.publisherId}:${plan.ids.bookVersionId}:${group.publisherIdentifier}`),
        question_id: questionId,
        identifier_type: "publisher_question",
        publisher_id: plan.ids.publisherId,
        book_version_id: plan.ids.bookVersionId,
        value: group.publisherIdentifier,
        normalized_value: group.publisherIdentifier.normalize("NFKC").toLowerCase(),
        source_document_id: null,
    }, ["id"]);
    for (const { document, record } of group.occurrences) {
        await ensureRow(client, "question_identifiers", {
            id: deterministicUuid(`question-identifier:source:${document.sourceDocumentId}:${record.normalizedQuestionNumber}`),
            question_id: questionId,
            identifier_type: "source_document_question",
            publisher_id: null,
            book_version_id: null,
            value: record.sourceQuestionNumber || record.normalizedQuestionNumber,
            normalized_value: record.normalizedQuestionNumber,
            source_document_id: document.sourceDocumentId,
        }, ["id"]);
    }
}

function buildSearchText(group) {
    const { record } = group.canonical;
    return [
        record.structured.prompt,
        ...record.structured.parts.flatMap((part) => [
            part.prompt,
            ...part.options.map((option) => option.text),
        ]),
        record.originalKnowledge,
        record.originalSource,
    ].filter(Boolean).join("\n");
}

async function createRevision(client, plan, group, question) {
    const existingRevision = await client.query(`
        SELECT id, question_id, status
        FROM question_revisions
        WHERE id = $1
    `, [group.revisionId]);
    if (existingRevision.rowCount > 0) {
        const revision = existingRevision.rows[0];
        if (revision.question_id !== question.id || revision.status !== "published") {
            fail("REVISION_IDENTITY_CONFLICT", "既有題目版本與本批匯入識別不一致。 ");
        }
        return { revisionId: group.revisionId, reused: true };
    }

    const numberResult = await client.query(
        "SELECT COALESCE(MAX(revision_number), 0)::integer + 1 AS next_number FROM question_revisions WHERE question_id = $1",
        [question.id],
    );
    const revisionNumber = numberResult.rows[0].next_number;
    const canonical = group.canonical.record;
    await client.query(`
        INSERT INTO question_revisions (
            id, question_id, revision_number, question_type_id, original_question_type_label,
            subject_id, grade_id, semester_id, book_version_id, exam_program_level_id,
            difficulty_level_id, source_category_id, search_text, status, change_note,
            created_by_type, created_by_user_id, published_at
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, NULL,
            $10, $11, $12, 'draft', $13,
            'user', $14, NULL
        )
    `, [
        group.revisionId,
        question.id,
        revisionNumber,
        questionTypeId(plan, canonical.structured.questionTypeCode),
        canonical.originalType,
        plan.ids.subjectId,
        plan.ids.gradeId,
        plan.ids.semesterId,
        plan.ids.bookVersionId,
        difficultyId(plan, canonical.structured.difficultyCode),
        plan.ids.sourceCategoryId,
        buildSearchText(group),
        revisionNumber > 1 ? "依新版匯入器修正來源文字解析；原始課次與來源證據保留於匯入紀錄。" : null,
        HANLIN_IMPORT_PRINCIPAL.userId,
    ]);
    return { revisionId: group.revisionId, reused: false, revisionNumber };
}

export async function recordHanlinSystemRevisionTransition(client, plan, revisionId, fromStatus, toStatus) {
    const identity = `${plan.batchId}:${revisionId}:${fromStatus}:${toStatus}`;
    await ensureRow(client, "question_revision_reviews", {
        id: deterministicUuid(`question-revision-review:hanlin:${identity}`),
        question_revision_id: revisionId,
        reviewer_type: "bootstrap_admin",
        reviewer_user_id: null,
        decision: "approved",
        reason: null,
        from_status: fromStatus,
        to_status: toStatus,
    }, ["id"]);
    await ensureRow(client, "admin_audit_logs", {
        id: deterministicUuid(`admin-audit:hanlin:${identity}`),
        actor_type: "bootstrap_admin",
        actor_user_id: null,
        action: "system_question_revision_status_changed",
        target_type: "question_revision",
        target_id: revisionId,
        before_data: { status: fromStatus },
        after_data: { status: toStatus },
        request_id: `hanlin:${identity}`,
        source_ip: null,
        user_agent: null,
    }, ["id"]);
}

async function insertRevisionContent(client, plan, group, questionId, revisionId) {
    const { document, record } = group.canonical;
    let blockPosition = 0;
    if (record.structured.prompt) {
        await ensureRow(client, "question_content_blocks", {
            id: deterministicUuid(`content:${revisionId}:prompt:text:0`),
            question_revision_id: revisionId,
            question_part_id: null,
            question_option_id: null,
            parent_block_id: null,
            placement: "prompt",
            content_type: "text",
            position: blockPosition,
            text_content: record.structured.prompt,
            asset_id: null,
            alt_text: null,
        }, ["id"]);
        blockPosition += 1;
    }
    for (const [imageIndex, image] of record.images.entries()) {
        await ensureRow(client, "question_content_blocks", {
            id: deterministicUuid(`content:${revisionId}:prompt:image:${image.checksum}:${imageIndex}`),
            question_revision_id: revisionId,
            question_part_id: null,
            question_option_id: null,
            parent_block_id: null,
            placement: "prompt",
            content_type: "image",
            position: blockPosition,
            text_content: null,
            asset_id: image.assetId,
            alt_text: `${document.originalTitle} 題目附圖`,
        }, ["id"]);
        blockPosition += 1;
    }

    for (const [partIndex, part] of record.structured.parts.entries()) {
        const partId = deterministicUuid(`question-part:${revisionId}:${part.stableKey}`);
        await ensureRow(client, "question_parts", {
            id: partId,
            question_revision_id: revisionId,
            parent_part_id: null,
            stable_key: part.stableKey,
            position: partIndex,
            answer_mode: part.answerMode,
            grading_policy: part.gradingPolicy,
            is_independently_gradable: true,
        }, ["id"]);
        if (part.prompt) {
            await ensureRow(client, "question_content_blocks", {
                id: deterministicUuid(`content:${revisionId}:part:${part.stableKey}:prompt`),
                question_revision_id: revisionId,
                question_part_id: partId,
                question_option_id: null,
                parent_block_id: null,
                placement: "prompt",
                content_type: "text",
                position: 0,
                text_content: part.prompt,
                asset_id: null,
                alt_text: null,
            }, ["id"]);
        }
        for (const [optionIndex, option] of part.options.entries()) {
            const optionId = deterministicUuid(`question-option:${partId}:${option.key}`);
            await ensureRow(client, "question_options", {
                id: optionId,
                question_part_id: partId,
                option_key: option.key,
                position: optionIndex,
            }, ["id"]);
            await ensureRow(client, "question_content_blocks", {
                id: deterministicUuid(`content:${revisionId}:part:${part.stableKey}:option:${option.key}`),
                question_revision_id: revisionId,
                question_part_id: partId,
                question_option_id: optionId,
                parent_block_id: null,
                placement: "option",
                content_type: "text",
                position: optionIndex,
                text_content: option.text,
                asset_id: null,
                alt_text: null,
            }, ["id"]);
        }
        if (part.answer) {
            await ensureRow(client, "question_answers", {
                id: deterministicUuid(`question-answer:${partId}:0`),
                question_part_id: partId,
                answer_key: part.answer.answerKey ?? null,
                accepted_value: part.answer.acceptedValue ?? null,
                position: 0,
            }, ["id"]);
        }
    }
    if (record.structured.explanation) {
        await ensureRow(client, "question_content_blocks", {
            id: deterministicUuid(`content:${revisionId}:explanation:0`),
            question_revision_id: revisionId,
            question_part_id: null,
            question_option_id: null,
            parent_block_id: null,
            placement: "explanation",
            content_type: "text",
            position: 0,
            text_content: record.structured.explanation,
            asset_id: null,
            alt_text: null,
        }, ["id"]);
    }
    await ensureRow(client, "question_revision_units", {
        question_revision_id: revisionId,
        curriculum_unit_id: plan.ids.targetUnitId,
        assignment_type: "native",
        is_primary: true,
        value_source: "document",
        confidence: 1,
    }, ["question_revision_id", "curriculum_unit_id"]);

    for (const [occurrenceIndex, { document: sourceDocument, record: sourceRecord }] of group.occurrences.entries()) {
        const itemId = await insertImportItem(client, plan, sourceDocument, sourceRecord, { questionId, revisionId });
        await ensureRow(client, "question_revision_sources", {
            id: deterministicUuid(`revision-source:${revisionId}:${sourceDocument.sourceDocumentId}:${sourceRecord.recordIndex}`),
            question_revision_id: revisionId,
            source_document_id: sourceDocument.sourceDocumentId,
            import_item_id: itemId,
            source_page: sourceRecord.sourcePage,
            source_question_number: sourceRecord.sourceQuestionNumber.length <= 80
                ? sourceRecord.sourceQuestionNumber
                : null,
            crop_asset_id: null,
            is_primary: occurrenceIndex === 0,
        }, ["id"]);
    }
}

async function publishRevision(client, plan, question, revisionId) {
    if (question.current_revision_id && question.current_revision_id !== revisionId) {
        const superseded = await client.query(`
            UPDATE question_revisions
            SET status = 'superseded'
            WHERE id = $1
              AND question_id = $2
              AND status = 'published'
            RETURNING id
        `, [question.current_revision_id, question.id]);
        if (superseded.rowCount !== 1) {
            fail("REVISION_STATE_CONFLICT", "既有目前版本無法安全轉為 superseded。 ");
        }
        await recordHanlinSystemRevisionTransition(
            client,
            plan,
            question.current_revision_id,
            "published",
            "superseded",
        );
    }
    const published = await client.query(`
        UPDATE question_revisions
        SET status = 'published', published_at = transaction_timestamp()
        WHERE id = $1
          AND question_id = $2
          AND status = 'draft'
        RETURNING id
    `, [revisionId, question.id]);
    if (published.rowCount !== 1) {
        const existing = await client.query(
            "SELECT id FROM question_revisions WHERE id = $1 AND question_id = $2 AND status = 'published'",
            [revisionId, question.id],
        );
        if (existing.rowCount !== 1) fail("REVISION_STATE_CONFLICT", "新版本無法安全發布。 ");
    }
    else {
        await recordHanlinSystemRevisionTransition(client, plan, revisionId, "draft", "published");
    }
    await client.query(`
        UPDATE questions
        SET current_revision_id = $2, status = 'published'
        WHERE id = $1
    `, [question.id, revisionId]);
}

async function writeQuestionGroup(client, plan, group) {
    if (!group.publishable) {
        for (const { document, record } of group.occurrences) {
            await insertImportItem(client, plan, document, record, null);
        }
        return { published: false, reclassified: false };
    }

    const questionId = await resolveQuestionId(client, plan, group);
    const question = await ensureQuestion(client, plan, questionId);
    await insertQuestionIdentifiers(client, plan, group, questionId);
    const revision = await createRevision(client, plan, group, question);
    if (!revision.reused) {
        await insertRevisionContent(client, plan, group, questionId, revision.revisionId);
        await publishRevision(client, plan, question, revision.revisionId);
    }
    await ensureRow(client, "question_bank_items", {
        question_bank_id: plan.ids.questionBankId,
        question_id: questionId,
        added_by_user_id: HANLIN_IMPORT_PRINCIPAL.userId,
    }, ["question_bank_id", "question_id"]);
    return {
        published: true,
        reclassified: Boolean(question.current_revision_id && question.current_revision_id !== revision.revisionId),
    };
}

async function existingBatchState(client, plan) {
    const result = await client.query(`
        SELECT id, question_bank_id, learner_id, created_by_user_id, status,
               idempotency_key, recognizer_version, confirmed_at
        FROM import_batches
        WHERE id = $1 OR (created_by_user_id = $2 AND idempotency_key = $3)
        FOR UPDATE
    `, [plan.batchId, HANLIN_IMPORT_PRINCIPAL.userId, plan.idempotencyKey]);
    if (result.rowCount === 0) return null;
    if (result.rowCount !== 1) fail("DATABASE_IDENTITY_CONFLICT", "匯入批次識別不唯一。 ");
    const row = result.rows[0];
    if (row.id !== plan.batchId
        || row.question_bank_id !== plan.ids.questionBankId
        || row.learner_id !== HANLIN_REAL_DATA_OWNERSHIP.batchLearnerId
        || row.created_by_user_id !== HANLIN_IMPORT_PRINCIPAL.userId
        || row.idempotency_key !== plan.idempotencyKey
        || row.recognizer_version !== plan.parserVersion) {
        fail("DATABASE_IDENTITY_CONFLICT", "匯入批次與既有資料不一致；未覆寫。 ");
    }
    return row;
}

async function batchSummary(client, plan, baseSummary, { reusedBatch, reclassified, batchStatus }) {
    const counts = await client.query(`
        SELECT
            count(*)::integer AS parsed,
            count(*) FILTER (WHERE review_status = 'approved')::integer AS approved_occurrences,
            count(*) FILTER (WHERE review_status = 'pending')::integer AS pending_review,
            count(DISTINCT question_id) FILTER (WHERE question_id IS NOT NULL)::integer AS published
        FROM import_items
        WHERE import_batch_id = $1
    `, [plan.batchId]);
    const documents = await client.query(
        "SELECT count(*)::integer AS count FROM import_batch_documents WHERE import_batch_id = $1",
        [plan.batchId],
    );
    const row = counts.rows[0];
    const expectedParsed = plan.documents.reduce((total, document) => total + document.records.length, 0);
    const expectedApproved = plan.questionGroups
        .filter((group) => group.publishable)
        .reduce((total, group) => total + group.occurrences.length, 0);
    const expectedPublished = plan.questionGroups.filter((group) => group.publishable).length;
    if (documents.rows[0].count !== plan.documents.length
        || row.parsed !== expectedParsed
        || row.approved_occurrences !== expectedApproved
        || row.pending_review !== expectedParsed - expectedApproved
        || row.published !== expectedPublished) {
        fail("BATCH_EVIDENCE_MISMATCH", "已確認批次的文件、題目或審核筆數與匯入計畫不一致。 ");
    }
    return {
        ...(baseSummary ?? {}),
        sourceFiles: documents.rows[0].count,
        parsed: row.parsed,
        published: row.published,
        pendingReview: row.pending_review,
        approvedOccurrences: row.approved_occurrences,
        duplicatesSkipped: plan.duplicatesSkipped,
        failed: 0,
        failedFiles: [],
        batchId: plan.batchId,
        sourceDocumentIds: plan.documents.map((document) => document.sourceDocumentId),
        idempotencyKey: plan.idempotencyKey,
        target: {
            grade: plan.target.gradeName,
            subject: plan.target.subjectAlias,
            publisher: plan.target.publisherName,
            volume: plan.target.volumeName,
            unit: plan.target.unitName,
        },
        persistence: "local-postgresql",
        batchStatus,
        reusedBatch,
        reclassified,
    };
}

function plannedStorageKeys(plan) {
    return [...new Set(plan.documents.flatMap((document) => [
        document.originalStorageKey,
        document.storageKey,
        ...document.records.flatMap((record) => record.images.map((image) => image.storageKey)),
    ]))];
}

function plannedAssets(plan) {
    const assets = new Map();
    for (const document of plan.documents) {
        assets.set(document.originalStorageKey, {
            byteSize: document.originalByteSize,
            checksum: document.originalSha256,
        });
        assets.set(document.storageKey, {
            byteSize: document.sanitizedByteSize,
            checksum: document.sanitizedSha256,
        });
        for (const record of document.records) {
            for (const image of record.images) {
                assets.set(image.storageKey, { byteSize: image.byteSize, checksum: image.checksum });
            }
        }
    }
    return assets;
}

async function verifyMaterializedAssets(plan, assetRoot) {
    if (assetRoot === null || assetRoot === undefined) {
        fail("ASSET_COMMIT_HOOK_REQUIRED", "未提供 beforeCommit 時必須提供 assetRoot 供提交前驗證。 ");
    }
    try {
        const realRoot = await realpath(assetRoot);
        if (realRoot !== path.resolve(assetRoot)) {
            fail("ASSET_VERIFICATION_FAILED", "local-data/assets 不可為符號連結。 ");
        }
        for (const [storageKey, expected] of plannedAssets(plan)) {
            const candidate = path.resolve(assetRoot, ...storageKey.split("/"));
            const realCandidate = await realpath(candidate);
            if (!realCandidate.startsWith(`${realRoot}${path.sep}`)) {
                fail("ASSET_VERIFICATION_FAILED", "本機資產路徑超出允許的資產根目錄。 ");
            }
            const metadata = await stat(realCandidate);
            if (!metadata.isFile() || metadata.size !== expected.byteSize) {
                fail("ASSET_VERIFICATION_FAILED", "本機資產大小或檔案類型不符。 ");
            }
            const checksum = createHash("sha256").update(await readFile(realCandidate)).digest("hex");
            if (checksum !== expected.checksum) {
                fail("ASSET_VERIFICATION_FAILED", "本機資產 SHA-256 不符。 ");
            }
        }
    }
    catch (error) {
        if (error instanceof HanlinImportError) throw error;
        fail("ASSET_VERIFICATION_FAILED", "無法在資料庫提交前驗證本機資產。 ");
    }
}

async function prepareAssetCommit(beforeCommit, plan, reusedBatch, assetRoot) {
    if (beforeCommit === null || beforeCommit === undefined) {
        await verifyMaterializedAssets(plan, assetRoot);
        return null;
    }
    if (typeof beforeCommit !== "function") {
        fail("INVALID_COMMIT_HOOK", "beforeCommit 必須是函式。 ");
    }
    let result;
    try {
        result = await beforeCommit({
            batchId: plan.batchId,
            reusedBatch,
            storageKeys: plannedStorageKeys(plan),
        });
    }
    catch {
        fail("ASSET_PROMOTION_FAILED", "本機資產無法在資料庫提交前完成提升。 ");
    }
    if (result === null || result === undefined) return null;
    if (!result || typeof result !== "object" || typeof result.rollback !== "function") {
        fail("INVALID_COMMIT_HOOK", "beforeCommit 回傳值必須提供 rollback 函式。 ");
    }
    return result.rollback;
}

function createDatabaseClient(config, applicationName) {
    const {
        isolatedTestRoot: _isolatedTestRoot,
        isolatedTestToken: _isolatedTestToken,
        ...connection
    } = config;
    return new Client({
        ...connection,
        password: async () => {
            fail("UNSAFE_DATABASE_CONFIG", "隔離本機 PostgreSQL 不應要求密碼。 ");
        },
        ssl: false,
        application_name: applicationName,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 120_000,
        query_timeout: 130_000,
    });
}

async function verifyCommitOutcome(config, plan, summary, batchStatus) {
    const verifier = createDatabaseClient(config, "lerniqa-hanlin-import-commit-check");
    try {
        await verifier.connect();
        await assertIsolatedServer(verifier, config);
        const batch = await verifier.query(
            "SELECT status FROM import_batches WHERE id = $1",
            [plan.batchId],
        );
        if (batch.rowCount !== 1 || batch.rows[0].status !== batchStatus) return { outcome: "not_committed" };
        const result = await batchSummary(verifier, plan, summary, {
            reusedBatch: false,
            reclassified: 0,
            batchStatus,
        });
        return { outcome: "committed", result: { ...result, commitRecovered: true } };
    }
    catch {
        return { outcome: "unknown" };
    }
    finally {
        await verifier.end().catch(() => undefined);
    }
}

/**
 * Persists a prepared plan in one PostgreSQL transaction. The caller owns file
 * staging. beforeCommit promotes or verifies the staged files after all SQL is
 * ready but before COMMIT, and may return { rollback } for commit compensation.
 */
export async function writeHanlinPostgresImport({
    plan,
    summary = null,
    assetRoot = null,
    pgConfig = {},
    pgEnv = process.env,
    beforeCommit = null,
}) {
    validateHanlinPostgresPlan(plan);
    if (assetRoot !== null
        && (!path.isAbsolute(assetRoot) || path.resolve(assetRoot) !== path.resolve(LOCAL_ASSET_ROOT))) {
        fail("INVALID_ASSET_ROOT", "assetRoot 必須是 repository 管理的 local-data/assets。 ");
    }
    const config = connectionConfig(pgConfig, pgEnv);
    const client = createDatabaseClient(config, "lerniqa-hanlin-import");
    let compensateAssets = null;
    let committed = false;
    let commitAttempted = false;
    let reusedFinalBatch = false;
    let expectedBatchStatus = null;
    let preparedResult = null;
    try {
        await client.connect();
        await assertIsolatedServer(client, config);
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
        await assertSchema(client);
        await seedHanlinCatalog(client, plan);
        await writeAssetsAndDocuments(client, plan);
        const existing = await existingBatchState(client, plan);
        if (existing && ["confirmed", "review"].includes(existing.status)) {
            const result = await batchSummary(client, plan, summary, {
                reusedBatch: true,
                reclassified: 0,
                batchStatus: existing.status,
            });
            preparedResult = result;
            expectedBatchStatus = existing.status;
            reusedFinalBatch = true;
            compensateAssets = await prepareAssetCommit(beforeCommit, plan, true, assetRoot);
            commitAttempted = true;
            await client.query("COMMIT");
            committed = true;
            return result;
        }
        if (existing && !["draft", "recognizing", "review"].includes(existing.status)) {
            fail("BATCH_STATE_CONFLICT", `既有匯入批次狀態 ${existing.status} 不可續寫。`);
        }
        await ensureBatch(client, plan);
        let reclassified = 0;
        for (const group of plan.questionGroups) {
            const result = await writeQuestionGroup(client, plan, group);
            if (result.reclassified) reclassified += 1;
        }
        const hasPending = plan.questionGroups.some((group) => !group.publishable);
        const finalStatus = hasPending ? "review" : "confirmed";
        const finalized = await client.query(`
            UPDATE import_batches
            SET status = $2::varchar(20),
                confirmed_at = CASE WHEN $2::varchar(20) = 'confirmed' THEN transaction_timestamp() ELSE NULL END
            WHERE id = $1
              AND status IN ('draft', 'recognizing', 'review')
            RETURNING id
        `, [plan.batchId, finalStatus]);
        if (finalized.rowCount !== 1) fail("BATCH_STATE_CONFLICT", "匯入批次無法完成。 ");
        const result = await batchSummary(client, plan, summary, {
            reusedBatch: false,
            reclassified,
            batchStatus: finalStatus,
        });
        preparedResult = result;
        expectedBatchStatus = finalStatus;
        compensateAssets = await prepareAssetCommit(beforeCommit, plan, false, assetRoot);
        commitAttempted = true;
        await client.query("COMMIT");
        committed = true;
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (commitAttempted && !committed) {
            if (reusedFinalBatch) {
                committed = true;
                fail(
                    "DATABASE_COMMIT_OUTCOME_UNKNOWN",
                    "既有批次仍可重試驗證；本次提交結果不明，因此保留其必要資產。",
                );
            }
            const verification = await verifyCommitOutcome(config, plan, summary, expectedBatchStatus);
            if (verification.outcome === "committed") {
                committed = true;
                return { ...preparedResult, commitRecovered: true };
            }
            if (verification.outcome === "unknown") {
                committed = true;
                fail(
                    "DATABASE_COMMIT_OUTCOME_UNKNOWN",
                    "無法確認資料庫提交結果；為避免破壞已提交資料，本機資產已保留。",
                );
            }
        }
        if (!committed && compensateAssets) {
            try {
                await compensateAssets();
            }
            catch {
                fail("ASSET_ROLLBACK_FAILED", "資料庫提交失敗後，本機資產補償回滾也失敗。 ");
            }
        }
        if (error instanceof HanlinImportError) throw error;
        const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
        fail("DATABASE_WRITE_FAILED", `PostgreSQL 匯入失敗（${code}）。`);
    }
    finally {
        await client.end().catch(() => undefined);
    }
}

export const writeHanlinImportToPostgres = writeHanlinPostgresImport;
