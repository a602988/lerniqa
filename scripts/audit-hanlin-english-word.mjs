#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
    authorizedHanlinImportByFileAndHash,
    inspectVisibleImageBounds,
    prepareHanlinChineseImport,
    stableJson,
} from "./lib/hanlin-chinese-import.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGLISH_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中英語/題本檔案/01_第一冊";
const LOCAL_SOCKET = path.join(REPOSITORY_ROOT, "local-data", "postgres-socket");
const SOURCE_FOLDERS = Object.freeze([
    "01_試題",
    "02_素養題",
    "03_習作",
    "04_各章節基測試題",
    "05_各章節會考試題",
    "06_附錄本",
]);

const WORD_TEXT_SCRIPT = String.raw`
on run argv
    set sourcePath to item 1 of argv
    set hfsPath to POSIX file sourcePath as text
    tell application "Microsoft Word"
        set matchingDocument to missing value
        repeat 60 times
            try
                repeat with candidateDocument in documents
                    if (full name of candidateDocument as text) is hfsPath then
                        set matchingDocument to candidateDocument
                        exit repeat
                    end if
                end repeat
            end try
            if matchingDocument is not missing value then exit repeat
            delay 0.5
        end repeat
        if matchingDocument is missing value then error "Word 開啟後找不到指定路徑"
        set bodyText to content of text object of matchingDocument
        close matchingDocument saving no
        return bodyText
    end tell
end run`;

function spawnResult(command, args, options = {}) {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300_000,
        ...options,
    });
    if (result.status !== 0) {
        throw new Error(`${command} 執行失敗：${result.stderr?.trim() || `exit ${result.status}`}`);
    }
    return result.stdout;
}

async function readWithMicrosoftWord(sourcePath) {
    spawnResult("open", ["-a", "Microsoft Word", sourcePath]);
    return spawnResult("osascript", ["-e", WORD_TEXT_SCRIPT, sourcePath])
        .replaceAll("\r", "\n")
        .normalize("NFKC");
}

function markerCount(wordText, questionNumber) {
    const escaped = String(questionNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...wordText.matchAll(new RegExp(`(?:編號|題號)\\s*[:：]\\s*${escaped}(?!\\d)`, "gu"))].length;
}

function imageSignature(image) {
    const placement = image.optionKey ? "option" : (image.placement ?? "prompt");
    return `${placement}:${image.optionKey ?? "-"}:${image.checksum}`;
}

async function imageIntegrityIssues(images, pathForImage, prefix) {
    const issues = [];
    const seen = new Set();
    for (const image of images) {
        if (!image.checksum || seen.has(image.checksum)) continue;
        seen.add(image.checksum);
        const imagePath = pathForImage(image);
        if (!imagePath) continue;
        const bounds = await inspectVisibleImageBounds(await readFile(imagePath));
        if (!bounds.bounds) issues.push(`${prefix}-image-effectively-blank:${image.checksum}`);
        else if (bounds.likelyOffsetClipped) issues.push(`${prefix}-image-offset-clipped:${image.checksum}`);
    }
    return issues;
}

function expectedMaterialized(record) {
    return {
        prompt: record.structured.prompt ?? "",
        explanation: record.structured.explanation ?? "",
        parts: record.structured.parts.map((part) => ({
            stableKey: part.stableKey,
            prompt: part.prompt ?? "",
            answerMode: part.answerMode,
            gradingPolicy: part.gradingPolicy,
            options: part.options.map((option) => ({ key: option.key, text: option.text ?? "" })),
            answer: part.answer ?? null,
        })),
    };
}

function actualMaterialized(rows, answerRows) {
    const rootText = (placement) => rows
        .filter((row) => row.part_stable_key === null && row.placement === placement && row.content_type === "text")
        .sort((a, b) => a.position - b.position)
        .map((row) => row.text_content)
        .join("");
    const partKeys = [...new Set([
        ...rows.filter((row) => row.part_stable_key !== null).map((row) => row.part_stable_key),
        ...answerRows.map((row) => row.part_stable_key),
    ])];
    partKeys.sort((a, b) => {
        const rowA = rows.find((row) => row.part_stable_key === a) ?? answerRows.find((row) => row.part_stable_key === a);
        const rowB = rows.find((row) => row.part_stable_key === b) ?? answerRows.find((row) => row.part_stable_key === b);
        return rowA.part_position - rowB.part_position;
    });
    return {
        prompt: rootText("prompt"),
        explanation: rootText("explanation"),
        parts: partKeys.map((stableKey) => {
            const partRows = rows.filter((row) => row.part_stable_key === stableKey);
            const first = partRows[0] ?? answerRows.find((row) => row.part_stable_key === stableKey);
            const optionKeys = [...new Set(partRows.filter((row) => row.option_key !== null).map((row) => row.option_key))];
            optionKeys.sort((a, b) => {
                const rowA = partRows.find((row) => row.option_key === a);
                const rowB = partRows.find((row) => row.option_key === b);
                return rowA.option_position - rowB.option_position;
            });
            const answers = answerRows.filter((row) => row.part_stable_key === stableKey);
            const answer = answers.length
                ? (answers[0].answer_key !== null
                    ? { answerKey: answers[0].answer_key }
                    : { acceptedValue: answers[0].accepted_value })
                : null;
            return {
                stableKey,
                prompt: partRows
                    .filter((row) => row.placement === "prompt" && row.content_type === "text")
                    .sort((a, b) => a.position - b.position)
                    .map((row) => row.text_content)
                    .join(""),
                answerMode: first.answer_mode,
                gradingPolicy: first.grading_policy,
                options: optionKeys.map((key) => ({
                    key,
                    text: partRows
                        .filter((row) => row.option_key === key && row.content_type === "text")
                        .sort((a, b) => a.position - b.position)
                        .map((row) => row.text_content)
                        .join(""),
                })),
                answer,
            };
        }),
    };
}

async function sourceFiles() {
    const files = [];
    for (const folder of SOURCE_FOLDERS) {
        const entries = await readdir(path.join(ENGLISH_ROOT, folder), { withFileTypes: true });
        for (const entry of entries
            .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".doc") && !candidate.name.startsWith("~$"))
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))) {
            files.push({ folder, fileName: entry.name, sourcePath: path.join(ENGLISH_ROOT, folder, entry.name) });
        }
    }
    return files;
}

async function loadDatabaseState(client, questionIds) {
    const questionResult = await client.query(`
        SELECT q.id AS question_id,
               q.status AS question_status,
               q.current_revision_id,
               revision.status AS revision_status,
               current_item.draft_payload->>'contentFingerprint' AS content_fingerprint
          FROM questions AS q
          LEFT JOIN question_revisions AS revision ON revision.id = q.current_revision_id
          LEFT JOIN LATERAL (
              SELECT item.draft_payload
                FROM import_items AS item
               WHERE item.question_revision_id = q.current_revision_id
               ORDER BY item.reviewed_at DESC NULLS LAST, item.source_order
               LIMIT 1
          ) AS current_item ON true
         WHERE q.id = ANY($1::uuid[])
    `, [questionIds]);
    const contentResult = await client.query(`
        SELECT q.id AS question_id,
               part.stable_key AS part_stable_key,
               part.position AS part_position,
               part.answer_mode,
               part.grading_policy,
               option.option_key,
               option.position AS option_position,
               block.placement,
               block.content_type,
               block.position,
               block.text_content,
               asset.checksum,
               asset.storage_key
          FROM questions AS q
          JOIN question_content_blocks AS block ON block.question_revision_id = q.current_revision_id
          LEFT JOIN question_parts AS part ON part.id = block.question_part_id
          LEFT JOIN question_options AS option ON option.id = block.question_option_id
          LEFT JOIN assets AS asset ON asset.id = block.asset_id
         WHERE q.id = ANY($1::uuid[])
         ORDER BY q.id, part.position NULLS FIRST, option.position NULLS FIRST, block.position
    `, [questionIds]);
    const answerResult = await client.query(`
        SELECT q.id AS question_id,
               part.stable_key AS part_stable_key,
               part.position AS part_position,
               part.answer_mode,
               part.grading_policy,
               answer.answer_key,
               answer.accepted_value,
               answer.position
          FROM questions AS q
          JOIN question_parts AS part ON part.question_revision_id = q.current_revision_id
          LEFT JOIN question_answers AS answer ON answer.question_part_id = part.id
         WHERE q.id = ANY($1::uuid[])
         ORDER BY q.id, part.position, answer.position
    `, [questionIds]);
    return {
        questions: new Map(questionResult.rows.map((row) => [row.question_id, row])),
        content: Map.groupBy(contentResult.rows, (row) => row.question_id),
        answers: Map.groupBy(answerResult.rows, (row) => row.question_id),
    };
}

async function main() {
    const skipWord = process.argv.includes("--skip-word");
    const outputPath = process.argv.find((argument) => argument.startsWith("--output="))?.slice("--output=".length)
        ?? path.join(REPOSITORY_ROOT, "reports", "hanlin-english-word-audit-2026-10-18.json");
    const files = await sourceFiles();
    const client = new Client({
        host: process.env.PGHOST || LOCAL_SOCKET,
        port: Number(process.env.PGPORT || 55432),
        database: process.env.PGDATABASE || "lerniqa_local",
        user: process.env.PGUSER || process.env.USER,
    });
    await client.connect();
    const audits = [];
    try {
        for (const [index, file] of files.entries()) {
            const bytes = await readFile(file.sourcePath);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            const authorized = authorizedHanlinImportByFileAndHash(file.fileName, sha256);
            if (!authorized || authorized.target.subjectCode !== "english") {
                throw new Error(`未授權或非英文來源：${file.sourcePath}`);
            }
            const wordText = skipWord ? null : await readWithMicrosoftWord(file.sourcePath);
            const prepared = await prepareHanlinChineseImport(file.sourcePath, {
                allowDirectory: false,
                authorizedLesson: authorized,
            });
            try {
                const groups = prepared.plan.questionGroups;
                const database = await loadDatabaseState(client, groups.map((group) => group.questionId));
                const questionAudits = await Promise.all(groups.map(async (group) => {
                    const record = group.canonical.record;
                    const question = database.questions.get(group.questionId);
                    const contentRows = database.content.get(group.questionId) ?? [];
                    const answerRows = database.answers.get(group.questionId) ?? [];
                    const expectedImages = record.images.map(imageSignature).sort();
                    const actualImages = contentRows
                        .filter((row) => row.content_type === "image")
                        .map((row) => `${row.placement}:${row.option_key ?? "-"}:${row.checksum}`)
                        .sort();
                    const imageRows = contentRows.filter((row) => row.content_type === "image");
                    const issues = [
                        ...await imageIntegrityIssues(record.images, (image) => image.temporaryPath, "source"),
                        ...await imageIntegrityIssues(
                            imageRows,
                            (image) => image.storage_key
                                ? path.join(REPOSITORY_ROOT, "local-data", "assets", image.storage_key)
                                : null,
                            "database",
                        ),
                    ];
                    const wordMarkers = wordText === null ? null : markerCount(wordText, record.sourceQuestionNumber);
                    if (wordMarkers !== null && wordMarkers !== 1) issues.push(`word-marker-count:${wordMarkers}`);
                    if (!question) issues.push("database-question-missing");
                    else {
                        if (question.question_status !== "published" || question.revision_status !== "published") {
                            issues.push(`not-published:${question.question_status}/${question.revision_status}`);
                        }
                        if (question.content_fingerprint !== record.contentFingerprint) issues.push("content-fingerprint-mismatch");
                        if (stableJson(expectedImages) !== stableJson(actualImages)) issues.push("image-block-mismatch");
                        if (stableJson(expectedMaterialized(record)) !== stableJson(actualMaterialized(contentRows, answerRows))) {
                            issues.push("materialized-content-mismatch");
                        }
                    }
                    if (record.pendingReasons.length) issues.push(...record.pendingReasons.map((reason) => `pending:${reason}`));
                    return {
                        number: record.sourceQuestionNumber,
                        questionId: group.questionId,
                        wordMarkers,
                        expectedImages,
                        actualImages,
                        issues,
                    };
                }));
                const issueQuestions = questionAudits.filter((question) => question.issues.length);
                audits.push({
                    index: index + 1,
                    folder: file.folder,
                    fileName: file.fileName,
                    sourcePath: file.sourcePath,
                    sha256,
                    questions: questionAudits.length,
                    sourceImages: questionAudits.reduce((sum, question) => sum + question.expectedImages.length, 0),
                    databaseImages: questionAudits.reduce((sum, question) => sum + question.actualImages.length, 0),
                    issueQuestions,
                });
                process.stdout.write(`WORD ${JSON.stringify({
                    index: index + 1,
                    folder: file.folder,
                    file: file.fileName,
                    questions: questionAudits.length,
                    sourceImages: audits.at(-1).sourceImages,
                    databaseImages: audits.at(-1).databaseImages,
                    issues: issueQuestions.length,
                })}\n`);
                await writeFile(outputPath, `${JSON.stringify({ complete: false, documents: audits }, null, 2)}\n`, "utf8");
            }
            finally {
                await prepared.cleanup();
            }
        }
        const summary = {
            documents: audits.length,
            questions: audits.reduce((sum, audit) => sum + audit.questions, 0),
            sourceImages: audits.reduce((sum, audit) => sum + audit.sourceImages, 0),
            databaseImages: audits.reduce((sum, audit) => sum + audit.databaseImages, 0),
            documentsWithIssues: audits.filter((audit) => audit.issueQuestions.length).length,
            questionsWithIssues: audits.reduce((sum, audit) => sum + audit.issueQuestions.length, 0),
            issueCounts: {},
        };
        for (const audit of audits) {
            for (const question of audit.issueQuestions) {
                for (const issue of question.issues) {
                    summary.issueCounts[issue] = (summary.issueCounts[issue] ?? 0) + 1;
                }
            }
        }
        await writeFile(outputPath, `${JSON.stringify({ complete: true, summary, documents: audits }, null, 2)}\n`, "utf8");
        process.stdout.write(`TOTAL ${JSON.stringify(summary)}\nREPORT ${outputPath}\n`);
    }
    finally {
        await client.end();
    }
}

await main();
