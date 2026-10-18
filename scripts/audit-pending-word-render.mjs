#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中社會/題本檔案/01_第一冊";
const SCIENCE_ROOT = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中自然";
const LOCAL_SOCKET = path.join(REPOSITORY_ROOT, "local-data", "postgres-socket");

const SOCIAL_FOLDERS = Object.freeze({
    bank: "01_試題",
    literacy: "02_素養題",
    workbook: "04_練習本",
    bct: "05_各章節基測試題",
    cap: "06_各章節會考試題",
});
const SCIENCE_FOLDERS = Object.freeze({
    bank: "01_題庫題目/第一冊",
    literacy: "03_素養題/第一冊",
    classroom: "04_隨課練/第一冊",
    kbook: "06_KBOOK/第一冊",
    sync: "07_同步練習卷/第一冊",
});

const WORD_TEXT_SCRIPT = String.raw`
on run argv
    set sourcePath to item 1 of argv
    tell application "Microsoft Word"
        repeat 360 times
            try
                set documentCount to count of documents
                if documentCount is 1 then return content of text object of active document
                if documentCount > 1 then error "Word 覆核要求只開啟一份來源文件"
            end try
            delay 0.5
        end repeat
        error "Word 開啟後找不到指定來源文件"
    end tell
end run`;

const WORD_MACRO_PROMPT_SCRIPT = String.raw`
tell application "System Events"
    repeat 600 times
        try
            tell process "Microsoft Word"
                if exists window "提示" then
                    if exists button "停用巨集" of window "提示" then
                        click button "停用巨集" of window "提示"
                        return "disabled"
                    end if
                end if
                if exists button "停用巨集" of window 1 then
                    click button "停用巨集" of window 1
                    return "disabled"
                end if
            end tell
        end try
        delay 0.1
    end repeat
end tell
return "no-prompt"`;

function sourceSuffix(idempotencyKey) {
    const targetKey = idempotencyKey.split(":")[1] ?? "";
    return targetKey.split("-").at(-1) ?? "";
}

function sourcePathFor(row) {
    const suffix = sourceSuffix(row.idempotency_key);
    if (/^hanlin-social-v\d+:/u.test(row.idempotency_key)) {
        const folder = SOCIAL_FOLDERS[suffix];
        if (!folder) throw new Error(`無法識別社會科來源分類：${row.idempotency_key}`);
        return path.join(SOCIAL_ROOT, folder, row.original_file_name);
    }
    if (row.idempotency_key.startsWith("kangxuan-science-doc-v2:")) {
        const folder = SCIENCE_FOLDERS[suffix];
        if (!folder) throw new Error(`無法識別自然科來源分類：${row.idempotency_key}`);
        return path.join(SCIENCE_ROOT, folder, row.original_file_name);
    }
    throw new Error(`不支援的批次：${row.idempotency_key}`);
}

function runMacroPromptWatcher() {
    return new Promise((resolve, reject) => {
        const child = spawn("osascript", ["-e", WORD_MACRO_PROMPT_SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr.trim() || `osascript exit ${code}`));
        });
    });
}

async function readWithWord(sourcePath) {
    const preflight = spawnSync("osascript", ["-e", [
        "if application \"Microsoft Word\" is running then",
        "tell application \"Microsoft Word\"",
        "if (count of documents) is not 0 then error \"Word 覆核前仍有文件開啟\"",
        "quit saving no",
        "end tell",
        "end if",
    ].join("\n")], { encoding: "utf8", timeout: 30_000 });
    if (preflight.status !== 0) {
        throw new Error(`Word 單檔覆核前置檢查失敗：${preflight.stderr.trim() || `exit ${preflight.status}`}`);
    }
    const promptWatcher = runMacroPromptWatcher();
    const opened = spawnSync("open", ["-a", "Microsoft Word", sourcePath], {
        encoding: "utf8",
        timeout: 120_000,
    });
    if (opened.status !== 0) {
        throw new Error(`Word 無法開啟 ${sourcePath}：${opened.stderr.trim() || `exit ${opened.status}`}`);
    }
    await promptWatcher;
    const result = spawnSync("osascript", ["-e", WORD_TEXT_SCRIPT, sourcePath], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
    });
    const closed = spawnSync("osascript", ["-e", [
        "tell application \"Microsoft Word\" to quit saving no",
        "repeat 120 times",
        "if application \"Microsoft Word\" is not running then return \"closed\"",
        "delay 0.25",
        "end repeat",
        "error \"Word remained running after single-document review\"",
    ].join("\n")], { encoding: "utf8", timeout: 45_000 });
    if (closed.status !== 0) {
        throw new Error(`Word 無法關閉 ${sourcePath}：${closed.stderr.trim() || `exit ${closed.status}`}`);
    }
    if (result.status === 0) {
        return {
            text: result.stdout.replaceAll("\r", "\n").normalize("NFKC"),
            reviewMethod: "word-text-object",
        };
    }
    const fallback = spawnSync("textutil", ["-convert", "txt", "-stdout", sourcePath], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
    });
    if (fallback.status !== 0) {
        throw new Error(`Word 與 textutil 都無法讀取 ${sourcePath}`);
    }
    return {
        text: fallback.stdout.replaceAll("\r", "\n").normalize("NFKC"),
        reviewMethod: "word-opened-textutil-fallback",
    };
}

function questionBlock(wordText, questionNumber) {
    const marker = new RegExp(`(?:編號|題號)\\s*[:：]\\s*${questionNumber}(?!\\d)`, "u");
    const match = marker.exec(wordText);
    if (!match) return null;
    if (match[0].startsWith("題號")) {
        const afterMarker = wordText.slice(match.index + match[0].length);
        const nextMarker = /(?:編號|題號)\s*[:：]/u.exec(afterMarker);
        const endIndex = nextMarker ? match.index + match[0].length + nextMarker.index : wordText.length;
        return wordText.slice(match.index, endIndex);
    }
    const prefix = wordText.slice(0, match.index);
    const earlierMarkers = [...prefix.matchAll(/(?:編號|題號)\s*[:：]/gu)];
    const previousMarker = earlierMarkers.at(-1)?.index ?? -1;
    return wordText.slice(previousMarker >= 0 ? previousMarker : 0, match.index);
}

function inspectBlock(block, pendingReasons) {
    if (!block) return { wordStatus: "question-number-not-found", inlineVisuals: 0, optionVisuals: [] };
    const answerIndex = block.lastIndexOf("答案");
    const questionContent = answerIndex >= 0 ? block.slice(0, answerIndex) : block;
    const inlineVisuals = (questionContent.match(/\//gu) ?? []).length;
    const optionVisuals = [...questionContent.matchAll(/\(([A-H])\)\s*\//gu)].map((match) => match[1]);
    const uniqueOptionVisuals = [...new Set(optionVisuals)];
    const reasons = new Set(pendingReasons);
    let wordStatus = "word-has-no-inline-visual";
    if (uniqueOptionVisuals.length >= 2 && reasons.has("choice-parse-failed")) {
        wordStatus = "word-confirms-image-options";
    }
    else if (inlineVisuals > 0) {
        wordStatus = "word-confirms-source-visual";
    }
    return { wordStatus, inlineVisuals, optionVisuals: uniqueOptionVisuals };
}

async function main() {
    const client = new Client({
        host: process.env.PGHOST || LOCAL_SOCKET,
        port: Number(process.env.PGPORT || 55432),
        database: process.env.PGDATABASE || "lerniqa_local",
        user: process.env.PGUSER || process.env.USER,
    });
    await client.connect();
    try {
        const { rows } = await client.query(`
            WITH ranked AS (
                SELECT ib.idempotency_key,
                       ii.source_document_id,
                       ii.source_question_number,
                       ii.source_page,
                       ii.source_order,
                       ii.review_status,
                       ii.draft_payload->'pendingReasons' AS pending_reasons,
                       ii.draft_payload->>'originalSha256' AS original_sha256,
                       sd.original_file_name,
                       ROW_NUMBER() OVER (
                           PARTITION BY COALESCE(ii.draft_payload->>'relativeFileName', sd.original_file_name),
                                        ii.source_question_number
                           ORDER BY ib.created_at DESC, ii.id DESC
                       ) AS recency
                  FROM import_batches ib
                  JOIN import_items ii ON ii.import_batch_id = ib.id
                  JOIN source_documents sd ON sd.id = ii.source_document_id
                 WHERE ib.idempotency_key LIKE 'hanlin-social-v%:%'
                    OR ib.idempotency_key LIKE 'kangxuan-science-doc-v2:%'
            )
            SELECT *
              FROM ranked
             WHERE recency = 1
               AND review_status = 'pending'
             ORDER BY idempotency_key, source_order
        `);
        const documents = new Map();
        const sourcePathIndex = process.argv.indexOf("--source-path");
        const requestedSourcePath = sourcePathIndex >= 0
            ? path.resolve(process.argv[sourcePathIndex + 1] ?? "")
            : null;
        for (const row of rows) {
            const sourcePath = sourcePathFor(row);
            if (requestedSourcePath && path.resolve(sourcePath) !== requestedSourcePath) continue;
            const entries = documents.get(sourcePath) ?? [];
            entries.push(row);
            documents.set(sourcePath, entries);
        }
        if (requestedSourcePath && documents.size !== 1) {
            throw new Error(`--source-path 沒有對應的最新待檢題：${requestedSourcePath}`);
        }

        let audits = [];
        if (process.argv.includes("--resume")) {
            try {
                const checkpoint = JSON.parse(await readFile("/tmp/pending-word-audit-checkpoint.json", "utf8"));
                if (Array.isArray(checkpoint.audits)) audits = checkpoint.audits;
            }
            catch {
                // No usable checkpoint; start from the beginning.
            }
        }
        const completedKeys = new Set(audits.map((audit) => `${audit.sourcePath}\0${audit.questionNumber}`));
        for (const [sourcePath, allPendingRows] of documents) {
            const pendingRows = allPendingRows.filter(
                (row) => !completedKeys.has(`${sourcePath}\0${row.source_question_number}`),
            );
            if (pendingRows.length === 0) continue;
            const bytes = await readFile(sourcePath);
            const actualSha256 = createHash("sha256").update(bytes).digest("hex");
            const expectedHashes = new Set(pendingRows.map((row) => row.original_sha256));
            if (expectedHashes.size !== 1 || !expectedHashes.has(actualSha256)) {
                throw new Error(`Word 覆核前來源雜湊不一致：${sourcePath}`);
            }
            let { text: wordText, reviewMethod } = await readWithWord(sourcePath);
            if (pendingRows[0].idempotency_key.startsWith("kangxuan-science-doc-v2:")) {
                const positionedText = spawnSync("textutil", ["-convert", "txt", "-stdout", sourcePath], {
                    encoding: "utf8",
                    maxBuffer: 32 * 1024 * 1024,
                    timeout: 120_000,
                });
                if (positionedText.status !== 0) throw new Error(`自然科題號定位失敗：${sourcePath}`);
                wordText = positionedText.stdout.replaceAll("\r", "\n").normalize("NFKC");
                reviewMethod = `${reviewMethod}+textutil-positioning`;
            }
            for (const row of pendingRows) {
                const pendingReasons = Array.isArray(row.pending_reasons) ? row.pending_reasons : [];
                const block = questionBlock(wordText, row.source_question_number);
                audits.push({
                    subject: row.idempotency_key.startsWith("hanlin-social-") ? "社會" : "自然",
                    sourcePath,
                    fileName: row.original_file_name,
                    questionNumber: row.source_question_number,
                    sourcePage: row.source_page,
                    reviewMethod,
                    pendingReasons,
                    wordBlock: block,
                    ...inspectBlock(block, pendingReasons),
                });
            }
            await writeFile(
                "/tmp/pending-word-audit-checkpoint.json",
                `${JSON.stringify({ completedItems: audits.length, audits }, null, 2)}\n`,
                "utf8",
            );
        }

        const summary = {};
        for (const audit of audits) {
            summary[audit.subject] ??= { total: 0, byWordStatus: {}, byPendingReason: {} };
            const subject = summary[audit.subject];
            subject.total += 1;
            subject.byWordStatus[audit.wordStatus] = (subject.byWordStatus[audit.wordStatus] ?? 0) + 1;
            for (const reason of audit.pendingReasons) {
                subject.byPendingReason[reason] = (subject.byPendingReason[reason] ?? 0) + 1;
            }
        }
        const output = { documents: documents.size, summary };
        if (process.argv.includes("--details")) output.audits = audits;
        const serialized = `${JSON.stringify(output, null, 2)}\n`;
        const outputIndex = process.argv.indexOf("--output");
        if (outputIndex >= 0) {
            const outputArgument = process.argv[outputIndex + 1];
            if (!outputArgument) throw new Error("--output 必須指定檔案。");
            const outputPath = path.resolve(outputArgument);
            await writeFile(outputPath, serialized, "utf8");
        }
        process.stdout.write(serialized);
    }
    finally {
        await client.end();
    }
}

await main();
