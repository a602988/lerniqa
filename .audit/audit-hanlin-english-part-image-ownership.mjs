import path from "node:path";

import { Client } from "pg";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const client = new Client({
    host: process.env.PGHOST || path.join(repositoryRoot, "local-data", "postgres-socket"),
    port: Number(process.env.PGPORT || 55432),
    database: process.env.PGDATABASE || "lerniqa_local",
    user: process.env.PGUSER || process.env.USER,
});

await client.connect();
const { rows } = await client.query(`
    SELECT question.id AS question_id,
           source.source_question_number,
           document.original_file_name,
           COUNT(DISTINCT part.id)::integer AS part_count,
           COUNT(DISTINCT block.id) FILTER (
               WHERE block.content_type = 'image'
                 AND block.question_part_id IS NULL
           )::integer AS root_image_count,
           COUNT(DISTINCT block.id) FILTER (
               WHERE block.content_type = 'image'
                 AND block.question_part_id IS NOT NULL
           )::integer AS part_image_count
      FROM questions AS question
      JOIN question_revisions AS revision
        ON revision.id = question.current_revision_id
       AND revision.question_id = question.id
      JOIN question_types AS type ON type.id = revision.question_type_id
      JOIN subjects AS subject ON subject.id = revision.subject_id
      JOIN book_versions AS version ON version.id = revision.book_version_id
      JOIN publishers AS publisher ON publisher.id = version.publisher_id
      JOIN question_revision_sources AS source
        ON source.question_revision_id = revision.id
       AND source.is_primary = true
      JOIN source_documents AS document ON document.id = source.source_document_id
      JOIN question_parts AS part ON part.question_revision_id = revision.id
      LEFT JOIN question_content_blocks AS block ON block.question_revision_id = revision.id
     WHERE question.status = 'published'
       AND revision.status = 'published'
       AND subject.code = 'english'
       AND publisher.code = 'hanlin'
       AND revision.original_question_type_label = '看圖回答問題'
     GROUP BY question.id,
              source.source_question_number,
              document.original_file_name
    HAVING COUNT(DISTINCT part.id) > 1
       AND COUNT(DISTINCT block.id) FILTER (
               WHERE block.content_type = 'image'
                 AND block.question_part_id IS NULL
           ) > 1
       AND COUNT(DISTINCT block.id) FILTER (
               WHERE block.content_type = 'image'
                 AND block.question_part_id IS NOT NULL
           ) = 0
     ORDER BY document.original_file_name, source.source_question_number
`);
await client.end();

console.log(JSON.stringify({
    complete: true,
    candidateCount: rows.length,
    candidates: rows,
}, null, 2));
