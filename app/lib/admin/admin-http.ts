import { NextResponse } from "next/server.js";

import {
    AdminApiError,
    type AdminApiErrorBody,
    toAdminApiErrorBody,
} from "./admin-types.ts";

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

export function adminErrorResponse(
    error: AdminApiError,
): NextResponse<AdminApiErrorBody> {
    return NextResponse.json(
        toAdminApiErrorBody(error),
        { status: error.status, headers: ADMIN_RESPONSE_HEADERS },
    );
}

function safeErrorName(error: unknown): string {
    if (!error || typeof error !== "object") return typeof error;
    const name = "name" in error ? error.name : undefined;
    return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
        ? name
        : "UnknownError";
}

/**
 * Returns only client-safe errors. SQL, connection settings, submitted values
 * and stack traces remain server-side.
 */
export function handleAdminHttpError(error: unknown): NextResponse<AdminApiErrorBody> {
    if (error instanceof AdminApiError) return adminErrorResponse(error);

    console.error("Admin API request failed", { errorName: safeErrorName(error) });
    return adminErrorResponse(new AdminApiError(
        "INTERNAL_ERROR",
        "系統暫時無法完成操作，請稍後再試。",
        500,
    ));
}
