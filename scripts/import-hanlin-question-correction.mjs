#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    AUTHORIZED_HANLIN_LESSON_IMPORTS,
    deterministicUuid,
    prepareHanlinChineseImport,
    safeFailureSummary,
} from "./lib/hanlin-chinese-import.mjs";
import {
    validateHanlinPostgresPlan,
    writeHanlinPostgresImport,
} from "./lib/hanlin-postgres-writer.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUESTION_NUMBER = "1501003429";
const CORRECTION_VERSION = "source-multiplication-signs-v1";
const SOURCE_SHA256 = "ffb7d287b28b4eb6b3bd1fdd7b266e11a7b2f10c55a249e77c41074b04b8d5dc";

async function main() {
    const authorizedLesson = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) =>
        entry.originalSha256 === SOURCE_SHA256);
    if (!authorizedLesson) throw new Error("找不到指定題目的已核准來源文件。");

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-question-correction-"));
    let prepared;
    try {
        const sourcePath = path.join(
            REPOSITORY_ROOT,
            "local-data",
            "assets",
            "quarantine",
            "source-documents",
            `${SOURCE_SHA256}.doc`,
        );
        const namedSourcePath = path.join(temporaryDirectory, authorizedLesson.fileName);
        await copyFile(sourcePath, namedSourcePath);
        prepared = await prepareHanlinChineseImport(namedSourcePath, {
            allowDirectory: false,
            authorizedLesson,
        });

        const group = prepared.plan.questionGroups.find((candidate) => candidate.number === QUESTION_NUMBER);
        if (!group || !group.publishable || group.occurrences.length !== 1) {
            throw new Error(`題號 ${QUESTION_NUMBER} 無法形成唯一且可發布的來源修訂。`);
        }
        const { document, record } = group.canonical;
        record.sourceOrder = 0;
        document.records = [record];
        group.occurrences = [{ document, record }];
        group.canonical = group.occurrences[0];

        prepared.plan.documents = [document];
        prepared.plan.questionGroups = [group];
        prepared.plan.duplicatesSkipped = 0;
        prepared.plan.correction = {
            questionNumber: QUESTION_NUMBER,
            version: CORRECTION_VERSION,
        };
        const correctionKey = createHash("sha256")
            .update(`${prepared.plan.sourceSetHash}:${QUESTION_NUMBER}:${CORRECTION_VERSION}`, "utf8")
            .digest("hex")
            .slice(0, 24);
        prepared.plan.idempotencyKey = `${prepared.plan.parserVersion}:${prepared.plan.target.key}:fix:${correctionKey}`;
        prepared.plan.batchId = deterministicUuid(`import-batch:${prepared.plan.idempotencyKey}`);
        group.revisionId = deterministicUuid(
            `revision:${prepared.plan.batchId}:${group.identityKey}:${group.contentFingerprint}`,
        );

        validateHanlinPostgresPlan(prepared.plan);
        const result = await writeHanlinPostgresImport({
            plan: prepared.plan,
            assetRoot: path.join(REPOSITORY_ROOT, "local-data", "assets"),
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    finally {
        await prepared?.cleanup();
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}

try {
    await main();
}
catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailureSummary(error))}\n`);
    process.exitCode = 1;
}
