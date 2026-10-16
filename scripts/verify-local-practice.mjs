#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
    AUTHORIZED_FOURTH_LESSON_FILE,
    AUTHORIZED_FOURTH_LESSON_SHA256,
    PARSER_VERSION,
} from "./lib/hanlin-chinese-import.mjs";
import { HANLIN_IMPORT_PRINCIPAL } from "./lib/hanlin-postgres-writer.mjs";

const { Pool } = pg;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "http://127.0.0.1:3500";
const DEFAULT_SOCKET = path.join(REPOSITORY_ROOT, "local-data", "postgres-socket");
const DEFAULT_DATABASE = "lerniqa_local";
const DEFAULT_PORT = 55_432;
const AUTH_SESSION_COOKIE = "lerniqa_session";
const IMPORT_RECOGNIZER = PARSER_VERSION;
const IMPORT_KEY_PREFIX = `${IMPORT_RECOGNIZER}:jh1-zh-hanlin-v1-l4:`;
const EXPECTED_IMPORT = Object.freeze({
    sourceFiles: 1,
    parsed: 279,
    approved: 279,
    pending: 0,
    rejected: 0,
});
const EXPECTED_MIGRATIONS = [
    ["0001", "identity_and_catalog"],
    ["0002", "question_core"],
    ["0003", "import_and_collections"],
    ["0004", "practice_and_attempts"],
    ["0005", "similarity_analytics_and_audit"],
    ["0006", "source_documents_word"],
    ["0007", "practice_answer_integrity"],
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const ABSOLUTE_PATH_PATTERNS = [
    /(?:^|[\s"'=:(])\/(?:Users|home|Volumes|private|var|tmp)\//u,
    /(?:^|[\s"'=:(])[A-Z]:[\\/]/iu,
    /\bfile:\/\//iu,
    /\bCloudStorage\b/iu,
    /\bGoogleDrive-[^/\\\s]+/iu,
];
const PRIVATE_METADATA_KEYS = new Set([
    "absolutepath",
    "author",
    "company",
    "creator",
    "directory",
    "directorypath",
    "email",
    "filepath",
    "fullpath",
    "lastmodifiedby",
    "sourcepath",
]);
const FORBIDDEN_QUESTION_API_KEYS = new Set([
    "acceptedkeys",
    "acceptedvalues",
    "answer",
    "answerkey",
    "answerpayload",
    "answers",
    "explanation",
    "explanationtext",
    "explanations",
    "storagekey",
]);

class VerificationError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = "VerificationError";
        this.code = code;
        this.details = details;
    }
}

function invariant(condition, code, message, details = undefined) {
    if (!condition) throw new VerificationError(code, message, details);
}

function readOptionalEnvironment(name) {
    const value = process.env[name];
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    invariant(trimmed !== "", "EMPTY_ENVIRONMENT_VALUE", `${name} 不可為空字串。`);
    return trimmed;
}

function parseBooleanEnvironment(name) {
    const value = readOptionalEnvironment(name);
    if (value === undefined) return false;
    invariant(["1", "true", "yes"].includes(value.toLowerCase()), "INVALID_BOOLEAN_ENVIRONMENT", `${name} 只接受 1、true 或 yes。`);
    return true;
}

function parsePort() {
    const raw = readOptionalEnvironment("LOCAL_PG_PORT");
    if (raw === undefined) return DEFAULT_PORT;
    invariant(/^\d+$/u.test(raw), "INVALID_DATABASE_PORT", "LOCAL_PG_PORT 必須是整數。");
    const port = Number(raw);
    invariant(Number.isSafeInteger(port) && port >= 1 && port <= 65_535, "INVALID_DATABASE_PORT", "LOCAL_PG_PORT 必須介於 1 到 65535。");
    return port;
}

function databaseConfig() {
    const socket = readOptionalEnvironment("LOCAL_PG_SOCKET") ?? DEFAULT_SOCKET;
    invariant(path.isAbsolute(socket), "INVALID_DATABASE_SOCKET", "LOCAL_PG_SOCKET 必須是絕對路徑。");
    return {
        socket: path.resolve(socket),
        port: parsePort(),
        database: readOptionalEnvironment("LOCAL_PG_DATABASE") ?? DEFAULT_DATABASE,
        user: readOptionalEnvironment("LOCAL_PG_USER") ?? userInfo().username,
    };
}

function baseUrl() {
    const parsed = new URL(readOptionalEnvironment("BASE_URL") ?? DEFAULT_BASE_URL);
    invariant(parsed.protocol === "http:", "UNSAFE_BASE_URL", "整合驗證只允許本機 HTTP 開發服務。");
    invariant(parsed.username === "" && parsed.password === "", "UNSAFE_BASE_URL", "BASE_URL 不可包含帳號或密碼。");
    invariant(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname), "UNSAFE_BASE_URL", "整合驗證拒絕對非 loopback 服務建立作答資料。");
    invariant(parsed.search === "" && parsed.hash === "", "INVALID_BASE_URL", "BASE_URL 不可包含 query 或 fragment。");
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    return parsed;
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalize(value) {
    return String(value).normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
}

function numberValue(value) {
    const parsed = Number(value);
    invariant(Number.isSafeInteger(parsed) && parsed >= 0, "INVALID_COUNT", "資料庫回傳了無效的筆數。");
    return parsed;
}

function unique(values) {
    return [...new Set(values)];
}

function isAbsoluteOrPrivateString(value) {
    return EMAIL_PATTERN.test(value) || ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

function scanPrivateMetadata(value, location = "payload", findings = []) {
    if (typeof value === "string") {
        if (isAbsoluteOrPrivateString(value)) findings.push({ location, reason: "private-or-absolute-string" });
        return findings;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => scanPrivateMetadata(entry, `${location}[${index}]`, findings));
        return findings;
    }
    if (!isRecord(value)) return findings;
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = key.replace(/[-_\s]/gu, "").toLowerCase();
        if (PRIVATE_METADATA_KEYS.has(normalizedKey)) findings.push({ location: `${location}.${key}`, reason: "private-metadata-key" });
        scanPrivateMetadata(entry, `${location}.${key}`, findings);
    }
    return findings;
}

function scanForbiddenKeys(value, location = "response", findings = []) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => scanForbiddenKeys(entry, `${location}[${index}]`, findings));
        return findings;
    }
    if (!isRecord(value)) return findings;
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = key.replace(/[-_\s]/gu, "").toLowerCase();
        if (FORBIDDEN_QUESTION_API_KEYS.has(normalizedKey)) findings.push(`${location}.${key}`);
        scanForbiddenKeys(entry, `${location}.${key}`, findings);
    }
    return findings;
}

async function fetchJson(origin, pathname, init = undefined, expectedStatuses = [200]) {
    const url = new URL(pathname, origin);
    let response;
    try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    }
    catch (error) {
        throw new VerificationError("API_UNREACHABLE", "無法連線到本機練習 API。", {
            cause: error instanceof Error ? error.name : "unknown",
        });
    }
    let body;
    try {
        body = await response.json();
    }
    catch {
        throw new VerificationError("API_NON_JSON_RESPONSE", "本機練習 API 未回傳 JSON。", { status: response.status });
    }
    invariant(expectedStatuses.includes(response.status), "API_STATUS_MISMATCH", "本機練習 API 回傳非預期狀態。", {
        status: response.status,
        errorCode: isRecord(body?.error) ? body.error.code : undefined,
    });
    return { body, headers: response.headers, status: response.status };
}

function sessionCookieFromHeaders(headers) {
    const setCookie = headers.get("set-cookie");
    invariant(typeof setCookie === "string", "AUTH_COOKIE_MISSING", "合成帳號註冊後沒有收到 session cookie。");
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)${AUTH_SESSION_COOKIE}=([^;,\\s]+)`, "u"));
    invariant(match !== null && /^[A-Za-z0-9_-]{43}$/u.test(match[1]), "AUTH_COOKIE_INVALID", "合成帳號的 session cookie 格式不正確。");
    return {
        header: `${AUTH_SESSION_COOKIE}=${match[1]}`,
        token: match[1],
    };
}

function authenticatedInit(cookieHeader, init = undefined) {
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookieHeader);
    return { ...init, headers };
}

async function createSyntheticAuthClient(origin) {
    let registration = null;
    let email = null;
    for (let attempt = 0; attempt < 3 && registration === null; attempt += 1) {
        const candidateEmail = `local-practice-${randomUUID()}@lerniqa.invalid`;
        const candidatePassword = `verify-${randomUUID()}-${randomUUID()}`;
        const response = await fetchJson(origin, "/api/v1/auth/register", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                origin: origin.origin,
            },
            body: JSON.stringify({
                displayName: "整合驗證帳號",
                learnerName: "整合驗證學習者",
                email: candidateEmail,
                password: candidatePassword,
                role: "learner",
            }),
        }, [201, 409]);
        if (response.status === 409 && response.body?.error?.code === "EMAIL_ALREADY_REGISTERED") continue;
        invariant(response.status === 201, "SYNTHETIC_REGISTRATION_FAILED", "無法建立本機整合驗證用合成帳號。", {
            status: response.status,
            errorCode: response.body?.error?.code,
        });
        registration = response;
        email = candidateEmail;
    }
    invariant(registration !== null && email !== null, "SYNTHETIC_REGISTRATION_COLLISION", "無法取得唯一的 .invalid 合成帳號。");

    const account = registration.body?.data?.account;
    invariant(
        isRecord(account)
            && account.email === email
            && account.email.endsWith(".invalid")
            && account.activeRole === "learner"
            && isRecord(account.learner)
            && UUID_PATTERN.test(account.learner.id),
        "SYNTHETIC_ACCOUNT_INVALID",
        "合成帳號註冊回應缺少有效的 learner 身分。",
    );
    const cookie = sessionCookieFromHeaders(registration.headers);
    let loggedOut = false;
    const request = (pathname, init = undefined, expectedStatuses = [200]) => (
        fetchJson(origin, pathname, authenticatedInit(cookie.header, init), expectedStatuses)
    );
    const me = await request("/api/v1/auth/me");
    invariant(
        me.body?.data?.account?.email === email
            && me.body?.data?.account?.learner?.id === account.learner.id
            && me.body?.meta?.persistence === "local-postgresql",
        "AUTH_SESSION_IDENTITY_MISMATCH",
        "session cookie 無法讀回同一個合成帳號。",
    );

    return {
        emailDomain: ".invalid",
        learnerId: account.learner.id,
        request,
        sessionTokenHash: `sha256:v1:${createHash("sha256").update(cookie.token, "utf8").digest("hex")}`,
        async logout() {
            if (loggedOut) return;
            const response = await request("/api/v1/auth/logout", { method: "POST" });
            invariant(response.body?.data?.loggedOut === true, "AUTH_LOGOUT_FAILED", "合成帳號登出 API 未確認完成。");
            const afterLogout = await request("/api/v1/auth/me", undefined, [401]);
            invariant(afterLogout.body?.error?.code === "AUTH_REQUIRED", "AUTH_SESSION_NOT_REVOKED", "登出後舊 session cookie 仍可使用。");
            loggedOut = true;
        },
    };
}

async function verifyAuthSessionRevoked(client, tokenHash) {
    const row = (await client.query(`
        SELECT revoked_at
        FROM auth_sessions
        WHERE token_hash = $1
    `, [tokenHash])).rows[0];
    invariant(row?.revoked_at !== null && row?.revoked_at !== undefined, "AUTH_SESSION_DATABASE_NOT_REVOKED", "登出後資料庫 session 尚未標記 revoked_at。");
}

async function verifyDatabaseIdentity(client, config) {
    const identity = (await client.query(`
        SELECT
            inet_server_addr()::text AS server_address,
            current_database() AS database_name,
            current_setting('data_directory') AS data_directory,
            current_setting('listen_addresses') AS listen_addresses,
            current_setting('unix_socket_directories') AS socket_directories,
            current_setting('unix_socket_permissions') AS socket_permissions,
            current_setting('port') AS server_port,
            pg_postmaster_start_time() AS server_started_at
    `)).rows[0];
    invariant(identity?.server_address === null, "DATABASE_NOT_UNIX_SOCKET", "資料庫連線不是 Unix socket，拒絕驗證寫入流程。");
    invariant(identity.database_name === config.database, "DATABASE_NAME_MISMATCH", "連線資料庫名稱不符。", {
        expected: config.database,
        actual: identity.database_name,
    });
    invariant(Number(identity.server_port) === config.port, "DATABASE_PORT_MISMATCH", "本機 PostgreSQL port 不符。", {
        expected: config.port,
        actual: identity.server_port,
    });
    invariant(identity.listen_addresses === "", "DATABASE_TCP_ENABLED", "隔離 PostgreSQL 不應啟用 TCP。");
    invariant(identity.socket_directories === config.socket, "DATABASE_SOCKET_MISMATCH", "PostgreSQL socket 目錄不符。");
    invariant(identity.socket_permissions === "0700", "DATABASE_SOCKET_PERMISSIONS_MISMATCH", "隔離 PostgreSQL socket 權限必須是 0700。");
    const expectedDataDirectory = path.join(REPOSITORY_ROOT, "local-data", "postgres");
    invariant(path.resolve(identity.data_directory) === expectedDataDirectory, "DATABASE_CLUSTER_MISMATCH", "目前連線不是 Lerniqa 管理的本機隔離 cluster。");
    const serverStartedAtMillis = new Date(identity.server_started_at).getTime();
    invariant(Number.isFinite(serverStartedAtMillis), "DATABASE_START_TIME_INVALID", "PostgreSQL 未回傳有效的啟動時間。");
    const serverStartedAt = new Date(serverStartedAtMillis).toISOString();
    return {
        database: identity.database_name,
        unixSocket: true,
        socketPermissions: identity.socket_permissions,
        tcpDisabled: true,
        serverStartedAt,
    };
}

async function verifyMigrations(client) {
    const rows = (await client.query(`
        SELECT version, name
        FROM schema_migrations
        ORDER BY version
    `)).rows;
    invariant(rows.length === EXPECTED_MIGRATIONS.length, "MIGRATION_COUNT_MISMATCH", "schema_migrations 必須恰好包含 0001 到 0007。", {
        expected: EXPECTED_MIGRATIONS.length,
        actual: rows.length,
    });
    EXPECTED_MIGRATIONS.forEach(([version, name], index) => {
        invariant(rows[index]?.version === version && rows[index]?.name === name, "MIGRATION_MISMATCH", "migration 版本或名稱不符。", {
            index,
            expectedVersion: version,
            actualVersion: rows[index]?.version,
        });
    });
    return rows.map((row) => row.version);
}

async function findImportBatch(client) {
    const requestedBatchId = readOptionalEnvironment("IMPORT_BATCH_ID");
    if (requestedBatchId !== undefined) invariant(UUID_PATTERN.test(requestedBatchId), "INVALID_IMPORT_BATCH_ID", "IMPORT_BATCH_ID 不是 UUID。");
    const result = await client.query(`
        SELECT
            batch.id,
            batch.question_bank_id,
            batch.learner_id,
            batch.created_by_user_id,
            batch.status,
            batch.recognizer_version,
            batch.idempotency_key,
            batch.confirmed_at,
            bank.origin AS question_bank_origin,
            bank.owner_user_id AS question_bank_owner_user_id,
            bank.created_role AS question_bank_created_role
        FROM import_batches AS batch
        JOIN question_banks AS bank ON bank.id = batch.question_bank_id
        WHERE batch.created_by_user_id = $1
            AND batch.recognizer_version = $2
            AND batch.idempotency_key LIKE $3
            AND ($4::uuid IS NULL OR batch.id = $4)
            AND (
                SELECT count(*)
                FROM import_batch_documents AS batch_document
                WHERE batch_document.import_batch_id = batch.id
            ) = $5
        ORDER BY batch.created_at DESC, batch.id DESC
    `, [HANLIN_IMPORT_PRINCIPAL.userId, IMPORT_RECOGNIZER, `${IMPORT_KEY_PREFIX}%`, requestedBatchId ?? null, EXPECTED_IMPORT.sourceFiles]);
    invariant(result.rows.length >= 1, "IMPORT_BATCH_NOT_FOUND", "找不到第四課的翰林國文匯入批次。");
    return { batch: result.rows[0], matchingBatchCount: result.rows.length };
}

function payloadSource(payload) {
    if (!isRecord(payload)) return null;
    return isRecord(payload.source) ? payload.source : payload;
}

async function verifyImport(client, authenticatedLearnerId) {
    const { batch, matchingBatchCount } = await findImportBatch(client);
    invariant(batch.idempotency_key.startsWith(IMPORT_KEY_PREFIX), "IMPORT_TARGET_KEY_MISMATCH", "匯入批次不是第四課目標分類。");
    invariant(batch.created_by_user_id === HANLIN_IMPORT_PRINCIPAL.userId, "IMPORT_PRINCIPAL_MISMATCH", "匯入批次不是由固定匯入服務建立。");
    invariant(batch.learner_id === null, "IMPORT_BATCH_FIXTURE_SCOPE", "真實題庫匯入批次不得綁定合成學習者。");
    invariant(
        batch.question_bank_origin === "system"
            && batch.question_bank_owner_user_id === null
            && batch.question_bank_created_role === null,
        "QUESTION_BANK_OWNERSHIP_MISMATCH",
        "正式題庫必須是無帳號 owner 的 system 題庫。",
    );

    const principalResult = (await client.query(`
        SELECT
            app_user.display_name,
            app_user.status,
            count(role.id)::integer AS role_count
        FROM users AS app_user
        LEFT JOIN user_roles AS role ON role.user_id = app_user.id AND role.revoked_at IS NULL
        WHERE app_user.id = $1
        GROUP BY app_user.id
    `, [HANLIN_IMPORT_PRINCIPAL.userId])).rows[0];
    invariant(
        principalResult?.display_name === HANLIN_IMPORT_PRINCIPAL.displayName
            && principalResult.status === "active"
            && principalResult.role_count === 0,
        "IMPORT_PRINCIPAL_STATE_MISMATCH",
        "匯入服務帳號必須存在、啟用且不取得互動式使用者角色。",
        principalResult,
    );

    const authenticatedMembershipCount = (await client.query(`
        SELECT count(*)::integer AS count
        FROM question_bank_learners
        WHERE question_bank_id = $1 AND learner_id = $2
    `, [batch.question_bank_id, authenticatedLearnerId])).rows[0]?.count;
    invariant(authenticatedMembershipCount === 1, "AUTHENTICATED_BANK_MEMBERSHIP_MISSING", "已登入的合成學習者沒有透過題庫 membership 取得正式題庫存取權。", {
        questionBankId: batch.question_bank_id,
        learnerId: authenticatedLearnerId,
    });

    const documentResult = await client.query(`
        SELECT
            batch_document.position,
            document.id,
            document.owner_user_id,
            document.input_type,
            document.original_file_name,
            document.document_title,
            document.status,
            document.pasted_text,
            asset.id AS asset_id,
            asset.storage_key,
            asset.mime_type,
            asset.byte_size,
            asset.checksum,
            asset.purpose,
            asset.sensitivity,
            asset.scan_status,
            asset.created_by_user_id,
            asset.deleted_at
        FROM import_batch_documents AS batch_document
        JOIN source_documents AS document ON document.id = batch_document.source_document_id
        JOIN assets AS asset ON asset.id = document.asset_id
        WHERE batch_document.import_batch_id = $1
        ORDER BY batch_document.position
    `, [batch.id]);
    const documents = documentResult.rows;
    invariant(documents.length === EXPECTED_IMPORT.sourceFiles, "SOURCE_DOCUMENT_COUNT_MISMATCH", "匯入批次必須只包含指定的第四課來源文件。", { actual: documents.length });
    invariant(documents.every((row, index) => row.position === index), "SOURCE_DOCUMENT_POSITION_MISMATCH", "來源文件位置必須從 0 起連續排列。");
    invariant(unique(documents.map((row) => row.asset_id)).length === documents.length, "SANITIZED_ASSET_REUSED", "每份來源文件必須引用獨立的清理後資產。");
    for (const row of documents) {
        invariant(row.owner_user_id === null, "SOURCE_DOCUMENT_OWNER_MISMATCH", "正式來源文件不得綁定合成或一般使用者 owner。");
        invariant(row.created_by_user_id === HANLIN_IMPORT_PRINCIPAL.userId, "SOURCE_ASSET_CREATOR_MISMATCH", "正式來源資產不是由固定匯入服務建立。");
        invariant(row.input_type === "document" && row.status === "ready" && row.pasted_text === null, "SOURCE_DOCUMENT_STATE_MISMATCH", "來源文件必須是已就緒的 document 且不得保存 pasted_text。");
        invariant(path.basename(row.original_file_name) === row.original_file_name && row.original_file_name.toLowerCase().endsWith(".doc"), "SOURCE_DOCUMENT_NAME_UNSAFE", "來源文件名稱必須是頂層相對 `.doc` 檔名。");
        invariant(row.original_file_name.normalize("NFC") === AUTHORIZED_FOURTH_LESSON_FILE.normalize("NFC"), "SOURCE_DOCUMENT_SCOPE_MISMATCH", "匯入批次包含未授權寫入第四課的來源文件。");
        invariant(typeof row.document_title === "string" && row.document_title.trim() !== "", "SOURCE_DOCUMENT_TITLE_MISSING", "來源文件缺少標題。");
        invariant(row.purpose === "source_document" && row.sensitivity === "private" && row.scan_status === "clean" && row.deleted_at === null, "SANITIZED_ASSET_STATE_MISMATCH", "來源文件只能引用 clean/private 的 source_document 資產。");
        invariant(/^sanitized-source-documents\/[0-9a-f]{64}\.docx$/u.test(row.storage_key), "SANITIZED_STORAGE_KEY_MISMATCH", "清理後來源的 storage_key 格式不符。");
        invariant(SHA256_PATTERN.test(row.checksum) && numberValue(row.byte_size) > 0, "SANITIZED_ASSET_METADATA_INVALID", "清理後來源缺少有效雜湊或大小。");
        invariant(!isAbsoluteOrPrivateString(row.original_file_name) && !isAbsoluteOrPrivateString(row.document_title) && !isAbsoluteOrPrivateString(row.storage_key), "SOURCE_DOCUMENT_PRIVATE_METADATA", "來源文件欄位含絕對路徑或 email metadata。");
    }

    const itemResult = await client.query(`
        SELECT
            id,
            source_document_id,
            source_page,
            source_question_number,
            source_order,
            draft_payload,
            review_status,
            question_id,
            question_revision_id
        FROM import_items
        WHERE import_batch_id = $1
        ORDER BY source_order
    `, [batch.id]);
    const items = itemResult.rows;
    invariant(items.length > 0, "IMPORT_ITEMS_MISSING", "匯入批次沒有任何題目項目。");
    invariant(unique(items.map((row) => row.source_order)).length === items.length, "IMPORT_SOURCE_ORDER_DUPLICATED", "匯入項目的 source_order 重複。");
    const documentIds = new Set(documents.map((row) => row.id));
    invariant(items.every((row) => documentIds.has(row.source_document_id)), "IMPORT_ITEM_DOCUMENT_MISMATCH", "匯入項目引用批次外的來源文件。");
    invariant(documents.every((document) => items.some((item) => item.source_document_id === document.id)), "SOURCE_DOCUMENT_WITHOUT_ITEMS", "至少一份來源文件沒有匯入項目。");

    const originalHashes = new Set();
    const sanitizedHashes = new Set();
    const sourceMappings = new Map();
    const privateMetadataFindings = [];
    const itemCounts = { approved: 0, pending: 0, rejected: 0, linked: 0 };
    for (const row of items) {
        invariant(["approved", "pending", "rejected"].includes(row.review_status), "IMPORT_ITEM_STATUS_INVALID", "匯入項目 review_status 不合法。");
        itemCounts[row.review_status] += 1;
        if (row.question_id !== null || row.question_revision_id !== null) itemCounts.linked += 1;
        if (row.review_status === "approved") {
            invariant(row.question_id !== null && row.question_revision_id !== null, "APPROVED_ITEM_UNLINKED", "核准匯入項目必須連到題目與版本。");
        }
        else {
            invariant(row.question_id === null && row.question_revision_id === null, "UNAPPROVED_ITEM_LINKED", "待核對或拒絕項目不得連到已發布題目。");
        }
        invariant(isRecord(row.draft_payload), "IMPORT_PAYLOAD_INVALID", "draft_payload 必須是物件。");
        privateMetadataFindings.push(...scanPrivateMetadata(row.draft_payload, `importItem:${row.id}`));
        const source = payloadSource(row.draft_payload);
        invariant(source !== null, "IMPORT_SOURCE_METADATA_MISSING", "draft_payload 缺少來源 metadata。");
        const originalSha = source.originalSha256;
        const sanitizedSha = source.sanitizedSha256;
        invariant(typeof originalSha === "string" && SHA256_PATTERN.test(originalSha), "ORIGINAL_HASH_MISSING", "來源 metadata 缺少原檔 SHA-256。");
        invariant(originalSha === AUTHORIZED_FOURTH_LESSON_SHA256, "IMPORT_SOURCE_CHECKSUM_MISMATCH", "匯入 metadata 不是已核准的第四課原檔內容。");
        invariant(typeof sanitizedSha === "string" && SHA256_PATTERN.test(sanitizedSha), "SANITIZED_HASH_MISSING", "來源 metadata 缺少清理後 SHA-256。");
        originalHashes.add(originalSha);
        sanitizedHashes.add(sanitizedSha);
        const relativeName = source.relativeFileName ?? source.relativePath;
        invariant(typeof relativeName === "string" && path.basename(relativeName) === relativeName, "IMPORT_RELATIVE_NAME_UNSAFE", "來源 metadata 只能保留頂層相對檔名。");
        invariant(relativeName.normalize("NFC") === AUTHORIZED_FOURTH_LESSON_FILE.normalize("NFC"), "IMPORT_SOURCE_SCOPE_MISMATCH", "匯入 metadata 不是指定的第四課來源文件。");
        invariant(source.originalScanStatus === "rejected", "ORIGINAL_SCAN_STATUS_MISMATCH", "原始 Word 文件必須標示為 rejected。");
        invariant(source.macroQuarantined === true, "ORIGINAL_MACRO_QUARANTINE_MISSING", "原始 Word 文件必須保留 macroQuarantined 證據。");
        const priorMapping = sourceMappings.get(originalSha);
        if (priorMapping) {
            invariant(priorMapping.sanitizedSha === sanitizedSha && priorMapping.relativeName === relativeName, "SOURCE_METADATA_INCONSISTENT", "同一原檔雜湊在不同匯入項目中有不一致的來源 metadata。");
        }
        else {
            sourceMappings.set(originalSha, { sanitizedSha, relativeName });
        }
    }
    invariant(privateMetadataFindings.length === 0, "IMPORT_PRIVATE_METADATA_FOUND", "匯入 payload 含絕對路徑、email 或 Office 作者 metadata。", {
        findingCount: privateMetadataFindings.length,
        locations: privateMetadataFindings.slice(0, 10).map((finding) => finding.location),
    });
    invariant(originalHashes.size === documents.length && sanitizedHashes.size === documents.length, "SOURCE_HASH_COUNT_MISMATCH", "每份來源文件應各有一組原檔與清理後雜湊。", {
        originalHashes: originalHashes.size,
        sanitizedHashes: sanitizedHashes.size,
    });
    for (const document of documents) {
        const originalSha = document.storage_key.match(/^sanitized-source-documents\/([0-9a-f]{64})\.docx$/u)?.[1];
        const mapping = originalSha ? sourceMappings.get(originalSha) : undefined;
        invariant(mapping !== undefined, "SANITIZED_SOURCE_MAPPING_MISSING", "清理後來源資產無法對回匯入 metadata。");
        invariant(document.checksum === mapping.sanitizedSha && document.original_file_name === mapping.relativeName, "SANITIZED_SOURCE_MAPPING_MISMATCH", "清理後來源資產與匯入 metadata 不一致。");
    }
    const observedItemCounts = { parsed: items.length, ...itemCounts };
    invariant(
        observedItemCounts.parsed === EXPECTED_IMPORT.parsed
            && observedItemCounts.approved === EXPECTED_IMPORT.approved
            && observedItemCounts.pending === EXPECTED_IMPORT.pending
            && observedItemCounts.rejected === EXPECTED_IMPORT.rejected,
        "IMPORT_ITEM_COUNT_MISMATCH",
        "匯入題目總數或核對狀態與已驗證的第四課來源不一致。",
        { expected: EXPECTED_IMPORT, actual: { sourceFiles: documents.length, ...observedItemCounts } },
    );
    invariant(itemCounts.linked === itemCounts.approved, "IMPORT_APPROVAL_COUNT_MISMATCH", "核准與題目連結數量不一致。");
    const expectedBatchStatus = itemCounts.pending + itemCounts.rejected > 0 ? "review" : "confirmed";
    invariant(batch.status === expectedBatchStatus, "IMPORT_BATCH_STATUS_MISMATCH", "匯入批次狀態與項目核對狀態不一致。", {
        expected: expectedBatchStatus,
        actual: batch.status,
    });
    invariant((batch.status === "confirmed") === (batch.confirmed_at !== null), "IMPORT_BATCH_CONFIRMATION_MISMATCH", "匯入批次 confirmed_at 與狀態不一致。");

    const quarantineKeys = [...originalHashes].map((checksum) => `quarantine/source-documents/${checksum}.doc`);
    const quarantineResult = await client.query(`
        SELECT
            asset.id,
            asset.storage_key,
            asset.mime_type,
            asset.byte_size,
            asset.checksum,
            asset.purpose,
            asset.sensitivity,
            asset.scan_status,
            asset.created_by_user_id,
            asset.deleted_at,
            count(document.id)::integer AS linked_source_documents
        FROM assets AS asset
        LEFT JOIN source_documents AS document ON document.asset_id = asset.id
        WHERE asset.storage_key = ANY($1::text[])
        GROUP BY asset.id
        ORDER BY asset.storage_key
    `, [quarantineKeys]);
    invariant(quarantineResult.rows.length === quarantineKeys.length, "QUARANTINE_ASSET_COUNT_MISMATCH", "找不到全部隔離原始 Word 資產。", { actual: quarantineResult.rows.length });
    for (const row of quarantineResult.rows) {
        invariant(row.purpose === "source_document" && row.sensitivity === "private" && row.scan_status === "rejected" && row.deleted_at === null, "QUARANTINE_ASSET_STATE_MISMATCH", "原始 Word 資產必須維持 rejected/private 隔離狀態。");
        invariant(row.created_by_user_id === HANLIN_IMPORT_PRINCIPAL.userId, "QUARANTINE_ASSET_CREATOR_MISMATCH", "隔離原檔不是由固定匯入服務建立。");
        invariant(numberValue(row.byte_size) > 0 && SHA256_PATTERN.test(row.checksum), "QUARANTINE_ASSET_METADATA_INVALID", "隔離原檔缺少有效雜湊或大小。");
        invariant(row.checksum === AUTHORIZED_FOURTH_LESSON_SHA256, "QUARANTINE_SOURCE_CHECKSUM_MISMATCH", "隔離原檔不是已核准的第四課原檔內容。");
        invariant(row.storage_key === `quarantine/source-documents/${row.checksum}.doc`, "QUARANTINE_CHECKSUM_MISMATCH", "隔離原檔 storage_key 與 SHA-256 不一致。");
        invariant(row.linked_source_documents === 0, "QUARANTINE_ASSET_LINKED", "rejected 原檔不得被 source_documents 引用。");
        invariant(!isAbsoluteOrPrivateString(row.storage_key), "QUARANTINE_STORAGE_KEY_UNSAFE", "隔離原檔 storage_key 含絕對路徑或 email。");
    }

    const classificationResult = await client.query(`
        SELECT
            candidate.source_document_id,
            count(*) FILTER (
                WHERE candidate.dimension = 'unit'
                    AND candidate.review_status = 'pending'
                    AND candidate.raw_value <> ''
                    AND num_nonnulls(
                        candidate.publisher_id,
                        candidate.subject_id,
                        candidate.grade_id,
                        candidate.semester_id,
                        candidate.book_version_id,
                        candidate.exam_program_id,
                        candidate.exam_program_level_id,
                        candidate.curriculum_unit_id,
                        candidate.curriculum_code_id,
                        candidate.source_category_id
                    ) = 0
            )::integer AS original_unit_candidates,
            array_agg(candidate.raw_value) FILTER (
                WHERE candidate.dimension = 'unit' AND candidate.review_status = 'pending'
            ) AS original_unit_values,
            array_agg(DISTINCT candidate.dimension) FILTER (WHERE candidate.review_status = 'approved') AS approved_dimensions,
            count(*) FILTER (
                WHERE candidate.dimension = 'unit'
                    AND candidate.review_status = 'approved'
                    AND target_unit.name = '第四課'
            )::integer AS fourth_lesson_candidates
        FROM source_document_classification_candidates AS candidate
        LEFT JOIN curriculum_units AS target_unit ON target_unit.id = candidate.curriculum_unit_id
        WHERE candidate.source_document_id = ANY($1::uuid[])
        GROUP BY candidate.source_document_id
    `, [[...documentIds]]);
    const expectedDimensions = ["book_version", "grade", "publisher", "semester", "source_category", "subject", "unit"];
    invariant(classificationResult.rows.length === documents.length, "CLASSIFICATION_DOCUMENT_COUNT_MISMATCH", "來源分類候選沒有涵蓋全部來源文件。");
    for (const row of classificationResult.rows) {
        invariant(row.original_unit_candidates >= 1, "ORIGINAL_UNIT_METADATA_MISSING", "來源文件未保留原課次候選 metadata。");
        invariant((row.original_unit_values ?? []).every((value) => !isAbsoluteOrPrivateString(value)), "ORIGINAL_UNIT_METADATA_UNSAFE", "原課次候選含絕對路徑或 email metadata。");
        invariant(row.fourth_lesson_candidates >= 1, "FOURTH_LESSON_CANDIDATE_MISSING", "來源文件缺少已核准的第四課分類。");
        const dimensions = [...(row.approved_dimensions ?? [])].sort();
        invariant(expectedDimensions.every((dimension) => dimensions.includes(dimension)), "APPROVED_CLASSIFICATION_INCOMPLETE", "來源文件的正式分類候選不完整。", { dimensions });
    }

    const targetResult = (await client.query(`
        WITH linked AS (
            SELECT DISTINCT item.question_id, item.question_revision_id
            FROM import_items AS item
            WHERE item.import_batch_id = $1
                AND item.review_status = 'approved'
        ), target AS (
            SELECT
                linked.question_id,
                linked.question_revision_id,
                question.status AS question_status,
                question.origin AS question_origin,
                question.owner_user_id AS question_owner_user_id,
                question.created_by_user_id AS question_created_by_user_id,
                question.current_revision_id,
                revision.status AS revision_status,
                grade.name AS grade_name,
                subject.name AS subject_name,
                semester.name AS semester_name,
                publisher.name AS publisher_name,
                book_version.name AS book_version_name,
                count(revision_unit.*) FILTER (WHERE revision_unit.is_primary)::integer AS primary_unit_count,
                max(unit.name) FILTER (WHERE revision_unit.is_primary) AS primary_unit_name,
                max(parent_unit.name) FILTER (WHERE revision_unit.is_primary) AS primary_parent_name,
                bool_and(
                    NOT revision_unit.is_primary
                    OR (
                        revision_unit.assignment_type = 'manual_classification'
                        AND revision_unit.value_source = 'user'
                    )
                ) AS primary_assignment_valid
            FROM linked
            JOIN questions AS question ON question.id = linked.question_id
            JOIN question_revisions AS revision
                ON revision.id = linked.question_revision_id
                AND revision.question_id = linked.question_id
            JOIN grades AS grade ON grade.id = revision.grade_id
            JOIN subjects AS subject ON subject.id = revision.subject_id
            LEFT JOIN semesters AS semester ON semester.id = revision.semester_id
            JOIN book_versions AS book_version ON book_version.id = revision.book_version_id
            LEFT JOIN publishers AS publisher ON publisher.id = book_version.publisher_id
            LEFT JOIN question_revision_units AS revision_unit ON revision_unit.question_revision_id = revision.id
            LEFT JOIN curriculum_units AS unit ON unit.id = revision_unit.curriculum_unit_id
            LEFT JOIN curriculum_units AS parent_unit ON parent_unit.id = unit.parent_unit_id
            GROUP BY
                linked.question_id,
                linked.question_revision_id,
                question.status,
                question.origin,
                question.owner_user_id,
                question.created_by_user_id,
                question.current_revision_id,
                revision.status,
                grade.name,
                subject.name,
                semester.name,
                publisher.name,
                book_version.name
        )
        SELECT
            count(*)::integer AS revision_count,
            count(*) FILTER (
                WHERE question_status <> 'published'
                    OR question_origin <> 'system'
                    OR question_owner_user_id IS NOT NULL
                    OR question_created_by_user_id <> $2
                    OR revision_status <> 'published'
                    OR current_revision_id <> question_revision_id
                    OR primary_unit_count <> 1
                    OR primary_unit_name <> '第四課'
                    OR primary_parent_name <> '第一冊'
                    OR grade_name <> '國一'
                    OR subject_name NOT IN ('國文', '國語')
                    OR semester_name <> '上學期'
                    OR publisher_name <> '翰林'
                    OR book_version_name NOT LIKE '%第一冊%'
                    OR primary_assignment_valid IS NOT TRUE
            )::integer AS violation_count
        FROM target
    `, [batch.id, HANLIN_IMPORT_PRINCIPAL.userId])).rows[0];
    invariant(targetResult.revision_count === EXPECTED_IMPORT.approved, "PUBLISHED_IMPORT_COUNT_MISMATCH", "已發布題目版本數與核准匯入項目數不一致。", {
        expected: EXPECTED_IMPORT.approved,
        actual: targetResult.revision_count,
    });
    invariant(targetResult.violation_count === 0, "PUBLISHED_TARGET_MISMATCH", "至少一個已發布版本沒有完整指向國一／國文／翰林／第一冊／第四課。", {
        revisionCount: targetResult.revision_count,
        violationCount: targetResult.violation_count,
    });

    const sourceLinkResult = (await client.query(`
        WITH item_links AS (
            SELECT
                item.id,
                item.review_status,
                count(source.id) FILTER (
                    WHERE source.source_document_id = item.source_document_id
                        AND source.question_revision_id = item.question_revision_id
                )::integer AS valid_links
            FROM import_items AS item
            LEFT JOIN question_revision_sources AS source ON source.import_item_id = item.id
            WHERE item.import_batch_id = $1
            GROUP BY item.id
        ), imported_revisions AS (
            SELECT DISTINCT question_revision_id
            FROM import_items
            WHERE import_batch_id = $1 AND review_status = 'approved'
        ), source_primary_counts AS (
            SELECT
                revision.question_revision_id,
                count(source.id) FILTER (WHERE source.is_primary)::integer AS primary_count
            FROM imported_revisions AS revision
            LEFT JOIN question_revision_sources AS source
                ON source.question_revision_id = revision.question_revision_id
            GROUP BY revision.question_revision_id
        )
        SELECT
            count(*) FILTER (WHERE item_links.review_status = 'approved')::integer AS approved_items,
            count(*) FILTER (
                WHERE item_links.review_status = 'approved' AND item_links.valid_links = 1
            )::integer AS valid_item_links,
            count(*) FILTER (
                WHERE item_links.review_status <> 'approved' AND item_links.valid_links <> 0
            )::integer AS unapproved_links,
            (SELECT count(*)::integer FROM source_primary_counts WHERE primary_count <> 1)
                AS primary_source_violations
        FROM item_links
    `, [batch.id])).rows[0];
    invariant(sourceLinkResult.valid_item_links === sourceLinkResult.approved_items, "REVISION_SOURCE_LINK_MISMATCH", "核准匯入項目沒有逐筆保留唯一來源關聯。", sourceLinkResult);
    invariant(sourceLinkResult.unapproved_links === 0, "UNAPPROVED_SOURCE_LINK_FOUND", "待核對或拒絕項目不應有題目來源關聯。");
    invariant(sourceLinkResult.primary_source_violations === 0, "REVISION_PRIMARY_SOURCE_MISMATCH", "每個匯入題目版本必須恰有一個 primary 來源。");

    return {
        summary: {
            batchId: batch.id,
            status: batch.status,
            matchingBatchCount,
            sourceDocuments: documents.length,
            sanitizedSourceAssets: documents.length,
            quarantinedOriginalAssets: quarantineResult.rows.length,
            items: { total: items.length, ...itemCounts },
            publishedRevisions: targetResult.revision_count,
            originalUnitMetadataDocuments: classificationResult.rows.length,
            ownership: {
                importPrincipalUserId: HANLIN_IMPORT_PRINCIPAL.userId,
                importPrincipalRoleCount: principalResult.role_count,
                questionBankOrigin: batch.question_bank_origin,
                questionBankOwnerUserId: batch.question_bank_owner_user_id,
                importBatchLearnerId: batch.learner_id,
                authenticatedLearnerMembership: authenticatedMembershipCount === 1,
            },
        },
        publishedRevisionIds: unique(items
            .filter((item) => item.review_status === "approved")
            .map((item) => item.question_revision_id)),
    };
}

async function loadQuestions(api) {
    const questions = [];
    const seen = new Set();
    let page = 1;
    let total = null;
    let responseCount = 0;
    while (total === null || questions.length < total) {
        invariant(page <= 10_000, "QUESTION_PAGINATION_OVERFLOW", "題庫分頁超出安全上限。");
        const query = new URLSearchParams({
            grade: "國一",
            subject: "國文",
            publisher: "翰林",
            volume: "第一冊",
            lesson: "第四課",
            page: String(page),
            limit: "100",
        });
        const { body } = await api.request(`/api/v1/local-practice/questions?${query}`);
        const pageQuestions = body?.data?.questions;
        invariant(Array.isArray(pageQuestions), "QUESTION_API_SHAPE_INVALID", "題庫 API 缺少 questions 陣列。");
        invariant(
            body?.meta?.persistence === "local-postgresql" && body?.meta?.identityMode === "authenticated",
            "QUESTION_API_META_INVALID",
            "題庫 API 未使用已登入的本機 PostgreSQL 身分。",
        );
        const pageTotal = Number(body?.meta?.total);
        invariant(Number.isSafeInteger(pageTotal) && pageTotal >= 0, "QUESTION_API_TOTAL_INVALID", "題庫 API total 無效。");
        if (total === null) total = pageTotal;
        invariant(pageTotal === total, "QUESTION_API_TOTAL_CHANGED", "讀取題庫分頁時 total 發生變化。");
        const leaks = scanForbiddenKeys(pageQuestions, `questionsPage:${page}`);
        invariant(leaks.length === 0, "QUESTION_API_LEAK", "題庫 API 洩漏答案、解析、解釋或 storage key。", { locations: leaks.slice(0, 10) });
        for (const question of pageQuestions) {
            invariant(isRecord(question) && UUID_PATTERN.test(question.id) && UUID_PATTERN.test(question.revisionId), "QUESTION_API_ITEM_INVALID", "題庫 API 含無效題目識別碼。");
            invariant(!seen.has(question.id), "QUESTION_API_DUPLICATE", "題庫 API 分頁回傳重複題目。");
            invariant(question.unit?.name === "第四課", "QUESTION_API_UNIT_MISMATCH", "題庫 API 回傳非第四課題目。");
            invariant(Array.isArray(question.parts) && question.parts.length > 0, "QUESTION_API_PARTS_MISSING", "題庫 API 題目沒有可作答小題。");
            seen.add(question.id);
            questions.push(question);
        }
        responseCount += 1;
        if (pageQuestions.length === 0) break;
        page += 1;
    }
    invariant(total !== null && total > 0 && questions.length === total, "QUESTION_API_EMPTY_OR_INCOMPLETE", "第四課題庫 API 沒有完整回傳可作答題目。", {
        total,
        loaded: questions.length,
    });
    return { questions, pageCount: responseCount, total };
}

async function loadGradeDefinitions(client, questions) {
    const partIds = questions.flatMap((question) => question.parts.map((part) => part.id));
    invariant(partIds.length > 0 && partIds.every((id) => UUID_PATTERN.test(id)), "QUESTION_PART_IDS_INVALID", "題庫 API 的小題識別碼無效。");
    const rows = (await client.query(`
        SELECT
            part.id,
            part.question_revision_id,
            part.answer_mode,
            part.grading_policy,
            answer.answer_key,
            answer.accepted_value,
            answer.position AS answer_position
        FROM question_parts AS part
        LEFT JOIN question_answers AS answer ON answer.question_part_id = part.id
        WHERE part.id = ANY($1::uuid[])
        ORDER BY part.id, answer.position, answer.id
    `, [partIds])).rows;
    const definitions = new Map();
    for (const row of rows) {
        const current = definitions.get(row.id) ?? {
            revisionId: row.question_revision_id,
            answerMode: row.answer_mode,
            gradingPolicy: row.grading_policy,
            acceptedKeys: [],
            acceptedValues: [],
        };
        if (row.answer_key !== null) current.acceptedKeys.push(row.answer_key);
        if (row.accepted_value !== null) current.acceptedValues.push(row.accepted_value);
        definitions.set(row.id, current);
    }
    invariant(partIds.every((id) => definitions.has(id)), "QUESTION_PART_DATABASE_MISMATCH", "題庫 API 的小題在資料庫中不存在。");
    return definitions;
}

function definitionIsCompleteAutomatic(definition) {
    if (definition.gradingPolicy !== "automatic") return false;
    const keys = unique(definition.acceptedKeys.map(normalize).filter(Boolean));
    const values = unique(definition.acceptedValues.map(normalize).filter(Boolean));
    if (definition.answerMode === "multiple_choice") return keys.length > 0;
    if (["single_choice", "boolean"].includes(definition.answerMode)) return keys.length === 1;
    return values.length > 0;
}

function correctValue(definition) {
    if (definition.answerMode === "multiple_choice") return unique(definition.acceptedKeys.map(normalize).filter(Boolean));
    if (["single_choice", "boolean"].includes(definition.answerMode)) return definition.acceptedKeys[0];
    return definition.acceptedValues[0];
}

function pendingValue(part) {
    const firstOptionKey = part.options.find((option) => typeof option.key === "string" && normalize(option.key) !== "")?.key;
    if (part.answerMode === "multiple_choice") return firstOptionKey ? [firstOptionKey] : null;
    if (["single_choice", "boolean"].includes(part.answerMode)) return firstOptionKey ?? null;
    return "待人工核對測試";
}

function selectAttemptCases(questions, definitions) {
    let wrongCase = null;
    for (const question of questions) {
        if (!question.parts.every((part) => definitionIsCompleteAutomatic(definitions.get(part.id)))) continue;
        const targetPart = question.parts.find((part) => {
            if (part.answerMode !== "single_choice" || part.options.length < 2) return false;
            const accepted = new Set(definitions.get(part.id).acceptedKeys.map(normalize));
            return part.options.some((option) => typeof option.key === "string" && normalize(option.key) !== "" && !accepted.has(normalize(option.key)));
        });
        if (!targetPart) continue;
        const accepted = new Set(definitions.get(targetPart.id).acceptedKeys.map(normalize));
        const wrongOption = targetPart.options.find((option) => typeof option.key === "string" && normalize(option.key) !== "" && !accepted.has(normalize(option.key)));
        const correctAnswers = question.parts.map((part) => ({
            partId: part.id,
            value: correctValue(definitions.get(part.id)),
        }));
        const wrongAnswers = question.parts.map((part) => ({
            partId: part.id,
            value: part.id === targetPart.id ? wrongOption.key : correctValue(definitions.get(part.id)),
        }));
        wrongCase = { question, targetPartId: targetPart.id, correctAnswers, wrongAnswers };
        break;
    }
    invariant(wrongCase !== null, "AUTOMATIC_SINGLE_CHOICE_NOT_FOUND", "找不到可用有效錯誤選項驗證自動批改的單選題。");

    let missingKeyCase = null;
    for (const question of questions) {
        const missingKeyParts = question.parts.filter((part) => {
            const definition = definitions.get(part.id);
            return definition.gradingPolicy === "automatic" && !definitionIsCompleteAutomatic(definition);
        });
        if (missingKeyParts.length === 0) continue;
        const answers = [];
        let selectable = true;
        for (const part of question.parts) {
            const definition = definitions.get(part.id);
            const value = definitionIsCompleteAutomatic(definition) ? correctValue(definition) : pendingValue(part);
            if (value === null) {
                selectable = false;
                break;
            }
            answers.push({ partId: part.id, value });
        }
        if (!selectable) continue;
        missingKeyCase = { question, missingKeyPartIds: new Set(missingKeyParts.map((part) => part.id)), answers };
        break;
    }
    return { wrongCase, missingKeyCase };
}

async function createSession(api, questionIds) {
    const { body, status } = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIds }),
    }, [201]);
    const session = body?.data?.session;
    const leaks = scanForbiddenKeys(body?.data, "session");
    invariant(leaks.length === 0, "SESSION_API_LEAK", "session API 洩漏答案、解析或 storage key。", { locations: leaks.slice(0, 10) });
    invariant(status === 201 && isRecord(session) && UUID_PATTERN.test(session.id), "SESSION_API_SHAPE_INVALID", "建立練習未回傳有效 session。");
    invariant(Array.isArray(session.items) && session.items.length === questionIds.length, "SESSION_ITEM_COUNT_MISMATCH", "session 題目數量不符。");
    invariant(
        body?.meta?.persistence === "local-postgresql" && body?.meta?.identityMode === "authenticated",
        "SESSION_API_META_INVALID",
        "session 未使用已登入的本機 PostgreSQL 身分。",
    );
    return session;
}

async function submitAttempt(api, body, expectedStatuses) {
    const response = await api.request("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }, expectedStatuses);
    const attempt = response.body?.data?.attempt;
    const leaks = scanForbiddenKeys(response.body?.data, "attempt");
    invariant(leaks.length === 0, "ATTEMPT_API_LEAK", "作答 API 洩漏答案內容或 storage key。", { locations: leaks.slice(0, 10) });
    invariant(isRecord(attempt) && UUID_PATTERN.test(attempt.id), "ATTEMPT_API_SHAPE_INVALID", "作答 API 未回傳有效 attempt。");
    invariant(Array.isArray(attempt.parts), "ATTEMPT_PARTS_INVALID", "作答 API 未回傳小題結果。");
    return { ...response, attempt };
}

async function attemptDatabaseState(client, learnerId, attemptId, idempotencyKey) {
    const result = (await client.query(`
        SELECT
            count(DISTINCT attempt.id)::integer AS attempts,
            count(DISTINCT part.id)::integer AS part_results,
            count(DISTINCT part.id) FILTER (WHERE part.current_result = 'wrong')::integer AS wrong_parts,
            count(DISTINCT part.id) FILTER (WHERE part.current_result = 'pending')::integer AS pending_parts,
            count(DISTINCT queue.id)::integer AS wrong_queue_items,
            count(DISTINCT outbox.id)::integer AS outbox_events
        FROM answer_attempts AS attempt
        LEFT JOIN answer_part_results AS part ON part.answer_attempt_id = attempt.id
        LEFT JOIN learner_practice_queue_items AS queue
            ON queue.source_answer_part_result_id = part.id
            AND queue.reason = 'wrong_review'
        LEFT JOIN analytics_outbox AS outbox
            ON outbox.source_record_id = attempt.id
            AND outbox.event_type = 'attempt_submitted'
        WHERE attempt.id = $1
            AND attempt.learner_id = $2
            AND attempt.idempotency_key = $3
    `, [attemptId, learnerId, idempotencyKey])).rows[0];
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, numberValue(value)]));
}

async function verifyAttemptFlow(client, api, questions, definitions) {
    const { wrongCase, missingKeyCase } = selectAttemptCases(questions, definitions);
    const runToken = `${Date.now().toString(36)}:${randomUUID()}`;

    const correctSession = await createSession(api, [wrongCase.question.id]);
    const correctRequest = {
        sessionId: correctSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:correct:${runToken}`,
        durationSeconds: 2,
        answers: wrongCase.correctAnswers,
    };
    const correctResponse = await submitAttempt(api, correctRequest, [201]);
    invariant(correctResponse.status === 201 && correctResponse.body?.meta?.replayed === false, "CORRECT_ATTEMPT_NOT_CREATED", "完整正解第一次送出必須建立新紀錄。");
    invariant(correctResponse.attempt.overallResult === "correct" && correctResponse.attempt.gradingSource === "automatic", "CORRECT_ATTEMPT_RESULT_MISMATCH", "完整標準答案沒有得到 automatic/correct 結果。");
    invariant(correctResponse.attempt.parts.length === wrongCase.question.parts.length, "CORRECT_PART_COUNT_MISMATCH", "完整正解結果沒有涵蓋全部可作答小題。");
    invariant(correctResponse.attempt.parts.every((part) => (
        part.result === "correct"
        && part.gradingSource === "automatic"
        && part.feedbackCode === "correct"
    )), "CORRECT_PART_RESULT_MISMATCH", "至少一個完整標準答案小題未被自動判為 correct。");
    invariant(correctResponse.body?.data?.session?.status === "completed", "CORRECT_SESSION_NOT_COMPLETED", "完整正解送出後 session 未完成。");
    const correctState = await attemptDatabaseState(client, api.learnerId, correctResponse.attempt.id, correctRequest.idempotencyKey);
    invariant(
        correctState.attempts === 1
            && correctState.part_results === wrongCase.question.parts.length
            && correctState.wrong_parts === 0
            && correctState.pending_parts === 0,
        "CORRECT_ATTEMPT_DATABASE_MISMATCH",
        "完整正解的持久判分結果不正確。",
        correctState,
    );
    invariant(correctState.wrong_queue_items === 0 && correctState.outbox_events === 1, "CORRECT_SIDE_EFFECT_MISMATCH", "完整正解不得建立錯題佇列，但必須建立 outbox。");

    const wrongSession = await createSession(api, [wrongCase.question.id]);
    const wrongRequest = {
        sessionId: wrongSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:wrong:${runToken}`,
        durationSeconds: 3,
        answers: wrongCase.wrongAnswers,
    };
    const wrongResponse = await submitAttempt(api, wrongRequest, [201]);
    invariant(wrongResponse.status === 201 && wrongResponse.body?.meta?.replayed === false, "WRONG_ATTEMPT_NOT_CREATED", "錯題作答第一次送出必須建立新紀錄。");
    invariant(wrongResponse.attempt.overallResult === "wrong", "WRONG_ATTEMPT_RESULT_MISMATCH", "刻意提交的有效錯誤選項沒有得到 wrong 結果。");
    const wrongPart = wrongResponse.attempt.parts.find((part) => part.partId === wrongCase.targetPartId);
    invariant(wrongPart?.result === "wrong" && wrongPart?.gradingSource === "automatic" && wrongPart?.feedbackCode === "wrong", "WRONG_PART_RESULT_MISMATCH", "目標單選小題沒有由自動批改判為 wrong。");
    invariant(wrongResponse.attempt.parts.length === wrongCase.question.parts.length, "WRONG_PART_COUNT_MISMATCH", "錯題作答結果沒有涵蓋全部可作答小題。");
    invariant(wrongResponse.attempt.parts.every((part) => (
        part.partId === wrongCase.targetPartId
        || (part.result === "correct" && part.gradingSource === "automatic" && part.feedbackCode === "correct")
    )), "WRONG_ATTEMPT_CORRECT_PART_MISMATCH", "刻意答錯以外的小題未依完整標準答案判為 correct。");
    invariant(wrongResponse.body?.data?.session?.status === "completed", "WRONG_SESSION_NOT_COMPLETED", "錯題送出後 session 未完成。");
    const stateBeforeReplay = await attemptDatabaseState(client, api.learnerId, wrongResponse.attempt.id, wrongRequest.idempotencyKey);
    invariant(
        stateBeforeReplay.attempts === 1
            && stateBeforeReplay.part_results === wrongCase.question.parts.length
            && stateBeforeReplay.wrong_parts === 1
            && stateBeforeReplay.pending_parts === 0,
        "WRONG_ATTEMPT_DATABASE_MISSING",
        "錯題作答沒有完整寫入資料庫，或非目標小題被錯判。",
        stateBeforeReplay,
    );
    invariant(stateBeforeReplay.wrong_queue_items === stateBeforeReplay.wrong_parts, "WRONG_QUEUE_COUNT_MISMATCH", "每個 wrong 小題都必須建立一筆錯題佇列。");
    invariant(stateBeforeReplay.outbox_events === 1, "WRONG_OUTBOX_MISSING", "錯題作答缺少 attempt_submitted outbox 事件。");

    const replay = await submitAttempt(api, wrongRequest, [200]);
    invariant(replay.status === 200 && replay.body?.meta?.replayed === true && replay.attempt.id === wrongResponse.attempt.id, "IDEMPOTENCY_REPLAY_MISMATCH", "相同冪等請求沒有重播原作答。");
    const stateAfterReplay = await attemptDatabaseState(client, api.learnerId, wrongResponse.attempt.id, wrongRequest.idempotencyKey);
    invariant(JSON.stringify(stateAfterReplay) === JSON.stringify(stateBeforeReplay), "IDEMPOTENCY_DUPLICATED_ROWS", "冪等重送產生了重複 attempt、queue 或 outbox。");
    const conflict = await api.request("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...wrongRequest, durationSeconds: wrongRequest.durationSeconds + 1 }),
    }, [409]);
    invariant(conflict.body?.error?.code === "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_CONFLICT_MISSING", "同一冪等鍵搭配不同內容必須回傳 409 conflict。");

    const missingAnswerSession = await createSession(api, [wrongCase.question.id]);
    const missingAnswerRequest = {
        sessionId: missingAnswerSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:missing-answer:${runToken}`,
        durationSeconds: 1,
        answers: [],
    };
    const missingAnswerResponse = await submitAttempt(api, missingAnswerRequest, [201]);
    invariant(missingAnswerResponse.attempt.overallResult === "pending", "MISSING_ANSWER_RESULT_MISMATCH", "未作答的自動判分題沒有保持 pending。");
    invariant(missingAnswerResponse.attempt.parts.length === wrongCase.question.parts.length, "MISSING_ANSWER_PART_COUNT_MISMATCH", "未作答結果沒有涵蓋全部可作答小題。");
    invariant(missingAnswerResponse.attempt.parts.every((part) => (
        part.result === "pending"
        && part.gradingSource === "automatic"
        && part.feedbackCode === "missing_answer"
    )), "MISSING_ANSWER_PART_RESULT_MISMATCH", "未作答小題沒有以 missing_answer 保持 automatic/pending。");
    invariant(missingAnswerResponse.body?.data?.session?.status === "completed", "MISSING_ANSWER_SESSION_NOT_COMPLETED", "未作答送出後 session 未完成。");
    const missingAnswerState = await attemptDatabaseState(client, api.learnerId, missingAnswerResponse.attempt.id, missingAnswerRequest.idempotencyKey);
    invariant(
        missingAnswerState.attempts === 1
            && missingAnswerState.part_results === wrongCase.question.parts.length
            && missingAnswerState.pending_parts === wrongCase.question.parts.length
            && missingAnswerState.wrong_parts === 0,
        "MISSING_ANSWER_DATABASE_MISMATCH",
        "未作答的持久 pending 結果不正確。",
        missingAnswerState,
    );
    invariant(missingAnswerState.wrong_queue_items === 0 && missingAnswerState.outbox_events === 1, "MISSING_ANSWER_SIDE_EFFECT_MISMATCH", "未作答不得建立錯題佇列，但必須建立 outbox。");

    let missingKeySummary = { status: "not_available", reason: "no-selectable-automatic-missing-key" };
    const attemptIds = [correctResponse.attempt.id, wrongResponse.attempt.id, missingAnswerResponse.attempt.id];
    let missingKeySessionId = null;
    if (missingKeyCase) {
        const missingKeySession = await createSession(api, [missingKeyCase.question.id]);
        missingKeySessionId = missingKeySession.id;
        const missingKeyRequest = {
            sessionId: missingKeySession.id,
            questionId: missingKeyCase.question.id,
            idempotencyKey: `local-practice-verify:missing-key:${runToken}`,
            durationSeconds: 4,
            answers: missingKeyCase.answers,
        };
        const missingKeyResponse = await submitAttempt(api, missingKeyRequest, [201]);
        invariant(missingKeyResponse.attempt.overallResult === "pending", "MISSING_KEY_ATTEMPT_RESULT_MISMATCH", "缺少完整自動答案鍵的題目沒有保持 pending。");
        invariant(missingKeyResponse.attempt.parts.every((part) => part.result !== "wrong"), "MISSING_KEY_ATTEMPT_CREATED_WRONG", "答案鍵不完整的題目被誤判為 wrong。");
        invariant(missingKeyResponse.attempt.parts.some((part) => (
            missingKeyCase.missingKeyPartIds.has(part.partId)
            && part.result === "pending"
            && part.gradingSource === "automatic"
            && part.feedbackCode === "missing_answer_key"
        )), "MISSING_KEY_PART_RESULT_MISSING", "自動判分但答案鍵不完整的小題沒有以 missing_answer_key 保持 pending。");
        invariant(missingKeyResponse.attempt.parts.length === missingKeyCase.question.parts.length, "MISSING_KEY_PART_COUNT_MISMATCH", "答案鍵不完整的作答結果沒有涵蓋全部可作答小題。");
        invariant(missingKeyResponse.body?.data?.session?.status === "completed", "MISSING_KEY_SESSION_NOT_COMPLETED", "答案鍵不完整的題目送出後 session 未完成。");
        const missingKeyState = await attemptDatabaseState(client, api.learnerId, missingKeyResponse.attempt.id, missingKeyRequest.idempotencyKey);
        invariant(missingKeyState.attempts === 1 && missingKeyState.pending_parts >= 1 && missingKeyState.wrong_parts === 0, "MISSING_KEY_ATTEMPT_DATABASE_MISMATCH", "答案鍵不完整作答的持久結果不正確。");
        invariant(missingKeyState.wrong_queue_items === 0 && missingKeyState.outbox_events === 1, "MISSING_KEY_SIDE_EFFECT_MISMATCH", "答案鍵不完整的作答不得建立錯題佇列，但必須建立 outbox。");
        attemptIds.push(missingKeyResponse.attempt.id);
        missingKeySummary = {
            status: "verified",
            attemptId: missingKeyResponse.attempt.id,
            pendingParts: missingKeyState.pending_parts,
            wrongQueueItems: missingKeyState.wrong_queue_items,
        };
    }

    const { body: historyBody } = await api.request("/api/v1/local-practice/history?limit=100");
    const historyLeaks = scanForbiddenKeys(historyBody?.data, "history");
    invariant(historyLeaks.length === 0, "HISTORY_API_LEAK", "歷史 API 洩漏作答內容或答案。", { locations: historyLeaks.slice(0, 10) });
    const historyAttempts = historyBody?.data?.attempts;
    const queueItems = historyBody?.data?.wrongReviewQueue?.items;
    invariant(Array.isArray(historyAttempts) && attemptIds.every((id) => historyAttempts.some((attempt) => attempt.id === id)), "HISTORY_ATTEMPT_MISSING", "歷史 API 找不到剛建立的作答。");
    invariant(Array.isArray(queueItems) && queueItems.some((item) => item.questionId === wrongCase.question.id), "HISTORY_WRONG_QUEUE_MISSING", "歷史 API 找不到剛建立的錯題佇列。");

    return {
        sessionIds: {
            correct: correctSession.id,
            wrong: wrongSession.id,
            missingAnswer: missingAnswerSession.id,
            missingKey: missingKeySessionId,
        },
        correctAttempt: {
            attemptId: correctResponse.attempt.id,
            result: correctResponse.attempt.overallResult,
            correctParts: correctState.part_results,
            wrongQueueItems: correctState.wrong_queue_items,
            outboxEvents: correctState.outbox_events,
        },
        wrongAttempt: {
            attemptId: wrongResponse.attempt.id,
            result: wrongResponse.attempt.overallResult,
            wrongParts: stateAfterReplay.wrong_parts,
            wrongQueueItems: stateAfterReplay.wrong_queue_items,
            outboxEvents: stateAfterReplay.outbox_events,
            idempotencyReplay: true,
        },
        missingAnswerAttempt: {
            attemptId: missingAnswerResponse.attempt.id,
            result: missingAnswerResponse.attempt.overallResult,
            pendingParts: missingAnswerState.pending_parts,
            wrongQueueItems: missingAnswerState.wrong_queue_items,
            outboxEvents: missingAnswerState.outbox_events,
        },
        missingKeyAttempt: missingKeySummary,
        attemptIds,
        historyVisible: true,
    };
}

function normalizedTimestamp(value, code, message) {
    if (value === undefined) return undefined;
    invariant(typeof value === "string" && value.trim() !== "", code, message);
    const milliseconds = Date.parse(value);
    invariant(Number.isFinite(milliseconds), code, message);
    return new Date(milliseconds).toISOString();
}

async function readPersistenceEvidence() {
    const direct = readOptionalEnvironment("PERSISTED_ATTEMPT_IDS");
    const directDatabaseStartedAt = normalizedTimestamp(
        readOptionalEnvironment("PERSISTED_DATABASE_STARTED_AT"),
        "PERSISTED_DATABASE_START_INVALID",
        "PERSISTED_DATABASE_STARTED_AT 必須是有效時間。",
    );
    const fileName = readOptionalEnvironment("PERSISTED_ATTEMPT_IDS_FILE");
    const collected = [];
    const databaseStartTimes = [];
    if (direct !== undefined) collected.push(...direct.split(/[\s,]+/u).filter(Boolean));
    if (directDatabaseStartedAt !== undefined) databaseStartTimes.push(directDatabaseStartedAt);
    if (fileName !== undefined) {
        const raw = await readFile(path.resolve(fileName), "utf8");
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            parsed = raw.split(/[\s,]+/u).filter(Boolean);
        }
        const ids = Array.isArray(parsed) ? parsed : parsed?.persistence?.attemptIds;
        invariant(Array.isArray(ids), "PERSISTENCE_FILE_INVALID", "PERSISTED_ATTEMPT_IDS_FILE 必須是 UUID 陣列，或含 persistence.attemptIds 的驗證 JSON。");
        collected.push(...ids);
        if (!Array.isArray(parsed)) {
            const fileDatabaseStartedAt = normalizedTimestamp(
                parsed?.persistence?.databaseStartedAt ?? parsed?.database?.serverStartedAt,
                "PERSISTENCE_FILE_START_INVALID",
                "PERSISTED_ATTEMPT_IDS_FILE 的資料庫啟動時間無效。",
            );
            if (fileDatabaseStartedAt !== undefined) databaseStartTimes.push(fileDatabaseStartedAt);
        }
    }
    const ids = unique(collected);
    invariant(ids.every((id) => typeof id === "string" && UUID_PATTERN.test(id)), "PERSISTED_ATTEMPT_ID_INVALID", "重啟驗證的 attempt ID 必須全部是 UUID。");
    const uniqueDatabaseStartTimes = unique(databaseStartTimes);
    invariant(uniqueDatabaseStartTimes.length <= 1, "PERSISTENCE_START_CONFLICT", "重啟驗證提供了互相衝突的資料庫啟動時間。");
    return {
        attemptIds: ids,
        databaseStartedAt: uniqueDatabaseStartTimes[0],
    };
}

async function verifyPersistedAttempts(client, api, attemptIds, previousDatabaseStartedAt, currentDatabaseStartedAt) {
    invariant(attemptIds.length > 0, "PERSISTED_ATTEMPT_IDS_REQUIRED", "VERIFY_PERSISTENCE_ONLY 需要 PERSISTED_ATTEMPT_IDS 或 PERSISTED_ATTEMPT_IDS_FILE。");
    invariant(previousDatabaseStartedAt !== undefined, "PERSISTED_DATABASE_START_REQUIRED", "重啟驗證需要先前完整驗證輸出的 databaseStartedAt；請使用 PERSISTED_ATTEMPT_IDS_FILE，或提供 PERSISTED_DATABASE_STARTED_AT。");
    invariant(
        Date.parse(currentDatabaseStartedAt) > Date.parse(previousDatabaseStartedAt),
        "DATABASE_RESTART_NOT_OBSERVED",
        "PostgreSQL 啟動時間沒有晚於第一次驗證；必須先停止並重新啟動本機資料庫。",
        { previousDatabaseStartedAt, currentDatabaseStartedAt },
    );
    const rows = (await client.query(`
        SELECT
            attempt.id,
            attempt.learner_id,
            attempt.overall_result,
            count(DISTINCT part.id)::integer AS part_results,
            count(DISTINCT part.id) FILTER (WHERE part.current_result = 'wrong')::integer AS wrong_parts,
            count(DISTINCT part.id) FILTER (WHERE part.current_result = 'pending')::integer AS pending_parts,
            count(DISTINCT queue.id)::integer AS wrong_queue_items,
            count(DISTINCT outbox.id)::integer AS outbox_events
        FROM answer_attempts AS attempt
        LEFT JOIN answer_part_results AS part ON part.answer_attempt_id = attempt.id
        LEFT JOIN learner_practice_queue_items AS queue ON queue.source_answer_part_result_id = part.id
        LEFT JOIN analytics_outbox AS outbox
            ON outbox.source_record_id = attempt.id
            AND outbox.event_type = 'attempt_submitted'
        WHERE attempt.id = ANY($1::uuid[])
        GROUP BY attempt.id, attempt.learner_id, attempt.overall_result
        ORDER BY attempt.id
    `, [attemptIds])).rows;
    invariant(rows.length === attemptIds.length, "PERSISTED_ATTEMPT_MISSING", "資料庫重啟後找不到全部指定作答。", {
        expected: attemptIds.length,
        actual: rows.length,
    });
    invariant(rows.every((row) => row.part_results > 0 && row.outbox_events === 1), "PERSISTED_ATTEMPT_INCOMPLETE", "重啟後的作答缺少小題結果或 outbox。");
    invariant(rows.every((row) => row.wrong_queue_items === row.wrong_parts), "PERSISTED_WRONG_QUEUE_MISMATCH", "重啟後的 wrong 小題與錯題佇列不一致。");
    invariant(rows.every((row) => (
        (row.overall_result === "pending" && row.pending_parts > 0)
        || (row.overall_result === "wrong" && row.pending_parts === 0 && row.wrong_parts > 0)
        || (row.overall_result === "correct" && row.pending_parts === 0 && row.wrong_parts === 0)
    )), "PERSISTED_RESULT_MISMATCH", "重啟後的 overall result 與小題結果不一致。");
    const { body } = await api.request("/api/v1/local-practice/history?limit=100");
    const historyLeaks = scanForbiddenKeys(body?.data, "persistedHistory");
    invariant(historyLeaks.length === 0, "PERSISTED_HISTORY_API_LEAK", "重啟後歷史 API 洩漏作答內容或答案。", { locations: historyLeaks.slice(0, 10) });
    const historyIds = new Set((body?.data?.attempts ?? []).map((attempt) => attempt.id));
    const ownedByCurrentLearner = rows.every((row) => row.learner_id === api.learnerId);
    if (ownedByCurrentLearner) {
        invariant(attemptIds.every((id) => historyIds.has(id)), "PERSISTED_ATTEMPT_NOT_IN_HISTORY", "資料庫重啟後，歷史 API 找不到目前帳號擁有的指定作答。");
    }
    else {
        invariant(attemptIds.every((id) => !historyIds.has(id)), "PERSISTED_ATTEMPT_CROSSED_ACCOUNT", "新合成帳號不應看見另一學習者的既有作答。");
    }
    return {
        attemptIds,
        attempts: rows.length,
        partResults: rows.reduce((sum, row) => sum + row.part_results, 0),
        wrongParts: rows.reduce((sum, row) => sum + row.wrong_parts, 0),
        pendingParts: rows.reduce((sum, row) => sum + row.pending_parts, 0),
        wrongQueueItems: rows.reduce((sum, row) => sum + row.wrong_queue_items, 0),
        outboxEvents: rows.reduce((sum, row) => sum + row.outbox_events, 0),
        historyVisible: ownedByCurrentLearner,
        crossAccountHistoryIsolated: !ownedByCurrentLearner,
        databaseRestart: {
            verified: true,
            previousStartedAt: previousDatabaseStartedAt,
            currentStartedAt: currentDatabaseStartedAt,
        },
    };
}

function safeError(error) {
    if (error instanceof VerificationError) {
        return { ok: false, code: error.code, message: error.message, details: error.details };
    }
    return {
        ok: false,
        code: typeof error?.code === "string" ? error.code : "UNEXPECTED_VERIFICATION_ERROR",
        message: "本機練習整合驗證發生未預期錯誤。",
        details: { errorName: error instanceof Error ? error.name : typeof error },
    };
}

async function main() {
    const config = databaseConfig();
    const origin = baseUrl();
    const persistenceOnly = parseBooleanEnvironment("VERIFY_PERSISTENCE_ONLY");
    const persistenceEvidence = await readPersistenceEvidence();
    const persistedAttemptIds = persistenceEvidence.attemptIds;
    const pool = new Pool({
        host: config.socket,
        port: config.port,
        database: config.database,
        user: config.user,
        password: async () => {
            throw new VerificationError("DATABASE_PASSWORD_REQUESTED", "隔離本機 PostgreSQL 不應要求密碼。");
        },
        ssl: false,
        application_name: "lerniqa-local-practice-verifier",
        max: 1,
        connectionTimeoutMillis: 3_000,
        statement_timeout: 30_000,
        query_timeout: 35_000,
        allowExitOnIdle: true,
    });
    try {
        const client = await pool.connect();
        try {
            const database = await verifyDatabaseIdentity(client, config);
            const migrations = await verifyMigrations(client);
            const api = await createSyntheticAuthClient(origin);
            let output;
            try {
                if (persistenceOnly) {
                    const importVerification = await verifyImport(client, api.learnerId);
                    const persistence = await verifyPersistedAttempts(
                        client,
                        api,
                        persistedAttemptIds,
                        persistenceEvidence.databaseStartedAt,
                        database.serverStartedAt,
                    );
                    output = {
                        ok: true,
                        mode: "persistence-only",
                        baseUrl: origin.origin,
                        database,
                        migrations,
                        auth: {
                            synthetic: true,
                            emailDomain: api.emailDomain,
                            learnerId: api.learnerId,
                        },
                        import: importVerification.summary,
                        persistence,
                    };
                }
                else {
                    const importVerification = await verifyImport(client, api.learnerId);
                    const catalog = await loadQuestions(api);
                    const apiRevisionIds = new Set(catalog.questions.map((question) => question.revisionId));
                    invariant(importVerification.publishedRevisionIds.every((id) => apiRevisionIds.has(id)), "IMPORTED_QUESTION_MISSING_FROM_API", "題庫 API 未完整提供本批已發布題目。", {
                        importedRevisions: importVerification.publishedRevisionIds.length,
                        apiQuestions: catalog.total,
                        missing: importVerification.publishedRevisionIds.filter((id) => !apiRevisionIds.has(id)).length,
                    });
                    const definitions = await loadGradeDefinitions(client, catalog.questions);
                    const flow = await verifyAttemptFlow(client, api, catalog.questions, definitions);
                    const suppliedPersistence = persistedAttemptIds.length > 0
                        ? await verifyPersistedAttempts(
                            client,
                            api,
                            persistedAttemptIds,
                            persistenceEvidence.databaseStartedAt,
                            database.serverStartedAt,
                        )
                        : null;
                    output = {
                        ok: true,
                        mode: "full",
                        baseUrl: origin.origin,
                        database,
                        migrations,
                        auth: {
                            synthetic: true,
                            emailDomain: api.emailDomain,
                            learnerId: api.learnerId,
                        },
                        import: importVerification.summary,
                        catalog: {
                            questions: catalog.total,
                            pages: catalog.pageCount,
                            answerOrStorageLeaks: 0,
                        },
                        practice: flow,
                        suppliedPersistence,
                        persistence: {
                            attemptIds: flow.attemptIds,
                            databaseStartedAt: database.serverStartedAt,
                            nextCheck: "先保存本次 JSON，停止並重啟 PostgreSQL 與網站，再執行 VERIFY_PERSISTENCE_ONLY=1 PERSISTED_ATTEMPT_IDS_FILE=<本次 JSON 路徑> node scripts/verify-local-practice.mjs",
                        },
                    };
                }
            }
            finally {
                await api.logout();
                await verifyAuthSessionRevoked(client, api.sessionTokenHash);
            }
            output.auth.loggedOut = true;
            output.auth.sessionRevoked = true;
            process.stdout.write(`${JSON.stringify(output)}\n`);
        }
        finally {
            client.release();
        }
    }
    finally {
        await pool.end();
    }
}

try {
    await main();
}
catch (error) {
    process.stdout.write(`${JSON.stringify(safeError(error))}\n`);
    process.exitCode = 1;
}
