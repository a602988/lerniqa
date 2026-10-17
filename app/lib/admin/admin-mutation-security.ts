import type { QueryResultRow } from "pg";

import {
    type AdminQueryRunner,
    readAdminSessionToken,
    requireSystemAdminToken,
    type SystemAdminActor,
} from "./admin-auth.ts";
import { resolveAdminRequestId } from "./admin-observability.ts";
import {
    AdminApiError,
    type AdminMutationEvidence,
} from "./admin-types.ts";

export type { AdminMutationEvidence } from "./admin-types.ts";

export const ADMIN_CSRF_HEADER = "x-lerniqa-csrf";
export const ADMIN_CSRF_HEADER_VALUE = "same-origin";
export const ADMIN_IDEMPOTENCY_HEADER = "idempotency-key";
export const ADMIN_MUTATION_MAX_BODY_BYTES = 64 * 1024;

const ADMIN_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CANONICAL_UUID_V4_OR_V7 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SERVER_EVIDENCE_FIELDS = new Set(["idempotencyKey", "requestId"]);

export interface AdminMutationTransactionProvider {
    runInTransaction<Result>(
        operation: (runner: AdminQueryRunner) => Promise<Result>,
    ): Promise<Result>;
}

interface MutationAuthLockRow extends QueryResultRow {
    locked: null;
}

/**
 * Every role, account-status and session mutation uses the same database
 * advisory lock. Taking it before the second authorization check prevents a
 * concurrent revocation from committing between authorization and mutation.
 */
export const ADMIN_MUTATION_AUTH_LOCK_SQL = `
    SELECT lerniqa_lock_auth_user($1::uuid) AS locked
`;

function forbiddenMutationRequest(): AdminApiError {
    return new AdminApiError(
        "FORBIDDEN",
        "這個管理操作必須從同一個 Lerniqa 頁面送出。",
        403,
    );
}

function invalidMutationInput(message: string): AdminApiError {
    return new AdminApiError("INVALID_INPUT", message, 422);
}

function parseOrigin(value: string | null): URL | null {
    if (!value) return null;

    try {
        const parsed = new URL(value);
        if (
            parsed.username
            || parsed.password
            || parsed.pathname !== "/"
            || parsed.search
            || parsed.hash
            || parsed.origin !== value
        ) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}

function isLoopbackHostname(hostname: string): boolean {
    return hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === "[::1]"
        || hostname === "::1";
}

/**
 * A mutation requires both an exact Origin match and a non-simple custom
 * header. The combination rejects cross-site forms and causes cross-origin
 * fetches to preflight, while keeping the local HTTP preview usable only on a
 * loopback hostname.
 */
export function requireAdminMutationSameOrigin(request: Request): void {
    if (!ADMIN_MUTATION_METHODS.has(request.method.toUpperCase())) {
        throw invalidMutationInput("管理寫入只接受 POST、PUT、PATCH 或 DELETE。");
    }

    let requestUrl: URL;
    try {
        requestUrl = new URL(request.url);
    }
    catch {
        throw forbiddenMutationRequest();
    }

    if (
        requestUrl.username
        || requestUrl.password
        || !["http:", "https:"].includes(requestUrl.protocol)
        || (requestUrl.protocol === "http:" && !isLoopbackHostname(requestUrl.hostname))
    ) {
        throw forbiddenMutationRequest();
    }

    const origin = parseOrigin(request.headers.get("origin"));
    if (!origin || origin.origin !== requestUrl.origin) {
        throw forbiddenMutationRequest();
    }

    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite !== null && fetchSite !== "same-origin") {
        throw forbiddenMutationRequest();
    }

    if (request.headers.get(ADMIN_CSRF_HEADER) !== ADMIN_CSRF_HEADER_VALUE) {
        throw forbiddenMutationRequest();
    }
}

/**
 * Admin mutation keys are canonical lower-case UUID v4/v7 values. A bounded,
 * fixed format can be stored and compared without accepting user-controlled
 * log text or database identifiers with ambiguous casing.
 */
export function parseAdminIdempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !CANONICAL_UUID_V4_OR_V7.test(value)) {
        throw new AdminApiError(
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency-Key 必須是小寫 UUID v4 或 v7。",
            422,
        );
    }
    return value;
}

export function requireAdminMutationEvidence(
    request: Request,
    requestId = resolveAdminRequestId(request.headers.get("x-request-id")),
): AdminMutationEvidence {
    requireAdminMutationSameOrigin(request);
    return {
        idempotencyKey: parseAdminIdempotencyKey(
            request.headers.get(ADMIN_IDEMPOTENCY_HEADER),
        ),
        requestId,
    };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function assertAdminMutationFields(
    value: unknown,
    allowedFields: readonly string[],
): asserts value is Record<string, unknown> {
    if (!isPlainRecord(value)) {
        throw invalidMutationInput("管理操作內容必須是 JSON 物件。");
    }

    const allowed = new Set(allowedFields);
    if (Object.keys(value).some((field) => (
        SERVER_EVIDENCE_FIELDS.has(field) || !allowed.has(field)
    ))) {
        throw invalidMutationInput("請求含有不支援或不可由前端指定的欄位。");
    }
}

function readContentLength(request: Request, maximumBytes: number): void {
    const header = request.headers.get("content-length");
    if (header === null) return;
    if (!/^(?:0|[1-9]\d*)$/u.test(header)) {
        throw invalidMutationInput("Content-Length 格式不正確。");
    }
    const length = Number(header);
    if (!Number.isSafeInteger(length) || length > maximumBytes) {
        throw invalidMutationInput("管理操作內容過大。");
    }
}

async function readBodyBytes(request: Request, maximumBytes: number): Promise<Uint8Array> {
    readContentLength(request, maximumBytes);
    if (!request.body) throw invalidMutationInput("管理操作缺少 JSON 內容。");

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
        reader = request.body.getReader();
    }
    catch {
        throw invalidMutationInput("管理操作內容無法讀取。");
    }

    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > maximumBytes) {
                await reader.cancel().catch(() => undefined);
                throw invalidMutationInput("管理操作內容過大。");
            }
            chunks.push(next.value);
        }
    }
    catch (error) {
        if (error instanceof AdminApiError) throw error;
        throw invalidMutationInput("管理操作內容無法讀取。");
    }
    finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
}

export async function readStrictAdminMutationJson(
    request: Request,
    allowedFields: readonly string[],
    maximumBytes = ADMIN_MUTATION_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
        throw new TypeError("maximumBytes must be a positive safe integer");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
        throw invalidMutationInput("管理操作只接受 application/json。");
    }

    const bytes = await readBodyBytes(request, maximumBytes);
    let decoded: string;
    try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        throw invalidMutationInput("管理操作內容必須是有效 UTF-8。");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decoded);
    }
    catch {
        throw invalidMutationInput("管理操作內容不是有效 JSON。");
    }

    assertAdminMutationFields(parsed, allowedFields);
    return parsed;
}

/**
 * Called inside the same transaction as the business write. The advisory
 * account lock serializes against session revocation, role revocation and
 * account suspension. Authorization is then recomputed from the original
 * cookie token and must resolve to the same session and user seen before body
 * parsing.
 */
export async function revalidateSystemAdminMutation(
    token: string | null,
    expectedActor: SystemAdminActor,
    runner: AdminQueryRunner,
): Promise<SystemAdminActor> {
    await runner.query<MutationAuthLockRow>(ADMIN_MUTATION_AUTH_LOCK_SQL, [
        expectedActor.userId,
    ]);
    const actor = await requireSystemAdminToken(token, runner);
    if (
        actor.userId !== expectedActor.userId
        || actor.sessionId !== expectedActor.sessionId
    ) {
        throw new AdminApiError(
            "UNAUTHENTICATED",
            "管理員登入狀態已變更，請重新登入。",
            401,
        );
    }
    return actor;
}

export function readAdminMutationToken(request: Request): string | null {
    return readAdminSessionToken(request);
}
