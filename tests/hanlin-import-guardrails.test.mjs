import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    AUTHORIZED_FOURTH_LESSON_FILE,
    AUTHORIZED_FOURTH_LESSON_SHA256,
    PARSER_VERSION,
    snapshotWordDocument,
    stripLegacyWordSequenceFieldPrefixes,
} from "../scripts/lib/hanlin-chinese-import.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readRepositoryFile(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("a formal import refuses any source other than the authorized Fourth Lesson file before file I/O", () => {
    const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, "scripts", "import-hanlin-chinese-postgres.mjs"),
        path.join(os.tmpdir(), "not-the-authorized-fourth-lesson.doc"),
    ], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: process.env,
    });

    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.failed, 1);
    assert.equal(summary.failedFiles[0].code, "WRITE_SCOPE_REQUIRES_FOURTH_LESSON_FILE");
    assert.match(summary.failedFiles[0].message, new RegExp(AUTHORIZED_FOURTH_LESSON_FILE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a formal import refuses different content renamed to the authorized Fourth Lesson file", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-import-scope-"));
    const lookalikePath = path.join(temporaryDirectory, AUTHORIZED_FOURTH_LESSON_FILE);
    try {
        await writeFile(lookalikePath, "synthetic non-approved Word content", "utf8");
        const result = spawnSync(process.execPath, [
            path.join(repositoryRoot, "scripts", "import-hanlin-chinese-postgres.mjs"),
            lookalikePath,
        ], {
            cwd: repositoryRoot,
            encoding: "utf8",
            env: process.env,
        });

        assert.equal(result.status, 1);
        const summary = JSON.parse(result.stdout.trim());
        assert.equal(summary.failed, 1);
        assert.equal(summary.failedFiles[0].code, "WRITE_SCOPE_REQUIRES_APPROVED_FOURTH_LESSON_CONTENT");
        assert.match(AUTHORIZED_FOURTH_LESSON_SHA256, /^[0-9a-f]{64}$/u);
    }
    finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

test("the importer snapshots one stable byte sequence before conversion and quarantine", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lerniqa-import-snapshot-"));
    const sourcePath = path.join(temporaryDirectory, "source.doc");
    const snapshotPath = path.join(temporaryDirectory, "snapshot.doc");
    try {
        await writeFile(sourcePath, "first stable byte sequence", "utf8");
        const snapshot = await snapshotWordDocument(sourcePath, snapshotPath, "source.doc");
        await writeFile(sourcePath, "replacement source content", "utf8");

        assert.equal(await readFile(snapshot.snapshotPath, "utf8"), "first stable byte sequence");
        assert.equal(snapshot.byteSize, Buffer.byteLength("first stable byte sequence"));
        assert.match(snapshot.sha256, /^[0-9a-f]{64}$/u);
    }
    finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

test("the parser removes known legacy Word sequence fields but preserves ordinary leading numbers", () => {
    assert.equal(PARSER_VERSION, "hanlin-zh-doc-v2");
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("\\S\\do 9(１)１\\S\\do 9(１))\\S\\do 9(１)子曰：學而時習之。"),
        "子曰：學而時習之。",
    );
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("\\S\\do 0(６６\\S\\do 0(６\\S\\do 0(６休養性情最好的方式之一便是讀書。"),
        "休養性情最好的方式之一便是讀書。",
    );
    assert.equal(stripLegacyWordSequenceFieldPrefixes("2026 年的題目內容"), "2026 年的題目內容");
});

test("the PostgreSQL writer keeps the repaired parameter casts and parser-versioned classification identities", async () => {
    const writer = await readRepositoryFile("scripts/lib/hanlin-postgres-writer.mjs");

    assert.match(writer, /SET status = \$2::varchar\(20\)/);
    assert.match(writer, /CASE WHEN \$2::varchar\(20\) = 'confirmed'/);
    assert.ok(writer.includes("classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:unit:${document.originalTitle}"));
    assert.ok(writer.includes("classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:${dimension}:approved:${targetId}"));
    assert.match(writer, /review_status = 'approved'[\s\S]*AND id <> \$4/);
});

test("database and writer contracts retain answer integrity, rollback, source snapshots, and original classification evidence", async () => {
    const [importLibrary, writer, migration, migrationTest, verifier] = await Promise.all([
        readRepositoryFile("scripts/lib/hanlin-chinese-import.mjs"),
        readRepositoryFile("scripts/lib/hanlin-postgres-writer.mjs"),
        readRepositoryFile("database/migrations/0007_practice_answer_integrity.up.sql"),
        readRepositoryFile("database/tests/0007_practice_answer_integrity.sql"),
        readRepositoryFile("scripts/verify-local-practice.mjs"),
    ]);

    assert.match(migration, /question_answers_choice_option_check/);
    assert.match(migration, /option\.option_key = answer\.answer_key/);
    assert.match(migrationTest, /SET answer_key = 'UNKNOWN'/);
    assert.match(migrationTest, /WHEN check_violation THEN/);

    assert.match(writer, /await client\.query\("BEGIN"\)/);
    assert.match(writer, /await client\.query\("ROLLBACK"\)/);
    assert.match(importLibrary, /const sourceSnapshot = await snapshotWordDocument\(/);
    assert.match(importLibrary, /sourcePath = sourceSnapshot\.snapshotPath/);
    assert.match(importLibrary, /copyVerified\(document\.sourcePath, quarantineDestination, document\.originalSha256\)/);
    assert.match(writer, /originalUnit: record\.originalUnit/);
    assert.match(writer, /raw_value: document\.originalTitle/);
    assert.match(verifier, /ORIGINAL_UNIT_METADATA_MISSING/);
    assert.match(verifier, /IMPORT_SOURCE_SCOPE_MISMATCH/);
    assert.match(verifier, /IMPORT_SOURCE_CHECKSUM_MISMATCH/);
    assert.match(verifier, /QUARANTINE_SOURCE_CHECKSUM_MISMATCH/);
});
