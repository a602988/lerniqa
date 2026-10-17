import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseMetadataLast } from "../scripts/import-grade-seven-fixtures.mjs";

import {
    AUTHORIZED_HANLIN_LESSON_IMPORTS,
    AUTHORIZED_FOURTH_LESSON_FILE,
    AUTHORIZED_FOURTH_LESSON_SHA256,
    correctedQuestionBody,
    normalizeLegacyWordSymbolArrows,
    PARSER_VERSION,
    snapshotWordDocument,
    stripLegacyWordSequenceFieldPrefixes,
} from "../scripts/lib/hanlin-chinese-import.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the approved math source correction preserves multiplication signs", () => {
    assert.equal(
        correctedQuestionBody({ number: "1501003429", body: "原始轉換文字" }),
        "小強將 a 做質因數分解，計算過程如下，則下列敘述何者正確？\n(A)d＝5＋7\n(B)c＝3×5\n(C)b＝2×3×5×7\n(D)a＝2×3×5×7",
    );
    assert.equal(correctedQuestionBody({ number: "other", body: " 保留文字 " }), "保留文字");
});

async function readRepositoryFile(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("a formal import refuses any source other than an authorized lesson file before file I/O", () => {
    const result = spawnSync(process.execPath, [
        path.join(repositoryRoot, "scripts", "import-hanlin-chinese-postgres.mjs"),
        path.join(os.tmpdir(), "not-an-authorized-lesson.doc"),
    ], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: process.env,
    });

    assert.equal(result.status, 1);
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.failed, 1);
    assert.equal(summary.failedFiles[0].code, "WRITE_SCOPE_REQUIRES_APPROVED_LESSON_FILE");
    assert.match(summary.failedFiles[0].message, new RegExp(AUTHORIZED_FOURTH_LESSON_FILE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a formal import refuses different content renamed to an authorized lesson file", async () => {
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
        assert.equal(summary.failedFiles[0].code, "WRITE_SCOPE_REQUIRES_APPROVED_LESSON_CONTENT");
        assert.match(AUTHORIZED_FOURTH_LESSON_SHA256, /^[0-9a-f]{64}$/u);
    }
    finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

test("the approved lesson manifest keeps separate targets, counts, checksums, and a narrowly scoped decorative image exception", () => {
    assert.deepEqual(
        AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) => entry.target.publisherCode === "hanlin").map((entry) => ({
            unit: entry.target.unitCode,
            position: entry.target.unitPosition,
            count: entry.expectedQuestionCount,
        })),
        [
            { unit: "lesson-4", position: 4, count: 279 },
            { unit: "lesson-5", position: 5, count: 280 },
            { unit: "lesson-6", position: 6, count: 258 },
            { unit: "language-knowledge-2", position: 7, count: 76 },
            { unit: "lesson-4", position: 4, count: 24 },
            { unit: "lesson-5", position: 5, count: 14 },
            { unit: "lesson-6", position: 6, count: 17 },
            { unit: "language-knowledge-2", position: 7, count: 7 },
            { unit: "lesson-4", position: 4, count: 8 },
            { unit: "lesson-6", position: 6, count: 9 },
            { unit: "language-knowledge-2", position: 7, count: 7 },
            { unit: "lesson-4", position: 4, count: 11 },
            { unit: "lesson-5", position: 5, count: 2 },
            { unit: "lesson-6", position: 6, count: 10 },
            { unit: "language-knowledge-2", position: 7, count: 13 },
            { unit: "lesson-4", position: 4, count: 11 },
            { unit: "lesson-5", position: 5, count: 11 },
            { unit: "lesson-6", position: 6, count: 11 },
            { unit: "language-knowledge-2", position: 7, count: 8 },
            { unit: "language-knowledge-2", position: 7, count: 40 },
        ],
    );
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS) {
        assert.match(entry.originalSha256, /^[0-9a-f]{64}$/u);
    }
    const mathEntries = AUTHORIZED_HANLIN_LESSON_IMPORTS.filter((entry) => entry.target.publisherCode === "kangxuan");
    assert.equal(mathEntries.length, 11);
    assert.equal(mathEntries.reduce((total, entry) => total + entry.expectedQuestionCount, 0), 1020);
    assert.ok(mathEntries.every((entry) => entry.target.subjectCode === "math"
        && entry.parserStyle === "metadata-first"));
    const factorsEntry = mathEntries.find((entry) =>
        entry.originalSha256 === "ffb7d287b28b4eb6b3bd1fdd7b266e11a7b2f10c55a249e77c41074b04b8d5dc");
    assert.deepEqual(factorsEntry?.approvedQuestionImageMappings, [
        { checksum: "28cfed3d74f8f7334440b0a88b86c3e86f3cf7ca77fd8c9a99474d9751cf4b8f", questionNumber: "1501003429" },
    ]);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[0].approvedDecorativeImageSha256s, []);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[1].approvedDecorativeImageSha256s, []);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[2].approvedDecorativeImageSha256s, [
        "cf335ba0de1c4025f416ca1932e9b2de5a815a72e98c87ac9f0d7be2d283ded8",
    ]);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].approvedDecorativeImageSha256s, []);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].expectedPublishedCount, 75);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].expectedPendingReviewCount, 1);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].approvedQuestionImageMappings, [
        { checksum: "7feccd462d1aab57c8b8df78caa19c8fcd71852ae1bdc473652076a67118e71c", questionNumber: "05011868" },
        { checksum: "eb4a540dc515923087e6e0f41b86265f09e3f2a95a26a2125ac1cb4aa37320a2", questionNumber: "05011869" },
    ]);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[3].unresolvedImageQuestionNumbers, ["05011838"]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(4, 8)) {
        assert.equal(entry.target.sourceCategoryCode, "literacy-question");
        assert.equal(entry.target.sourceCategoryName, "素養題");
        assert.ok(entry.approvedQuestionImageMappings.length > 0);
    }
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[4].expectedPublishedCount, 24);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[4].expectedPendingReviewCount, 0);
    assert.deepEqual(
        AUTHORIZED_HANLIN_LESSON_IMPORTS[4].approvedQuestionImageMappings
            .filter((mapping) => mapping.questionNumber === "05013285")
            .map((mapping) => mapping.optionKey),
        ["A", "B", "C", "D"],
    );
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[4].approvedChoiceRepairs, [{
        questionNumber: "05013285",
        answerKey: "B",
        options: [
            { key: "A", text: "圖表 A", imageChecksum: "9981dd9151c4097c6a47c0db44a84e1ad632cee6c37330cc765231134e730d81" },
            { key: "B", text: "圖表 B", imageChecksum: "a7d1bbfa1b98adcaf02c6e42c07a44b78ccc15c52c75eb251f7cf263bb1ea6dc" },
            { key: "C", text: "圖表 C", imageChecksum: "b9a8f883214587ed5654803c9fd099f360b5f6505d02d3a75d9572ca4746bd00" },
            { key: "D", text: "圖表 D", imageChecksum: "5afa3ffbf561463af9c4fe2cd9125ff897082160595b03926b7637052337c9d7" },
        ],
    }]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(8, 11)) {
        assert.equal(entry.target.sourceCategoryCode, "basic-competency-test");
        assert.equal(entry.target.sourceCategoryName, "基測");
    }
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[10].approvedQuestionImageMappings, [
        { checksum: "8f497c1c45aaf297558eef7c8030f8b2a2e58c5752ed8495970073aeb867119e", questionNumber: "05013137" },
    ]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(11, 15)) {
        assert.equal(entry.target.sourceCategoryCode, "comprehensive-assessment");
        assert.equal(entry.target.sourceCategoryName, "會考");
    }
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[14].approvedQuestionImageMappings, [
        { checksum: "9714f98a8427c6f33d6797fd48da5aef8821daf8f026b9a0e6fb20cb43c72b2f", questionNumber: "05013175" },
        { checksum: "16f5f00fb5cf0886286e8ac494a6a241410c9fd7ea9d1d58e2a7d3862b3adf2c", questionNumber: "05013176" },
    ]);
    for (const entry of AUTHORIZED_HANLIN_LESSON_IMPORTS.slice(15, 19)) {
        assert.equal(entry.target.sourceCategoryCode, "textbook-classroom");
        assert.equal(entry.target.sourceCategoryName, "課本隨堂");
    }
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[18].approvedQuestionImageMappings, [
        { checksum: "ee52a468557fb02c5cf26cdd585c663e029b0d0bb3fff3d4096ff841ba88a8ff", questionNumber: "05013570" },
    ]);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].target.sourceCategoryCode, "publisher-test-bank");
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].expectedPublishedCount, 40);
    assert.equal(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].expectedPendingReviewCount, 0);
    assert.deepEqual(AUTHORIZED_HANLIN_LESSON_IMPORTS[19].approvedQuestionImageMappings, [
        { checksum: "4ec38651486731332a6bf527f52a0ebef0379abea2b57de0212d5262c09e737a", questionNumber: "05013843", optionKey: "A", altText: "對話 A：弟子祝夫子生日快樂，夫子道謝" },
        { checksum: "3369396cb51b4451c7273736ba0e7c010d8bab9e15d297e2eb177b7c079ed3e6", questionNumber: "05013843", optionKey: "B", altText: "對話 B：他人稱讚高足的表現，對方回答過譽了" },
        { checksum: "d916500d2862bd8afde2fab0ba52af5b8c9654a6d2c1216158cc82e706cddf58", questionNumber: "05013843", optionKey: "C", altText: "對話 C：受業想再多多請教，夫子回答沒問題" },
        { checksum: "5f51d55bc0184e1f440c4df152439ae7536c50ddba32e3fcf5cdab782c3bf9f9", questionNumber: "05013843", optionKey: "D", altText: "對話 D：弟子感謝講述並表示受益匪淺" },
    ]);
    assert.deepEqual(
        AUTHORIZED_HANLIN_LESSON_IMPORTS[19].approvedChoiceRepairs.map((repair) => [repair.questionNumber, repair.answerKey]),
        [["05013836", "D"], ["05013843", "B"]],
    );
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
    assert.equal(PARSER_VERSION, "hanlin-zh-doc-v6");
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

test("the parser retains cognitive and knowledge dimensions as separate source fields", () => {
    const records = parseMetadataLast([
        "單一選擇題",
        "下列何者正確？",
        "答案：A",
        "編號：05010001",
        "難易度：易",
        "出處：試題",
        "認知向度：基本語文知識",
        "知識向度：正確用字",
        "課名：第一課",
    ].join("\n"), ["單一選擇題"], "source.doc");

    assert.equal(records.length, 1);
    assert.equal(records[0].cognitive, "基本語文知識");
    assert.equal(records[0].knowledge, "正確用字");
});

test("the parser converts legacy Wingdings arrows without changing genuine Latin text", () => {
    assert.equal(normalizeLegacyWordSymbolArrows("(Ａ)蘊\uf0e0慍(Ｃ)譯\uf0e0繹"), "(Ａ)蘊→慍(Ｃ)譯→繹");
    assert.equal(normalizeLegacyWordSymbolArrows("(Ａ)塭à溫(Ｃ)祟à崇"), "(Ａ)塭→溫(Ｃ)祟→崇");
    assert.equal(normalizeLegacyWordSymbolArrows("(Ａ)ㄅㄧㄣˋàㄅㄧㄣ"), "(Ａ)ㄅㄧㄣˋ→ㄅㄧㄣ");
    assert.equal(normalizeLegacyWordSymbolArrows("Voilà, à la carte"), "Voilà, à la carte");
});

test("the PostgreSQL writer keeps the repaired parameter casts and parser-versioned classification identities", async () => {
    const writer = await readRepositoryFile("scripts/lib/hanlin-postgres-writer.mjs");

    assert.match(writer, /SET status = \$2::varchar\(20\)/);
    assert.match(writer, /CASE WHEN \$2::varchar\(20\) = 'confirmed'/);
    assert.ok(writer.includes("classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:unit:${document.originalTitle}"));
    assert.ok(writer.includes("classification-candidate:${document.sourceDocumentId}:${plan.parserVersion}:${dimension}:approved:${targetId}"));
    assert.match(writer, /review_status = 'approved'[\s\S]*AND id <> \$4/);
    assert.match(writer, /review_status = 'pending'[\s\S]*question_revision_id IS NULL/);
    assert.match(writer, /existing\?\.status === "confirmed"/);
    assert.match(writer, /key: "cognitive_dimension", name: "認知向度"/);
    assert.match(writer, /key: "knowledge_dimension", name: "知識向度"/);
    assert.match(writer, /question_revision_filter_values/);
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
