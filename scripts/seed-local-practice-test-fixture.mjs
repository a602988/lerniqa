#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";

import {
    deterministicUuid,
    LOCAL_CATALOG_IDS,
    PARSER_VERSION,
    SANITIZER_VERSION,
    stableJson,
    TARGET_CLASSIFICATION,
} from "./lib/hanlin-chinese-import.mjs";
import {
    HANLIN_IMPORT_PRINCIPAL,
    writeHanlinPostgresImport,
} from "./lib/hanlin-postgres-writer.mjs";

const ROOT_PATTERN = /^lerniqa-practice-test\.[A-Za-z0-9_-]+$/u;
const DATABASE_PATTERN = /^lerniqa_practice_test_[a-z0-9_]+$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const MARKER_FILE = ".lerniqa-isolated-practice-test";
const SOURCE_FILE = "lerniqa-isolated-practice-fixture.doc";
const SOURCE_BYTES = Buffer.from("lerniqa-isolated-practice-fixture-v1", "utf8");
const SANITIZED_BYTES = Buffer.from("lerniqa-isolated-practice-fixture-sanitized-v1", "utf8");
const QUESTION_COUNT = 279;
const DATABASE_OWNERSHIP_COMMENT_PREFIX = "lerniqa-isolated-practice-test:";

const { Pool } = pg;

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironment(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`缺少隔離測試環境變數 ${name}。`);
    return value;
}

async function verifyIsolatedTarget() {
    if (process.env.VERIFY_CATALOG_PROFILE !== "synthetic-import") {
        throw new Error("合成 fixture 只能用於 VERIFY_CATALOG_PROFILE=synthetic-import。");
    }
    const configuredRoot = requiredEnvironment("LERNIQA_ISOLATED_TEST_ROOT");
    const token = requiredEnvironment("LERNIQA_ISOLATED_TEST_TOKEN");
    const database = requiredEnvironment("LOCAL_PG_DATABASE");
    const socket = requiredEnvironment("LOCAL_PG_SOCKET");
    const user = requiredEnvironment("LOCAL_PG_USER");
    const port = requiredEnvironment("LOCAL_PG_PORT");
    const existingServerMode = process.env.LERNIQA_PRACTICE_TEST_EXISTING?.trim() ?? "0";
    if (!["0", "1"].includes(existingServerMode)) {
        throw new Error("LERNIQA_PRACTICE_TEST_EXISTING 只接受 0 或 1。");
    }
    const borrowingExistingServer = existingServerMode === "1";
    if (!path.isAbsolute(configuredRoot) || !ROOT_PATTERN.test(path.basename(configuredRoot))) {
        throw new Error("隔離測試根目錄不符合安全規則。");
    }
    if (!TOKEN_PATTERN.test(token)
        || !DATABASE_PATTERN.test(database)
        || user !== os.userInfo().username
        || !/^\d+$/u.test(port)
        || Number(port) < 1
        || Number(port) > 65_535) {
        throw new Error("隔離測試資料庫設定不符合安全規則。");
    }

    let expectedSocket = path.join(path.resolve(configuredRoot), "socket");
    let expectedDataDirectory = path.join(path.resolve(configuredRoot), "postgres");
    if (borrowingExistingServer) {
        const approvedSocket = requiredEnvironment("LERNIQA_PRACTICE_TEST_SOCKET");
        const approvedPort = requiredEnvironment("LERNIQA_PRACTICE_TEST_PORT");
        const approvedDataDirectory = requiredEnvironment("LERNIQA_PRACTICE_TEST_DATA_DIRECTORY");
        if (!path.isAbsolute(approvedSocket)
            || !path.isAbsolute(approvedDataDirectory)
            || !/^\d+$/u.test(approvedPort)
            || Number(approvedPort) !== Number(port)) {
            throw new Error("existing-local-server 核准設定不符合安全規則。");
        }
        expectedSocket = path.resolve(approvedSocket);
        expectedDataDirectory = path.resolve(approvedDataDirectory);
        if (path.resolve(socket) !== expectedSocket) {
            throw new Error("LOCAL_PG_SOCKET 與核准的 existing-local-server socket 不一致。");
        }
    }
    else if (path.resolve(socket) !== expectedSocket) {
        throw new Error("隔離測試資料庫設定不符合安全規則。");
    }

    const [root, temporaryParent] = await Promise.all([
        realpath(configuredRoot),
        realpath(os.tmpdir()),
    ]);
    if (root !== path.resolve(configuredRoot) || path.dirname(root) !== temporaryParent) {
        throw new Error("隔離測試根目錄必須是 canonical 暫存目錄的直屬目錄。");
    }
    const isolatedDirectories = borrowingExistingServer
        ? [root]
        : [root, path.join(root, "postgres"), path.join(root, "socket")];
    for (const target of isolatedDirectories) {
        const metadata = await lstat(target);
        if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
            throw new Error("隔離測試目錄必須是私有真實目錄，不可為符號連結。");
        }
    }
    const markerPath = path.join(root, MARKER_FILE);
    const markerMetadata = await lstat(markerPath);
    if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink() || (markerMetadata.mode & 0o077) !== 0) {
        throw new Error("隔離測試 marker 必須是私有一般檔案，不可為符號連結。");
    }
    const marker = await readFile(markerPath, "utf8");
    if (marker.trim() !== token) throw new Error("隔離測試 marker 不符。");

    if (borrowingExistingServer) {
        const pool = new Pool({
            host: socket,
            port: Number(port),
            database,
            user,
            password: async () => {
                throw new Error("existing-local-server 隔離 fixture 不應要求密碼。");
            },
            ssl: false,
            application_name: "lerniqa-isolated-practice-fixture-guard",
            max: 1,
            connectionTimeoutMillis: 3_000,
            statement_timeout: 10_000,
            query_timeout: 12_000,
            allowExitOnIdle: true,
        });
        try {
            const identity = (await pool.query(`
                SELECT
                    inet_server_addr()::text AS server_address,
                    current_database() AS database_name,
                    current_user AS current_user_name,
                    session_user AS session_user_name,
                    current_setting('data_directory') AS data_directory,
                    current_setting('unix_socket_directories') AS socket_directories,
                    current_setting('port') AS server_port,
                    pg_catalog.pg_is_in_recovery() AS in_recovery,
                    (
                        SELECT pg_catalog.shobj_description(oid, 'pg_database')
                        FROM pg_catalog.pg_database
                        WHERE datname = current_database()
                    ) AS database_comment
            `)).rows[0];
            const [actualDataDirectory, canonicalExpectedDataDirectory, actualSocket, canonicalExpectedSocket] = await Promise.all([
                realpath(identity?.data_directory).catch(() => null),
                realpath(expectedDataDirectory).catch(() => null),
                realpath(identity?.socket_directories).catch(() => null),
                realpath(expectedSocket).catch(() => null),
            ]);
            if (identity?.server_address !== null
                || identity.database_name !== database
                || identity.current_user_name !== user
                || identity.session_user_name !== user
                || Number(identity.server_port) !== Number(port)
                || identity.in_recovery !== false
                || actualDataDirectory === null
                || actualDataDirectory !== canonicalExpectedDataDirectory
                || actualSocket === null
                || actualSocket !== canonicalExpectedSocket
                || identity.database_comment !== `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${token}`) {
                throw new Error("existing-local-server 身分或資料庫 ownership marker 不符。");
            }
        }
        finally {
            await pool.end();
        }
    }
}

function createPlan() {
    const originalSha256 = sha256(SOURCE_BYTES);
    const sanitizedSha256 = sha256(SANITIZED_BYTES);
    const sourceDocumentId = deterministicUuid(`source-document:sanitized-docx:${SANITIZER_VERSION}:${originalSha256}`);
    const records = Array.from({ length: QUESTION_COUNT }, (_, index) => {
        const sequence = index + 1;
        const number = `fixture-${String(sequence).padStart(4, "0")}`;
        const isManualReview = sequence === QUESTION_COUNT;
        const structured = isManualReview
            ? {
                kind: "written",
                questionTypeCode: "written",
                difficultyCode: "basic",
                prompt: `隔離測試題目 ${sequence}：請寫出合成答案。`,
                parts: [{
                    stableKey: "main",
                    prompt: "",
                    answerMode: "text",
                    gradingPolicy: "manual_review",
                    options: [],
                    answer: { acceptedValue: `合成參考答案 ${sequence}` },
                }],
                explanation: "",
                pendingReasons: [],
            }
            : {
                kind: "choice",
                questionTypeCode: "single-choice",
                difficultyCode: "basic",
                prompt: `隔離測試題目 ${sequence}：請選出正確的合成選項。`,
                parts: [{
                    stableKey: "main",
                    prompt: "",
                    answerMode: "single_choice",
                    gradingPolicy: "automatic",
                    options: [
                        { key: "A", text: `正確選項 ${sequence}` },
                        { key: "B", text: `錯誤選項 ${sequence}` },
                    ],
                    answer: { answerKey: "A" },
                }],
                explanation: "",
                pendingReasons: [],
            };
        return {
            documentIndex: 0,
            recordIndex: index,
            sourceDocumentId,
            sourcePage: Math.floor(index / 25) + 1,
            sourceQuestionNumber: number,
            normalizedQuestionNumber: number,
            sourceOrder: index,
            originalType: isManualReview ? "填充題" : "單一選擇題",
            originalDifficulty: "基礎",
            originalKnowledge: "隔離測試",
            originalSource: "合成題庫",
            originalUnit: "第四課",
            structured,
            pendingReasons: [],
            contentFingerprint: sha256(stableJson({ number, structured })),
            images: [],
        };
    });
    const document = {
        documentIndex: 0,
        relativePath: SOURCE_FILE,
        fileName: SOURCE_FILE,
        originalTitle: "Lerniqa 隔離練習測試題",
        originalSha256,
        originalByteSize: SOURCE_BYTES.length,
        originalMimeType: "application/msword",
        originalStorageKey: `quarantine/source-documents/${originalSha256}.doc`,
        originalAssetId: deterministicUuid(`asset:quarantine-source-document:${originalSha256}`),
        originalMacroMarkers: ["synthetic-isolation-marker"],
        sanitizedSha256,
        sanitizedByteSize: SANITIZED_BYTES.length,
        sanitizedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        storageKey: `sanitized-source-documents/${originalSha256}.docx`,
        assetId: deterministicUuid(`asset:sanitized-source-document:${SANITIZER_VERSION}:${originalSha256}`),
        sourceDocumentId,
        sanitization: {
            tool: "synthetic-test-fixture",
            version: SANITIZER_VERSION,
            policy: "isolated-synthetic-fixture",
        },
        pageCount: Math.ceil(QUESTION_COUNT / 25),
        htmlImageCount: 0,
        pdfImageCount: 0,
        records,
    };
    const manifest = [{ relativePath: document.relativePath, originalSha256 }];
    const sourceSetHash = sha256(stableJson(manifest));
    const idempotencyKey = `${PARSER_VERSION}:${TARGET_CLASSIFICATION.key}:${sourceSetHash}`;
    const batchId = deterministicUuid(`import-batch:${idempotencyKey}`);
    const questionGroups = records.map((record) => {
        const identityKey = `${originalSha256}:${record.normalizedQuestionNumber}`;
        const occurrence = { document, record };
        return {
            number: record.normalizedQuestionNumber,
            identityKey,
            publishable: true,
            contentFingerprint: record.contentFingerprint,
            publisherIdentifier: `${originalSha256.slice(0, 16)}:${record.normalizedQuestionNumber}`,
            canonical: occurrence,
            occurrences: [occurrence],
            questionId: deterministicUuid(`question:hanlin:${identityKey}`),
            revisionId: deterministicUuid(`revision:${batchId}:${identityKey}:${record.contentFingerprint}`),
        };
    });
    return {
        parserVersion: PARSER_VERSION,
        target: TARGET_CLASSIFICATION,
        sourceKind: "synthetic-isolated-test",
        ids: { ...LOCAL_CATALOG_IDS },
        idempotencyKey,
        batchId,
        sourceSetHash,
        documents: [document],
        questionGroups,
        duplicatesSkipped: 0,
    };
}

/**
 * 建立只屬於隔離題庫的已確認相同題模板，供推薦 E2E 驗證正式關聯路徑。
 * @param {ReturnType<typeof createPlan>} plan 已匯入的合成題庫計畫。
 * @returns {Promise<void>} 寫入完成時結束。
 */
async function seedConfirmedTemplate(plan) {
    const pool = new Pool({
        host: requiredEnvironment("LOCAL_PG_SOCKET"),
        port: Number(requiredEnvironment("LOCAL_PG_PORT")),
        database: requiredEnvironment("LOCAL_PG_DATABASE"),
        user: requiredEnvironment("LOCAL_PG_USER"),
        password: async () => {
            throw new Error("隔離 fixture 資料庫不應要求密碼。");
        },
        ssl: false,
        application_name: "lerniqa-isolated-practice-relation-fixture",
        max: 1,
        allowExitOnIdle: true,
    });
    const templateId = deterministicUuid("isolated-practice:question-template:choice-sequence");
    const choiceGroups = plan.questionGroups.slice(0, QUESTION_COUNT - 1);
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`
            INSERT INTO question_templates (
                id, template_key, normalized_pattern, logic_key, status,
                created_source, method_version, evidence,
                confirmed_by_user_id, confirmed_at
            )
            VALUES ($1, $2, $3, $4, 'confirmed', 'rule', $5, $6::jsonb, $7, CURRENT_TIMESTAMP)
        `, [
            templateId,
            "isolated-practice-choice-sequence",
            "隔離測試題目 {sequence}：請選出正確的合成選項。",
            "select-synthetic-correct-option",
            "isolated-fixture-v1",
            JSON.stringify({ fixture: "synthetic-isolated-local-practice" }),
            HANLIN_IMPORT_PRINCIPAL.userId,
        ]);
        await client.query(`
            INSERT INTO question_template_memberships (
                question_template_id, question_id, based_on_revision_id,
                variable_values, status, evidence, reviewed_by_user_id, reviewed_at, created_at
            )
            SELECT
                $1,
                fixture.question_id,
                fixture.revision_id,
                jsonb_build_object('sequence', fixture.sequence),
                'confirmed',
                jsonb_build_object('fixture', 'synthetic-isolated-local-practice'),
                $2,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM unnest($3::uuid[], $4::uuid[], $5::integer[])
                AS fixture(question_id, revision_id, sequence)
        `, [
            templateId,
            HANLIN_IMPORT_PRINCIPAL.userId,
            choiceGroups.map((group) => group.questionId),
            choiceGroups.map((group) => group.revisionId),
            choiceGroups.map((_, index) => index + 1),
        ]);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
        await pool.end();
    }
}

await verifyIsolatedTarget();
const plan = createPlan();
const result = await writeHanlinPostgresImport({
    plan,
    summary: { fixture: "synthetic-isolated-local-practice" },
    pgEnv: process.env,
    beforeCommit: async () => null,
});
if (result.sourceFiles !== 1 || result.parsed !== QUESTION_COUNT || result.published !== QUESTION_COUNT) {
    throw new Error("隔離合成 fixture 匯入筆數不符。");
}
await seedConfirmedTemplate(plan);
process.stdout.write(`${JSON.stringify({
    ok: true,
    fixture: "synthetic-isolated-local-practice",
    sourceFiles: result.sourceFiles,
    parsed: result.parsed,
    published: result.published,
})}\n`);
