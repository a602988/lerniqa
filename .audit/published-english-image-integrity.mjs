import path from "node:path";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

import { inspectVisibleImageBounds } from "../scripts/lib/hanlin-chinese-import.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const client = new Client({
    host: process.env.PGHOST || path.join(repositoryRoot, "local-data", "postgres-socket"),
    port: Number(process.env.PGPORT || 55432),
    database: process.env.PGDATABASE || "lerniqa_local",
    user: process.env.PGUSER || process.env.USER,
});

await client.connect();
const { rows } = await client.query(`
    SELECT q.id AS question_id,
           revision.id AS revision_id,
           source.source_question_number,
           document.original_file_name,
           block.id AS block_id,
           block.placement,
           block.position,
           asset.id AS asset_id,
           asset.storage_key,
           asset.mime_type,
           asset.width,
           asset.height,
           asset.checksum
      FROM questions AS q
      JOIN question_revisions AS revision
        ON revision.id = q.current_revision_id
       AND revision.question_id = q.id
      JOIN subjects AS subject ON subject.id = revision.subject_id
      JOIN book_versions AS version
        ON version.id = revision.book_version_id
       AND version.subject_id = revision.subject_id
      JOIN publishers AS publisher ON publisher.id = version.publisher_id
      JOIN question_content_blocks AS block
        ON block.question_revision_id = revision.id
       AND block.content_type = 'image'
      JOIN assets AS asset ON asset.id = block.asset_id
      JOIN question_revision_sources AS source
        ON source.question_revision_id = revision.id
       AND source.is_primary = true
      JOIN source_documents AS document ON document.id = source.source_document_id
     WHERE q.status = 'published'
       AND revision.status = 'published'
       AND subject.code = 'english'
       AND publisher.code = 'hanlin'
     ORDER BY document.original_file_name,
              source.source_question_number,
              q.id,
              block.placement,
              block.position
`);
await client.end();

const assets = new Map();
for (const row of rows) {
    const asset = assets.get(row.asset_id) ?? {
        assetId: row.asset_id,
        checksum: row.checksum,
        storageKey: row.storage_key,
        mimeType: row.mime_type,
        databaseDimensions: { width: row.width, height: row.height },
        uses: [],
    };
    asset.uses.push({
        questionId: row.question_id,
        revisionId: row.revision_id,
        sourceQuestionNumber: row.source_question_number,
        originalFileName: row.original_file_name,
        blockId: row.block_id,
        placement: row.placement,
        position: row.position,
    });
    assets.set(row.asset_id, asset);
}

const findings = [];
for (const asset of assets.values()) {
    const physicalPath = path.join(repositoryRoot, "local-data", "assets", asset.storageKey);
    try {
        const inspection = await inspectVisibleImageBounds(await readFile(physicalPath));
        const flags = [];
        if (!inspection.bounds) flags.push("effectively-blank");
        if (inspection.likelyOffsetClipped) flags.push("offset-clipping-candidate");
        if (flags.length) findings.push({ ...asset, physicalPath, inspection, flags });
    } catch (error) {
        findings.push({
            ...asset,
            physicalPath,
            flags: [error?.code === "ENOENT" ? "missing-file" : "decode-error"],
            error: error?.message,
        });
    }
}

const flagCounts = Object.fromEntries(
    [...new Set(findings.flatMap((finding) => finding.flags))]
        .sort()
        .map((flag) => [flag, findings.filter((finding) => finding.flags.includes(flag)).length]),
);
console.log(JSON.stringify({
    complete: true,
    scope: {
        publisherCode: "hanlin",
        subjectCode: "english",
        questionStatus: "published",
        revisionStatus: "published",
    },
    summary: {
        questionCount: new Set(rows.map((row) => row.question_id)).size,
        imageBlockCount: rows.length,
        distinctAssetCount: assets.size,
        findingCount: findings.length,
        flagCounts,
    },
    findings,
}, null, 2));
