#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUTHORIZED_HANLIN_LESSON_IMPORTS, deterministicUuid, prepareHanlinChineseImport, safeFailureSummary } from "./lib/hanlin-chinese-import.mjs";
import { validateHanlinPostgresPlan, writeHanlinPostgresImport } from "./lib/hanlin-postgres-writer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SHA256 = "372f14612c6c4d0a12a2c55e04dea006da2f558f4e80eb5c082e7da2b9c91989";
const QUESTION_NUMBER = "1501004796";
const CORRECTION_VERSION = "verified-formula-blocks-v1";

async function main() {
    const lesson = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) => entry.originalSha256 === SOURCE_SHA256);
    if (!lesson) throw new Error(`找不到已核准來源 ${SOURCE_SHA256}。`);
    const directory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-formula-blocks-"));
    let prepared;
    try {
        const source = path.join(directory, lesson.fileName);
        await copyFile(path.join(ROOT, "local-data", "assets", "quarantine", "source-documents", `${SOURCE_SHA256}.doc`), source);
        prepared = await prepareHanlinChineseImport(source, { allowDirectory: false, authorizedLesson: lesson });
        const group = prepared.plan.questionGroups.find((candidate) => candidate.number === QUESTION_NUMBER);
        if (!group || !group.publishable || group.occurrences.length !== 1) {
            throw new Error(`題號 ${QUESTION_NUMBER} 無法形成唯一且可發布的來源修訂。`);
        }
        const { document, record } = group.canonical;
        const formulas = record.images.filter((image) => image.inlineFormula === true && image.formula);
        if (formulas.length < 20) throw new Error(`題號 ${QUESTION_NUMBER} 的核准公式映射不完整。`);

        const scopedDocument = { ...document, records: [record] };
        scopedDocument.records[0].sourceOrder = 0;
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
            correction: { questionNumber: QUESTION_NUMBER, version: CORRECTION_VERSION },
        };
        const key = createHash("sha256")
            .update(`${plan.sourceSetHash}:${QUESTION_NUMBER}:${CORRECTION_VERSION}`, "utf8")
            .digest("hex")
            .slice(0, 24);
        plan.idempotencyKey = `${plan.parserVersion}:${plan.target.key}:fix:${key}`;
        plan.batchId = deterministicUuid(`import-batch:${plan.idempotencyKey}`);
        scopedGroup.revisionId = deterministicUuid(`revision:${plan.batchId}:${scopedGroup.identityKey}:${record.contentFingerprint}`);
        validateHanlinPostgresPlan(plan);
        const result = await writeHanlinPostgresImport({ plan, assetRoot: path.join(ROOT, "local-data", "assets") });
        process.stdout.write(`${JSON.stringify({ questionNumber: QUESTION_NUMBER, formulaCount: formulas.length, result })}\n`);
    }
    finally {
        await prepared?.cleanup();
        await rm(directory, { recursive: true, force: true });
    }
}

try {
    await main();
}
catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailureSummary(error))}\n`);
    process.exitCode = 1;
}
