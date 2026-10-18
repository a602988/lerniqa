#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    AUTHORIZED_HANLIN_LESSON_IMPORTS,
    deterministicUuid,
    materializeHanlinAssets,
    prepareHanlinChineseImport,
    safeFailureSummary,
} from "./lib/hanlin-chinese-import.mjs";
import {
    validateHanlinPostgresPlan,
    writeHanlinPostgresImport,
} from "./lib/hanlin-postgres-writer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SHA256 = "05af8ac3292610edfc99a9fc9216b80f4f5ed6bcf8de6564d8bd75ba9db0dcab";
const QUESTION_NUMBER = "1501000017";
const FORMULA_CHECKSUM = "036444dba226e502061b12624abcc6fa970fbf44bfb2a10eb827175140aa4b75";
const FORMULA = "\\frac{2 \\times A + 1}{5}";
const CORRECTION_VERSION = "source-verified-formula-block-v1";
const EXPECTED_CURRENT_REVISION_ID = "b57c0011-2385-5d8b-ac76-766de0604b47";
const EXISTING_SANITIZED_SHA256 = "2d5f4a252c40ca2eab43a56e2cc9a6ce1e8654913c8f4bccae30a2a85fe1aced";
const EXISTING_SANITIZED_BYTE_SIZE = 1132871;

function assertSourceContract(record) {
    const formulas = record.images.filter((image) => image.inlineFormula === true && image.formula);
    const acceptedValue = record.structured.parts[0]?.answer?.acceptedValue;
    if (record.sourcePage !== 1
        || record.pendingReasons.length !== 0
        || acceptedValue !== "2"
        || !record.unresolvedInlineMathImageEvidence
        || formulas.length !== 1
        || formulas[0].checksum !== FORMULA_CHECKSUM
        || formulas[0].formula !== FORMULA
        || !record.structured.prompt.includes(`⟦未解析公式圖:${FORMULA_CHECKSUM}⟧`)) {
        throw new Error(`題號 ${QUESTION_NUMBER} 的來源覆核結果與核准契約不一致。`);
    }
}

async function main() {
    const write = process.argv.slice(2).includes("--write");
    const lesson = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) => entry.originalSha256 === SOURCE_SHA256);
    if (!lesson) throw new Error(`找不到已核准來源 ${SOURCE_SHA256}。`);

    const directory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-1501000017-"));
    let prepared;
    try {
        const source = path.join(directory, lesson.fileName);
        await copyFile(
            path.join(ROOT, "local-data", "assets", "quarantine", "source-documents", `${SOURCE_SHA256}.doc`),
            source,
        );
        prepared = await prepareHanlinChineseImport(source, { allowDirectory: false, authorizedLesson: lesson });
        const group = prepared.plan.questionGroups.find((candidate) => candidate.number === QUESTION_NUMBER);
        if (!group || !group.publishable || group.occurrences.length !== 1) {
            throw new Error(`題號 ${QUESTION_NUMBER} 無法形成唯一且可發布的來源修訂。`);
        }

        const { document, record } = group.canonical;
        assertSourceContract(record);

        document.sanitizedPath = path.join(
            ROOT,
            "local-data",
            "assets",
            "sanitized-source-documents",
            `${SOURCE_SHA256}.docx`,
        );
        document.sanitizedSha256 = EXISTING_SANITIZED_SHA256;
        document.sanitizedByteSize = EXISTING_SANITIZED_BYTE_SIZE;

        record.sourceOrder = 0;
        const scopedDocument = { ...document, records: [record] };
        const scopedGroup = {
            ...group,
            canonical: { document: scopedDocument, record },
            occurrences: [{ document: scopedDocument, record }],
        };
        const plan = {
            ...prepared.plan,
            documents: [scopedDocument],
            questionGroups: [scopedGroup],
            duplicatesSkipped: 0,
            correction: {
                questionNumber: QUESTION_NUMBER,
                version: CORRECTION_VERSION,
                expectedCurrentRevisionId: EXPECTED_CURRENT_REVISION_ID,
            },
        };
        const key = createHash("sha256")
            .update(`${plan.sourceSetHash}:${QUESTION_NUMBER}:${CORRECTION_VERSION}`, "utf8")
            .digest("hex")
            .slice(0, 24);
        plan.idempotencyKey = `${plan.parserVersion}:${plan.target.key}:fix:${key}`;
        plan.batchId = deterministicUuid(`import-batch:${plan.idempotencyKey}`);
        scopedGroup.revisionId = deterministicUuid(
            `revision:${plan.batchId}:${scopedGroup.identityKey}:${record.contentFingerprint}`,
        );
        validateHanlinPostgresPlan(plan);

        const assetRoot = path.join(ROOT, "local-data", "assets");
        if (write) await materializeHanlinAssets(plan, assetRoot);
        const result = write ? await writeHanlinPostgresImport({ plan, assetRoot }) : null;
        process.stdout.write(`${JSON.stringify({
            dryRun: !write,
            questionNumber: QUESTION_NUMBER,
            sourceSha256: document.originalSha256,
            sourcePage: record.sourcePage,
            sanitizedSha256: document.sanitizedSha256,
            sanitizedByteSize: document.sanitizedByteSize,
            publishable: group.publishable,
            pendingReasons: record.pendingReasons,
            acceptedValue: record.structured.parts[0].answer.acceptedValue,
            formulaChecksum: FORMULA_CHECKSUM,
            formula: FORMULA,
            correction: plan.correction,
            idempotencyKey: plan.idempotencyKey,
            revisionId: scopedGroup.revisionId,
            result,
        })}\n`);
    } finally {
        await prepared?.cleanup();
        await rm(directory, { recursive: true, force: true });
    }
}

try {
    await main();
} catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailureSummary(error))}\n`);
    process.exitCode = 1;
}
