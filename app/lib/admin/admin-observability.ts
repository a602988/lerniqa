import { randomUUID } from "node:crypto";

import type { AdminApiErrorCode } from "./admin-types.ts";

const ADMIN_REQUEST_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type AdminFailureScope = "admin_api" | "admin_page_auth";
export type AdminFailureKind = "classified" | "unhandled";
export type AdminFailureCode = AdminApiErrorCode | "UNHANDLED_ERROR";
export type AdminRequestIdGenerator = () => string;

export interface AdminServerFailureEvent {
    event: "admin_server_failure";
    scope: AdminFailureScope;
    requestId: string;
    status: number;
    failureKind: AdminFailureKind;
    errorCode: AdminFailureCode;
    errorName: string;
}

export type AdminServerFailureLogger = (
    event: Readonly<AdminServerFailureEvent>,
) => void;

const ADMIN_FAILURE_SCOPES = new Set<AdminFailureScope>([
    "admin_api",
    "admin_page_auth",
]);
const ADMIN_FAILURE_KINDS = new Set<AdminFailureKind>([
    "classified",
    "unhandled",
]);
const ADMIN_FAILURE_CODES = new Set<AdminFailureCode>([
    "INVALID_INPUT",
    "INVALID_QUERY",
    "INVALID_UUID",
    "INVALID_IDEMPOTENCY_KEY",
    "INVALID_STATUS_TRANSITION",
    "INVALID_SUBSCRIPTION_PLAN",
    "INVALID_SUBSCRIPTION_PRICE",
    "INVALID_FEATURE_LIMIT",
    "INVALID_QUESTION_REVISION",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "STALE_VERSION",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "UNHANDLED_ERROR",
]);
const SAFE_ERROR_NAMES = new Set([
    "AdminApiError",
    "AggregateError",
    "Error",
    "EvalError",
    "LocalPostgresUnavailableError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
]);

const defaultAdminServerFailureLogger: AdminServerFailureLogger = (event) => {
    console.error("Admin server failure", event);
};

/**
 * Correlation IDs are deliberately narrower than general UUID identifiers.
 * Only canonical, lower-case UUID v4/v7 values are accepted from a caller.
 */
export function parseAdminRequestId(value: unknown): string | null {
    return typeof value === "string" && ADMIN_REQUEST_ID_PATTERN.test(value)
        ? value
        : null;
}

/**
 * Uses a valid caller-provided correlation ID or creates a fresh server ID.
 * A broken injected generator cannot prevent the error response itself.
 */
export function resolveAdminRequestId(
    candidate: unknown,
    generate: AdminRequestIdGenerator = randomUUID,
): string {
    const accepted = parseAdminRequestId(candidate);
    if (accepted) return accepted;

    try {
        const generated = parseAdminRequestId(generate());
        if (generated) return generated;
    }
    catch {
        // Observability must never replace the original request failure.
    }

    return randomUUID();
}

function safeErrorName(error: unknown): string {
    if (!error || typeof error !== "object") return "NonErrorThrown";

    try {
        const name = "name" in error ? error.name : undefined;
        return typeof name === "string" && SAFE_ERROR_NAMES.has(name)
            ? name
            : "UnknownError";
    }
    catch {
        return "UnknownError";
    }
}

/**
 * Emits a fixed, low-cardinality server event. The API intentionally has no
 * fields for cookies, tokens, URLs, query strings, submitted values, database
 * details, error messages or stack traces.
 */
export function recordAdminServerFailure(
    input: {
        scope: AdminFailureScope;
        requestId: string;
        status: number;
        failureKind: AdminFailureKind;
        errorCode: AdminFailureCode;
        error: unknown;
    },
    logger: AdminServerFailureLogger = defaultAdminServerFailureLogger,
): AdminServerFailureEvent | null {
    const requestId = parseAdminRequestId(input.requestId);
    if (
        !requestId
        || !Number.isInteger(input.status)
        || input.status < 500
        || input.status > 599
        || !ADMIN_FAILURE_SCOPES.has(input.scope)
        || !ADMIN_FAILURE_KINDS.has(input.failureKind)
    ) {
        return null;
    }

    const errorCode = ADMIN_FAILURE_CODES.has(input.errorCode)
        ? input.errorCode
        : input.failureKind === "unhandled"
            ? "UNHANDLED_ERROR"
            : "INTERNAL_ERROR";

    const event: AdminServerFailureEvent = Object.freeze({
        event: "admin_server_failure",
        scope: input.scope,
        requestId,
        status: input.status,
        failureKind: input.failureKind,
        errorCode,
        errorName: safeErrorName(input.error),
    });

    try {
        logger(event);
    }
    catch {
        // Logging failures cannot change the client-facing error contract.
    }

    return event;
}
