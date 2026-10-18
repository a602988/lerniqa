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
const SOURCE_SHA256 = "372f14612c6c4d0a12a2c55e04dea006da2f558f4e80eb5c082e7da2b9c91989";
const QUESTION_NUMBER = "1501004805";
const CORRECTION_VERSION = "source-verified-formula-blocks-v1";
const EXPECTED_CURRENT_REVISION_ID = "f240f6e2-4712-5e31-9911-534eb2036175";
const EXISTING_SANITIZED_SHA256 = "e90325096e5fa8bce392a788e25f7b8f82f4c8b2b465b2ae8d9212464f7a7d1d";
const EXISTING_SANITIZED_BYTE_SIZE = 512918;
const EXPECTED_FORMULAS = new Map(Object.entries({
    "84d354946b2b0ed4869f38ccf4c0c9a2a19d2c3696a088354a72be8de22c2070": "\\frac{\\text{安打數}}{\\text{打擊次數}}",
    "e4b6b6e274cc1a196babef945cbeb432225e47b4d29dd030632ce64b8109cc0d": "\\frac{11}{24}",
    "4661688f40eb747375965060a08a481e914698fc8012abd04d5046f7c8f4ae01": "\\frac{13}{24}",
    "392dc2b53d8abdca0478e0e4abe0217555498500c3b22f6cbc373ad4c48f6b1d": "\\frac{6}{19}",
    "cf54ed3c83fa3f49fe505e00f602110532f810411d5dfac0a0b3a44517c756cf": "\\frac{13}{19}",
    "b1ce47755e8eb49edfb092a7e917e50fe241e79333e4e1439d10e34c38d84c55": "\\frac{16}{29}",
    "60b937e3242a414ccb83a3a9efcc1c87b2d245609e8f1a9b13bcccc617810e82": "\\frac{13}{29}",
    "a1f227c8217b9514c9c6e3a9d3e5678491253925c0b9a90d359d8241e6806c39": "\\frac{20}{33}",
    "b12576c991493d3ca1e9788b1ee027cf8866d17270e41eec66ceb6d7cb7656b5": "\\frac{13}{33}",
}));

function assertSourceContract(record) {
    const formulas = new Map(record.images
        .filter((image) => image.inlineFormula === true && image.formula)
        .map((image) => [image.checksum, image.formula]));
    const contractMatches = formulas.size === EXPECTED_FORMULAS.size
        && [...EXPECTED_FORMULAS].every(([checksum, expression]) => formulas.get(checksum) === expression);
    if (record.sourcePage !== 14
        || record.pendingReasons.length !== 0
        || record.structured.parts[0]?.answer?.answerKey !== "D"
        || !record.unresolvedInlineMathImageEvidence
        || !contractMatches
        || !record.structured.prompt.includes("⟦未解析公式圖:84d354946b2b0ed4869f38ccf4c0c9a2a19d2c3696a088354a72be8de22c2070⟧")
        || !record.structured.explanation.includes("⟦未解析公式圖:e4b6b6e274cc1a196babef945cbeb432225e47b4d29dd030632ce64b8109cc0d⟧")) {
        throw new Error(`題號 ${QUESTION_NUMBER} 的來源覆核結果與核准契約不一致。`);
    }
    return formulas;
}

async function main() {
    const write = process.argv.slice(2).includes("--write");
    const lesson = AUTHORIZED_HANLIN_LESSON_IMPORTS.find((entry) => entry.originalSha256 === SOURCE_SHA256);
    if (!lesson) throw new Error(`找不到已核准來源 ${SOURCE_SHA256}。`);

    const directory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-1501004805-"));
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
        const formulas = assertSourceContract(record);

        // Reuse the checksummed sanitized snapshot. Re-converting the legacy
        // DOC can change package metadata without changing source content.
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
            answerKey: record.structured.parts[0].answer.answerKey,
            formulaChecksums: [...formulas.keys()].sort(),
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
