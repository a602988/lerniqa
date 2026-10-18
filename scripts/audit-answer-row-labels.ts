#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { tokenizePromptBlanks } from "../app/lib/question-presentation.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = new Client({
    host: process.env.PGHOST || path.join(ROOT, "local-data", "postgres-socket"),
    port: Number(process.env.PGPORT || 55432),
    database: process.env.PGDATABASE || "lerniqa_local",
    user: process.env.PGUSER || process.env.USER,
});

const SQL = `
    SELECT
        question.id AS question_id,
        question_identifier.value AS source_number,
        root_prompt.prompt,
        array_agg(part.answer_mode ORDER BY part.position) AS answer_modes,
        array_agg(part.answer_field_count ORDER BY part.position) AS answer_field_counts
    FROM questions AS question
    JOIN question_revisions AS revision
        ON revision.id = question.current_revision_id
        AND revision.status = 'published'
    JOIN question_parts AS part ON part.question_revision_id = revision.id
    LEFT JOIN LATERAL (
        SELECT string_agg(COALESCE(block.text_content, ''), E'\\n' ORDER BY block.position) AS prompt
        FROM question_content_blocks AS block
        WHERE block.question_revision_id = revision.id
            AND block.question_part_id IS NULL
            AND block.placement = 'prompt'
    ) AS root_prompt ON true
    LEFT JOIN LATERAL (
        SELECT identifier.value
        FROM question_identifiers AS identifier
        WHERE identifier.question_id = question.id
            AND identifier.identifier_type = 'source_document_question'
        ORDER BY identifier.value
        LIMIT 1
    ) AS question_identifier ON true
    WHERE question.status = 'published'
    GROUP BY question.id, question_identifier.value, root_prompt.prompt
    HAVING count(*) > 1 AND bool_and(part.answer_mode = 'text')
`;

function countPromptBlanks(prompt: string) {
    return tokenizePromptBlanks(prompt).filter((token) => token.kind === "blank").length
        + (prompt.match(/(?:_{3,}|＿{3,})/gu)?.length ?? 0);
}

try {
    await client.connect();
    const result = await client.query<{
        question_id: string;
        source_number: string | null;
        prompt: string | null;
        answer_modes: string[];
        answer_field_counts: number[];
    }>(SQL);
    const candidates = result.rows.filter((row) => countPromptBlanks(row.prompt ?? "") >= row.answer_modes.length);
    const affected = candidates
        .filter((row) => row.answer_field_counts.some((count) => count === 1))
        .sort((first, second) => (first.source_number ?? first.question_id).localeCompare(second.source_number ?? second.question_id));
    const formerlyUnlabeledRows = affected.reduce(
        (total, row) => total + row.answer_field_counts.filter((count) => count === 1).length,
        0,
    );
    process.stdout.write(`${JSON.stringify({
        matchingQuestions: candidates.length,
        answerRows: candidates.reduce((total, row) => total + row.answer_modes.length, 0),
        affectedQuestions: affected.length,
        formerlyUnlabeledRows,
        sampleSourceNumbers: affected.slice(0, 10).map((row) => row.source_number ?? row.question_id),
    }, null, 2)}\n`);
}
finally {
    await client.end().catch(() => undefined);
}
