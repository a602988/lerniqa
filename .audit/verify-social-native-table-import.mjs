#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";

const { Client } = pg;
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const audit = JSON.parse(readFileSync(path.join(import.meta.dirname, "social-table-word-pdf-audit.json"), "utf8"));
const candidates = audit.candidates.filter((candidate) => candidate.auditStatus === "word-pdf-exact-text-match");

const comparable = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, "");
const client = new Client({
    host: path.join(repositoryRoot, "local-data", "postgres-socket"),
    port: 55432,
    database: "lerniqa_local",
});

await client.connect();
const results = [];
try {
    for (const candidate of candidates) {
        const expectedTable = candidate.rows.map((row) => row.join("\t")).join("\n");
        const query = await client.query(`
            SELECT q.id AS question_id,
                   q.status,
                   r.id AS revision_id,
                   r.revision_number,
                   COALESCE(array_agg(b.text_content ORDER BY b.position)
                       FILTER (WHERE b.placement = 'prompt' AND b.content_type = 'table'), ARRAY[]::text[]) AS tables,
                   COALESCE(string_agg(b.text_content, E'\n' ORDER BY b.position)
                       FILTER (WHERE b.placement = 'prompt' AND b.content_type = 'text'), '') AS prompt_text
            FROM questions q
            JOIN question_revisions r ON r.id = q.current_revision_id
            JOIN question_revision_sources s ON s.question_revision_id = r.id AND s.is_primary
            JOIN source_documents d ON d.id = s.source_document_id
            LEFT JOIN question_content_blocks b ON b.question_revision_id = r.id
            WHERE s.source_question_number = $1
              AND d.original_file_name = $2
              AND q.status = 'published'
            GROUP BY q.id, q.status, r.id, r.revision_number
        `, [candidate.questionNumber, candidate.fileName]);
        const matches = query.rows.filter((row) => row.tables.some((table) => comparable(table) === comparable(expectedTable)));
        const row = matches.length === 1 ? matches[0] : null;
        const tableFlattenedIntoPrompt = row
            ? row.tables.some((table) => comparable(table).length >= 12
                && comparable(row.prompt_text).includes(comparable(table)))
            : null;
        results.push({
            questionNumber: candidate.questionNumber,
            fileName: candidate.fileName,
            nativeTableIndex: candidate.tableIndex,
            pdfPath: candidate.pdfPath,
            pdfPages: candidate.evidencePages,
            expectedAuditStatus: candidate.auditStatus,
            matchedPublishedRevisionCount: matches.length,
            questionId: row?.question_id ?? null,
            revisionId: row?.revision_id ?? null,
            revisionNumber: row?.revision_number ?? null,
            exactTableTextMatch: matches.length === 1,
            tableFlattenedIntoPrompt,
            passed: matches.length === 1 && tableFlattenedIntoPrompt === false,
        });
    }
}
finally {
    await client.end();
}

const failed = results.filter((result) => !result.passed);
const report = {
    generatedAt: new Date().toISOString(),
    expectedTableCount: candidates.length,
    passedTableCount: results.length - failed.length,
    failedTableCount: failed.length,
    uniqueQuestionCount: new Set(candidates.map((candidate) => candidate.questionNumber)).size,
    results,
};
writeFileSync(path.join(import.meta.dirname, "social-native-table-import-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
    expectedTableCount: report.expectedTableCount,
    passedTableCount: report.passedTableCount,
    failedTableCount: report.failedTableCount,
    uniqueQuestionCount: report.uniqueQuestionCount,
    failures: failed.map(({ questionNumber, fileName, nativeTableIndex }) => ({ questionNumber, fileName, nativeTableIndex })),
}, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
