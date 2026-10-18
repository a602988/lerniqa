import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
    authorizedHanlinImportByFileAndHash,
    prepareHanlinChineseImport,
} from "../scripts/lib/hanlin-chinese-import.mjs";

const root = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中英語/題本檔案/01_第一冊";
const targets = [
    ["02_素養題", "02_Unit 2 Where Are My Pencils_.doc", [11]],
    ["01_試題", "03_Unit 2 Where Are My Pencils_.doc", [243]],
    ["02_素養題", "03_Unit 3 Open the Magic Door.doc", [15, 18]],
    ["02_素養題", "04_Unit 4 What Time Is the Concert_.doc", [17]],
    ["01_試題", "05_Unit 4 What Time Is the Concert_.doc", [173]],
    ["03_習作", "05_Unit 4 What Time Is the Concert_.doc", [2]],
    ["01_試題", "06_Unit 5 What's the Date_.doc", [163]],
    ["02_素養題", "06_Unit 6 There Are Some Elephants Over There.doc", [15, 17]],
];

for (const [folder, fileName, numbers] of targets) {
    const sourcePath = path.join(root, folder, fileName);
    try {
        const bytes = await readFile(sourcePath);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const authorizedLesson = authorizedHanlinImportByFileAndHash(fileName, sha256);
        const prepared = await prepareHanlinChineseImport(sourcePath, {
            allowDirectory: false,
            authorizedLesson,
        });
        try {
            const questions = prepared.plan.questionGroups
                .filter((group) => numbers.includes(group.canonical.record.sourceOrder))
                .map((group) => ({
                    questionNumber: group.canonical.record.questionNumber,
                    questionId: group.questionId,
                    images: group.canonical.record.images.map((image) => ({
                        checksum: image.checksum,
                        dimensions: image.dimensions,
                        mimeType: image.mimeType,
                        altText: image.altText,
                        placement: image.placement,
                        optionKey: image.optionKey,
                        temporaryPath: image.temporaryPath,
                    })),
                }));
            console.log(JSON.stringify({
                folder,
                fileName,
                status: "ok",
                questions,
                parsedQuestionNumbers: prepared.plan.questionGroups.map((group) => group.canonical.record.questionNumber),
            }));
        } finally {
            await prepared.cleanup();
        }
    } catch (error) {
        console.log(JSON.stringify({
            folder,
            fileName,
            status: "error",
            code: error?.code,
            message: error?.message,
        }));
    }
}
