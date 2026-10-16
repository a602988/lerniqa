#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    AUTHORIZED_FOURTH_LESSON_FILE,
    AUTHORIZED_FOURTH_LESSON_SHA256,
    cleanupHanlinAssetStaging,
    HanlinImportError,
    materializeHanlinAssets,
    prepareHanlinChineseImport,
    promoteHanlinAssets,
    rollbackHanlinAssets,
    safeFailureSummary,
} from "./lib/hanlin-chinese-import.mjs";
import {
    validateHanlinPostgresPlan,
    writeHanlinPostgresImport,
} from "./lib/hanlin-postgres-writer.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
    return "Usage: node scripts/import-hanlin-chinese-postgres.mjs <source-file-or-directory> [--dry-run] [--asset-root <directory>]";
}

function parseArguments(argv) {
    const parsed = {
        sourcePath: null,
        dryRun: false,
        assetRoot: path.join(REPOSITORY_ROOT, "local-data", "assets"),
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--dry-run") {
            parsed.dryRun = true;
        }
        else if (argument === "--asset-root") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) throw new HanlinImportError("INVALID_ARGUMENT", "--asset-root 需要目錄參數。");
            parsed.assetRoot = path.resolve(value);
            index += 1;
        }
        else if (argument.startsWith("--")) {
            throw new HanlinImportError("INVALID_ARGUMENT", `不支援的參數：${argument}`);
        }
        else if (parsed.sourcePath) {
            throw new HanlinImportError("INVALID_ARGUMENT", "只能指定一個來源檔案或目錄。");
        }
        else {
            parsed.sourcePath = path.resolve(argument);
        }
    }
    if (!parsed.sourcePath) throw new HanlinImportError("INVALID_ARGUMENT", usage());
    return parsed;
}

function validateWriteScope(options, plan) {
    if (options.dryRun) return;
    const expectedName = AUTHORIZED_FOURTH_LESSON_FILE.normalize("NFC");
    const selectedNames = plan.documents.map((document) => document.fileName.normalize("NFC"));
    if (plan.sourceKind !== "file" || selectedNames.length !== 1 || selectedNames[0] !== expectedName) {
        throw new HanlinImportError(
            "WRITE_SCOPE_REQUIRES_FOURTH_LESSON_FILE",
            `正式匯入只允許明確指定 ${AUTHORIZED_FOURTH_LESSON_FILE}；目錄只能搭配 --dry-run 盤點。`,
        );
    }
    if (plan.documents[0]?.originalSha256 !== AUTHORIZED_FOURTH_LESSON_SHA256) {
        throw new HanlinImportError(
            "WRITE_SCOPE_REQUIRES_APPROVED_FOURTH_LESSON_CONTENT",
            `正式匯入只允許已核准的 ${AUTHORIZED_FOURTH_LESSON_FILE} 原始內容。`,
            selectedNames[0] ?? null,
        );
    }
}

async function validateApprovedWriteSource(options) {
    if (options.dryRun) return;
    let sourceBytes;
    try {
        sourceBytes = await readFile(options.sourcePath);
    }
    catch {
        throw new HanlinImportError(
            "SOURCE_FILE_READ_FAILED",
            `無法讀取待匯入的 ${AUTHORIZED_FOURTH_LESSON_FILE}。`,
            path.basename(options.sourcePath),
        );
    }
    const checksum = createHash("sha256").update(sourceBytes).digest("hex");
    if (checksum !== AUTHORIZED_FOURTH_LESSON_SHA256) {
        throw new HanlinImportError(
            "WRITE_SCOPE_REQUIRES_APPROVED_FOURTH_LESSON_CONTENT",
            `正式匯入只允許已核准的 ${AUTHORIZED_FOURTH_LESSON_FILE} 原始內容。`,
            path.basename(options.sourcePath),
        );
    }
}

async function main() {
    let prepared;
    let stagingRoot;
    let createdStorageKeys = [];
    try {
        const options = parseArguments(process.argv.slice(2));
        if (!options.dryRun
            && path.basename(options.sourcePath).normalize("NFC") !== AUTHORIZED_FOURTH_LESSON_FILE.normalize("NFC")) {
            throw new HanlinImportError(
                "WRITE_SCOPE_REQUIRES_FOURTH_LESSON_FILE",
                `正式匯入只允許明確指定 ${AUTHORIZED_FOURTH_LESSON_FILE}；目錄只能搭配 --dry-run 盤點。`,
            );
        }
        await validateApprovedWriteSource(options);
        prepared = await prepareHanlinChineseImport(options.sourcePath, { allowDirectory: options.dryRun });
        validateWriteScope(options, prepared.plan);
        validateHanlinPostgresPlan(prepared.plan);
        if (options.dryRun) {
            process.stdout.write(`${JSON.stringify({ ...prepared.summary, dryRun: true })}\n`);
            return;
        }

        stagingRoot = path.join(options.assetRoot, ".staging", prepared.plan.batchId);
        await cleanupHanlinAssetStaging(stagingRoot);
        const stagedStorageKeys = await materializeHanlinAssets(prepared.plan, stagingRoot);
        const summary = await writeHanlinPostgresImport({
            plan: prepared.plan,
            summary: prepared.summary,
            assetRoot: options.assetRoot,
            pgEnv: process.env,
            beforeCommit: async ({ storageKeys }) => {
                ({ createdStorageKeys } = await promoteHanlinAssets(
                    prepared.plan,
                    stagingRoot,
                    options.assetRoot,
                    storageKeys.length ? storageKeys : stagedStorageKeys,
                ));
                return {
                    rollback: () => rollbackHanlinAssets(options.assetRoot, createdStorageKeys),
                };
            },
        });
        process.stdout.write(`${JSON.stringify(summary)}\n`);
    }
    catch (error) {
        process.stdout.write(`${JSON.stringify(safeFailureSummary(error))}\n`);
        process.exitCode = 1;
    }
    finally {
        if (stagingRoot) await cleanupHanlinAssetStaging(stagingRoot).catch(() => undefined);
        await prepared?.cleanup();
    }
}

await main();
