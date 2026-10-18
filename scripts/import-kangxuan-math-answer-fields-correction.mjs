#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUTHORIZED_HANLIN_LESSON_IMPORTS, deterministicUuid, prepareHanlinChineseImport, safeFailureSummary } from "./lib/hanlin-chinese-import.mjs";
import { validateHanlinPostgresPlan, writeHanlinPostgresImport } from "./lib/hanlin-postgres-writer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORRECTION_VERSION = "approved-answer-fields-v1";
const TARGETS = [
    ["372f14612c6c4d0a12a2c55e04dea006da2f558f4e80eb5c082e7da2b9c91989", ["1501004796"]],
    ["50b1f60f5a722042dea5429edfac8f694d273ac7160f74f3ea4a9229e2b916f0", ["1501003705", "1501005024", "1501005583"]],
];

async function correctQuestion(prepared, number) {
    const group = prepared.plan.questionGroups.find((candidate) => candidate.number === number);
    if (!group || !group.publishable || group.occurrences.length !== 1) {
        throw new Error(`題號 ${number} 無法形成唯一且可發布的來源修訂。`);
    }
    const { document, record } = group.canonical;
    if (!record.structured.parts.length || record.structured.parts.some((part) => !(part.answerFieldCount > 1))) {
        throw new Error(`題號 ${number} 缺少已核准的多欄答案資料。`);
    }
    const plan = { ...prepared.plan, documents: [{ ...document, records: [record] }], questionGroups: [], duplicatesSkipped: 0 };
    const scopedDocument = plan.documents[0];
    const scopedRecord = scopedDocument.records[0];
    scopedRecord.sourceOrder = 0;
    const scopedGroup = {
        ...group,
        canonical: { document: scopedDocument, record: scopedRecord },
        occurrences: [{ document: scopedDocument, record: scopedRecord }],
    };
    plan.questionGroups = [scopedGroup];
    plan.correction = { questionNumber: number, version: CORRECTION_VERSION };
    const key = createHash("sha256")
        .update(`${plan.sourceSetHash}:${number}:${CORRECTION_VERSION}`, "utf8")
        .digest("hex")
        .slice(0, 24);
    plan.idempotencyKey = `${plan.parserVersion}:${plan.target.key}:fix:${key}`;
    plan.batchId = deterministicUuid(`import-batch:${plan.idempotencyKey}`);
    scopedGroup.revisionId = deterministicUuid(`revision:${plan.batchId}:${scopedGroup.identityKey}:${scopedGroup.contentFingerprint}`);
    validateHanlinPostgresPlan(plan);
    return writeHanlinPostgresImport({ plan, assetRoot: path.join(ROOT, "local-data", "assets") });
}

async function main() {
    for (const [sha256, numbers] of TARGETS) {
        const lesson = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) => entry.originalSha256 === sha256);
        if (!lesson) throw new Error(`找不到已核准來源 ${sha256}。`);
        const directory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-answer-fields-"));
        let prepared;
        try {
            const source = path.join(directory, lesson.fileName);
            await copyFile(path.join(ROOT, "local-data", "assets", "quarantine", "source-documents", `${sha256}.doc`), source);
            prepared = await prepareHanlinChineseImport(source, { allowDirectory: false, authorizedLesson: lesson });
            for (const number of numbers) {
                const result = await correctQuestion(prepared, number);
                process.stdout.write(`${JSON.stringify({ questionNumber: number, result })}\n`);
            }
        }
        finally {
            await prepared?.cleanup();
            await rm(directory, { recursive: true, force: true });
        }
    }
}

try {
    await main();
}
catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailureSummary(error))}\n`);
    process.exitCode = 1;
}
