#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    HANLIN_SOCIAL_TYPES,
    catalogIdsForTarget,
    cleanupHanlinAssetStaging,
    materializeHanlinAssets,
    prepareHanlinChineseImport,
    promoteHanlinAssets,
    rollbackHanlinAssets,
} from "./lib/hanlin-chinese-import.mjs";
import { validateHanlinPostgresPlan, writeHanlinPostgresImport } from "./lib/hanlin-postgres-writer.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中社會/題本檔案/01_第一冊";
const SOURCE_RULES = Object.freeze([
    Object.freeze({ folder: "01_試題", geographyEnd: 21, historyEnd: 34, code: "publisher-test-bank", name: "出版社題庫", suffix: "bank" }),
    Object.freeze({ folder: "02_素養題", geographyEnd: 15, historyEnd: 27, code: "literacy-question", name: "素養題", suffix: "literacy" }),
    Object.freeze({ folder: "04_練習本", geographyEnd: 19, historyEnd: 31, code: "workbook-practice", name: "練習本", suffix: "workbook" }),
    Object.freeze({ folder: "05_各章節基測試題", geographyEnd: 15, historyEnd: 25, code: "basic-competency-test", name: "基測", suffix: "bct" }),
    Object.freeze({ folder: "06_各章節會考試題", geographyEnd: 13, historyEnd: 24, code: "comprehensive-assessment", name: "會考", suffix: "cap" }),
]);
const SUBJECTS = Object.freeze({
    geography: Object.freeze({ code: "geography", name: "地理", alias: "地理", marker: "01", short: "geo" }),
    history: Object.freeze({ code: "history", name: "歷史", alias: "歷史", marker: "02", short: "hist" }),
    civics: Object.freeze({ code: "civics", name: "公民", alias: "公民", marker: "03", short: "civ" }),
});

function parseArguments(argv) {
    const dryRun = argv.includes("--dry-run");
    const sourceIndex = argv.indexOf("--source-root");
    const sourceRoot = sourceIndex >= 0 ? path.resolve(argv[sourceIndex + 1] ?? "") : DEFAULT_SOURCE_ROOT;
    const startIndexArgument = argv.indexOf("--start-index");
    const startIndex = startIndexArgument >= 0 ? Number(argv[startIndexArgument + 1]) : 0;
    if (!Number.isInteger(startIndex) || startIndex < 0) throw new Error("--start-index 必須是非負整數。");
    return { dryRun, sourceRoot, startIndex, assetRoot: path.join(REPOSITORY_ROOT, "local-data", "assets") };
}

function classify(rule, fileName) {
    const match = fileName.match(/^(\d{2})_(01|02|03)_\d+-\d+_(導言|\d+-\d+)_\s*(.+)\.doc$/u);
    if (!match) throw new Error(`無法解析社會科檔名：${fileName}`);
    const sequence = Number(match[1]);
    const subjectKey = sequence <= rule.geographyEnd ? "geography" : sequence <= rule.historyEnd ? "history" : "civics";
    const subject = SUBJECTS[subjectKey];
    if (match[2] !== subject.marker) throw new Error(`檔名科目與指定範圍不一致：${rule.folder}/${fileName}`);
    const sectionCode = match[3] === "導言" ? "intro" : match[3];
    const unitName = `${match[3]} ${match[4].trim()}`;
    const numericPosition = sectionCode === "intro" ? 0 : Number(sectionCode.replace("-", ""));
    return { subject, sectionCode, unitName, unitPosition: numericPosition };
}

function buildTarget(rule, fileName) {
    const { subject, sectionCode, unitName, unitPosition } = classify(rule, fileName);
    return Object.freeze({
        key: `jh1-${subject.short}-hanlin-v1-${sectionCode}-${rule.suffix}`,
        gradeCode: "junior-high-1", gradeName: "國一",
        semesterCode: "semester-1", semesterName: "上學期",
        subjectCode: subject.code, subjectName: subject.name, subjectAlias: subject.alias,
        publisherCode: "hanlin", publisherName: "翰林", bookName: "翰林版",
        volumeCode: "volume-1", volumeName: "第一冊",
        unitCode: sectionCode === "intro" ? "intro" : `chapter-${sectionCode}`,
        unitName, unitPosition,
        sourceCategoryCode: rule.code, sourceCategoryName: rule.name,
        originalSourceName: rule.folder.replace(/^\d+_/u, ""),
    });
}

async function authorizedImport(rule, sourcePath) {
    const fileName = path.basename(sourcePath);
    const originalSha256 = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
    const target = buildTarget(rule, fileName);
    return Object.freeze({
        fileName, originalSha256, target, ids: catalogIdsForTarget(target),
        parserVersion: "hanlin-social-v2", questionTypes: HANLIN_SOCIAL_TYPES,
        allowDerivedHtmlImages: true,
        allowTextualTableVisualReferences: true,
        approvedDecorativeImageSha256s: Object.freeze([]),
        approvedQuestionImageMappings: Object.freeze([]),
        approvedChoiceRepairs: Object.freeze([]),
    });
}

function addTotals(totals, summary, target) {
    totals.files += 1;
    totals.parsed += summary.parsed;
    totals.published += summary.published;
    totals.pendingReview += summary.pendingReview;
    totals.failed += summary.failed;
    totals.questionAssets += summary.assetCounts.questionContent;
    totals.bySubject[target.subjectName] ??= { files: 0, parsed: 0, published: 0, pendingReview: 0 };
    const subject = totals.bySubject[target.subjectName];
    subject.files += 1;
    subject.parsed += summary.parsed;
    subject.published += summary.published;
    subject.pendingReview += summary.pendingReview;
}

async function importOne(sourcePath, authorized, options) {
    let prepared;
    let stagingRoot;
    let createdStorageKeys = [];
    try {
        prepared = await prepareHanlinChineseImport(sourcePath, { allowDirectory: false, authorizedLesson: authorized });
        validateHanlinPostgresPlan(prepared.plan);
        if (prepared.summary.failed) throw new Error(`${authorized.fileName} 有 ${prepared.summary.failed} 筆解析失敗。`);
        if (options.dryRun) return prepared.summary;
        stagingRoot = path.join(options.assetRoot, ".staging", prepared.plan.batchId);
        await cleanupHanlinAssetStaging(stagingRoot);
        const stagedStorageKeys = await materializeHanlinAssets(prepared.plan, stagingRoot);
        return await writeHanlinPostgresImport({
            plan: prepared.plan, summary: prepared.summary, assetRoot: options.assetRoot, pgEnv: process.env,
            beforeCommit: async ({ storageKeys }) => {
                ({ createdStorageKeys } = await promoteHanlinAssets(prepared.plan, stagingRoot, options.assetRoot,
                    storageKeys.length ? storageKeys : stagedStorageKeys));
                return { rollback: () => rollbackHanlinAssets(options.assetRoot, createdStorageKeys) };
            },
        });
    }
    finally {
        if (stagingRoot) await cleanupHanlinAssetStaging(stagingRoot).catch(() => undefined);
        await prepared?.cleanup();
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const totals = { files: 0, parsed: 0, published: 0, pendingReview: 0, failed: 0, questionAssets: 0, bySubject: {} };
    const jobs = [];
    for (const rule of SOURCE_RULES) {
        const directory = path.join(options.sourceRoot, rule.folder);
        const fileNames = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".doc"))
            .sort((a, b) => a.localeCompare(b, "zh-Hant"));
        for (const fileName of fileNames) {
            const sourcePath = path.join(directory, fileName);
            jobs.push({ rule, fileName, sourcePath });
        }
    }
    const runJob = async ({ rule, fileName, sourcePath }) => {
        const authorized = await authorizedImport(rule, sourcePath);
        const summary = await importOne(sourcePath, authorized, options);
        addTotals(totals, summary, authorized.target);
        process.stderr.write(`${options.dryRun ? "盤點" : "匯入"} ${rule.folder}/${fileName}: ${summary.published}/${summary.parsed}, 待檢 ${summary.pendingReview}, 圖片 ${summary.assetCounts.questionContent}\n`);
    };
    const selectedJobs = jobs.slice(options.startIndex);
    const workerCount = options.dryRun ? 8 : 1;
    if (workerCount > 1) {
        const workers = Array.from({ length: workerCount }, async (_, workerIndex) => {
            for (let index = workerIndex; index < selectedJobs.length; index += workerCount) await runJob(selectedJobs[index]);
        });
        await Promise.all(workers);
    }
    else {
        for (const job of selectedJobs) await runJob(job);
    }
    process.stdout.write(`${JSON.stringify({ ...totals, dryRun: options.dryRun })}\n`);
}

await main();
