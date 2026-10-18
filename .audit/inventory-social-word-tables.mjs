#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const assetRoot = path.join(repositoryRoot, "local-data", "assets");
const socket = path.join(repositoryRoot, "local-data", "postgres-socket");
const outputPath = path.join(repositoryRoot, ".audit", "social-table-source-inventory.json");
const sourceRoot = "/Users/chianlin/Library/CloudStorage/GoogleDrive-jean@minmax.biz/我的雲端硬碟/個人/題庫資料/國中/國中社會/題本檔案/01_第一冊";
const sourceFolders = new Map([
    ["bank", "01_試題"],
    ["literacy", "02_素養題"],
    ["workbook", "04_練習本"],
    ["bct", "05_各章節基測試題"],
    ["cap", "06_各章節會考試題"],
]);

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function sourceSuffix(idempotencyKey) {
    return idempotencyKey.match(/-(bank|literacy|workbook|bct|cap):/u)?.[1] ?? null;
}

function unzipText(docxPath, entry) {
    const result = spawnSync("/usr/bin/unzip", ["-p", docxPath, entry], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`無法讀取 ${docxPath} 的 ${entry}`);
    return result.stdout;
}

function unzipEntries(docxPath) {
    const result = spawnSync("/usr/bin/unzip", ["-Z1", docxPath], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`無法列出 ${docxPath}`);
    return result.stdout.split("\n").filter(Boolean);
}

function decodeXml(value) {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

function textFromXml(value) {
    return [...value.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
        .map((match) => decodeXml(match[1]))
        .join("");
}

function tableRows(tableXml) {
    return [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)].map((rowMatch) =>
        [...rowMatch[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)].map((cellMatch) =>
            textFromXml(cellMatch[0]).replace(/\s+/gu, " ").trim(),
        ),
    ).filter((row) => row.some(Boolean));
}

function relationshipTargets(relationshipsXml) {
    return new Map([...relationshipsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/gu)]
        .map((match) => [match[1], match[2].replace(/^\.\.\//u, "word/")]));
}

function nearestQuestion(items, xmlIndex) {
    const before = items.filter((item) => item.xmlIndex <= xmlIndex).at(-1);
    const after = items.find((item) => item.xmlIndex > xmlIndex);
    if (after?.marker === "編號") return after;
    return before ?? after ?? null;
}

function inspectDocument(docxPath, questions) {
    const entries = unzipEntries(docxPath);
    const documentXml = unzipText(docxPath, "word/document.xml");
    const relationships = entries.includes("word/_rels/document.xml.rels")
        ? relationshipTargets(unzipText(docxPath, "word/_rels/document.xml.rels"))
        : new Map();
    const questionMarkers = questions.flatMap((question) => {
        const pattern = new RegExp(`(?:編號|題號)\\s*[:：]?\\s*${question.questionNumber}(?!\\d)`, "gu");
        return [...textFromXml(documentXml).matchAll(pattern)].map((match) => ({
            questionNumber: question.questionNumber,
            sourcePage: question.sourcePage,
            marker: match[0].startsWith("題號") ? "題號" : "編號",
            textIndex: match.index ?? 0,
            xmlIndex: -1,
        }));
    });
    const textRuns = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)];
    let textIndex = 0;
    for (const run of textRuns) {
        const value = decodeXml(run[1]);
        for (const marker of questionMarkers) {
            if (marker.xmlIndex < 0 && marker.textIndex >= textIndex && marker.textIndex < textIndex + value.length) {
                marker.xmlIndex = run.index ?? 0;
            }
        }
        textIndex += value.length;
    }
    const sortedMarkers = questionMarkers.filter((marker) => marker.xmlIndex >= 0)
        .sort((left, right) => left.xmlIndex - right.xmlIndex);

    const nativeTables = [...documentXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gu)].map((match, index) => {
        const rows = tableRows(match[0]);
        const question = nearestQuestion(sortedMarkers, match.index ?? 0);
        return {
            index: index + 1,
            checksum: sha256(match[0]),
            xmlIndex: match.index ?? 0,
            questionNumber: question?.questionNumber ?? null,
            sourcePage: question?.sourcePage ?? null,
            rows,
            rowCount: rows.length,
            columnCounts: rows.map((row) => row.length),
            cellCount: rows.reduce((count, row) => count + row.filter(Boolean).length, 0),
        };
    });
    const embeddedObjects = [...documentXml.matchAll(/<o:OLEObject\b[^>]*r:id="([^"]+)"[^>]*>/gu)].map((match, index) => {
        const target = relationships.get(match[1]) ?? null;
        const question = nearestQuestion(sortedMarkers, match.index ?? 0);
        return {
            index: index + 1,
            xmlIndex: match.index ?? 0,
            relationshipId: match[1],
            target,
            questionNumber: question?.questionNumber ?? null,
            sourcePage: question?.sourcePage ?? null,
        };
    });
    return { nativeTables, embeddedObjects, markerCount: sortedMarkers.length, entryCount: entries.length };
}

const client = new Client({ host: socket, port: 55432, database: "lerniqa_local", user: process.env.USER });
await client.connect();
try {
    const result = await client.query(`
        WITH latest AS (
            SELECT sd.id AS source_document_id,
                   sd.original_file_name,
                   a.storage_key,
                   ii.source_question_number,
                   ii.source_page,
                   ii.question_id,
                   q.status AS question_status,
                   (SELECT count(*)::int
                      FROM question_content_blocks qcb
                     WHERE qcb.question_revision_id = q.current_revision_id
                       AND qcb.content_type = 'table') AS current_table_block_count,
                   ii.draft_payload->>'originalSha256' AS original_sha256,
                   ib.idempotency_key,
                   ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(ii.draft_payload->>'relativeFileName', sd.original_file_name), ii.source_question_number
                       ORDER BY ib.created_at DESC, ii.id DESC
                   ) AS recency
              FROM import_items ii
              JOIN import_batches ib ON ib.id = ii.import_batch_id
              JOIN source_documents sd ON sd.id = ii.source_document_id
              JOIN assets a ON a.id = sd.asset_id
              LEFT JOIN questions q ON q.id = ii.question_id
             WHERE ib.idempotency_key LIKE 'hanlin-social-v%:%'
        )
        SELECT source_document_id, original_file_name, storage_key, original_sha256,
               min(idempotency_key) AS idempotency_key,
               json_agg(json_build_object(
                   'questionNumber', source_question_number,
                   'sourcePage', source_page,
                   'questionId', question_id,
                   'status', question_status,
                   'currentTableBlockCount', current_table_block_count
               ) ORDER BY source_question_number) AS questions
          FROM latest
         WHERE recency = 1
         GROUP BY source_document_id, original_file_name, storage_key, original_sha256
         ORDER BY original_file_name, original_sha256
    `);
    const documents = [];
    for (const row of result.rows) {
        const docxPath = path.join(assetRoot, row.storage_key);
        await readFile(docxPath);
        const suffix = sourceSuffix(row.idempotency_key);
        const sourceFolder = suffix ? sourceFolders.get(suffix) : null;
        const sourcePath = sourceFolder ? path.join(sourceRoot, sourceFolder, row.original_file_name) : null;
        documents.push({
            sourceDocumentId: row.source_document_id,
            fileName: row.original_file_name,
            originalSha256: row.original_sha256,
            storageKey: row.storage_key,
            sourceSuffix: suffix,
            sourcePath,
            questions: row.questions,
            ...inspectDocument(docxPath, row.questions),
        });
    }
    const summary = {
        documents: documents.length,
        documentsWithNativeTables: documents.filter((document) => document.nativeTables.length).length,
        nativeTables: documents.reduce((count, document) => count + document.nativeTables.length, 0),
        documentsWithEmbeddedObjects: documents.filter((document) => document.embeddedObjects.length).length,
        embeddedObjects: documents.reduce((count, document) => count + document.embeddedObjects.length, 0),
        unassignedNativeTables: documents.reduce((count, document) => count + document.nativeTables.filter((table) => !table.questionNumber).length, 0),
        unassignedEmbeddedObjects: documents.reduce((count, document) => count + document.embeddedObjects.filter((object) => !object.questionNumber).length, 0),
    };
    await writeFile(outputPath, `${JSON.stringify({ summary, documents }, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
finally {
    await client.end();
}
