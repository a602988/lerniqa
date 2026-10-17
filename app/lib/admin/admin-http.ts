import { NextResponse } from "next/server.js";

import {
    AdminApiError,
    type AdminApiErrorBody,
} from "./admin-types.ts";
import {
    type AdminRequestIdGenerator,
    type AdminServerFailureLogger,
    parseAdminRequestId,
    recordAdminServerFailure,
    resolveAdminRequestId,
} from "./admin-observability.ts";

const ADMIN_RESPONSE_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
} as const;

export interface AdminResponseMeta {
    persistence: "local-postgresql";
    [key: string]: unknown;
}

export function adminDataResponse<Data>(
    data: Data,
    meta: Omit<AdminResponseMeta, "persistence"> = {},
    status = 200,
): NextResponse<{ data: Data; meta: AdminResponseMeta }> {
    return NextResponse.json(
        {
            data,
            meta: {
                persistence: "local-postgresql",
                ...meta,
            },
        },
        { status, headers: ADMIN_RESPONSE_HEADERS },
    );
}

function serializedAdminErrorResponse(
    error: AdminApiError,
    requestIdCandidate: unknown = error.requestId,
): NextResponse<AdminApiErrorBody> {
    const requestId = parseAdminRequestId(requestIdCandidate);
    const headers = requestId
        ? { ...ADMIN_RESPONSE_HEADERS, "X-Request-Id": requestId }
        : ADMIN_RESPONSE_HEADERS;

    return NextResponse.json(
        {
            error: {
                code: error.code,
                message: error.message,
                ...(requestId ? { requestId } : {}),
            },
        },
        { status: error.status, headers },
    );
}

/**
 * Serializes expected 4xx errors directly. A caller cannot accidentally bypass
 * correlation logging by passing a classified server error to this helper.
 */
export function adminErrorResponse(
    error: AdminApiError,
    requestIdCandidate: unknown = error.requestId,
): NextResponse<AdminApiErrorBody> {
    if (error.status >= 500) {
        return handleAdminHttpError(error, { requestId: requestIdCandidate });
    }
    return serializedAdminErrorResponse(error, requestIdCandidate);
}

export interface AdminHttpErrorOptions {
    requestId?: unknown;
    generateRequestId?: AdminRequestIdGenerator;
    logger?: AdminServerFailureLogger;
}

/**
 * Returns only client-safe errors. SQL, connection settings, submitted values
 * and stack traces remain server-side.
 */
export function handleAdminHttpError(
    error: unknown,
    options: AdminHttpErrorOptions = {},
): NextResponse<AdminApiErrorBody> {
    const classified = error instanceof AdminApiError;
    const acceptedRequestId = parseAdminRequestId(options.requestId)
        ?? (classified ? parseAdminRequestId(error.requestId) : null);

    if (classified && error.status < 500) {
        return serializedAdminErrorResponse(error, acceptedRequestId);
    }

    const requestId = acceptedRequestId ?? resolveAdminRequestId(
        null,
        options.generateRequestId,
    );
    const status = classified && error.status >= 500 && error.status <= 599
        ? error.status
        : 500;
    const responseError = classified && status === error.status
        ? new AdminApiError(error.code, error.message, status, requestId)
        : new AdminApiError(
            "INTERNAL_ERROR",
            "系統暫時無法完成操作，請稍後再試。",
            status,
            requestId,
        );

    recordAdminServerFailure(
        {
            scope: "admin_api",
            requestId,
            status,
            failureKind: classified ? "classified" : "unhandled",
            errorCode: classified ? error.code : "UNHANDLED_ERROR",
            error,
        },
        options.logger,
    );

    return serializedAdminErrorResponse(responseError, requestId);
}
