import fs from "node:fs/promises";
import path from "node:path";

import {
    AUTHORIZED_HANLIN_LESSON_IMPORTS,
    prepareHanlinChineseImport,
} from "../scripts/lib/hanlin-chinese-import.mjs";

const sourceRoot = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中數學";
const outputRoot = path.resolve(".audit/kangxuan-math-answer-formulas");
const sourceFolders = {
    "publisher-test-bank": "01_題庫題目",
    "literacy-question": "07_素養題",
    "mock-comprehensive-written": "08_仿會考非選題",
};
const report = JSON.parse(await fs.readFile("reports/kangxuan-math-v9-audit-2026-10-18.json", "utf8"));
const answerChecksums = new Set();
const marker = /未解析公式圖:([0-9a-f]{64})/gu;
for (const entry of report.pendingEntries) {
    for (const match of String(entry.unresolvedInlineMathImageEvidence?.sourceAnswer ?? "").matchAll(marker)) {
        answerChecksums.add(match[1]);
    }
}

await fs.mkdir(outputRoot, { recursive: true });
const copied = new Set();
for (const lesson of AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) =>
    entry.target.publisherCode === "kangxuan" && entry.target.subjectCode === "math")) {
    const sourcePath = path.join(
        sourceRoot,
        sourceFolders[lesson.target.sourceCategoryCode],
        "第一冊",
        lesson.fileName,
    );
    const prepared = await prepareHanlinChineseImport(sourcePath, {
        allowDirectory: false,
        authorizedLesson: lesson,
    });
    try {
        for (const record of prepared.plan.documents[0].records) {
            for (const image of record.images) {
                if (!answerChecksums.has(image.checksum) || copied.has(image.checksum)) continue;
                const imagePath = image.temporaryPath ?? image.imagePath;
                if (!imagePath) throw new Error(`公式 ${image.checksum} 沒有暫存圖片路徑。`);
                await fs.copyFile(imagePath, path.join(outputRoot, `${image.checksum}${path.extname(imagePath) || ".gif"}`));
                copied.add(image.checksum);
            }
        }
    }
    finally {
        await prepared.cleanup();
    }
}

console.log(JSON.stringify({ expected: answerChecksums.size, copied: copied.size }));
if (copied.size !== answerChecksums.size) process.exitCode = 1;
