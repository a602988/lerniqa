#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir, userInfo } from "node:os";
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
const SYNTHETIC_HANDWRITING_DATA_URL = `data:image/png;base64,${(
    await readFile(path.join(REPOSITORY_ROOT, "tests", "fixtures", "handwriting-ai-synthetic", "png", "readable-a.png"))
).toString("base64")}`;
const MIGRATION_DIRECTORY = path.join(REPOSITORY_ROOT, "database", "migrations");
const ISOLATED_ROOT_BASENAME_PATTERN = /^lerniqa-practice-test\.[A-Za-z0-9_-]+$/u;
const ISOLATED_DATABASE_PATTERN = /^lerniqa_practice_test_[a-z0-9_]+$/u;
const ISOLATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ISOLATION_MARKER_FILE = ".lerniqa-isolated-practice-test";
const DATABASE_OWNERSHIP_COMMENT_PREFIX = "lerniqa-isolated-practice-test:";
const AUTH_SESSION_COOKIE = "lerniqa_session";
const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const FORWARDED_HTTPS_HOST = "session-contract.lerniqa.invalid:8443";
const FORWARDED_HTTPS_ORIGIN = `https://${FORWARDED_HTTPS_HOST}`;
const SYNTHETIC_ACCOUNT_ROLES = ["learner", "parent", "tutor"];
const IMPORT_RECOGNIZER = PARSER_VERSION;
const IMPORT_KEY_PREFIX = `${IMPORT_RECOGNIZER}:jh1-zh-hanlin-v1-l4:`;
const SYNTHETIC_SOURCE_FILE = "lerniqa-isolated-practice-fixture.doc";
const SYNTHETIC_SOURCE_SHA256 = createHash("sha256")
    .update("lerniqa-isolated-practice-fixture-v1", "utf8")
    .digest("hex");
const EXPECTED_IMPORT = Object.freeze({
    sourceFiles: 1,
    parsed: 279,
    approved: 279,
    pending: 0,
    rejected: 0,
});
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
    "idempotencykey",
    "storagekey",
]);
const FORBIDDEN_MASKED_GRADING_KEYS = new Set([
    "attempt",
    "attempts",
    "feedbackcode",
    "gradingsource",
    "overallresult",
    "partresults",
    "parts",
    "result",
]);
const FORBIDDEN_DETAILED_PRIVATE_KEYS = new Set([
    "answerpayload",
    "idempotencykey",
    "storagekey",
]);
const FORBIDDEN_SCORE_MAPPING_KEYS = new Set([
    "attempt",
    "attempts",
    "feedbackcode",
    "gradingsource",
    "items",
    "overallresult",
    "partid",
    "partresults",
    "parts",
    "questionid",
    "revisionid",
    "sessionitemid",
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
    invariant(raw !== undefined, "ISOLATED_DATABASE_PORT_REQUIRED", "隔離驗證必須明確提供 LOCAL_PG_PORT。");
    invariant(/^\d+$/u.test(raw), "INVALID_DATABASE_PORT", "LOCAL_PG_PORT 必須是整數。");
    const port = Number(raw);
    invariant(Number.isSafeInteger(port) && port >= 1 && port <= 65_535, "INVALID_DATABASE_PORT", "LOCAL_PG_PORT 必須介於 1 到 65535。");
    return port;
}

function existingServerModeEnabled() {
    const value = readOptionalEnvironment("LERNIQA_PRACTICE_TEST_EXISTING") ?? "0";
    invariant(["0", "1"].includes(value), "INVALID_EXISTING_SERVER_MODE", "LERNIQA_PRACTICE_TEST_EXISTING 只接受 0 或 1。");
    return value === "1";
}

function parseExpectedExistingPort() {
    const raw = readOptionalEnvironment("LERNIQA_PRACTICE_TEST_PORT");
    invariant(raw !== undefined && /^\d+$/u.test(raw), "EXISTING_SERVER_PORT_REQUIRED", "existing-local-server 模式必須明確提供 LERNIQA_PRACTICE_TEST_PORT。");
    const port = Number(raw);
    invariant(Number.isSafeInteger(port) && port >= 1 && port <= 65_535, "INVALID_EXISTING_SERVER_PORT", "LERNIQA_PRACTICE_TEST_PORT 必須介於 1 到 65535。");
    return port;
}

function databaseConfig() {
    const existingServer = existingServerModeEnabled();
    const configuredRoot = readOptionalEnvironment("LERNIQA_ISOLATED_TEST_ROOT");
    invariant(configuredRoot !== undefined, "ISOLATED_TEST_ROOT_REQUIRED", "拒絕對持久資料執行整合寫入；請改用 npm run test:local-practice 建立臨時測試環境。");
    invariant(path.isAbsolute(configuredRoot), "INVALID_ISOLATED_TEST_ROOT", "LERNIQA_ISOLATED_TEST_ROOT 必須是絕對路徑。");
    const testRoot = path.resolve(configuredRoot);
    invariant(ISOLATED_ROOT_BASENAME_PATTERN.test(path.basename(testRoot)), "INVALID_ISOLATED_TEST_ROOT", "隔離測試目錄名稱不符合安全規則。");
    invariant(testRoot !== REPOSITORY_ROOT && !testRoot.startsWith(`${REPOSITORY_ROOT}${path.sep}`), "ISOLATED_TEST_ROOT_IN_REPOSITORY", "隔離測試目錄不得位於 repository 或持久資料目錄內。");

    const token = readOptionalEnvironment("LERNIQA_ISOLATED_TEST_TOKEN");
    invariant(token !== undefined && ISOLATION_TOKEN_PATTERN.test(token), "ISOLATED_TEST_TOKEN_REQUIRED", "隔離驗證缺少有效的一次性識別。");

    const socket = readOptionalEnvironment("LOCAL_PG_SOCKET");
    invariant(socket !== undefined, "ISOLATED_DATABASE_SOCKET_REQUIRED", "隔離驗證必須明確提供 LOCAL_PG_SOCKET。");
    invariant(path.isAbsolute(socket), "INVALID_DATABASE_SOCKET", "LOCAL_PG_SOCKET 必須是絕對路徑。");
    const resolvedSocket = path.resolve(socket);
    let expectedDataDirectory = path.join(testRoot, "postgres");
    let expectedSocket = path.join(testRoot, "socket");
    let expectedPort = parsePort();
    if (existingServer) {
        const configuredSocket = readOptionalEnvironment("LERNIQA_PRACTICE_TEST_SOCKET");
        invariant(configuredSocket !== undefined && path.isAbsolute(configuredSocket), "EXISTING_SERVER_SOCKET_REQUIRED", "existing-local-server 模式必須明確提供絕對 LERNIQA_PRACTICE_TEST_SOCKET。");
        expectedSocket = path.resolve(configuredSocket);
        invariant(resolvedSocket === expectedSocket, "EXISTING_SERVER_SOCKET_MISMATCH", "LOCAL_PG_SOCKET 與明確核准的 existing-local-server socket 不一致。");
        expectedPort = parseExpectedExistingPort();
        invariant(parsePort() === expectedPort, "EXISTING_SERVER_PORT_MISMATCH", "LOCAL_PG_PORT 與明確核准的 existing-local-server port 不一致。");
        const configuredDataDirectory = readOptionalEnvironment("LERNIQA_PRACTICE_TEST_DATA_DIRECTORY");
        invariant(configuredDataDirectory !== undefined && path.isAbsolute(configuredDataDirectory), "EXISTING_SERVER_DATA_DIRECTORY_REQUIRED", "existing-local-server 模式必須明確提供絕對 LERNIQA_PRACTICE_TEST_DATA_DIRECTORY。");
        expectedDataDirectory = path.resolve(configuredDataDirectory);
    }
    else {
        invariant(resolvedSocket === expectedSocket, "DATABASE_SOCKET_OUTSIDE_TEST_ROOT", "LOCAL_PG_SOCKET 必須位於本次隔離測試目錄。");
    }

    const database = readOptionalEnvironment("LOCAL_PG_DATABASE");
    invariant(database !== undefined && ISOLATED_DATABASE_PATTERN.test(database), "ISOLATED_DATABASE_NAME_REQUIRED", "隔離驗證只能使用 lerniqa_practice_test_* 資料庫。");
    const user = readOptionalEnvironment("LOCAL_PG_USER");
    invariant(user === userInfo().username, "ISOLATED_DATABASE_USER_MISMATCH", "隔離驗證只能使用目前作業系統使用者。");
    return {
        testRoot,
        token,
        existingServer,
        socket: resolvedSocket,
        port: expectedPort,
        database,
        user,
        expectedSocket,
        expectedDataDirectory,
    };
}

function baseUrl() {
    const configuredBaseUrl = readOptionalEnvironment("BASE_URL");
    invariant(configuredBaseUrl !== undefined, "ISOLATED_BASE_URL_REQUIRED", "隔離驗證必須明確提供 BASE_URL。");
    const configuredHttpPort = readOptionalEnvironment("LERNIQA_ISOLATED_HTTP_PORT");
    invariant(configuredHttpPort !== undefined && /^\d+$/u.test(configuredHttpPort), "ISOLATED_HTTP_PORT_REQUIRED", "隔離驗證必須明確提供 LERNIQA_ISOLATED_HTTP_PORT。");
    const parsed = new URL(configuredBaseUrl);
    invariant(parsed.protocol === "http:", "UNSAFE_BASE_URL", "整合驗證只允許本機 HTTP 開發服務。");
    invariant(parsed.username === "" && parsed.password === "", "UNSAFE_BASE_URL", "BASE_URL 不可包含帳號或密碼。");
    invariant(parsed.hostname === "127.0.0.1", "UNSAFE_BASE_URL", "隔離驗證只能連到明確的 127.0.0.1 服務。");
    invariant(Number(parsed.port) === Number(configuredHttpPort), "ISOLATED_HTTP_PORT_MISMATCH", "BASE_URL 與隔離 HTTP port 不一致。");
    invariant(parsed.pathname === "/" && parsed.search === "" && parsed.hash === "", "INVALID_BASE_URL", "BASE_URL 不可包含額外 path、query 或 fragment。");
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    return parsed;
}

async function verifyIsolationMarker(config) {
    const canonicalRoot = await realpath(config.testRoot).catch(() => null);
    invariant(canonicalRoot === config.testRoot, "ISOLATED_TEST_ROOT_NOT_CANONICAL", "隔離測試目錄不存在、是符號連結或不是 canonical path。");
    const canonicalTemp = await realpath(tmpdir()).catch(() => null);
    invariant(canonicalTemp !== null && path.dirname(canonicalRoot) === canonicalTemp, "ISOLATED_TEST_ROOT_OUTSIDE_TEMP", "隔離測試目錄必須是作業系統 canonical 暫存目錄的直屬目錄。");
    const rootMetadata = await lstat(canonicalRoot).catch(() => null);
    invariant(rootMetadata?.isDirectory() === true
        && rootMetadata.isSymbolicLink() === false
        && (rootMetadata.mode & 0o077) === 0, "INVALID_ISOLATED_TEST_ROOT", "隔離測試根目錄必須是私有真實目錄，不可為符號連結。");
    for (const childName of config.existingServer ? [] : ["postgres", "socket"]) {
        const childPath = path.join(canonicalRoot, childName);
        const metadata = await lstat(childPath).catch(() => null);
        invariant(metadata?.isDirectory() === true
            && metadata.isSymbolicLink() === false
            && (metadata.mode & 0o077) === 0, "ISOLATED_TEST_CHILD_INVALID", `隔離測試的 ${childName} 必須是私有真實目錄，不可為符號連結。`);
    }
    const markerPath = path.join(config.testRoot, ISOLATION_MARKER_FILE);
    const markerMetadata = await lstat(markerPath).catch(() => null);
    invariant(markerMetadata?.isFile() === true
        && markerMetadata.isSymbolicLink() === false
        && (markerMetadata.mode & 0o077) === 0, "ISOLATED_TEST_MARKER_INVALID", "隔離測試 marker 必須是私有一般檔案，不可為符號連結。");
    const marker = await readFile(markerPath, "utf8").catch(() => null);
    invariant(marker?.trim() === config.token, "ISOLATED_TEST_MARKER_MISMATCH", "隔離測試目錄的一次性標記不符。");
}

async function expectedMigrations() {
    const fileNames = (await readdir(MIGRATION_DIRECTORY))
        .filter((fileName) => /^[0-9]{4}_[a-z0-9_]+\.up\.sql$/u.test(fileName))
        .sort();
    invariant(fileNames.length > 0, "MIGRATION_MANIFEST_EMPTY", "找不到 migration manifest。");
    return fileNames.map((fileName, index) => {
        const match = fileName.match(/^([0-9]{4})_([a-z0-9_]+)\.up\.sql$/u);
        const expectedVersion = String(index + 1).padStart(4, "0");
        invariant(match !== null && match[1] === expectedVersion, "MIGRATION_MANIFEST_INVALID", "migration manifest 有跳號或格式錯誤。", { fileName, expectedVersion });
        return [match[1], match[2]];
    });
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

function catalogProfile() {
    const profile = readOptionalEnvironment("VERIFY_CATALOG_PROFILE");
    invariant(["synthetic-import", "real-import-copy"].includes(profile), "CATALOG_PROFILE_REQUIRED", "VERIFY_CATALOG_PROFILE 必須明確指定 synthetic-import 或 real-import-copy。");
    if (profile === "synthetic-import") {
        return {
            name: profile,
            sourceFile: SYNTHETIC_SOURCE_FILE,
            sourceSha256: SYNTHETIC_SOURCE_SHA256,
            synthetic: true,
        };
    }
    return {
        name: profile,
        sourceFile: AUTHORIZED_FOURTH_LESSON_FILE,
        sourceSha256: AUTHORIZED_FOURTH_LESSON_SHA256,
        synthetic: false,
    };
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

function scanNamedKeys(value, forbiddenKeys, location = "response", findings = []) {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => scanNamedKeys(entry, forbiddenKeys, `${location}[${index}]`, findings));
        return findings;
    }
    if (!isRecord(value)) return findings;
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = key.replace(/[-_\s]/gu, "").toLowerCase();
        if (forbiddenKeys.has(normalizedKey)) findings.push(`${location}.${key}`);
        scanNamedKeys(entry, forbiddenKeys, `${location}.${key}`, findings);
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

async function fetchJsonWithExplicitHost(origin, pathname, init = undefined, expectedStatuses = [200]) {
    const url = new URL(pathname, origin);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const response = await new Promise((resolve, reject) => {
        const request = httpRequest({
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method: init?.method ?? "GET",
            headers,
        }, (incoming) => {
            const chunks = [];
            incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            incoming.once("error", reject);
            incoming.once("end", () => {
                const responseHeaders = new Headers();
                for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
                    responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
                }
                resolve({
                    headers: responseHeaders,
                    status: incoming.statusCode ?? 0,
                    text: Buffer.concat(chunks).toString("utf8"),
                });
            });
        });
        request.setTimeout(30_000, () => request.destroy(new Error("loopback proxy request timed out")));
        request.once("error", (error) => {
            reject(new VerificationError("API_UNREACHABLE", "無法連線到本機練習 API。", {
                cause: error instanceof Error ? error.name : "unknown",
            }));
        });
        if (typeof init?.body === "string") request.write(init.body);
        request.end();
    });
    let body;
    try {
        body = JSON.parse(response.text);
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

function verifySessionCookiePolicy(headers, { secure, cleared = false }) {
    const setCookie = headers.get("set-cookie");
    invariant(typeof setCookie === "string", "AUTH_COOKIE_MISSING", "帳號回應沒有設定 session cookie。");
    invariant(/(?:^|;\s*)HttpOnly(?:;|$)/iu.test(setCookie), "AUTH_COOKIE_HTTP_ONLY_MISSING", "session cookie 缺少 HttpOnly。");
    invariant(/(?:^|;\s*)SameSite=Lax(?:;|$)/iu.test(setCookie), "AUTH_COOKIE_SAME_SITE_INVALID", "session cookie 必須使用 SameSite=Lax。");
    invariant(/(?:^|;\s*)Path=\/(?:;|$)/iu.test(setCookie), "AUTH_COOKIE_PATH_INVALID", "session cookie 必須套用至整個網站。");
    invariant(!/(?:^|;\s*)Domain=/iu.test(setCookie), "AUTH_COOKIE_DOMAIN_TOO_BROAD", "session cookie 不得設定跨主機 Domain。");
    invariant(
        /(?:^|;\s*)Secure(?:;|$)/iu.test(setCookie) === secure,
        "AUTH_COOKIE_SECURE_POLICY_INVALID",
        secure ? "HTTPS session cookie 缺少 Secure。" : "loopback HTTP session cookie 不應標記 Secure。",
    );
    invariant(
        new RegExp(`(?:^|;\\s*)Max-Age=${cleared ? 0 : AUTH_SESSION_MAX_AGE_SECONDS}(?:;|$)`, "iu").test(setCookie),
        "AUTH_COOKIE_MAX_AGE_INVALID",
        cleared ? "登出沒有立即清除 session cookie。" : "session cookie 保存期限不符合服務契約。",
    );
    if (cleared) {
        invariant(
            new RegExp(`(?:^|,\\s*)${AUTH_SESSION_COOKIE}=(?:;|$)`, "u").test(setCookie),
            "AUTH_COOKIE_CLEAR_VALUE_INVALID",
            "登出沒有把 session cookie 值清空。",
        );
    }
}

function authenticatedInit(cookieHeader, init = undefined) {
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookieHeader);
    return { ...init, headers };
}

async function createSyntheticAuthClient(origin, requestedRole = "learner") {
    invariant(SYNTHETIC_ACCOUNT_ROLES.includes(requestedRole), "SYNTHETIC_ROLE_INVALID", "合成帳號角色不在可驗證範圍內。", { requestedRole });
    let registration = null;
    let email = null;
    let password = null;
    for (let attempt = 0; attempt < 3 && registration === null; attempt += 1) {
        const candidateEmail = `local-practice-${requestedRole}-${randomUUID()}@lerniqa.invalid`;
        const candidatePassword = `verify-${randomUUID()}-${randomUUID()}`;
        const response = await fetchJson(origin, "/api/v1/auth/register", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                origin: origin.origin,
            },
            body: JSON.stringify({
                displayName: `整合驗證${requestedRole}帳號`,
                learnerName: `整合驗證${requestedRole}學習者`,
                email: candidateEmail,
                password: candidatePassword,
                role: requestedRole,
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
        }, [201, 409]);
        if (response.status === 409 && response.body?.error?.code === "EMAIL_ALREADY_REGISTERED") continue;
        invariant(response.status === 201, "SYNTHETIC_REGISTRATION_FAILED", "無法建立本機整合驗證用合成帳號。", {
            status: response.status,
            errorCode: response.body?.error?.code,
        });
        registration = response;
        email = candidateEmail;
        password = candidatePassword;
    }
    invariant(registration !== null && email !== null && password !== null, "SYNTHETIC_REGISTRATION_COLLISION", "無法取得唯一的 .invalid 合成帳號。");

    const account = registration.body?.data?.account;
    invariant(
        isRecord(account)
            && account.email === email
            && account.email.endsWith(".invalid")
            && account.accountRole === requestedRole
            && account.activeRole === requestedRole
            && Array.isArray(account.roles)
            && account.roles.includes(requestedRole)
            && isRecord(account.learner)
            && Array.isArray(account.learners)
            && account.learners.some((learner) => learner?.id === account.learner.id)
            && UUID_PATTERN.test(account.learner.id),
        "SYNTHETIC_ACCOUNT_INVALID",
        "合成帳號註冊回應缺少有效的 learner 身分。",
    );
    const cookie = sessionCookieFromHeaders(registration.headers);
    verifySessionCookiePolicy(registration.headers, { secure: origin.protocol === "https:" });
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
        cookieHeader: cookie.header,
        email,
        emailDomain: ".invalid",
        learnerId: account.learner.id,
        password,
        request,
        requestedRole,
        sessionTokenHash: `sha256:v1:${createHash("sha256").update(cookie.token, "utf8").digest("hex")}`,
        async logout() {
            if (loggedOut) return;
            const response = await request("/api/v1/auth/logout", { method: "POST" });
            invariant(response.body?.data?.loggedOut === true, "AUTH_LOGOUT_FAILED", "合成帳號登出 API 未確認完成。");
            verifySessionCookiePolicy(response.headers, { secure: origin.protocol === "https:", cleared: true });
            const afterLogout = await request("/api/v1/auth/me", undefined, [401]);
            invariant(afterLogout.body?.error?.code === "AUTH_REQUIRED", "AUTH_SESSION_NOT_REVOKED", "登出後舊 session cookie 仍可使用。");
            loggedOut = true;
        },
    };
}

async function loginSyntheticAuthClient(origin, registeredAccount) {
    const login = await fetchJson(origin, "/api/v1/auth/login", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            origin: origin.origin,
        },
        body: JSON.stringify({
            email: registeredAccount.email,
            password: registeredAccount.password,
        }),
    });
    const account = login.body?.data?.account;
    invariant(
        isRecord(account)
            && account.email === registeredAccount.email
            && account.activeRole === registeredAccount.requestedRole
            && account.learner?.id === registeredAccount.learnerId,
        "SYNTHETIC_LOGIN_ROLE_UNSTABLE",
        "合成帳號再次登入後沒有穩定選回 learner access 的角色。",
        { requestedRole: registeredAccount.requestedRole, activeRole: account?.activeRole },
    );
    const cookie = sessionCookieFromHeaders(login.headers);
    verifySessionCookiePolicy(login.headers, { secure: origin.protocol === "https:" });
    let loggedOut = false;
    const request = (pathname, init = undefined, expectedStatuses = [200]) => (
        fetchJson(origin, pathname, authenticatedInit(cookie.header, init), expectedStatuses)
    );
    const me = await request("/api/v1/auth/me");
    invariant(
        me.body?.data?.account?.email === registeredAccount.email
            && me.body?.data?.account?.activeRole === registeredAccount.requestedRole
            && me.body?.data?.account?.learner?.id === registeredAccount.learnerId,
        "SYNTHETIC_LOGIN_SESSION_ROLE_UNSTABLE",
        "登入 session 無法讀回所選角色與同一學習者。",
        { requestedRole: registeredAccount.requestedRole },
    );
    return {
        activeRole: account.activeRole,
        cookieHeader: cookie.header,
        learnerId: account.learner.id,
        request,
        sessionTokenHash: `sha256:v1:${createHash("sha256").update(cookie.token, "utf8").digest("hex")}`,
        async logout() {
            if (loggedOut) return;
            const response = await request("/api/v1/auth/logout", { method: "POST" });
            invariant(response.body?.data?.loggedOut === true, "AUTH_LOGOUT_FAILED", "重新登入的合成帳號登出 API 未確認完成。");
            verifySessionCookiePolicy(response.headers, { secure: origin.protocol === "https:", cleared: true });
            const afterLogout = await request("/api/v1/auth/me", undefined, [401]);
            invariant(afterLogout.body?.error?.code === "AUTH_REQUIRED", "AUTH_SESSION_NOT_REVOKED", "登出後舊 session cookie 仍可使用。");
            loggedOut = true;
        },
    };
}

async function verifyForwardedHttpsSessionLifecycle(client, origin) {
    const email = `forwarded-session-${randomUUID()}@lerniqa.invalid`;
    const password = `verify-${randomUUID()}-${randomUUID()}`;
    const proxyHeaders = {
        host: FORWARDED_HTTPS_HOST,
        origin: FORWARDED_HTTPS_ORIGIN,
        "x-forwarded-proto": "https",
    };
    const registration = await fetchJsonWithExplicitHost(origin, "/api/v1/auth/register", {
        method: "POST",
        headers: {
            ...proxyHeaders,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            displayName: "HTTPS session 驗證帳號",
            email,
            password,
            role: "learner",
            educationStatus: "enrolled",
            gradeCode: "junior-high-1",
            semesterCode: "semester-1",
        }),
    }, [201]);
    const account = registration.body?.data?.account;
    invariant(
        account?.email === email && UUID_PATTERN.test(account?.learner?.id ?? ""),
        "FORWARDED_HTTPS_REGISTRATION_INVALID",
        "模擬 HTTPS proxy 的註冊回應缺少正確帳號。",
    );
    verifySessionCookiePolicy(registration.headers, { secure: true });
    const requestWithCookie = (cookieHeader, pathname, init = undefined, expectedStatuses = [200]) => (
        fetchJsonWithExplicitHost(
            origin,
            pathname,
            authenticatedInit(cookieHeader, {
                ...init,
                headers: {
                    ...proxyHeaders,
                    ...Object.fromEntries(new Headers(init?.headers).entries()),
                },
            }),
            expectedStatuses,
        )
    );
    const registrationCookie = sessionCookieFromHeaders(registration.headers);
    const registrationLogout = await requestWithCookie(
        registrationCookie.header,
        "/api/v1/auth/logout",
        { method: "POST" },
    );
    invariant(
        registrationLogout.body?.data?.loggedOut === true,
        "FORWARDED_HTTPS_REGISTRATION_LOGOUT_FAILED",
        "HTTPS proxy 註冊 session 無法在登入前安全結束。",
    );
    verifySessionCookiePolicy(registrationLogout.headers, { secure: true, cleared: true });
    await verifyAuthSessionRevoked(
        client,
        `sha256:v1:${createHash("sha256").update(registrationCookie.token, "utf8").digest("hex")}`,
    );

    const login = await fetchJsonWithExplicitHost(origin, "/api/v1/auth/login", {
        method: "POST",
        headers: {
            ...proxyHeaders,
            "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
    });
    invariant(
        login.body?.data?.account?.email === email
            && login.body?.data?.account?.learner?.id === account.learner.id,
        "FORWARDED_HTTPS_LOGIN_INVALID",
        "模擬 HTTPS proxy 的登入沒有讀回原帳號。",
    );
    verifySessionCookiePolicy(login.headers, { secure: true });
    const cookie = sessionCookieFromHeaders(login.headers);
    const request = (pathname, init = undefined, expectedStatuses = [200]) => requestWithCookie(
        cookie.header,
        pathname,
        init,
        expectedStatuses,
    );

    const refresh = await request("/api/v1/auth/me");
    const reopenedTab = await request("/api/v1/auth/me");
    invariant(
        refresh.body?.data?.account?.email === email
            && refresh.body?.data?.account?.learner?.id === account.learner.id
            && reopenedTab.body?.data?.account?.email === email
            && reopenedTab.body?.data?.account?.learner?.id === account.learner.id,
        "FORWARDED_HTTPS_SESSION_NOT_RESTORED",
        "HTTPS proxy 後的 session 無法在重新整理或新分頁讀回同一帳號。",
    );
    const logout = await request("/api/v1/auth/logout", { method: "POST" });
    invariant(logout.body?.data?.loggedOut === true, "FORWARDED_HTTPS_LOGOUT_FAILED", "HTTPS proxy 後的 session 無法登出。");
    verifySessionCookiePolicy(logout.headers, { secure: true, cleared: true });
    const afterLogout = await request("/api/v1/auth/me", undefined, [401]);
    invariant(afterLogout.body?.error?.code === "AUTH_REQUIRED", "FORWARDED_HTTPS_SESSION_NOT_REVOKED", "HTTPS proxy 登出後舊 session 仍可使用。");
    await verifyAuthSessionRevoked(
        client,
        `sha256:v1:${createHash("sha256").update(cookie.token, "utf8").digest("hex")}`,
    );
    return {
        forwardedProtocol: "https",
        secureCookie: true,
        loginIssuedSession: true,
        refreshRestored: true,
        reopenedTabRestored: true,
        logoutRevoked: true,
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

function recoveryRequestInit(origin, body, cookieHeader = undefined) {
    return {
        method: "POST",
        headers: {
            "content-type": "application/json",
            origin: origin.origin,
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(body),
    };
}

function recoveryToken() {
    const token = randomBytes(32).toString("base64url");
    invariant(token.length === 43, "RECOVERY_TOKEN_FIXTURE_INVALID", "隔離驗證產生了非預期長度的恢復 token。");
    return token;
}

function recoveryTokenHash(token) {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

async function recoveryAccountRow(client, email) {
    const result = await client.query(`
        SELECT
            identity.user_id,
            identity.id AS identity_id,
            identity.password_hash,
            identity.verified_at
        FROM account_identities AS identity
        JOIN users AS app_user ON app_user.id = identity.user_id
        WHERE identity.provider = 'email'
            AND identity.email_normalized = $1
            AND identity.revoked_at IS NULL
            AND app_user.status = 'active'
    `, [email]);
    invariant(result.rowCount === 1, "RECOVERY_ACCOUNT_FIXTURE_INVALID", "隔離恢復驗證找不到唯一的合成帳號。");
    return result.rows[0];
}

async function seedRecoveryChallenge(client, input) {
    const token = recoveryToken();
    const tokenHash = recoveryTokenHash(token);
    const id = randomUUID();
    await client.query(`
        INSERT INTO verification_challenges (
            id,
            user_id,
            account_identity_id,
            purpose,
            target_role,
            token_hash,
            expires_at,
            consumed_at,
            created_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            transaction_timestamp() + ($7::integer * interval '1 minute'),
            CASE WHEN $8::boolean THEN transaction_timestamp() ELSE NULL END,
            transaction_timestamp() - ($9::integer * interval '1 second')
        )
    `, [
        id,
        input.userId,
        input.identityId,
        input.purpose,
        input.targetRole ?? null,
        tokenHash,
        input.expiresInMinutes ?? 30,
        input.consumed ?? false,
        input.createdAgoSeconds ?? 0,
    ]);
    return { id, token, tokenHash };
}

async function verifyPasswordResetRequestPrivacy(client, origin, account, userId, identityId) {
    const countChallenges = async () => numberValue((await client.query(`
        SELECT count(*)::integer AS count
        FROM verification_challenges
        WHERE user_id = $1
            AND purpose = 'password_reset'
    `, [userId])).rows[0]?.count);
    for (let index = 0; index < 4; index += 1) {
        await seedRecoveryChallenge(client, {
            userId,
            identityId,
            purpose: "password_reset",
            consumed: true,
            createdAgoSeconds: 120 + index,
        });
    }
    const before = await countChallenges();
    const known = await fetchJson(
        origin,
        "/api/v1/auth/password-reset",
        recoveryRequestInit(origin, { email: account.email }),
        [202],
    );
    const afterKnown = await countChallenges();
    invariant(
        known.body?.data?.status === "accepted"
            && known.headers.get("cache-control") === "no-store"
            && afterKnown === before + 1,
        "PASSWORD_RESET_REQUEST_CONTRACT_INVALID",
        "已存在帳號的密碼恢復申請未以 generic accepted 完成，或未建立單一可稽核 challenge。",
    );
    const deliveryFailureChallenge = (await client.query(`
        SELECT consumed_at, attempt_count
        FROM verification_challenges
        WHERE user_id = $1
            AND purpose = 'password_reset'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    `, [userId])).rows[0];
    invariant(
        deliveryFailureChallenge?.consumed_at !== null
            && deliveryFailureChallenge?.consumed_at !== undefined
            && deliveryFailureChallenge?.attempt_count === 0,
        "PASSWORD_RESET_UNDELIVERED_TOKEN_ACTIVE",
        "合成 SMTP 拒絕寄送後，未送達的密碼恢復 token 仍可使用。",
    );

    const unknown = await fetchJson(
        origin,
        "/api/v1/auth/password-reset",
        recoveryRequestInit(origin, { email: `unknown-${randomUUID()}@lerniqa.invalid` }),
        [202],
    );
    invariant(
        JSON.stringify(unknown.body) === JSON.stringify(known.body)
            && unknown.headers.get("cache-control") === "no-store"
            && await countChallenges() === afterKnown,
        "PASSWORD_RESET_REQUEST_ENUMERATION_LEAK",
        "不存在帳號的密碼恢復申請與已存在帳號的公開回應不一致。",
    );

    const cooldown = await fetchJson(
        origin,
        "/api/v1/auth/password-reset",
        recoveryRequestInit(origin, { email: account.email }),
        [202],
    );
    invariant(
        JSON.stringify(cooldown.body) === JSON.stringify(known.body)
            && await countChallenges() === afterKnown,
        "PASSWORD_RESET_COOLDOWN_BYPASSED",
        "密碼恢復冷卻期間建立了第二筆 challenge，或公開回應不一致。",
    );

    invariant(await countChallenges() === 5, "PASSWORD_RESET_RATE_FIXTURE_INVALID", "密碼恢復每小時上限的合成資料不正確。");
    const hourlyLimit = await fetchJson(
        origin,
        "/api/v1/auth/password-reset",
        recoveryRequestInit(origin, { email: account.email }),
        [202],
    );
    invariant(
        JSON.stringify(hourlyLimit.body) === JSON.stringify(known.body)
            && await countChallenges() === 5,
        "PASSWORD_RESET_HOURLY_LIMIT_BYPASSED",
        "密碼恢復達每小時上限後仍建立 challenge，或公開回應洩漏限制狀態。",
    );
    return {
        genericAccepted: true,
        unknownAccountIndistinguishable: true,
        undeliveredTokenCancelled: true,
        cooldownEnforced: true,
        hourlyLimitEnforced: true,
    };
}

async function verifyPasswordResetContracts(client, origin) {
    const account = await createSyntheticAuthClient(origin, "learner");
    let secondSession = null;
    let replacementSession = null;
    let finalSession = null;
    let unrelatedAccount = null;
    try {
        secondSession = await loginSyntheticAuthClient(origin, account);
        const stateBefore = await recoveryAccountRow(client, account.email);
        const requestPrivacy = await verifyPasswordResetRequestPrivacy(
            client,
            origin,
            account,
            stateBefore.user_id,
            stateBefore.identity_id,
        );
        const activeBefore = numberValue((await client.query(`
            SELECT count(*)::integer AS count
            FROM auth_sessions
            WHERE user_id = $1
                AND revoked_at IS NULL
        `, [stateBefore.user_id])).rows[0]?.count);
        invariant(activeBefore === 2, "PASSWORD_RESET_SESSION_FIXTURE_INVALID", "密碼恢復前未建立兩個可驗證的合成 session。");

        const sibling = await seedRecoveryChallenge(client, {
            userId: stateBefore.user_id,
            identityId: stateBefore.identity_id,
            purpose: "password_reset",
            consumed: true,
        });
        const primary = await seedRecoveryChallenge(client, {
            userId: stateBefore.user_id,
            identityId: stateBefore.identity_id,
            purpose: "password_reset",
        });
        const newPassword = `replacement-${randomUUID()}-${randomUUID()}`;
        const confirmed = await fetchJson(
            origin,
            "/api/v1/auth/password-reset/confirm",
            recoveryRequestInit(origin, {
                token: primary.token,
                newPassword,
            }, account.cookieHeader),
        );
        invariant(
            confirmed.body?.data?.status === "completed"
                && confirmed.body?.data?.affectedUserId === undefined
                && confirmed.headers.get("cache-control") === "no-store",
            "PASSWORD_RESET_CONFIRM_INVALID",
            "密碼重設確認 API 未完成或允許快取敏感回應。",
        );
        verifySessionCookiePolicy(confirmed.headers, { secure: false, cleared: true });

        const stateAfter = await recoveryAccountRow(client, account.email);
        invariant(
            stateAfter.password_hash !== stateBefore.password_hash
                && /^scrypt\$v1\$/u.test(stateAfter.password_hash),
            "PASSWORD_RESET_HASH_NOT_REPLACED",
            "密碼重設沒有換成預期的 scrypt 密碼 hash。",
        );
        const challengeRows = (await client.query(`
            SELECT token_hash, attempt_count, consumed_at
            FROM verification_challenges
            WHERE token_hash = ANY($1::text[])
            ORDER BY token_hash
        `, [[primary.tokenHash, sibling.tokenHash]])).rows;
        invariant(
            challengeRows.length === 2
                && challengeRows.every((row) => row.consumed_at !== null)
                && challengeRows.find((row) => row.token_hash === primary.tokenHash)?.attempt_count === 1
                && challengeRows.find((row) => row.token_hash === sibling.tokenHash)?.attempt_count === 0,
            "PASSWORD_RESET_CHALLENGES_NOT_CONSUMED",
            "密碼重設沒有原子地消耗本 token 與同帳號其他未完成 token。",
        );
        const activeAfter = numberValue((await client.query(`
            SELECT count(*)::integer AS count
            FROM auth_sessions
            WHERE user_id = $1
                AND revoked_at IS NULL
        `, [stateBefore.user_id])).rows[0]?.count);
        invariant(activeAfter === 0, "PASSWORD_RESET_SESSIONS_NOT_REVOKED", "密碼重設沒有撤銷該帳號全部 session。");
        invariant(
            (await account.request("/api/v1/auth/me", undefined, [401])).body?.error?.code === "AUTH_REQUIRED"
                && (await secondSession.request("/api/v1/auth/me", undefined, [401])).body?.error?.code === "AUTH_REQUIRED",
            "PASSWORD_RESET_OLD_COOKIE_ACCEPTED",
            "密碼重設後仍可使用舊 session cookie。",
        );

        const invalidResponses = [];
        for (const token of [primary.token, sibling.token, recoveryToken()]) {
            const response = await fetchJson(
                origin,
                "/api/v1/auth/password-reset/confirm",
                recoveryRequestInit(origin, {
                    token,
                    newPassword: `unused-${randomUUID()}-${randomUUID()}`,
                }),
                [400],
            );
            invalidResponses.push(response.body?.error);
        }
        invariant(
            invalidResponses.every((error) => (
                error?.code === "PASSWORD_RESET_INVALID"
                && error?.message === invalidResponses[0]?.message
            )),
            "PASSWORD_RESET_INVALID_RESPONSE_INCONSISTENT",
            "已使用、連帶失效與未知 token 的錯誤回應不一致。",
        );

        const oldLogin = await fetchJson(origin, "/api/v1/auth/login", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                origin: origin.origin,
            },
            body: JSON.stringify({ email: account.email, password: account.password }),
        }, [401]);
        invariant(oldLogin.body?.error?.code === "INVALID_CREDENTIALS", "PASSWORD_RESET_OLD_PASSWORD_ACCEPTED", "密碼重設後舊密碼仍可登入。");
        replacementSession = await loginSyntheticAuthClient(origin, {
            ...account,
            password: newPassword,
        });

        const beforeExpired = await recoveryAccountRow(client, account.email);
        const expired = await seedRecoveryChallenge(client, {
            userId: stateBefore.user_id,
            identityId: stateBefore.identity_id,
            purpose: "password_reset",
            expiresInMinutes: -1,
        });
        const expiredResponse = await fetchJson(
            origin,
            "/api/v1/auth/password-reset/confirm",
            recoveryRequestInit(origin, {
                token: expired.token,
                newPassword: `must-not-apply-${randomUUID()}-${randomUUID()}`,
            }),
            [410],
        );
        const expiredState = (await client.query(`
            SELECT attempt_count, consumed_at
            FROM verification_challenges
            WHERE id = $1
        `, [expired.id])).rows[0];
        const afterExpired = await recoveryAccountRow(client, account.email);
        invariant(
            expiredResponse.body?.error?.code === "PASSWORD_RESET_EXPIRED"
                && expiredState?.attempt_count === 0
                && expiredState?.consumed_at === null
                && afterExpired.password_hash === beforeExpired.password_hash
                && (await replacementSession.request("/api/v1/auth/me")).body?.data?.account?.email === account.email,
            "PASSWORD_RESET_EXPIRED_MUTATED_ACCOUNT",
            "過期密碼重設 token 改變了密碼、session 或 challenge 狀態不符契約。",
        );
        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = transaction_timestamp()
            WHERE id = $1
                AND consumed_at IS NULL
        `, [expired.id]);

        unrelatedAccount = await createSyntheticAuthClient(origin, "learner");
        const crossAccountChallenge = await seedRecoveryChallenge(client, {
            userId: stateBefore.user_id,
            identityId: stateBefore.identity_id,
            purpose: "password_reset",
        });
        const finalPassword = `final-${randomUUID()}-${randomUUID()}`;
        const crossAccountConfirm = await fetchJson(
            origin,
            "/api/v1/auth/password-reset/confirm",
            recoveryRequestInit(origin, {
                token: crossAccountChallenge.token,
                newPassword: finalPassword,
            }, unrelatedAccount.cookieHeader),
        );
        invariant(
            crossAccountConfirm.body?.data?.status === "completed"
                && crossAccountConfirm.body?.data?.affectedUserId === undefined
                && crossAccountConfirm.headers.get("set-cookie") === null
                && (await unrelatedAccount.request("/api/v1/auth/me")).body?.data?.account?.email
                    === unrelatedAccount.email
                && (await replacementSession.request("/api/v1/auth/me", undefined, [401])).body?.error?.code
                    === "AUTH_REQUIRED",
            "PASSWORD_RESET_CROSS_ACCOUNT_COOKIE_CLEARED",
            "密碼重設誤清除另一帳號的有效 cookie，或沒有撤銷目標帳號 session。",
        );
        finalSession = await loginSyntheticAuthClient(origin, {
            ...account,
            password: finalPassword,
        });

        const identityBoundChallenge = await seedRecoveryChallenge(client, {
            userId: stateBefore.user_id,
            identityId: stateBefore.identity_id,
            purpose: "password_reset",
        });
        let identityMutationCode = null;
        await client.query("BEGIN");
        try {
            await client.query("SELECT lerniqa_lock_auth_user($1::uuid)", [stateBefore.user_id]);
            await client.query(`
                UPDATE account_identities
                SET revoked_at = transaction_timestamp()
                WHERE id = $1
            `, [stateBefore.identity_id]);
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            identityMutationCode = typeof error?.code === "string" ? error.code : null;
        }
        const retainedIdentityState = await recoveryAccountRow(client, account.email);
        const identityBoundChallengeState = (await client.query(`
            SELECT consumed_at, attempt_count
            FROM verification_challenges
            WHERE id = $1
        `, [identityBoundChallenge.id])).rows[0];
        invariant(
            identityMutationCode === "23514"
                && retainedIdentityState.identity_id === stateBefore.identity_id
                && identityBoundChallengeState?.consumed_at === null
                && identityBoundChallengeState?.attempt_count === 0,
            "PASSWORD_RESET_IDENTITY_MUTATION_ACCEPTED",
            "有效密碼重設 token 存在時，電子郵件 identity 仍可被撤銷或 challenge 被改寫。",
        );

        return {
            requestPrivacy,
            passwordHashReplaced: true,
            allSessionsRevoked: true,
            replayRejected: true,
            singleActiveChallengeEnforced: true,
            expiredTokenRejectedWithoutMutation: true,
            newPasswordLogin: true,
            sameAccountCookieCleared: true,
            unrelatedAccountCookiePreserved: true,
            identityMutationBlocked: true,
        };
    }
    finally {
        await account.logout();
        if (secondSession) await secondSession.logout();
        if (replacementSession) await replacementSession.logout();
        if (finalSession) await finalSession.logout();
        if (unrelatedAccount) await unrelatedAccount.logout();
    }
}

async function verifyRolePinResetContracts(client, origin) {
    const tutorSession = await createSyntheticAuthClient(origin, "parent");
    let parentSession = null;
    let unrelatedTutorSession = null;
    try {
        parentSession = await loginSyntheticAuthClient(origin, tutorSession);
        const accountState = await recoveryAccountRow(client, tutorSession.email);
        await client.query(`
            UPDATE account_identities
            SET verified_at = transaction_timestamp()
            WHERE id = $1
        `, [accountState.identity_id]);
        const tutorIdentity = await tutorSession.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, {
                targetRole: "tutor",
                password: tutorSession.password,
            }),
        );
        invariant(
            tutorIdentity.body?.data?.account?.activeRole === "tutor",
            "ROLE_PIN_SESSION_FIXTURE_INVALID",
            "角色 PIN 驗證無法建立 tutor 目標 session。",
        );
        const roleSessionsBefore = (await client.query(`
            SELECT active_role, count(*)::integer AS count
            FROM auth_sessions
            WHERE user_id = $1
                AND revoked_at IS NULL
            GROUP BY active_role
            ORDER BY active_role
        `, [accountState.user_id])).rows;
        invariant(
            roleSessionsBefore.some((row) => row.active_role === "parent" && row.count === 1)
                && roleSessionsBefore.some((row) => row.active_role === "tutor" && row.count === 1),
            "ROLE_PIN_SESSION_FIXTURE_INVALID",
            "角色 PIN 驗證前未同時建立 parent 與 tutor session。",
        );

        const primary = await seedRecoveryChallenge(client, {
            userId: accountState.user_id,
            identityId: accountState.identity_id,
            purpose: "role_pin_reset",
            targetRole: "tutor",
            expiresInMinutes: 15,
        });
        const newPin = "482951";
        const confirmed = await fetchJson(
            origin,
            "/api/v1/auth/role-pin-reset/confirm",
            recoveryRequestInit(origin, { token: primary.token, newPin }, tutorSession.cookieHeader),
        );
        invariant(
            confirmed.body?.data?.status === "completed"
                && confirmed.body?.data?.targetRole === "tutor"
                && confirmed.body?.data?.affectedUserId === undefined
                && confirmed.headers.get("cache-control") === "no-store",
            "ROLE_PIN_RESET_CONFIRM_INVALID",
            "角色 PIN 重設確認 API 未完成、角色錯誤或允許快取敏感回應。",
        );
        verifySessionCookiePolicy(confirmed.headers, { secure: false, cleared: true });
        const credential = (await client.query(`
            SELECT pin_hash, failed_attempts, locked_until
            FROM role_pin_credentials
            WHERE user_id = $1
                AND role = 'tutor'
        `, [accountState.user_id])).rows[0];
        const challengeState = (await client.query(`
            SELECT attempt_count, consumed_at
            FROM verification_challenges
            WHERE id = $1
        `, [primary.id])).rows[0];
        invariant(
            /^scrypt-pin\$v1\$/u.test(credential?.pin_hash ?? "")
                && credential?.failed_attempts === 0
                && credential?.locked_until === null
                && challengeState?.attempt_count === 1
                && challengeState?.consumed_at !== null,
            "ROLE_PIN_RESET_DATABASE_STATE_INVALID",
            "角色 PIN hash、鎖定狀態或 challenge 消耗狀態不正確。",
        );
        const roleSessionsAfter = (await client.query(`
            SELECT active_role, revoked_at
            FROM auth_sessions
            WHERE user_id = $1
            ORDER BY active_role, created_at
        `, [accountState.user_id])).rows;
        invariant(
            roleSessionsAfter.some((row) => row.active_role === "tutor" && row.revoked_at !== null)
                && roleSessionsAfter.some((row) => row.active_role === "parent" && row.revoked_at === null),
            "ROLE_PIN_RESET_SESSION_SCOPE_INVALID",
            "角色 PIN 重設沒有只撤銷目標角色 session。",
        );
        invariant(
            (await tutorSession.request("/api/v1/auth/me", undefined, [401])).body?.error?.code === "AUTH_REQUIRED"
                && (await parentSession.request("/api/v1/auth/me")).body?.data?.account?.activeRole === "parent",
            "ROLE_PIN_RESET_COOKIE_SCOPE_INVALID",
            "角色 PIN 重設後 tutor 舊 cookie 仍可用，或 parent session 被誤撤銷。",
        );

        const replay = await fetchJson(
            origin,
            "/api/v1/auth/role-pin-reset/confirm",
            recoveryRequestInit(origin, { token: primary.token, newPin: "739204" }),
            [400],
        );
        invariant(replay.body?.error?.code === "ROLE_PIN_RESET_INVALID", "ROLE_PIN_RESET_REPLAY_ACCEPTED", "已使用的角色 PIN token 可重播。");

        const beforeExpiredHash = credential.pin_hash;
        const expired = await seedRecoveryChallenge(client, {
            userId: accountState.user_id,
            identityId: accountState.identity_id,
            purpose: "role_pin_reset",
            targetRole: "tutor",
            expiresInMinutes: -1,
        });
        const expiredResponse = await fetchJson(
            origin,
            "/api/v1/auth/role-pin-reset/confirm",
            recoveryRequestInit(origin, { token: expired.token, newPin: "739204" }),
            [410],
        );
        const expiredState = (await client.query(`
            SELECT attempt_count, consumed_at
            FROM verification_challenges
            WHERE id = $1
        `, [expired.id])).rows[0];
        const afterExpiredHash = (await client.query(`
            SELECT pin_hash
            FROM role_pin_credentials
            WHERE user_id = $1 AND role = 'tutor'
        `, [accountState.user_id])).rows[0]?.pin_hash;
        invariant(
            expiredResponse.body?.error?.code === "ROLE_PIN_RESET_EXPIRED"
                && expiredState?.attempt_count === 0
                && expiredState?.consumed_at === null
                && afterExpiredHash === beforeExpiredHash
                && (await parentSession.request("/api/v1/auth/me")).body?.data?.account?.activeRole === "parent",
            "ROLE_PIN_RESET_EXPIRED_MUTATED_ACCOUNT",
            "過期角色 PIN token 改變了 credential 或非目標角色 session。",
        );
        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = transaction_timestamp()
            WHERE id = $1
                AND consumed_at IS NULL
        `, [expired.id]);

        const unchanged = await seedRecoveryChallenge(client, {
            userId: accountState.user_id,
            identityId: accountState.identity_id,
            purpose: "role_pin_reset",
            targetRole: "tutor",
            expiresInMinutes: 15,
        });
        const unchangedResponse = await fetchJson(
            origin,
            "/api/v1/auth/role-pin-reset/confirm",
            recoveryRequestInit(origin, { token: unchanged.token, newPin }),
            [409],
        );
        const unchangedState = (await client.query(`
            SELECT attempt_count, consumed_at
            FROM verification_challenges
            WHERE id = $1
        `, [unchanged.id])).rows[0];
        invariant(
            unchangedResponse.body?.error?.code === "ROLE_PIN_UNCHANGED"
                && unchangedState?.attempt_count === 0
                && unchangedState?.consumed_at === null,
            "ROLE_PIN_UNCHANGED_CONSUMED_CHALLENGE",
            "重複角色 PIN 未被拒絕，或失敗交易消耗了 challenge。",
        );
        await client.query(`
            UPDATE verification_challenges
            SET consumed_at = transaction_timestamp()
            WHERE id = $1
                AND consumed_at IS NULL
        `, [unchanged.id]);

        unrelatedTutorSession = await createSyntheticAuthClient(origin, "tutor");
        const crossAccount = await seedRecoveryChallenge(client, {
            userId: accountState.user_id,
            identityId: accountState.identity_id,
            purpose: "role_pin_reset",
            targetRole: "tutor",
            expiresInMinutes: 15,
        });
        const crossAccountResponse = await fetchJson(
            origin,
            "/api/v1/auth/role-pin-reset/confirm",
            recoveryRequestInit(
                origin,
                { token: crossAccount.token, newPin: "739204" },
                unrelatedTutorSession.cookieHeader,
            ),
        );
        invariant(
            crossAccountResponse.body?.data?.status === "completed"
                && crossAccountResponse.body?.data?.targetRole === "tutor"
                && crossAccountResponse.body?.data?.affectedUserId === undefined
                && crossAccountResponse.headers.get("set-cookie") === null
                && (await unrelatedTutorSession.request("/api/v1/auth/me")).body?.data?.account?.activeRole
                    === "tutor",
            "ROLE_PIN_RESET_CROSS_ACCOUNT_COOKIE_CLEARED",
            "角色 PIN 重設誤清除另一帳號相同角色的有效 cookie。",
        );

        return {
            pinHashStoredSeparately: true,
            targetRoleSessionsRevoked: true,
            otherRoleSessionPreserved: true,
            replayRejected: true,
            expiredTokenRejectedWithoutMutation: true,
            unchangedPinRejectedAtomically: true,
            sameAccountTargetRoleCookieCleared: true,
            unrelatedAccountCookiePreserved: true,
        };
    }
    finally {
        await tutorSession.logout();
        if (parentSession) await parentSession.logout();
        if (unrelatedTutorSession) await unrelatedTutorSession.logout();
    }
}

async function verifyAccountRecoveryContracts(client, origin) {
    return {
        syntheticOnly: true,
        password: await verifyPasswordResetContracts(client, origin),
        rolePin: await verifyRolePinResetContracts(client, origin),
    };
}

async function verifyRegistrationRoleContracts(client, origin) {
    const roleContracts = [];
    for (const requestedRole of SYNTHETIC_ACCOUNT_ROLES) {
        const registered = await createSyntheticAuthClient(origin, requestedRole);
        let loggedIn = null;
        try {
            const state = (await client.query(`
                SELECT
                    identity.user_id,
                    app_user.account_role,
                    app_user.display_name AS user_display_name,
                    learner.display_name AS learner_display_name,
                    ARRAY(
                        SELECT role.role
                        FROM user_roles AS role
                        WHERE role.user_id = identity.user_id
                            AND role.revoked_at IS NULL
                        ORDER BY role.role
                    ) AS active_roles,
                    ARRAY(
                        SELECT DISTINCT access.access_role
                        FROM learner_access AS access
                        WHERE access.user_id = identity.user_id
                            AND access.learner_id = $2
                            AND access.accepted_at IS NOT NULL
                            AND access.revoked_at IS NULL
                        ORDER BY access.access_role
                    ) AS active_access_roles
                FROM account_identities AS identity
                JOIN users AS app_user ON app_user.id = identity.user_id
                JOIN learners AS learner ON learner.id = $2
                WHERE identity.provider = 'email'
                    AND identity.email_normalized = $1
                    AND identity.revoked_at IS NULL
                LIMIT 1
            `, [registered.email, registered.learnerId])).rows[0];
            const expectedRoles = requestedRole === "learner"
                ? ["learner"]
                : ["learner", requestedRole].sort();
            invariant(
                UUID_PATTERN.test(state?.user_id)
                    && state.account_role === requestedRole
                    && JSON.stringify(state.active_roles) === JSON.stringify(expectedRoles)
                    && JSON.stringify(state.active_access_roles) === JSON.stringify([requestedRole]),
                "REGISTRATION_ROLE_CONTRACT_MISMATCH",
                "註冊沒有建立預期的 active user roles 與 learner access role。",
                {
                    requestedRole,
                    expectedRoles,
                    activeRoles: state?.active_roles,
                    activeAccessRoles: state?.active_access_roles,
                },
            );
            if (requestedRole === "learner") {
                invariant(
                    state.user_display_name === state.learner_display_name,
                    "REGISTRATION_SELF_NAME_MISMATCH",
                    "本人學習者名稱沒有和帳號稱呼同步。",
                );
            }

            await registered.logout();
            await verifyAuthSessionRevoked(client, registered.sessionTokenHash);
            loggedIn = await loginSyntheticAuthClient(origin, registered);
            invariant(loggedIn.activeRole === requestedRole, "LOGIN_ACTIVE_ROLE_MISMATCH", "再次登入沒有選回註冊時的角色。", { requestedRole, activeRole: loggedIn.activeRole });
            roleContracts.push({
                requestedRole,
                activeRoles: state.active_roles,
                accessRole: state.active_access_roles[0],
                registrationActiveRole: requestedRole,
                loginActiveRole: loggedIn.activeRole,
            });
        }
        finally {
            await registered.logout();
            if (loggedIn) {
                await loggedIn.logout();
                await verifyAuthSessionRevoked(client, loggedIn.sessionTokenHash);
            }
        }
    }
    return roleContracts;
}

function accountMutationInit(origin, body) {
    return {
        method: "PATCH",
        headers: {
            "content-type": "application/json",
            origin: origin.origin,
        },
        body: JSON.stringify(body),
    };
}

async function verifyAccountSettingsContracts(client, origin) {
    const owner = await createSyntheticAuthClient(origin, "parent");
    const outsider = await createSyntheticAuthClient(origin, "parent");
    try {
        const initialAccount = (await owner.request("/api/v1/auth/me")).body?.data?.account;
        const initialSubjectSetting = initialAccount?.learner?.subjectSettings?.find((setting) => (
            typeof setting?.subject?.code === "string"
            && Number.isSafeInteger(setting?.lockVersion)
            && Array.isArray(setting?.availableBookVersions)
            && setting.availableBookVersions.some((version) => UUID_PATTERN.test(version?.id ?? ""))
        ));
        invariant(
            initialSubjectSetting,
            "SUBJECT_VERSION_FIXTURE_MISSING",
            "合成學習者沒有可用教材版本，無法驗證每科版本設定。",
        );
        const originalBookVersionId = initialSubjectSetting.bookVersion?.id ?? null;
        const changedBookVersionId = originalBookVersionId === null
            ? initialSubjectSetting.availableBookVersions[0].id
            : null;
        const changedSubjectVersion = await owner.request(
            "/api/v1/auth/learners/subject-settings",
            accountMutationInit(origin, {
                learnerId: owner.learnerId,
                subjectCode: initialSubjectSetting.subject.code,
                bookVersionId: changedBookVersionId,
                lockVersion: initialSubjectSetting.lockVersion,
            }),
        );
        const changedSetting = changedSubjectVersion.body?.data?.account?.learner?.subjectSettings?.find(
            (setting) => setting?.subject?.code === initialSubjectSetting.subject.code,
        );
        invariant(
            changedSetting?.bookVersion?.id === changedBookVersionId
                || (changedBookVersionId === null && changedSetting?.bookVersion === null),
            "SUBJECT_VERSION_UPDATE_MISMATCH",
            "科目版本 PATCH 沒有回傳更新後的教材版本。",
        );
        invariant(
            changedSetting.lockVersion === initialSubjectSetting.lockVersion + 1,
            "SUBJECT_VERSION_LOCK_NOT_ADVANCED",
            "科目版本更新沒有推進 optimistic lock。",
        );

        const staleSubjectVersion = await owner.request(
            "/api/v1/auth/learners/subject-settings",
            accountMutationInit(origin, {
                learnerId: owner.learnerId,
                subjectCode: initialSubjectSetting.subject.code,
                bookVersionId: originalBookVersionId,
                lockVersion: initialSubjectSetting.lockVersion,
            }),
            [409],
        );
        invariant(
            staleSubjectVersion.body?.error?.code === "LEARNER_SUBJECT_SETTING_CONFLICT",
            "SUBJECT_VERSION_STALE_LOCK_ACCEPTED",
            "科目版本設定接受了會覆蓋新值的過期 optimistic lock。",
        );
        const crossAccountSubjectVersion = await outsider.request(
            "/api/v1/auth/learners/subject-settings",
            accountMutationInit(origin, {
                learnerId: owner.learnerId,
                subjectCode: initialSubjectSetting.subject.code,
                bookVersionId: originalBookVersionId,
                lockVersion: changedSetting.lockVersion,
            }),
            [403],
        );
        invariant(
            crossAccountSubjectVersion.body?.error?.code === "LEARNER_SETTINGS_FORBIDDEN",
            "SUBJECT_VERSION_CROSS_ACCOUNT_UPDATE",
            "另一帳號可修改不屬於自己的學習者科目版本。",
        );
        const restoredSubjectVersion = await owner.request(
            "/api/v1/auth/learners/subject-settings",
            accountMutationInit(origin, {
                learnerId: owner.learnerId,
                subjectCode: initialSubjectSetting.subject.code,
                bookVersionId: originalBookVersionId,
                lockVersion: changedSetting.lockVersion,
            }),
        );
        const restoredSetting = restoredSubjectVersion.body?.data?.account?.learner?.subjectSettings?.find(
            (setting) => setting?.subject?.code === initialSubjectSetting.subject.code,
        );
        const refreshedSetting = (await owner.request("/api/v1/auth/me"))
            .body?.data?.account?.learner?.subjectSettings?.find(
                (setting) => setting?.subject?.code === initialSubjectSetting.subject.code,
            );
        invariant(
            (restoredSetting?.bookVersion?.id ?? null) === originalBookVersionId
                && restoredSetting?.lockVersion === changedSetting.lockVersion + 1
                && (refreshedSetting?.bookVersion?.id ?? null) === originalBookVersionId
                && refreshedSetting?.lockVersion === restoredSetting.lockVersion,
            "SUBJECT_VERSION_READBACK_MISMATCH",
            "科目版本設定無法由目前 session 重新讀回，或還原後狀態不一致。",
        );
        const subjectVersionSetting = {
            subjectCode: initialSubjectSetting.subject.code,
            updateReadBack: true,
            optimisticLock: true,
            crossAccountIsolation: true,
        };

        const ungrantedRole = await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, {
                targetRole: "tutor",
                password: owner.password,
            }),
            [403],
        );
        invariant(
            ungrantedRole.body?.error?.code === "ROLE_NOT_GRANTED",
            "QUICK_ROLE_GRANTED_PRIVILEGE",
            "快速角色切換可切到未授權角色。",
        );

        const wrongPassword = await owner.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, {
                targetRole: "tutor",
                password: "definitely-not-the-account-password",
            }),
            [401],
        );
        invariant(
            wrongPassword.body?.error?.code === "INVALID_CREDENTIALS",
            "IDENTITY_REAUTH_NOT_ENFORCED",
            "身份變更沒有拒絕錯誤密碼。",
        );
        const tutorGrantBeforeIdentity = await client.query(`
            SELECT 1
            FROM account_identities AS identity
            JOIN user_roles AS role ON role.user_id = identity.user_id
            WHERE identity.email_normalized = $1
                AND identity.revoked_at IS NULL
                AND role.role = 'tutor'
                AND role.revoked_at IS NULL
        `, [owner.email]);
        invariant(tutorGrantBeforeIdentity.rowCount === 0, "FAILED_IDENTITY_PARTIAL_GRANT", "錯誤密碼的身份變更留下 tutor grant。");

        const tutorIdentity = await owner.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, {
                targetRole: "tutor",
                password: owner.password,
            }),
        );
        invariant(
            tutorIdentity.body?.data?.account?.accountRole === "tutor"
                && tutorIdentity.body.data.account.activeRole === "tutor"
                && tutorIdentity.body.data.account.roles.includes("tutor")
                && !tutorIdentity.body.data.account.roles.includes("system_admin"),
            "IDENTITY_SELF_GRANT_MISMATCH",
            "身份變更沒有建立或選取預期的一般角色。",
        );
        const systemAdminGrant = await client.query(`
            SELECT 1
            FROM account_identities AS identity
            JOIN user_roles AS role ON role.user_id = identity.user_id
            WHERE identity.email_normalized = $1
                AND identity.revoked_at IS NULL
                AND role.role = 'system_admin'
                AND role.revoked_at IS NULL
        `, [owner.email]);
        invariant(systemAdminGrant.rowCount === 0, "IDENTITY_GRANTED_SYSTEM_ADMIN", "一般身份 API 建立了 system_admin grant。");
        const wrongQuickSwitchPassword = await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, {
                targetRole: "tutor",
                password: "definitely-not-the-account-password",
            }),
            [401],
        );
        invariant(
            wrongQuickSwitchPassword.body?.error?.code === "INVALID_CREDENTIALS",
            "QUICK_ROLE_REAUTH_NOT_ENFORCED",
            "快速切到 parent/tutor 沒有拒絕錯誤密碼。",
        );
        const idempotentQuickSwitch = await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, {
                targetRole: "tutor",
                password: owner.password,
            }),
        );
        invariant(
            idempotentQuickSwitch.body?.data?.account?.activeRole === "tutor"
                && idempotentQuickSwitch.headers.get("set-cookie") === null,
            "QUICK_ROLE_NOT_IDEMPOTENT",
            "切到目前角色時不應建立新 session 或改變角色。",
        );

        const learnerMode = await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, { targetRole: "learner" }),
        );
        invariant(
            learnerMode.body?.data?.account?.accountRole === "tutor"
                && learnerMode.body.data.account.activeRole === "learner"
                && learnerMode.body.data.account.learner.id === owner.learnerId
                && learnerMode.body.data.account.email === null
                && learnerMode.body.data.account.emailVerified === null
                && learnerMode.body.data.account.learners.length === 1
                && learnerMode.body.meta?.emailVerification === "hidden",
            "QUICK_ROLE_ACCOUNT_IDENTITY_CHANGED",
            "快速角色切換不應改變本人身份，受管理 learner 模式也不得揭露帳號資料。",
        );
        const forbiddenManagedLearnerIdentity = await owner.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, {
                targetRole: "parent",
                password: owner.password,
            }),
            [403],
        );
        invariant(
            forbiddenManagedLearnerIdentity.body?.error?.code === "ACCOUNT_SETTINGS_FORBIDDEN",
            "MANAGED_LEARNER_IDENTITY_BYPASS",
            "受管理學習者模式可直接變更帳號身份。",
        );
        const identityAfterForbiddenMutation = (await client.query(`
            SELECT app_user.account_role
            FROM account_identities AS identity
            JOIN users AS app_user ON app_user.id = identity.user_id
            WHERE identity.email_normalized = $1
                AND identity.revoked_at IS NULL
            LIMIT 1
        `, [owner.email])).rows[0];
        invariant(
            identityAfterForbiddenMutation?.account_role === "tutor",
            "MANAGED_LEARNER_IDENTITY_PARTIAL_WRITE",
            "被拒絕的帳號身份變更留下部分寫入。",
        );
        const currentLearnerUpdate = await owner.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update-current",
                learnerId: owner.learnerId,
                displayName: "學習者模式目前學生",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
        );
        invariant(
            currentLearnerUpdate.body?.data?.account?.accountRole === "tutor"
                && currentLearnerUpdate.body.data.account.activeRole === "learner"
                && currentLearnerUpdate.body.data.account.learner.id === owner.learnerId
                && currentLearnerUpdate.body.data.account.learner.displayName === "學習者模式目前學生",
            "CURRENT_LEARNER_UPDATE_MISMATCH",
            "learner mode 沒有只更新目前學習者的基本資料。",
        );
        const forbiddenManagedUpdate = await owner.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update",
                learnerId: owner.learnerId,
                displayName: "不可由帳號設定修改",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
            [403],
        );
        invariant(
            forbiddenManagedUpdate.body?.error?.code === "LEARNER_SETTINGS_FORBIDDEN",
            "LEARNER_MODE_ACCOUNT_SETTINGS_GUARD_MISSING",
            "learner mode 可冒用帳號層 learner update。",
        );
        await client.query(`
            UPDATE learner_access AS access
            SET can_manage_settings = false
            FROM account_identities AS identity
            WHERE identity.user_id = access.user_id
                AND identity.email_normalized = $1
                AND identity.revoked_at IS NULL
                AND access.learner_id = $2
                AND access.access_role IN ('parent', 'tutor')
                AND access.revoked_at IS NULL
        `, [owner.email, owner.learnerId]);
        const forbiddenReadOnlyCurrentUpdate = await owner.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update-current",
                learnerId: owner.learnerId,
                displayName: "唯讀 access 不可修改",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
            [403],
        );
        invariant(
            forbiddenReadOnlyCurrentUpdate.body?.error?.code === "LEARNER_SETTINGS_FORBIDDEN",
            "CURRENT_LEARNER_MANAGE_PERMISSION_MISSING",
            "learner mode 忽略 can_manage_settings=false。",
        );
        await client.query(`
            UPDATE learner_access AS access
            SET can_manage_settings = true
            FROM account_identities AS identity
            WHERE identity.user_id = access.user_id
                AND identity.email_normalized = $1
                AND identity.revoked_at IS NULL
                AND access.learner_id = $2
                AND access.access_role IN ('parent', 'tutor')
                AND access.revoked_at IS NULL
        `, [owner.email, owner.learnerId]);
        const forbiddenOtherCurrentUpdate = await owner.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update-current",
                learnerId: outsider.learnerId,
                displayName: "不可修改其他學習者",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
            [403],
        );
        invariant(
            forbiddenOtherCurrentUpdate.body?.error?.code === "LEARNER_SETTINGS_FORBIDDEN",
            "CURRENT_LEARNER_SCOPE_GUARD_MISSING",
            "learner mode 可修改非目前或跨帳號學習者。",
        );
        const forbiddenCreateId = randomUUID();
        const forbiddenCreate = await owner.request(
            "/api/v1/auth/learners",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: origin.origin,
                },
                body: JSON.stringify({
                    clientRequestId: forbiddenCreateId,
                    displayName: "模式拒絕學習者",
                    educationStatus: "enrolled",
                    gradeCode: "junior-high-1",
                    semesterCode: "semester-1",
                }),
            },
            [403],
        );
        invariant(
            forbiddenCreate.body?.error?.code === "LEARNER_SETTINGS_FORBIDDEN",
            "MANAGED_LEARNER_MODE_GUARD_MISSING",
            "受管帳號切到 learner 模式後仍可新增學習者。",
        );
        const forbiddenArtifact = await client.query(
            "SELECT 1 FROM learners WHERE id = $1",
            [forbiddenCreateId],
        );
        invariant(forbiddenArtifact.rowCount === 0, "FORBIDDEN_LEARNER_PARTIAL_WRITE", "被拒絕的新增要求留下部分資料。");

        const adultAccountMode = await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, {
                targetRole: "parent",
                password: owner.password,
            }),
        );
        invariant(
            adultAccountMode.body?.data?.account?.accountRole === "tutor"
                && adultAccountMode.body.data.account.activeRole === "parent",
            "ADULT_ACCOUNT_MODE_SWITCH_MISMATCH",
            "非 learner 的已授權成人模式不應改變持久本人身份。",
        );
        const invalidCatalogId = randomUUID();
        const invalidCatalog = await owner.request(
            "/api/v1/auth/learners",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: origin.origin,
                },
                body: JSON.stringify({
                    clientRequestId: invalidCatalogId,
                    displayName: "不存在年級",
                    educationStatus: "enrolled",
                    gradeCode: "missing-grade",
                    semesterCode: "semester-1",
                }),
            },
            [400],
        );
        invariant(invalidCatalog.body?.error?.code === "LEARNER_CATALOG_NOT_FOUND", "INVALID_LEARNER_CATALOG_ACCEPTED", "不存在的年級仍可新增學習者。");
        const invalidCatalogArtifact = await client.query(
            "SELECT 1 FROM learners WHERE id = $1",
            [invalidCatalogId],
        );
        invariant(invalidCatalogArtifact.rowCount === 0, "INVALID_CATALOG_PARTIAL_WRITE", "無效年級要求留下部分 learner 資料。");

        const learnerId = randomUUID();
        const learnerPayload = {
            clientRequestId: learnerId,
            displayName: "冪等受管學習者",
            educationStatus: "enrolled",
            gradeCode: "junior-high-1",
            semesterCode: "semester-1",
        };
        for (let replay = 0; replay < 2; replay += 1) {
            const created = await owner.request(
                "/api/v1/auth/learners",
                {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        origin: origin.origin,
                    },
                    body: JSON.stringify(learnerPayload),
                },
                [201],
            );
            invariant(
                created.body?.data?.account?.learner?.id === learnerId,
                "LEARNER_CREATE_REPLAY_MISMATCH",
                "重送新增學習者要求沒有回到同一筆資料。",
            );
        }
        const learnerRows = (await client.query(`
            SELECT
                count(DISTINCT learner.id)::integer AS learner_count,
                count(DISTINCT access.id)::integer AS access_count,
                count(DISTINCT preference.learner_id)::integer AS preference_count
            FROM learners AS learner
            LEFT JOIN learner_access AS access ON access.learner_id = learner.id
            LEFT JOIN learner_preferences AS preference ON preference.learner_id = learner.id
            WHERE learner.id = $1
        `, [learnerId])).rows[0];
        invariant(
            learnerRows?.learner_count === 1
                && learnerRows.access_count === 1
                && learnerRows.preference_count === 1,
            "LEARNER_CREATE_NOT_IDEMPOTENT",
            "重送新增學習者要求建立了重複或不完整資料。",
            learnerRows,
        );

        const changedReplay = await owner.request(
            "/api/v1/auth/learners",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: origin.origin,
                },
                body: JSON.stringify({ ...learnerPayload, displayName: "不同 payload" }),
            },
            [409],
        );
        invariant(changedReplay.body?.error?.code === "LEARNER_REQUEST_CONFLICT", "LEARNER_REPLAY_CONFLICT_MISSING", "同一識別碼可被不同 payload 重用。");
        const crossAccountReplay = await outsider.request(
            "/api/v1/auth/learners",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: origin.origin,
                },
                body: JSON.stringify(learnerPayload),
            },
            [409],
        );
        invariant(crossAccountReplay.body?.error?.code === "LEARNER_REQUEST_CONFLICT", "LEARNER_REQUEST_ID_HIJACK", "另一帳號可劫持已使用的請求識別碼。");

        const crossAccountUpdate = await outsider.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update",
                learnerId,
                displayName: "越權修改",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
            [403],
        );
        invariant(crossAccountUpdate.body?.error?.code === "LEARNER_SETTINGS_FORBIDDEN", "CROSS_ACCOUNT_LEARNER_UPDATE", "另一帳號可修改不屬於自己的學習者。");

        const gradeFixtureToken = randomUUID().replaceAll("-", "").slice(0, 10);
        const nextGradeId = randomUUID();
        const nextGradeCode = `verify-grade-${gradeFixtureToken}`;
        const oldSystemSubjectId = randomUUID();
        const nextSystemSubjectId = randomUUID();
        const customSubjectId = randomUUID();
        await client.query(`
            INSERT INTO grades (id, stage, code, name, sort_order, status)
            VALUES ($1, 'junior_high', $2, $3, 32760, 'active')
        `, [nextGradeId, nextGradeCode, `驗證年級${gradeFixtureToken}`]);
        await client.query(`
            INSERT INTO subjects (
                id, code, name, normalized_name, subject_kind, origin, owner_user_id, status
            )
            VALUES
                ($1, $2, $3, $3, 'leaf', 'system', NULL, 'active'),
                ($4, $5, $6, $6, 'leaf', 'system', NULL, 'active')
        `, [
            oldSystemSubjectId,
            `verify-old-${gradeFixtureToken}`,
            `舊年級系統科目${gradeFixtureToken}`,
            nextSystemSubjectId,
            `verify-new-${gradeFixtureToken}`,
            `新年級系統科目${gradeFixtureToken}`,
        ]);
        await client.query(`
            INSERT INTO subjects (
                id, code, name, normalized_name, subject_kind, origin, owner_user_id, status
            )
            SELECT $1, $2, $3, $3, 'leaf', 'account', identity.user_id, 'active'
            FROM account_identities AS identity
            WHERE identity.email_normalized = $4
                AND identity.revoked_at IS NULL
        `, [
            customSubjectId,
            `verify-custom-${gradeFixtureToken}`,
            `帳號自訂科目${gradeFixtureToken}`,
            owner.email,
        ]);
        await client.query(`
            INSERT INTO grade_subjects (grade_id, subject_id, is_default, sort_order)
            VALUES ($1, $2, true, 0)
        `, [nextGradeId, nextSystemSubjectId]);
        await client.query(`
            INSERT INTO learner_subject_settings (
                id, learner_id, subject_id, enabled, is_default_subject, position
            )
            VALUES
                ($1, $2, $3, true, true, 31000),
                ($4, $2, $5, true, true, 31001)
        `, [randomUUID(), learnerId, oldSystemSubjectId, randomUUID(), customSubjectId]);

        const updated = await owner.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update",
                learnerId,
                displayName: "已更新受管學習者",
                educationStatus: "enrolled",
                gradeCode: nextGradeCode,
                semesterCode: "semester-1",
            }),
        );
        const enabledSubjectCodes = (updated.body?.data?.account?.learner?.subjectSettings ?? [])
            .map((setting) => setting?.subject?.code);
        invariant(
            updated.body?.data?.account?.learner?.displayName === "已更新受管學習者"
                && updated.body.data.account.learner.gradeCode === nextGradeCode
                && enabledSubjectCodes.includes(`verify-new-${gradeFixtureToken}`)
                && enabledSubjectCodes.includes(`verify-custom-${gradeFixtureToken}`)
                && !enabledSubjectCodes.includes(`verify-old-${gradeFixtureToken}`),
            "MANAGED_LEARNER_UPDATE_MISMATCH",
            "年級更新沒有正確啟停系統科目或保留帳號自訂科目。",
            { enabledSubjectCodes },
        );
        const reconciledSettings = await client.query(`
            SELECT subject_id, enabled, is_default_subject, position
            FROM learner_subject_settings
            WHERE learner_id = $1
                AND subject_id = ANY($2::uuid[])
            ORDER BY subject_id
        `, [learnerId, [oldSystemSubjectId, nextSystemSubjectId, customSubjectId]]);
        const enabledBySubjectId = new Map(
            reconciledSettings.rows.map((row) => [row.subject_id, row]),
        );
        invariant(
            enabledBySubjectId.get(oldSystemSubjectId)?.enabled === false
                && enabledBySubjectId.get(nextSystemSubjectId)?.enabled === true
                && enabledBySubjectId.get(customSubjectId)?.enabled === true
                && enabledBySubjectId.get(customSubjectId)?.is_default_subject === true
                && enabledBySubjectId.get(customSubjectId)?.position === 31001,
            "GRADE_SUBJECT_RECONCILIATION_MISMATCH",
            "grade change 的 subject setting reconcile 不正確。",
        );

        const managedModeAfterSecondLearner = await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, { targetRole: "learner" }),
        );
        const managedAccount = managedModeAfterSecondLearner.body?.data?.account;
        invariant(
            managedAccount?.email === null
                && managedAccount.emailVerified === null
                && managedAccount.learner?.id === learnerId
                && managedAccount.learners?.length === 1
                && managedAccount.learners[0]?.id === learnerId,
            "MANAGED_LEARNER_ROSTER_LEAK",
            "受管理 learner 模式揭露了帳號信箱或其他學習者。",
        );
        await owner.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, { targetRole: "parent", password: owner.password }),
        );

        const selfIdentity = await outsider.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, { targetRole: "learner" }),
        );
        const selfAccount = selfIdentity.body?.data?.account;
        invariant(
            selfAccount?.accountRole === "learner"
                && selfAccount.activeRole === "learner"
                && selfAccount.learner?.isSelf === true
                && selfAccount.learner?.canManageSettings === true
                && selfAccount.learner?.displayName === selfAccount.displayName
                && selfAccount.learners?.length === 1
                && selfAccount.learners[0]?.id === selfAccount.learner.id,
            "SELF_LEARNER_PROVISION_MISMATCH",
            "learner 本人身份沒有建立可管理且同名的 self learner。",
        );
        const firstSelfLearnerId = selfAccount.learner.id;
        const replayedSelfIdentity = await outsider.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, { targetRole: "learner" }),
        );
        invariant(replayedSelfIdentity.body?.data?.account?.learner?.id === firstSelfLearnerId, "SELF_IDENTITY_NOT_IDEMPOTENT", "重送本人身份選取建立了第二位 self learner。");

        const selfUpdated = await outsider.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update-current",
                learnerId: firstSelfLearnerId,
                displayName: "同步本人新名稱",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
        );
        invariant(
            selfUpdated.body?.data?.account?.displayName === "同步本人新名稱"
                && selfUpdated.body.data.account.learner.displayName === "同步本人新名稱",
            "SELF_LEARNER_NAME_NOT_SYNCED",
            "本人學習者更新沒有同步帳號與 learner 名稱。",
        );
        const selfDatabaseState = (await client.query(`
            SELECT
                app_user.display_name AS user_display_name,
                learner.display_name AS learner_display_name,
                count(*) OVER ()::integer AS self_access_count,
                access.can_manage_settings
            FROM account_identities AS identity
            JOIN users AS app_user ON app_user.id = identity.user_id
            JOIN learner_access AS access
                ON access.user_id = app_user.id
                AND access.access_role = 'learner'
                AND access.revoked_at IS NULL
            JOIN learners AS learner ON learner.id = access.learner_id
            WHERE identity.email_normalized = $1
                AND identity.revoked_at IS NULL
        `, [outsider.email])).rows[0];
        invariant(
            selfDatabaseState?.self_access_count === 1
                && selfDatabaseState.can_manage_settings === true
                && selfDatabaseState.user_display_name === selfDatabaseState.learner_display_name,
            "SELF_LEARNER_DATABASE_INVARIANT_MISMATCH",
            "本人學習者的唯一性、權限或名稱同步不正確。",
        );

        const adultModeWithLearnerIdentity = await outsider.request(
            "/api/v1/auth/role",
            accountMutationInit(origin, {
                targetRole: "parent",
                password: outsider.password,
            }),
        );
        invariant(
            adultModeWithLearnerIdentity.body?.data?.account?.accountRole === "learner"
                && adultModeWithLearnerIdentity.body.data.account.activeRole === "parent",
            "LEARNER_IDENTITY_ADULT_MODE_UNSUPPORTED",
            "保留的成人角色授權切換後沒有形成可用且一致的成人模式。",
        );

        await outsider.request(
            "/api/v1/auth/identity",
            accountMutationInit(origin, {
                targetRole: "parent",
                password: outsider.password,
            }),
        );
        const managedSelfUpdate = await outsider.request(
            "/api/v1/auth/learners",
            accountMutationInit(origin, {
                action: "update",
                learnerId: firstSelfLearnerId,
                displayName: "管理模式同步本人名稱",
                educationStatus: "enrolled",
                gradeCode: "junior-high-1",
                semesterCode: "semester-1",
            }),
        );
        invariant(
            managedSelfUpdate.body?.data?.account?.accountRole === "parent"
                && managedSelfUpdate.body.data.account.displayName === "管理模式同步本人名稱"
                && managedSelfUpdate.body.data.account.learner.displayName === "管理模式同步本人名稱",
            "MANAGED_SELF_LEARNER_NAME_NOT_SYNCED",
            "parent/tutor identity 更新自己的 self learner 時未同步帳號名稱。",
        );

        return {
            quickRoleDoesNotGrant: true,
            identitySelfGrant: true,
            systemAdminUntouched: true,
            idempotentQuickRole: true,
            managedModeGuard: true,
            managedLearnerIdentityGuard: true,
            adultRoleAccountSettings: true,
            currentLearnerModeGuard: true,
            idempotentLearnerCreate: true,
            crossAccountIsolation: true,
            gradeSubjectReconciliation: true,
            subjectVersionSetting,
            selfLearnerNameSync: true,
            retainedAdultGrantSupported: true,
        };
    }
    finally {
        await owner.logout();
        await outsider.logout();
    }
}

async function verifyDatabaseIdentity(client, config) {
    const identity = (await client.query(`
        SELECT
            inet_server_addr()::text AS server_address,
            current_database() AS database_name,
            current_user AS current_user_name,
            session_user AS session_user_name,
            current_setting('data_directory') AS data_directory,
            current_setting('listen_addresses') AS listen_addresses,
            current_setting('unix_socket_directories') AS socket_directories,
            current_setting('unix_socket_permissions') AS socket_permissions,
            current_setting('port') AS server_port,
            pg_catalog.pg_is_in_recovery() AS in_recovery,
            (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = current_database()
            ) AS database_comment,
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
    invariant(identity.current_user_name === config.user && identity.session_user_name === config.user, "DATABASE_USER_MISMATCH", "PostgreSQL current_user/session_user 不是目前作業系統使用者。");
    invariant(identity.in_recovery === false, "DATABASE_IN_RECOVERY", "拒絕在 recovery 中的 PostgreSQL 執行練習整合驗證。");
    const [actualDataDirectory, expectedDataDirectory, actualSocket, expectedSocket] = await Promise.all([
        realpath(identity.data_directory).catch(() => null),
        realpath(config.expectedDataDirectory).catch(() => null),
        realpath(identity.socket_directories).catch(() => null),
        realpath(config.expectedSocket).catch(() => null),
    ]);
    invariant(actualDataDirectory !== null && actualDataDirectory === expectedDataDirectory, "DATABASE_CLUSTER_MISMATCH", "PostgreSQL data_directory 與明確核准的隔離環境不符。", {
        expected: expectedDataDirectory,
        actual: actualDataDirectory,
    });
    invariant(actualSocket !== null && actualSocket === expectedSocket, "DATABASE_SOCKET_MISMATCH", "PostgreSQL unix_socket_directories 與明確核准的 socket 不符。", {
        expected: expectedSocket,
        actual: actualSocket,
    });
    if (config.existingServer) {
        invariant(identity.database_comment === `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${config.token}`, "DATABASE_OWNERSHIP_MARKER_MISMATCH", "existing-local-server 上的隔離資料庫缺少本次一次性 ownership marker。");
    }
    else {
        invariant(identity.listen_addresses === "", "DATABASE_TCP_ENABLED", "隔離 PostgreSQL 不應啟用 TCP。");
        invariant(identity.socket_permissions === "0700", "DATABASE_SOCKET_PERMISSIONS_MISMATCH", "隔離 PostgreSQL socket 權限必須是 0700。");
    }
    const serverStartedAtMillis = new Date(identity.server_started_at).getTime();
    invariant(Number.isFinite(serverStartedAtMillis), "DATABASE_START_TIME_INVALID", "PostgreSQL 未回傳有效的啟動時間。");
    const serverStartedAt = new Date(serverStartedAtMillis).toISOString();
    return {
        database: identity.database_name,
        borrowedExistingServer: config.existingServer,
        unixSocket: true,
        socketPermissions: identity.socket_permissions,
        tcpDisabled: identity.listen_addresses === "",
        currentUser: identity.current_user_name,
        inRecovery: identity.in_recovery,
        serverStartedAt,
    };
}

async function verifyMigrations(client, expected) {
    const rows = (await client.query(`
        SELECT version, name
        FROM schema_migrations
        ORDER BY version
    `)).rows;
    invariant(rows.length === expected.length, "MIGRATION_COUNT_MISMATCH", "schema_migrations 必須與 repository migration manifest 完全一致。", {
        expected: expected.length,
        actual: rows.length,
    });
    expected.forEach(([version, name], index) => {
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

async function verifyImport(client, authenticatedLearnerId, profile) {
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
        invariant(row.original_file_name.normalize("NFC") === profile.sourceFile.normalize("NFC"), "SOURCE_DOCUMENT_SCOPE_MISMATCH", "匯入批次包含不屬於本次驗證 fixture 的來源文件。");
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
        invariant(originalSha === profile.sourceSha256, "IMPORT_SOURCE_CHECKSUM_MISMATCH", "匯入 metadata 與本次驗證 fixture 的來源雜湊不符。");
        invariant(typeof sanitizedSha === "string" && SHA256_PATTERN.test(sanitizedSha), "SANITIZED_HASH_MISSING", "來源 metadata 缺少清理後 SHA-256。");
        originalHashes.add(originalSha);
        sanitizedHashes.add(sanitizedSha);
        const relativeName = source.relativeFileName ?? source.relativePath;
        invariant(typeof relativeName === "string" && path.basename(relativeName) === relativeName, "IMPORT_RELATIVE_NAME_UNSAFE", "來源 metadata 只能保留頂層相對檔名。");
        invariant(relativeName.normalize("NFC") === profile.sourceFile.normalize("NFC"), "IMPORT_SOURCE_SCOPE_MISMATCH", "匯入 metadata 不是本次驗證 fixture 的來源文件。");
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
        invariant(row.checksum === profile.sourceSha256, "QUARANTINE_SOURCE_CHECKSUM_MISMATCH", "隔離原檔與本次驗證 fixture 的來源雜湊不符。");
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
                        revision_unit.assignment_type = 'native'
                        AND revision_unit.value_source = 'document'
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
    const publisherNumbers = questions.map((question) => String(question.code ?? "").replace(/^[0-9a-f]{16}:/iu, ""));
    const naturallySorted = [...publisherNumbers].sort(new Intl.Collator("zh-Hant", { numeric: true }).compare);
    invariant(
        publisherNumbers.every(Boolean)
            && publisherNumbers.every((value, index) => value === naturallySorted[index]),
        "QUESTION_API_ORDER_INVALID",
        "題庫 API 未依出版社題號的數字自然順序回傳。",
    );
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

function assertReferenceAnswers(referenceAnswers, question, definitions, codePrefix) {
    invariant(
        Array.isArray(referenceAnswers) && referenceAnswers.length === question.parts.length,
        `${codePrefix}_REFERENCE_ANSWER_COUNT_INVALID`,
        "已解鎖參考答案沒有涵蓋題目的全部目標小題。",
    );
    for (const part of question.parts) {
        const actual = referenceAnswers.find((answer) => answer.partId === part.id);
        const expected = definitions.get(part.id);
        invariant(isRecord(actual) && expected, `${codePrefix}_REFERENCE_ANSWER_PART_MISSING`, "參考答案缺少指定小題。", { partId: part.id });
        invariant(actual.answerMode === expected.answerMode, `${codePrefix}_REFERENCE_ANSWER_MODE_MISMATCH`, "參考答案作答方式與 pinned revision 不符。", { partId: part.id });
        invariant(
            JSON.stringify(unique(actual.answerKeys ?? []).sort()) === JSON.stringify(unique(expected.acceptedKeys).sort())
                && JSON.stringify(unique(actual.acceptedValues ?? []).sort()) === JSON.stringify(unique(expected.acceptedValues).sort()),
            `${codePrefix}_REFERENCE_ANSWER_VALUE_MISMATCH`,
            "參考答案內容與 pinned revision 不符。",
            { partId: part.id },
        );
        const expectedOptionKeys = part.options.map((option) => option.key).sort();
        const actualOptionKeys = (actual.options ?? []).map((option) => option.key).sort();
        invariant(
            JSON.stringify(actualOptionKeys) === JSON.stringify(expectedOptionKeys)
                && (actual.options ?? []).every((option) => typeof option.label === "string" && option.label.trim() !== ""),
            `${codePrefix}_REFERENCE_OPTION_LABELS_INVALID`,
            "參考答案沒有保留選項鍵與顯示文字。",
            { partId: part.id },
        );
        invariant(
            actual.explanation === null || typeof actual.explanation === "string",
            `${codePrefix}_REFERENCE_EXPLANATION_INVALID`,
            "參考答案解析必須是文字或 null。",
            { partId: part.id },
        );
    }
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

    let manualReviewCase = null;
    for (const question of questions) {
        const manualPartIds = new Set(
            question.parts
                .filter((part) => definitions.get(part.id)?.gradingPolicy === "manual_review")
                .map((part) => part.id),
        );
        if (manualPartIds.size === 0) continue;
        const answers = [];
        let selectable = true;
        for (const part of question.parts) {
            const definition = definitions.get(part.id);
            const value = definition?.gradingPolicy === "manual_review"
                ? pendingValue(part)
                : definitionIsCompleteAutomatic(definition)
                    ? correctValue(definition)
                    : null;
            if (value === null) {
                selectable = false;
                break;
            }
            answers.push({ partId: part.id, value });
        }
        if (!selectable) continue;
        manualReviewCase = { question, manualPartIds, answers };
        break;
    }
    invariant(manualReviewCase !== null, "MANUAL_REVIEW_QUESTION_NOT_FOUND", "找不到可完整提交的人工批改題驗證 pending 契約。");
    return { wrongCase, missingKeyCase, manualReviewCase };
}

async function createSession(api, questions, settings = {}) {
    const sessionId = randomUUID();
    const { body, status } = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sessionId,
            questions: questions.map((question) => ({ questionId: question.id, revisionId: question.revisionId })),
            mode: settings.mode ?? "practice",
            checkMode: settings.checkMode ?? "instant",
        }),
    }, [201]);
    const session = body?.data?.session;
    const leaks = scanForbiddenKeys(body?.data, "session");
    invariant(leaks.length === 0, "SESSION_API_LEAK", "session API 洩漏答案、解析或 storage key。", { locations: leaks.slice(0, 10) });
    invariant(status === 201 && isRecord(session) && UUID_PATTERN.test(session.id), "SESSION_API_SHAPE_INVALID", "建立練習未回傳有效 session。");
    invariant(session.id === sessionId, "SESSION_CLIENT_ID_MISMATCH", "session 未沿用 client 產生的 UUID。");
    invariant(Array.isArray(session.items) && session.items.length === questions.length, "SESSION_ITEM_COUNT_MISMATCH", "session 題目數量不符。");
    invariant(
        body?.meta?.persistence === "local-postgresql" && body?.meta?.identityMode === "authenticated",
        "SESSION_API_META_INVALID",
        "session 未使用已登入的本機 PostgreSQL 身分。",
    );
    return session;
}

async function verifySessionContracts(client, origin, api, question) {
    const sessionId = randomUUID();
    const requestBody = {
        sessionId,
        questions: [{ questionId: question.id, revisionId: question.revisionId }],
        mode: "review",
        checkMode: "complete",
    };
    const created = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
    }, [201]);
    invariant(created.body?.data?.session?.id === sessionId && created.body?.meta?.replayed === false, "SESSION_IDEMPOTENT_CREATE_FAILED", "client UUID session 第一次建立結果不正確。");

    const replay = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
    }, [200]);
    invariant(replay.body?.data?.session?.id === sessionId && replay.body?.meta?.replayed === true, "SESSION_IDEMPOTENT_REPLAY_FAILED", "相同 session 建立請求未安全重播。");

    const conflict = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...requestBody, checkMode: "score" }),
    }, [409]);
    invariant(conflict.body?.error?.code === "SESSION_IDEMPOTENCY_CONFLICT", "SESSION_IDEMPOTENCY_CONFLICT_MISSING", "相同 session UUID 搭配不同設定未回傳 409。");

    const otherAccount = await createSyntheticAuthClient(origin);
    try {
        const crossAccountPost = await otherAccount.request("/api/v1/local-practice/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(requestBody),
        }, [409]);
        invariant(crossAccountPost.body?.error?.code === "SESSION_IDEMPOTENCY_CONFLICT", "SESSION_CROSS_ACCOUNT_POST_NOT_ISOLATED", "另一帳號可用相同 UUID 重播 session。");
        const crossAccountGet = await otherAccount.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(sessionId)}`, undefined, [404]);
        invariant(crossAccountGet.body?.error?.code === "SESSION_NOT_FOUND", "SESSION_CROSS_ACCOUNT_GET_NOT_ISOLATED", "另一帳號可讀取 session。");
        const crossAccountPatch = await otherAccount.request("/api/v1/local-practice/sessions", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, status: "paused" }),
        }, [404]);
        invariant(crossAccountPatch.body?.error?.code === "SESSION_NOT_FOUND", "SESSION_CROSS_ACCOUNT_PATCH_NOT_ISOLATED", "另一帳號可變更 session 狀態。");
    }
    finally {
        await otherAccount.logout();
        await verifyAuthSessionRevoked(client, otherAccount.sessionTokenHash);
    }

    const stale = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            ...requestBody,
            sessionId: randomUUID(),
            questions: [{ questionId: question.id, revisionId: randomUUID() }],
        }),
    }, [409]);
    invariant(stale.body?.error?.code === "QUESTION_REVISION_STALE", "SESSION_STALE_REVISION_ACCEPTED", "過期 revision target 未回傳 409。");

    const getSession = async (expectedStatus) => {
        const response = await api.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(sessionId)}`);
        invariant(response.body?.data?.session?.status === expectedStatus, "SESSION_GET_STATUS_MISMATCH", "GET session 未回傳預期狀態。", { expectedStatus });
        const leaks = scanForbiddenKeys(response.body?.data, "resumedSession");
        invariant(leaks.length === 0, "SESSION_GET_API_LEAK", "GET session 洩漏答案、解析或評分 payload。", { locations: leaks.slice(0, 10) });
    };
    await getSession("active");
    for (const status of ["paused", "active", "abandoned"]) {
        const response = await api.request("/api/v1/local-practice/sessions", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, status }),
        });
        invariant(response.body?.data?.session?.status === status, "SESSION_STATUS_UPDATE_FAILED", "session lifecycle 更新未生效。", { status });
        await getSession(status);
    }

    const legacy = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionIds: [question.id] }),
    }, [201]);
    const legacySessionId = legacy.body?.data?.session?.id;
    invariant(UUID_PATTERN.test(legacySessionId), "LEGACY_SESSION_PAYLOAD_REJECTED", "舊 questionIds payload 不再相容。");
    await api.request("/api/v1/local-practice/sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: legacySessionId, status: "abandoned" }),
    });
    return {
        clientSessionId: true,
        exactReplay: true,
        conflictRejected: true,
        crossAccountIsolated: true,
        staleRevisionRejected: true,
        getAndLifecycle: true,
        legacyQuestionIds: true,
        answerOrStorageLeaks: 0,
    };
}

async function submitAttempt(api, body, expectedStatuses) {
    const response = await api.request("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }, expectedStatuses);
    const attempt = response.body?.data?.attempt;
    const leaks = scanNamedKeys(response.body?.data, FORBIDDEN_DETAILED_PRIVATE_KEYS, "attempt");
    invariant(leaks.length === 0, "ATTEMPT_API_LEAK", "作答 API 洩漏作答 payload、冪等鍵或 storage key。", { locations: leaks.slice(0, 10) });
    invariant(response.body?.data?.disclosure === "detailed", "ATTEMPT_DISCLOSURE_INVALID", "逐題檢核未回傳 detailed disclosure。");
    invariant(isRecord(attempt) && UUID_PATTERN.test(attempt.id), "ATTEMPT_API_SHAPE_INVALID", "作答 API 未回傳有效 attempt。");
    invariant(Array.isArray(attempt.parts), "ATTEMPT_PARTS_INVALID", "作答 API 未回傳小題結果。");
    invariant(Array.isArray(attempt.referenceAnswers), "ATTEMPT_REFERENCE_ANSWERS_MISSING", "逐題檢核未回傳已解鎖的參考答案。");
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

async function sessionDatabaseArtifacts(client, sessionId) {
    const result = (await client.query(`
        SELECT
            session.score_total_count,
            session.score_answered_count,
            session.score_correct_count,
            session.score_wrong_count,
            session.score_pending_count,
            ARRAY(
                SELECT receipt.id
                FROM practice_session_items AS item
                JOIN practice_score_receipts AS receipt
                    ON receipt.practice_session_item_id = item.id
                WHERE item.practice_session_id = session.id
                ORDER BY receipt.id
            ) AS receipt_ids,
            ARRAY(
                SELECT attempt.id
                FROM practice_session_items AS item
                JOIN answer_attempts AS attempt
                    ON attempt.practice_session_item_id = item.id
                WHERE item.practice_session_id = session.id
                ORDER BY attempt.id
            ) AS attempt_ids,
            ARRAY(
                SELECT part.id
                FROM practice_session_items AS item
                JOIN answer_attempts AS attempt
                    ON attempt.practice_session_item_id = item.id
                JOIN answer_part_results AS part
                    ON part.answer_attempt_id = attempt.id
                WHERE item.practice_session_id = session.id
                ORDER BY part.id
            ) AS part_result_ids,
            ARRAY(
                SELECT queue.id
                FROM practice_session_items AS item
                JOIN answer_attempts AS attempt
                    ON attempt.practice_session_item_id = item.id
                JOIN answer_part_results AS part
                    ON part.answer_attempt_id = attempt.id
                JOIN learner_practice_queue_items AS queue
                    ON queue.source_answer_part_result_id = part.id
                WHERE item.practice_session_id = session.id
                ORDER BY queue.id
            ) AS queue_ids,
            ARRAY(
                SELECT outbox.id
                FROM practice_session_items AS item
                JOIN answer_attempts AS attempt
                    ON attempt.practice_session_item_id = item.id
                JOIN analytics_outbox AS outbox
                    ON outbox.source_record_id = attempt.id
                WHERE item.practice_session_id = session.id
                ORDER BY outbox.id
            ) AS outbox_ids
        FROM practice_sessions AS session
        WHERE session.id = $1
    `, [sessionId])).rows[0];
    invariant(result, "SESSION_DATABASE_ARTIFACTS_MISSING", "找不到待驗證的 session database state。");
    return {
        receiptIds: result.receipt_ids ?? [],
        attemptIds: result.attempt_ids ?? [],
        partResultIds: result.part_result_ids ?? [],
        queueIds: result.queue_ids ?? [],
        outboxIds: result.outbox_ids ?? [],
        scoreAggregate: {
            total: numberValue(result.score_total_count),
            answered: numberValue(result.score_answered_count),
            correct: numberValue(result.score_correct_count),
            wrong: numberValue(result.score_wrong_count),
            pending: numberValue(result.score_pending_count),
        },
    };
}

async function shareLearnerWithSyntheticAccount(client, account, learnerId, canViewResults = true) {
    const accessId = randomUUID();
    const access = await client.query(`
        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_view_results,
            can_create_plans,
            can_review_answers,
            can_manage_settings,
            invited_by_user_id,
            accepted_at
        )
        SELECT
            $1::uuid,
            $2::uuid,
            identity.user_id,
            'parent',
            $4::boolean,
            false,
            false,
            false,
            NULL,
            transaction_timestamp()
        FROM account_identities AS identity
        WHERE identity.provider = 'email'
            AND identity.email_normalized = $3
            AND identity.revoked_at IS NULL
        RETURNING user_id
    `, [accessId, learnerId, account.email, canViewResults]);
    invariant(access.rowCount === 1, "SHARED_LEARNER_ACCESS_SETUP_FAILED", "無法建立第二帳號的隔離 shared learner 驗證資料。");
    const switched = await client.query(`
        UPDATE auth_sessions
        SET active_role = 'learner', active_learner_id = $1
        WHERE token_hash = $2
            AND revoked_at IS NULL
        RETURNING user_id
    `, [learnerId, account.sessionTokenHash]);
    invariant(switched.rowCount === 1, "SHARED_LEARNER_SESSION_SETUP_FAILED", "無法把第二帳號切換至 shared learner 驗證資料。");
    const me = await account.request("/api/v1/auth/me");
    invariant(me.body?.data?.account?.learner?.id === learnerId, "SHARED_LEARNER_SESSION_MISMATCH", "第二帳號沒有取得預期的 shared learner session。");
}

function assertMaskedDisclosure(data, codePrefix) {
    invariant(data?.disclosure === "masked", `${codePrefix}_DISCLOSURE_NOT_MASKED`, "未完成的練習沒有回傳 masked disclosure。");
    invariant(isRecord(data.receipt) && UUID_PATTERN.test(data.receipt.id), `${codePrefix}_RECEIPT_MISSING`, "masked disclosure 缺少有效 receipt。");
    const findings = scanNamedKeys(data, FORBIDDEN_MASKED_GRADING_KEYS, codePrefix);
    invariant(findings.length === 0, `${codePrefix}_GRADING_LEAK`, "masked disclosure 洩漏判分結果。", { locations: findings.slice(0, 10) });
}

function assertScoreDisclosure(data, expected, codePrefix) {
    invariant(data?.disclosure === "score", `${codePrefix}_DISCLOSURE_NOT_SCORE`, "計分模式完成後沒有回傳 score disclosure。");
    invariant(JSON.stringify(data.summary) === JSON.stringify(expected), `${codePrefix}_SUMMARY_MISMATCH`, "計分模式彙總不正確。", {
        expected,
        actual: data?.summary,
    });
    invariant(
        JSON.stringify(Object.keys(data.summary ?? {}).sort()) === JSON.stringify(["accuracy", "correct", "pending", "total", "wrong"]),
        `${codePrefix}_SUMMARY_SHAPE_INVALID`,
        "計分模式彙總欄位不符合契約。",
    );
    const findings = scanNamedKeys(data, FORBIDDEN_SCORE_MAPPING_KEYS, codePrefix);
    invariant(findings.length === 0, `${codePrefix}_QUESTION_RESULT_LEAK`, "計分模式建立了逐題或逐小題判分對照。", { locations: findings.slice(0, 10) });
}

function assertScoreDatabaseState(state, expected, codePrefix) {
    invariant(
        state.attemptIds.length === 0
            && state.partResultIds.length === 0
            && state.queueIds.length === 0
            && state.outboxIds.length === 0,
        `${codePrefix}_DETAIL_PERSISTED`,
        "score 模式不可保存逐題 attempt、part result、錯題佇列或 outbox。",
        {
            attemptIds: state.attemptIds,
            partResultIds: state.partResultIds,
            queueIds: state.queueIds,
            outboxIds: state.outboxIds,
        },
    );
    invariant(
        state.receiptIds.length === expected.answered,
        `${codePrefix}_RECEIPT_COUNT_MISMATCH`,
        "score 模式的無答案冪等收據數與已提交題數不一致。",
        { expected: expected.answered, actual: state.receiptIds.length },
    );
    invariant(
        JSON.stringify(state.scoreAggregate) === JSON.stringify(expected),
        `${codePrefix}_AGGREGATE_MISMATCH`,
        "score session aggregate 與預期不一致。",
        { expected, actual: state.scoreAggregate },
    );
}

async function postAttempt(api, request, expectedStatuses = [201]) {
    return api.request("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
    }, expectedStatuses);
}

async function verifyCheckModeDisclosure(client, origin, api, questions, definitions) {
    const { wrongCase } = selectAttemptCases(questions, definitions);
    const secondQuestion = questions.find((question) => question.id !== wrongCase.question.id
        && question.parts.every((part) => definitionIsCompleteAutomatic(definitions.get(part.id))));
    invariant(secondQuestion, "SECOND_AUTOMATIC_QUESTION_NOT_FOUND", "找不到第二題完整自動判分題驗證 complete/score 揭露時機。");
    const secondCorrectAnswers = secondQuestion.parts.map((part) => ({
        partId: part.id,
        value: correctValue(definitions.get(part.id)),
    }));
    const runToken = `${Date.now().toString(36)}:${randomUUID()}`;

    for (const checkMode of ["instant", "complete"]) {
        const outOfOrderSession = await createSession(
            api,
            [wrongCase.question, secondQuestion],
            { checkMode },
        );
        const lastItemFirst = await postAttempt(api, {
            sessionId: outOfOrderSession.id,
            questionId: secondQuestion.id,
            idempotencyKey: `local-practice-verify:${checkMode}-last-first:${runToken}`,
            durationSeconds: 3,
            answers: secondCorrectAnswers,
        });
        invariant(
            lastItemFirst.body?.data?.session?.status === "active",
            `${checkMode.toUpperCase()}_LAST_ITEM_COMPLETED_EARLY`,
            `${checkMode} 模式先送清單最後一題時 session 不得提早完成。`,
        );
        const outOfOrderRead = await api.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(outOfOrderSession.id)}`);
        const outOfOrderAnswered = outOfOrderRead.body?.data?.session?.items?.filter((item) => item.answered) ?? [];
        invariant(
            outOfOrderAnswered.length === 1 && outOfOrderAnswered[0].questionId === secondQuestion.id,
            `${checkMode.toUpperCase()}_LAST_ITEM_PROGRESS_INVALID`,
            `${checkMode} 模式亂序提交後的 answered progress 不正確。`,
        );
        const remainingItem = await postAttempt(api, {
            sessionId: outOfOrderSession.id,
            questionId: wrongCase.question.id,
            idempotencyKey: `local-practice-verify:${checkMode}-remaining:${runToken}`,
            durationSeconds: 4,
            answers: wrongCase.wrongAnswers,
        });
        invariant(
            remainingItem.body?.data?.session?.status === "completed",
            `${checkMode.toUpperCase()}_OUT_OF_ORDER_NOT_COMPLETED`,
            `${checkMode} 模式補送其餘題目後 session 未完成。`,
        );
    }

    const completeSession = await createSession(api, [wrongCase.question, secondQuestion], { checkMode: "complete" });
    const completeFirstRequest = {
        sessionId: completeSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:complete-first:${runToken}`,
        durationSeconds: 5,
        answers: wrongCase.wrongAnswers,
    };
    const queueBeforeComplete = (await api.request("/api/v1/local-practice/history?limit=100")).body?.data?.wrongReviewQueue;
    const completeFirst = await postAttempt(api, completeFirstRequest);
    assertMaskedDisclosure(completeFirst.body?.data, "COMPLETE_ACTIVE");
    invariant(completeFirst.body?.data?.session?.status === "active", "COMPLETE_RELEASED_EARLY", "complete 模式在全卷提交前已結束。");
    const completeFirstAttemptId = completeFirst.body.data.receipt.id;

    const completeReplay = await postAttempt(api, completeFirstRequest, [200]);
    assertMaskedDisclosure(completeReplay.body?.data, "COMPLETE_REPLAY");
    invariant(completeReplay.body?.meta?.replayed === true && completeReplay.body.data.receipt.id === completeFirstAttemptId, "COMPLETE_REPLAY_MISMATCH", "complete 模式相同冪等鍵沒有安全重播同一 receipt。");
    const completeDifferentKey = await postAttempt(api, {
        ...completeFirstRequest,
        idempotencyKey: `local-practice-verify:complete-duplicate:${runToken}`,
    }, [409]);
    invariant(completeDifferentKey.body?.error?.code === "SESSION_ITEM_ALREADY_ANSWERED", "COMPLETE_DIFFERENT_KEY_ACCEPTED", "complete 模式同一題換冪等鍵沒有回 409。");

    const completeResume = await api.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(completeSession.id)}`);
    invariant(completeResume.body?.data?.disclosure === "masked", "COMPLETE_RESUME_DISCLOSURE_INVALID", "未完成 complete session 的 GET 未保持遮罩。");
    const answeredItems = completeResume.body?.data?.session?.items?.filter((item) => item.answered) ?? [];
    invariant(answeredItems.length === 1 && answeredItems[0].questionId === wrongCase.question.id, "COMPLETE_RESUME_PROGRESS_INVALID", "resume 沒有只標示已作答 item。");
    const resumeLeaks = scanNamedKeys(completeResume.body?.data, FORBIDDEN_MASKED_GRADING_KEYS, "completeResume");
    invariant(resumeLeaks.length === 0, "COMPLETE_RESUME_GRADING_LEAK", "resume 洩漏 complete 模式判分。", { locations: resumeLeaks.slice(0, 10) });

    const completeMidHistory = (await api.request("/api/v1/local-practice/history?limit=100")).body?.data;
    const completeMidSession = completeMidHistory?.sessions?.find((session) => session.id === completeSession.id);
    invariant(completeMidSession?.disclosure === "masked" && completeMidSession.summary === undefined, "COMPLETE_HISTORY_RELEASED_EARLY", "history 在 complete session 完成前揭露結果。");
    invariant(!(completeMidHistory?.attempts ?? []).some((attempt) => attempt.sessionId === completeSession.id), "COMPLETE_HISTORY_ATTEMPT_LEAK", "history 在 complete session 完成前回傳逐題 attempt。");
    const completeArtifacts = await sessionDatabaseArtifacts(client, completeSession.id);
    invariant(completeArtifacts.attemptIds.length === 1 && completeArtifacts.queueIds.length > 0, "COMPLETE_MASK_FIXTURE_INVALID", "complete 遮罩測試沒有建立預期的錯題持久資料。");
    invariant(completeArtifacts.queueIds.every((id) => !(completeMidHistory?.wrongReviewQueue?.items ?? []).some((item) => item.id === id)), "COMPLETE_QUEUE_LEAK", "complete 未完成前可從錯題佇列反推出結果。");
    invariant(completeMidHistory?.wrongReviewQueue?.pendingCount === queueBeforeComplete?.pendingCount, "COMPLETE_QUEUE_COUNT_LEAK", "complete 未完成前錯題 pendingCount 洩漏結果。");

    const completeSecondRequest = {
        sessionId: completeSession.id,
        questionId: secondQuestion.id,
        idempotencyKey: `local-practice-verify:complete-second:${runToken}`,
        durationSeconds: 6,
        answers: secondCorrectAnswers,
    };
    const completeFinal = await postAttempt(api, completeSecondRequest);
    invariant(completeFinal.body?.data?.disclosure === "detailed" && completeFinal.body?.data?.session?.status === "completed", "COMPLETE_FINAL_NOT_RELEASED", "complete 模式完成後沒有釋出詳細結果。");
    invariant(completeFinal.body?.data?.attempts?.length === 2, "COMPLETE_FINAL_ATTEMPTS_MISSING", "complete 模式完成後未回傳整個 session 的詳細結果。");
    invariant(completeFinal.body.data.attempts.some((attempt) => attempt.overallResult === "wrong") && completeFinal.body.data.attempts.some((attempt) => attempt.overallResult === "correct"), "COMPLETE_FINAL_RESULTS_INVALID", "complete 模式完成後的詳細結果不完整。");
    for (const attempt of completeFinal.body.data.attempts) {
        const question = attempt.questionId === wrongCase.question.id ? wrongCase.question : secondQuestion;
        assertReferenceAnswers(attempt.referenceAnswers, question, definitions, "COMPLETE_FINAL");
    }
    const completeFinalReplay = await postAttempt(api, completeSecondRequest, [200]);
    invariant(completeFinalReplay.body?.meta?.replayed === true && completeFinalReplay.body?.data?.attempts?.length === 2, "COMPLETE_FINAL_REPLAY_MISMATCH", "complete 最後一題冪等重播未保持完整揭露。");
    const completeHistory = (await api.request("/api/v1/local-practice/history?limit=100")).body?.data;
    const completeFinalArtifacts = await sessionDatabaseArtifacts(client, completeSession.id);
    invariant(completeFinalArtifacts.attemptIds.length === 2, "COMPLETE_FINAL_ARTIFACTS_INVALID", "complete session 完成後沒有保留兩筆作答記錄。");
    invariant(completeFinalArtifacts.attemptIds.every((id) => (completeHistory?.attempts ?? []).some((attempt) => attempt.id === id)), "COMPLETE_HISTORY_DETAILS_MISSING", "complete session 完成後 history 未釋出所有詳細結果。");
    invariant(completeFinalArtifacts.queueIds.every((id) => (completeHistory?.wrongReviewQueue?.items ?? []).some((item) => item.id === id)), "COMPLETE_HISTORY_QUEUE_MISSING", "complete session 完成後 history 未釋出錯題佇列。");

    const abandonedSession = await createSession(api, [wrongCase.question, secondQuestion], { checkMode: "complete" });
    const abandonedFirst = await postAttempt(api, {
        ...completeFirstRequest,
        sessionId: abandonedSession.id,
        idempotencyKey: `local-practice-verify:complete-abandoned:${runToken}`,
    });
    assertMaskedDisclosure(abandonedFirst.body?.data, "COMPLETE_ABANDONED_ACTIVE");
    await api.request("/api/v1/local-practice/sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: abandonedSession.id, status: "abandoned" }),
    });
    const abandonedRead = await api.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(abandonedSession.id)}`);
    invariant(abandonedRead.body?.data?.disclosure === "masked", "COMPLETE_ABANDONED_RELEASED", "未完成即放棄的 complete session 不得解鎖詳細結果。");
    const abandonedArtifacts = await sessionDatabaseArtifacts(client, abandonedSession.id);

    const scoreSession = await createSession(api, [wrongCase.question, secondQuestion], { checkMode: "score" });
    const scoreFirstRequest = {
        ...completeSecondRequest,
        sessionId: scoreSession.id,
        idempotencyKey: `local-practice-verify:score-first:${runToken}`,
    };
    const scoreHistoryBefore = (await api.request("/api/v1/local-practice/history?limit=100")).body?.data;
    const scoreFirst = await postAttempt(api, scoreFirstRequest);
    assertMaskedDisclosure(scoreFirst.body?.data, "SCORE_ACTIVE");
    invariant(scoreFirst.body?.data?.session?.status === "active", "SCORE_LAST_ITEM_COMPLETED_EARLY", "score 模式先送清單最後一題時 session 不得提早完成。");
    const scoreFirstAttemptId = scoreFirst.body.data.receipt.id;
    const scoreProgress = await api.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(scoreSession.id)}`);
    const scoreAnsweredItems = scoreProgress.body?.data?.session?.items?.filter((item) => item.answered) ?? [];
    invariant(scoreAnsweredItems.length === 1 && scoreAnsweredItems[0].questionId === secondQuestion.id, "SCORE_LAST_ITEM_PROGRESS_INVALID", "score 模式先送最後一題後的 answered progress 不正確。");
    const scoreFirstDatabaseState = await sessionDatabaseArtifacts(client, scoreSession.id);
    assertScoreDatabaseState(scoreFirstDatabaseState, {
        total: 2,
        answered: 1,
        correct: 1,
        wrong: 0,
        pending: 1,
    }, "SCORE_FIRST");
    const scoreReplay = await postAttempt(api, scoreFirstRequest, [200]);
    assertMaskedDisclosure(scoreReplay.body?.data, "SCORE_REPLAY");
    invariant(scoreReplay.body?.meta?.replayed === true && scoreReplay.body.data.receipt.id === scoreFirstAttemptId, "SCORE_REPLAY_MISMATCH", "score 模式相同冪等鍵沒有安全重播。");
    const scoreDifferentKey = await postAttempt(api, {
        ...scoreFirstRequest,
        idempotencyKey: `local-practice-verify:score-duplicate:${runToken}`,
    }, [409]);
    invariant(scoreDifferentKey.body?.error?.code === "SESSION_ITEM_ALREADY_ANSWERED", "SCORE_DIFFERENT_KEY_ACCEPTED", "score 模式同一題換冪等鍵沒有回 409。");

    const scoreArtifactsBeforeCrossAccount = await sessionDatabaseArtifacts(client, scoreSession.id);
    await api.request("/api/v1/local-practice/sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: scoreSession.id, status: "paused" }),
    });
    const otherAccount = await createSyntheticAuthClient(origin);
    try {
        await shareLearnerWithSyntheticAccount(client, otherAccount, api.learnerId);
        const collisionSession = await createSession(otherAccount, [wrongCase.question]);
        const crossAccountIdempotencyCollision = await postAttempt(otherAccount, {
            ...completeFirstRequest,
            sessionId: collisionSession.id,
        }, [409]);
        invariant(
            crossAccountIdempotencyCollision.body?.error?.code === "IDEMPOTENCY_CONFLICT",
            "CROSS_ACCOUNT_IDEMPOTENCY_COLLISION_NOT_CONFLICT",
            "同一 learner 的另一授權帳號重用 non-score 冪等鍵時未安全回傳 409。",
        );
        const collisionArtifacts = await sessionDatabaseArtifacts(client, collisionSession.id);
        invariant(collisionArtifacts.attemptIds.length === 0, "CROSS_ACCOUNT_IDEMPOTENCY_COLLISION_WRITE", "被拒絕的跨帳號冪等鍵衝突仍寫入 attempt。");
        await otherAccount.request("/api/v1/local-practice/sessions", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: collisionSession.id, status: "abandoned" }),
        });
        const crossAccountAttempt = await postAttempt(otherAccount, scoreFirstRequest, [404, 409]);
        invariant(["SESSION_QUESTION_NOT_FOUND", "IDEMPOTENCY_CONFLICT"].includes(crossAccountAttempt.body?.error?.code), "ATTEMPT_CROSS_ACCOUNT_NOT_ISOLATED", "第二帳號可對不屬於自己的 session 提交或重播作答。");
        const crossAccountLeaks = scanNamedKeys(crossAccountAttempt.body?.data, FORBIDDEN_MASKED_GRADING_KEYS, "crossAccountAttempt");
        invariant(crossAccountLeaks.length === 0, "ATTEMPT_CROSS_ACCOUNT_RESULT_LEAK", "第二帳號 attempt 錯誤回應洩漏判分結果。");
        const afterCrossAccount = await sessionDatabaseArtifacts(client, scoreSession.id);
        invariant(JSON.stringify(afterCrossAccount) === JSON.stringify(scoreArtifactsBeforeCrossAccount), "ATTEMPT_CROSS_ACCOUNT_WRITE", "第二帳號 attempt 請求建立了新的持久紀錄。");

        const sharedHistory = (await otherAccount.request("/api/v1/local-practice/history?limit=100")).body?.data;
        const sharedCompleteSession = sharedHistory?.sessions?.find((session) => session.id === completeSession.id);
        invariant(sharedCompleteSession?.disclosure === "detailed", "SHARED_RESULTS_NOT_VISIBLE", "具有成果檢視權限的共享帳號看不到已完成 complete session。");
        invariant(completeFinalArtifacts.attemptIds.every((id) => (sharedHistory?.attempts ?? []).some((attempt) => attempt.id === id)), "SHARED_ATTEMPTS_NOT_VISIBLE", "具有成果檢視權限的共享帳號看不到 learner-wide 作答結果。");
        invariant(completeFinalArtifacts.queueIds.every((id) => (sharedHistory?.wrongReviewQueue?.items ?? []).some((item) => item.id === id)), "SHARED_QUEUE_NOT_VISIBLE", "具有成果檢視權限的共享帳號看不到 learner-wide 錯題佇列。");
        const sharedAbandonedSession = sharedHistory?.sessions?.find((session) => session.id === abandonedSession.id);
        invariant(sharedAbandonedSession?.disclosure === "masked" && sharedAbandonedSession.status === "abandoned", "SHARED_ABANDONED_RELEASED", "共享成果檢視不得解鎖未完成即放棄的 complete session。");
        invariant(abandonedArtifacts.attemptIds.every((id) => !(sharedHistory?.attempts ?? []).some((attempt) => attempt.id === id)), "SHARED_ABANDONED_ATTEMPT_LEAK", "共享成果檢視洩漏已放棄 complete session 的逐題結果。");
        invariant(abandonedArtifacts.queueIds.every((id) => !(sharedHistory?.wrongReviewQueue?.items ?? []).some((item) => item.id === id)), "SHARED_ABANDONED_QUEUE_LEAK", "共享成果檢視從錯題佇列洩漏已放棄 complete session 結果。");
        const sharedScoreSession = sharedHistory?.sessions?.find((session) => session.id === scoreSession.id);
        invariant(sharedScoreSession?.disclosure === "masked" && sharedScoreSession.status === "paused" && sharedScoreSession.summary === undefined, "SHARED_SCORE_RELEASED_EARLY", "共享成果檢視不得繞過已暫停 score session 的遮罩。");
        invariant(scoreArtifactsBeforeCrossAccount.attemptIds.every((id) => !(sharedHistory?.attempts ?? []).some((attempt) => attempt.id === id)), "SHARED_SCORE_ATTEMPT_LEAK", "共享成果檢視洩漏 score session 的逐題結果。");
        invariant(scoreArtifactsBeforeCrossAccount.queueIds.every((id) => !(sharedHistory?.wrongReviewQueue?.items ?? []).some((item) => item.id === id)), "SHARED_SCORE_QUEUE_LEAK", "共享成果檢視從錯題佇列洩漏 score session 結果。");
        const sharedReferenceRead = await otherAccount.request(
            `/api/v1/local-practice/questions/${encodeURIComponent(wrongCase.question.id)}/reference-answer?revisionId=${encodeURIComponent(wrongCase.question.revisionId)}`,
        );
        assertReferenceAnswers(
            sharedReferenceRead.body?.data?.referenceAnswers,
            wrongCase.question,
            definitions,
            "SHARED_QUESTION_REVIEW",
        );
    }
    finally {
        await otherAccount.logout();
        await verifyAuthSessionRevoked(client, otherAccount.sessionTokenHash);
    }
    await api.request("/api/v1/local-practice/sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: scoreSession.id, status: "active" }),
    });

    const restrictedAccount = await createSyntheticAuthClient(origin);
    try {
        await shareLearnerWithSyntheticAccount(client, restrictedAccount, api.learnerId, false);
        const deniedHistory = await restrictedAccount.request("/api/v1/local-practice/history?limit=100", undefined, [403]);
        invariant(deniedHistory.body?.error?.code === "RESULT_ACCESS_DENIED" && deniedHistory.body?.data === undefined, "RESULT_ACCESS_NOT_ENFORCED", "沒有成果檢視權限的共享帳號仍可讀取 history。");
        const deniedReferenceRead = await restrictedAccount.request(
            `/api/v1/local-practice/questions/${encodeURIComponent(wrongCase.question.id)}/reference-answer?revisionId=${encodeURIComponent(wrongCase.question.revisionId)}`,
            undefined,
            [403],
        );
        invariant(
            deniedReferenceRead.body?.error?.code === "RESULT_ACCESS_DENIED"
                && deniedReferenceRead.body?.data === undefined,
            "QUESTION_REFERENCE_RESULT_ACCESS_NOT_ENFORCED",
            "沒有成果檢視權限的共享帳號仍可讀取題目參考答案。",
        );

        const restrictedSession = await createSession(restrictedAccount, [wrongCase.question], { checkMode: "complete" });
        const restrictedRead = await restrictedAccount.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(restrictedSession.id)}`);
        invariant(restrictedRead.body?.data?.disclosure === "masked", "RESTRICTED_PROGRESS_NOT_MASKED", "沒有成果檢視權限的帳號讀取未完成 session 時未維持遮罩。");
        const deniedAttempt = await postAttempt(restrictedAccount, {
            ...completeFirstRequest,
            sessionId: restrictedSession.id,
            idempotencyKey: `local-practice-verify:no-result-access:${runToken}`,
        }, [403]);
        invariant(deniedAttempt.body?.error?.code === "RESULT_ACCESS_DENIED" && deniedAttempt.body?.data === undefined, "RESTRICTED_ATTEMPT_RESULT_ACCESS", "沒有成果檢視權限的帳號仍可提交並取得判分結果。");
        const restrictedArtifacts = await sessionDatabaseArtifacts(client, restrictedSession.id);
        invariant(restrictedArtifacts.attemptIds.length === 0 && restrictedArtifacts.queueIds.length === 0, "RESTRICTED_ATTEMPT_WRITE", "被拒絕的作答請求仍建立了持久紀錄。");
        await restrictedAccount.request("/api/v1/local-practice/sessions", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: restrictedSession.id, status: "abandoned" }),
        });
    }
    finally {
        await restrictedAccount.logout();
        await verifyAuthSessionRevoked(client, restrictedAccount.sessionTokenHash);
    }

    const scoreMidHistory = (await api.request("/api/v1/local-practice/history?limit=100")).body?.data;
    const scoreMidSession = scoreMidHistory?.sessions?.find((session) => session.id === scoreSession.id);
    invariant(scoreMidSession?.disclosure === "masked" && scoreMidSession.summary === undefined, "SCORE_HISTORY_RELEASED_EARLY", "score session 完成前 history 洩漏彙總或詳細結果。");
    invariant(!(scoreMidHistory?.attempts ?? []).some((attempt) => attempt.sessionId === scoreSession.id), "SCORE_HISTORY_ATTEMPT_LEAK", "score history 回傳逐題 attempt。");
    const scoreArtifacts = await sessionDatabaseArtifacts(client, scoreSession.id);
    assertScoreDatabaseState(scoreArtifacts, {
        total: 2,
        answered: 1,
        correct: 1,
        wrong: 0,
        pending: 1,
    }, "SCORE_MID");
    invariant(scoreMidHistory?.wrongReviewQueue?.pendingCount === scoreHistoryBefore?.wrongReviewQueue?.pendingCount, "SCORE_QUEUE_COUNT_LEAK", "score 模式錯題 pendingCount 洩漏結果。");

    const scoreSecondRequest = {
        ...completeFirstRequest,
        sessionId: scoreSession.id,
        idempotencyKey: `local-practice-verify:score-second:${runToken}`,
    };
    const expectedScore = { total: 2, correct: 1, wrong: 1, pending: 0, accuracy: 50 };
    const scoreFinal = await postAttempt(api, scoreSecondRequest);
    assertScoreDisclosure(scoreFinal.body?.data, expectedScore, "SCORE_FINAL");
    invariant(scoreFinal.body?.data?.session?.status === "completed", "SCORE_SESSION_NOT_COMPLETED", "score 最後一題送出後 session 未完成。");
    const scoreFinalReplay = await postAttempt(api, scoreSecondRequest, [200]);
    assertScoreDisclosure(scoreFinalReplay.body?.data, expectedScore, "SCORE_FINAL_REPLAY");
    invariant(scoreFinalReplay.body?.meta?.replayed === true, "SCORE_FINAL_REPLAY_FLAG_MISSING", "score 最後一題冪等重播未標記 replayed。");

    const scoreRead = await api.request(`/api/v1/local-practice/sessions?id=${encodeURIComponent(scoreSession.id)}`);
    assertScoreDisclosure(scoreRead.body?.data, expectedScore, "SCORE_SESSION_GET");
    const finalHistory = (await api.request("/api/v1/local-practice/history?limit=100")).body?.data;
    const scoreHistorySession = finalHistory?.sessions?.find((session) => session.id === scoreSession.id);
    invariant(scoreHistorySession?.disclosure === "score", "SCORE_HISTORY_SUMMARY_MISSING", "score history 未回傳 aggregate disclosure。");
    invariant(JSON.stringify(scoreHistorySession.summary) === JSON.stringify(expectedScore), "SCORE_HISTORY_SUMMARY_MISMATCH", "score history aggregate 不正確。");
    const finalScoreArtifacts = await sessionDatabaseArtifacts(client, scoreSession.id);
    assertScoreDatabaseState(finalScoreArtifacts, {
        total: 2,
        answered: 2,
        correct: 1,
        wrong: 1,
        pending: 0,
    }, "SCORE_FINAL");
    invariant(!(finalHistory?.attempts ?? []).some((attempt) => attempt.sessionId === scoreSession.id), "SCORE_HISTORY_DETAIL_LEAK", "score history 回傳了逐題詳細結果。");
    const historyLeaks = scanNamedKeys(finalHistory, FORBIDDEN_DETAILED_PRIVATE_KEYS, "checkModeHistory");
    invariant(historyLeaks.length === 0, "CHECK_MODE_HISTORY_PRIVATE_LEAK", "check mode history 洩漏作答 payload、storage key 或冪等鍵。", { locations: historyLeaks.slice(0, 10) });

    return {
        instant: { detailed: true },
        complete: { maskedUntilCompleted: true, detailedAttemptsAfterCompletion: 2, abandonedRemainsMasked: true },
        score: { maskedUntilCompleted: true, summary: expectedScore, perQuestionResults: false },
        idempotencyReplay: true,
        duplicateItemRejected: true,
        crossAccountAttemptIsolated: true,
        sharedLearnerResultsAuthorized: true,
        resultAccessDeniedWithoutCapability: true,
        historyRedacted: true,
    };
}

async function verifyAttemptFlow(client, api, questions, definitions) {
    const { wrongCase, missingKeyCase, manualReviewCase } = selectAttemptCases(questions, definitions);
    const runToken = `${Date.now().toString(36)}:${randomUUID()}`;

    const referenceRead = await api.request(
        `/api/v1/local-practice/questions/${encodeURIComponent(wrongCase.question.id)}/reference-answer?revisionId=${encodeURIComponent(wrongCase.question.revisionId)}`,
    );
    assertReferenceAnswers(
        referenceRead.body?.data?.referenceAnswers,
        wrongCase.question,
        definitions,
        "QUESTION_REVIEW",
    );
    const uppercaseReferenceRead = await api.request(
        `/api/v1/local-practice/questions/${encodeURIComponent(wrongCase.question.id.toUpperCase())}/reference-answer?revisionId=${encodeURIComponent(wrongCase.question.revisionId.toUpperCase())}`,
    );
    assertReferenceAnswers(
        uppercaseReferenceRead.body?.data?.referenceAnswers,
        wrongCase.question,
        definitions,
        "QUESTION_REVIEW_UPPERCASE_UUID",
    );
    const staleReferenceRead = await api.request(
        `/api/v1/local-practice/questions/${encodeURIComponent(wrongCase.question.id)}/reference-answer?revisionId=${encodeURIComponent(randomUUID())}`,
        undefined,
        [404],
    );
    invariant(staleReferenceRead.body?.error?.code === "QUESTION_REFERENCE_NOT_FOUND", "QUESTION_REVIEW_STALE_REVISION_ACCEPTED", "題目總覽答案 API 接受了非 current revision。");

    const duplicateCaseVariant = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            questions: [
                {
                    questionId: wrongCase.question.id,
                    revisionId: wrongCase.question.revisionId,
                    partId: wrongCase.targetPartId,
                },
                {
                    questionId: wrongCase.question.id.toUpperCase(),
                    revisionId: wrongCase.question.revisionId.toUpperCase(),
                    partId: wrongCase.targetPartId.toUpperCase(),
                },
            ],
        }),
    }, [400]);
    invariant(duplicateCaseVariant.body?.error?.code === "INVALID_SESSION_REQUEST", "UUID_CASE_DUPLICATE_ACCEPTED", "UUID 大小寫變體繞過了重複小題檢查。");
    const overlappingWholeAndPart = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            questions: [
                { questionId: wrongCase.question.id, revisionId: wrongCase.question.revisionId },
                {
                    questionId: wrongCase.question.id,
                    revisionId: wrongCase.question.revisionId,
                    partId: wrongCase.targetPartId,
                },
            ],
        }),
    }, [400]);
    invariant(overlappingWholeAndPart.body?.error?.code === "INVALID_SESSION_REQUEST", "WHOLE_AND_PART_OVERLAP_ACCEPTED", "整題與其指定小題可同時加入同一輪練習。");

    const correctSession = await createSession(api, [wrongCase.question]);
    const correctRequest = {
        sessionId: correctSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:correct:${runToken}`,
        durationSeconds: 2,
        answers: wrongCase.correctAnswers,
    };
    const correctResponse = await submitAttempt(api, correctRequest, [201]);
    assertReferenceAnswers(correctResponse.attempt.referenceAnswers, wrongCase.question, definitions, "INSTANT_CORRECT");
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
    const freshKeyDuplicate = await api.request("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            ...correctRequest,
            idempotencyKey: `local-practice-verify:correct-fresh-key:${runToken}`,
        }),
    }, [409]);
    invariant(
        freshKeyDuplicate.body?.error?.code === "SESSION_ITEM_ALREADY_ANSWERED",
        "INSTANT_FRESH_KEY_DUPLICATE_ACCEPTED",
        "instant 模式同一 session item 使用新冪等鍵時仍可建立第二次作答。",
    );
    const correctAttemptCount = (await client.query(`
        SELECT count(*)::integer AS count
        FROM answer_attempts AS attempt
        WHERE attempt.practice_session_item_id = $1
    `, [correctResponse.attempt.sessionItemId])).rows[0]?.count;
    invariant(correctAttemptCount === 1, "INSTANT_FRESH_KEY_DUPLICATE_ROWS", "拒絕新冪等鍵後仍留下重複作答。");

    const wrongSession = await createSession(api, [wrongCase.question]);
    const wrongRequest = {
        sessionId: wrongSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:wrong:${runToken}`,
        durationSeconds: 3,
        answers: wrongCase.wrongAnswers,
    };
    const wrongResponse = await submitAttempt(api, wrongRequest, [201]);
    assertReferenceAnswers(wrongResponse.attempt.referenceAnswers, wrongCase.question, definitions, "INSTANT_WRONG");
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

    const wrongQueueItemId = (await client.query(`
        SELECT queue.id
        FROM learner_practice_queue_items AS queue
        WHERE queue.source_answer_part_result_id = (
            SELECT part.id
            FROM answer_part_results AS part
            WHERE part.answer_attempt_id = $1
                AND part.question_part_id = $2
        )
            AND queue.status = 'pending'
        LIMIT 1
    `, [wrongResponse.attempt.id, wrongCase.targetPartId])).rows[0]?.id;
    invariant(UUID_PATTERN.test(wrongQueueItemId ?? ""), "RECOMMENDATION_SOURCE_QUEUE_MISSING", "錯題沒有可供推薦 API 驗證的 durable queue item。");
    const recommendationPreview = await api.request("/api/v1/local-practice/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "preview", sourceQueueItemIds: [wrongQueueItemId], limit: 5 }),
    });
    invariant(
        recommendationPreview.body?.data?.recommendationKind === "same_template"
            && recommendationPreview.body.data.questions.length > 0,
        "RECOMMENDATION_PREVIEW_EMPTY",
        "合成錯題沒有取得可追溯的相同或相近題候選。",
        recommendationPreview.body?.data,
    );
    const recommendationSessionId = randomUUID();
    const recommendationStartBody = {
        action: "start",
        sourceQueueItemIds: [wrongQueueItemId],
        limit: 5,
        checkMode: "instant",
        sessionId: recommendationSessionId,
    };
    const recommendationStart = await api.request("/api/v1/local-practice/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(recommendationStartBody),
    }, [201]);
    const recommendationOrigins = (await client.query(`
        SELECT
            origin.match_basis,
            origin.question_template_id,
            origin.shared_relation_count,
            origin.relation_method_version,
            origin.relation_evidence
        FROM practice_session_items AS item
        JOIN practice_session_item_origins AS origin
            ON origin.practice_session_item_id = item.id
        WHERE item.practice_session_id = $1
    `, [recommendationSessionId])).rows;
    invariant(
        recommendationStart.body?.data?.session?.id === recommendationSessionId
            && recommendationOrigins.length > 0
            && recommendationOrigins.every((origin) => (
                origin.match_basis === "same_template"
                && UUID_PATTERN.test(origin.question_template_id ?? "")
                && origin.shared_relation_count === 0
                && origin.relation_method_version === "confirmed-relation-v1"
                && origin.relation_evidence?.template_id === origin.question_template_id
            )),
        "RECOMMENDATION_SESSION_PROVENANCE_MISSING",
        "相同或相近題 session 沒有保存完整選題依據。",
        { origins: recommendationOrigins },
    );
    const recommendationReplay = await api.request("/api/v1/local-practice/recommendations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(recommendationStartBody),
    }, [200]);
    invariant(
        recommendationReplay.body?.meta?.replayed === true
            && recommendationReplay.body?.data?.session?.id === recommendationSessionId,
        "RECOMMENDATION_SESSION_REPLAY_MISMATCH",
        "相同的推薦請求沒有安全重播原 session。",
    );

    const partSessionResponse = await api.request("/api/v1/local-practice/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            sessionId: randomUUID(),
            questions: [{
                questionId: wrongCase.question.id,
                revisionId: wrongCase.question.revisionId,
                partId: wrongCase.targetPartId,
            }],
            mode: "review",
            checkMode: "instant",
        }),
    }, [201]);
    const partSession = partSessionResponse.body?.data?.session;
    const partSessionItem = partSession?.items?.[0];
    invariant(
        partSession?.items?.length === 1
            && partSessionItem?.partId === wrongCase.targetPartId
            && UUID_PATTERN.test(partSessionItem.id),
        "WRONG_REVIEW_PART_TARGET_MISSING",
        "錯題複習 session 沒有固定指定小題。",
    );
    const selectionReason = (await client.query(`
        SELECT selection_reason
        FROM practice_session_items
        WHERE id = $1
    `, [partSessionItem.id])).rows[0]?.selection_reason;
    invariant(selectionReason === "wrong_review", "WRONG_REVIEW_SELECTION_REASON_INVALID", "指定小題 session item 沒有標記 wrong_review。");
    const partAnswer = wrongCase.correctAnswers.find((answer) => answer.partId === wrongCase.targetPartId);
    invariant(partAnswer, "WRONG_REVIEW_PART_ANSWER_MISSING", "找不到指定小題的合成作答。");
    const partReviewResponse = await submitAttempt(api, {
        sessionId: partSession.id,
        sessionItemId: partSessionItem.id,
        questionId: wrongCase.question.id,
        partId: wrongCase.targetPartId,
        idempotencyKey: `local-practice-verify:part-review:${runToken}`,
        durationSeconds: 2,
        answers: [partAnswer],
    }, [201]);
    invariant(
        partReviewResponse.attempt.parts.length === 1
            && partReviewResponse.attempt.parts[0].partId === wrongCase.targetPartId
            && partReviewResponse.attempt.parts[0].result === "correct"
            && partReviewResponse.attempt.referenceAnswers.length === 1
            && partReviewResponse.attempt.referenceAnswers[0].partId === wrongCase.targetPartId,
        "WRONG_REVIEW_PART_SCOPE_INVALID",
        "指定小題答對後的判分或答案揭露未維持在該小題。",
    );
    const partReviewState = await attemptDatabaseState(
        client,
        api.learnerId,
        partReviewResponse.attempt.id,
        `local-practice-verify:part-review:${runToken}`,
    );
    invariant(
        partReviewState.attempts === 1
            && partReviewState.part_results === 1
            && partReviewState.wrong_parts === 0
            && partReviewState.pending_parts === 0
            && partReviewState.wrong_queue_items === 0,
        "WRONG_REVIEW_CORRECT_RESULT_MISMATCH",
        "指定錯題小題答對後仍被判錯、建立新錯題或保存了額外小題。",
        partReviewState,
    );

    const manualReviewSession = await createSession(api, [manualReviewCase.question]);
    const manualReviewRequest = {
        sessionId: manualReviewSession.id,
        questionId: manualReviewCase.question.id,
        idempotencyKey: `local-practice-verify:manual-review:${runToken}`,
        durationSeconds: 3,
        answers: manualReviewCase.answers,
    };
    const manualReviewResponse = await submitAttempt(api, manualReviewRequest, [201]);
    assertReferenceAnswers(
        manualReviewResponse.attempt.referenceAnswers,
        manualReviewCase.question,
        definitions,
        "MANUAL_REVIEW",
    );
    const manualResultParts = manualReviewResponse.attempt.parts.filter(
        (part) => manualReviewCase.manualPartIds.has(part.partId),
    );
    invariant(
        manualReviewResponse.attempt.overallResult === "pending"
            && manualReviewResponse.attempt.parts.every((part) => part.result !== "wrong")
            && manualResultParts.length === manualReviewCase.manualPartIds.size
            && manualResultParts.every((part) => (
                part.result === "pending"
                && part.gradingSource === "manual_review"
                && part.feedbackCode === "manual_review"
            )),
        "MANUAL_REVIEW_MISGRADED",
        "人工批改小題被自動判定正確或錯誤。",
    );
    const manualReviewState = await attemptDatabaseState(
        client,
        api.learnerId,
        manualReviewResponse.attempt.id,
        manualReviewRequest.idempotencyKey,
    );
    invariant(
        manualReviewState.attempts === 1
            && manualReviewState.part_results === manualReviewCase.question.parts.length
            && manualReviewState.pending_parts >= manualReviewCase.manualPartIds.size
            && manualReviewState.wrong_parts === 0
            && manualReviewState.wrong_queue_items === 0
            && manualReviewState.outbox_events === 1,
        "MANUAL_REVIEW_DATABASE_MISMATCH",
        "人工批改題沒有以 pending 保存，或誤建錯題佇列。",
        manualReviewState,
    );

    const handwrittenPart = manualReviewCase.question.parts.find(
        (part) => manualReviewCase.manualPartIds.has(part.id) && part.answerMode === "text",
    );
    invariant(handwrittenPart, "HANDWRITING_TEXT_PART_NOT_FOUND", "找不到可用手寫補答的人工批改文字小題。");
    const handwritingSession = await createSession(api, [manualReviewCase.question]);
    const handwritingRequest = {
        sessionId: handwritingSession.id,
        questionId: manualReviewCase.question.id,
        idempotencyKey: `local-practice-verify:handwriting:${runToken}`,
        durationSeconds: 4,
        answers: manualReviewCase.answers.filter((answer) => answer.partId !== handwrittenPart.id),
        handwriting: { dataUrl: SYNTHETIC_HANDWRITING_DATA_URL },
    };
    const handwritingResponse = await submitAttempt(api, handwritingRequest, [201]);
    const handwritingPart = handwritingResponse.attempt.parts.find((part) => part.partId === handwrittenPart.id);
    const handwritingState = (await client.query(`
        SELECT
            result.current_result,
            result.grading_source,
            result.answer_payload->>'value' AS transcription,
            asset.checksum AS stored_checksum,
            count(job.id)::integer AS analysis_jobs
        FROM answer_attempts AS attempt
        JOIN answer_part_results AS result
            ON result.answer_attempt_id = attempt.id
            AND result.question_part_id = $2
        JOIN answer_part_assets AS link
            ON link.answer_part_result_id = result.id
            AND link.asset_role = 'handwriting'
        JOIN assets AS asset ON asset.id = link.asset_id
        LEFT JOIN handwriting_analysis_jobs AS job
            ON job.answer_part_result_id = result.id
            AND job.asset_id = asset.id
        WHERE attempt.id = $1
        GROUP BY result.id, asset.id
    `, [handwritingResponse.attempt.id, handwrittenPart.id])).rows;
    invariant(
        handwritingPart
            && handwritingPart.result !== "pending"
            && handwritingPart.gradingSource === "automatic"
            && ["correct", "wrong"].includes(handwritingPart.feedbackCode)
            && handwritingState.length === 1
            && handwritingState[0].current_result === handwritingPart.result
            && handwritingState[0].grading_source === "automatic"
            && typeof handwritingState[0].transcription === "string"
            && handwritingState[0].transcription.trim() !== ""
            && handwritingState[0].stored_checksum?.length === 64
            && Number(handwritingState[0].analysis_jobs) === 0,
        "HANDWRITING_IMMEDIATE_GRADING_MISMATCH",
        "清楚手寫補答沒有立即轉成文字、交由標準答案規則判分並保存原始手寫附件。",
        { part: handwritingPart, state: handwritingState },
    );

    const missingAnswerSession = await createSession(api, [wrongCase.question]);
    const missingAnswerRequest = {
        sessionId: missingAnswerSession.id,
        questionId: wrongCase.question.id,
        idempotencyKey: `local-practice-verify:missing-answer:${runToken}`,
        durationSeconds: 1,
        answers: [],
    };
    const missingAnswerResponse = await api.request("/api/v1/local-practice/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(missingAnswerRequest),
    }, [400]);
    invariant(missingAnswerResponse.body?.error?.code === "INCOMPLETE_ANSWER", "MISSING_ANSWER_ACCEPTED", "未完成指定 item 的全部小題仍可提交。");
    const missingAnswerArtifacts = await sessionDatabaseArtifacts(client, missingAnswerSession.id);
    invariant(missingAnswerArtifacts.attemptIds.length === 0, "MISSING_ANSWER_DATABASE_WRITE", "拒絕未完成作答後仍留下 attempt。");
    await api.request("/api/v1/local-practice/sessions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: missingAnswerSession.id, status: "abandoned" }),
    });

    let missingKeySummary = { status: "not_available", reason: "no-selectable-automatic-missing-key" };
    const attemptIds = [
        correctResponse.attempt.id,
        wrongResponse.attempt.id,
        partReviewResponse.attempt.id,
        manualReviewResponse.attempt.id,
    ];
    let missingKeySessionId = null;
    if (missingKeyCase) {
        const missingKeySession = await createSession(api, [missingKeyCase.question]);
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
    const historyLeaks = scanNamedKeys(historyBody?.data, FORBIDDEN_DETAILED_PRIVATE_KEYS, "history");
    invariant(historyLeaks.length === 0, "HISTORY_API_LEAK", "歷史 API 洩漏作答 payload、冪等鍵或 storage key。", { locations: historyLeaks.slice(0, 10) });
    const historyAttempts = historyBody?.data?.attempts;
    const queueItems = historyBody?.data?.wrongReviewQueue?.items;
    invariant(Array.isArray(historyAttempts) && attemptIds.every((id) => historyAttempts.some((attempt) => attempt.id === id)), "HISTORY_ATTEMPT_MISSING", "歷史 API 找不到剛建立的作答。");
    invariant(
        Array.isArray(queueItems)
            && !queueItems.some((item) => (
                item.questionId === wrongCase.question.id
                && item.partId === wrongCase.targetPartId
            )),
        "HISTORY_RESOLVED_WRONG_QUEUE_PRESENT",
        "指定小題已有較新的正確作答，歷史 API 仍回傳舊錯題佇列。",
    );

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
            questionId: wrongCase.question.id,
            partId: wrongCase.targetPartId,
            result: wrongResponse.attempt.overallResult,
            wrongParts: stateAfterReplay.wrong_parts,
            wrongQueueItems: stateAfterReplay.wrong_queue_items,
            outboxEvents: stateAfterReplay.outbox_events,
            idempotencyReplay: true,
        },
        wrongReviewAttempt: {
            attemptId: partReviewResponse.attempt.id,
            questionId: wrongCase.question.id,
            partId: wrongCase.targetPartId,
            result: partReviewResponse.attempt.overallResult,
            scopedToOnePart: true,
        },
        manualReviewAttempt: {
            attemptId: manualReviewResponse.attempt.id,
            result: manualReviewResponse.attempt.overallResult,
            pendingParts: manualReviewState.pending_parts,
            wrongQueueItems: manualReviewState.wrong_queue_items,
        },
        missingAnswerAttempt: {
            rejected: true,
            code: missingAnswerResponse.body?.error?.code,
        },
        missingKeyAttempt: missingKeySummary,
        attemptIds,
        historyVisible: true,
    };
}

async function verifyPracticeReadbackAfterNewLogin(client, origin, registeredAccount, flow) {
    const loggedIn = await loginSyntheticAuthClient(origin, registeredAccount);
    try {
        invariant(
            loggedIn.learnerId === registeredAccount.learnerId,
            "PRACTICE_RELOGIN_LEARNER_CHANGED",
            "同一帳號建立新登入後沒有回到原學習者。",
        );
        const history = (await loggedIn.request("/api/v1/local-practice/history?limit=100"))
            .body?.data;
        const attemptIds = new Set((history?.attempts ?? []).map((attempt) => attempt.id));
        invariant(
            flow.attemptIds.every((attemptId) => attemptIds.has(attemptId)),
            "PRACTICE_RELOGIN_HISTORY_MISSING",
            "同一帳號建立新登入後無法讀回既有作答成果。",
            {
                expected: flow.attemptIds.length,
                visible: flow.attemptIds.filter((attemptId) => attemptIds.has(attemptId)).length,
            },
        );
        invariant(
            (history?.wrongReviewQueue?.items ?? []).some((item) => (
                item.questionId === flow.wrongAttempt.questionId
                && item.partId === flow.wrongAttempt.partId
            )),
            "PRACTICE_RELOGIN_WRONG_QUEUE_MISSING",
            "同一帳號建立新登入後無法讀回 learner + part 錯題。",
        );
        return {
            learnerIdStable: true,
            attemptCount: flow.attemptIds.length,
            wrongPartVisible: true,
        };
    }
    finally {
        await loggedIn.logout();
        await verifyAuthSessionRevoked(client, loggedIn.sessionTokenHash);
    }
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

async function verifyPersistedAttempts(
    client,
    api,
    attemptIds,
    previousDatabaseStartedAt,
    currentDatabaseStartedAt,
    requireDatabaseRestart,
) {
    invariant(attemptIds.length > 0, "PERSISTED_ATTEMPT_IDS_REQUIRED", "VERIFY_PERSISTENCE_ONLY 需要 PERSISTED_ATTEMPT_IDS 或 PERSISTED_ATTEMPT_IDS_FILE。");
    invariant(previousDatabaseStartedAt !== undefined, "PERSISTED_DATABASE_START_REQUIRED", "持久性驗證需要先前完整驗證輸出的 databaseStartedAt；請使用 PERSISTED_ATTEMPT_IDS_FILE，或提供 PERSISTED_DATABASE_STARTED_AT。");
    if (requireDatabaseRestart) {
        invariant(
            Date.parse(currentDatabaseStartedAt) > Date.parse(previousDatabaseStartedAt),
            "DATABASE_RESTART_NOT_OBSERVED",
            "PostgreSQL 啟動時間沒有晚於第一次驗證；必須先停止並重新啟動本機資料庫。",
            { previousDatabaseStartedAt, currentDatabaseStartedAt },
        );
    }
    else {
        invariant(
            currentDatabaseStartedAt === previousDatabaseStartedAt,
            "BORROWED_DATABASE_RESTARTED",
            "借用的 existing-local-server 在兩次驗證間被重新啟動；無法證明 runner 沒有干預該服務。",
            { previousDatabaseStartedAt, currentDatabaseStartedAt },
        );
    }
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
    const historyLeaks = scanNamedKeys(body?.data, FORBIDDEN_DETAILED_PRIVATE_KEYS, "persistedHistory");
    invariant(historyLeaks.length === 0, "PERSISTED_HISTORY_API_LEAK", "重啟後歷史 API 洩漏作答 payload、storage key 或冪等鍵。", { locations: historyLeaks.slice(0, 10) });
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
            verified: requireDatabaseRestart,
            skipped: !requireDatabaseRestart,
            reason: requireDatabaseRestart ? undefined : "borrowed-existing-server",
            serverRemainedRunning: !requireDatabaseRestart,
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
    await verifyIsolationMarker(config);
    const origin = baseUrl();
    const migrationManifest = await expectedMigrations();
    const selectedCatalogProfile = catalogProfile();
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
            const migrations = await verifyMigrations(client, migrationManifest);
            const forwardedHttpsSession = await verifyForwardedHttpsSessionLifecycle(client, origin);
            const roleContracts = await verifyRegistrationRoleContracts(client, origin);
            const accountSettings = await verifyAccountSettingsContracts(client, origin);
            const accountRecovery = persistenceOnly
                ? null
                : await verifyAccountRecoveryContracts(client, origin);
            const api = await createSyntheticAuthClient(origin);
            let output;
            try {
                if (persistenceOnly) {
                    const importVerification = await verifyImport(client, api.learnerId, selectedCatalogProfile);
                    const persistence = await verifyPersistedAttempts(
                        client,
                        api,
                        persistedAttemptIds,
                        persistenceEvidence.databaseStartedAt,
                        database.serverStartedAt,
                        !config.existingServer,
                    );
                    output = {
                        ok: true,
                        mode: "persistence-only",
                        catalogProfile: selectedCatalogProfile.name,
                        baseUrl: origin.origin,
                        database,
                        migrations,
                        auth: {
                            synthetic: true,
                            emailDomain: api.emailDomain,
                            learnerId: api.learnerId,
                            forwardedHttpsSession,
                            roleContracts,
                            accountSettings,
                        },
                        import: importVerification.summary,
                        persistence,
                    };
                }
                else {
                    const importVerification = await verifyImport(client, api.learnerId, selectedCatalogProfile);
                    const catalog = await loadQuestions(api);
                    invariant(
                        catalog.total === EXPECTED_IMPORT.approved,
                        "QUESTION_API_EXACT_COUNT_MISMATCH",
                        "國語／國一／翰林／第一冊／第四課必須精確回傳 279 題。",
                        { expected: EXPECTED_IMPORT.approved, actual: catalog.total },
                    );
                    const apiRevisionIds = new Set(catalog.questions.map((question) => question.revisionId));
                    invariant(importVerification.publishedRevisionIds.every((id) => apiRevisionIds.has(id)), "IMPORTED_QUESTION_MISSING_FROM_API", "題庫 API 未完整提供本批已發布題目。", {
                        importedRevisions: importVerification.publishedRevisionIds.length,
                        apiQuestions: catalog.total,
                        missing: importVerification.publishedRevisionIds.filter((id) => !apiRevisionIds.has(id)).length,
                    });
                    const definitions = await loadGradeDefinitions(client, catalog.questions);
                    const sessionContracts = await verifySessionContracts(client, origin, api, catalog.questions[0]);
                    const flow = await verifyAttemptFlow(client, api, catalog.questions, definitions);
                    const checkModeDisclosure = await verifyCheckModeDisclosure(client, origin, api, catalog.questions, definitions);
                    const practiceRelogin = await verifyPracticeReadbackAfterNewLogin(
                        client,
                        origin,
                        api,
                        flow,
                    );
                    const suppliedPersistence = persistedAttemptIds.length > 0
                        ? await verifyPersistedAttempts(
                            client,
                            api,
                            persistedAttemptIds,
                            persistenceEvidence.databaseStartedAt,
                            database.serverStartedAt,
                            !config.existingServer,
                        )
                        : null;
                    output = {
                        ok: true,
                        mode: "full",
                        catalogProfile: selectedCatalogProfile.name,
                        baseUrl: origin.origin,
                        database,
                        migrations,
                        auth: {
                            synthetic: true,
                            emailDomain: api.emailDomain,
                            learnerId: api.learnerId,
                            forwardedHttpsSession,
                            roleContracts,
                            accountSettings,
                            accountRecovery,
                        },
                        import: importVerification.summary,
                        catalog: {
                            questions: catalog.total,
                            pages: catalog.pageCount,
                            answerOrStorageLeaks: 0,
                        },
                        sessionContracts,
                        practice: flow,
                        practiceRelogin,
                        checkModeDisclosure,
                        suppliedPersistence,
                        persistence: {
                            attemptIds: flow.attemptIds,
                            databaseStartedAt: database.serverStartedAt,
                            nextCheck: config.existingServer
                                ? "npm run test:local-practice 會重啟隔離 Next，但保持借用的 PostgreSQL 持續運行，再驗證作答持久性。"
                                : "npm run test:local-practice 會在同一次隔離執行中自動重啟臨時 PostgreSQL 與 Next，並驗證作答持久性。",
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
