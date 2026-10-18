import { NextResponse } from "next/server";
import { promisify } from "node:util";
import { constants, gzip } from "node:zlib";
import {
    AuthServiceError,
    getAuthenticatedAccount,
    type AuthenticatedAccount,
} from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError } from "@/app/lib/local-postgres";
import { LocalPracticeRequestError } from "@/app/lib/local-practice-store";
import {
    LOCAL_PRACTICE_DEFAULT_FILTERS,
    type LocalPracticeFilters,
} from "@/app/lib/local-practice-types";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function localPracticeMeta(extra: Record<string, unknown> = {}) {
    return {
        persistence: "local-postgresql" as const,
        identityMode: "authenticated" as const,
        ...extra,
    };
}

export function localPracticeJsonResponse(body: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Cache-Control", "private, no-store");
    return NextResponse.json(body, { ...init, headers });
}

const gzipAsync = promisify(gzip);

function acceptsGzip(request: Request): boolean {
    return (request.headers.get("accept-encoding") ?? "")
        .split(",")
        .some((entry) => {
            const [coding, ...parameters] = entry.trim().toLowerCase().split(";");
            if (coding !== "gzip") return false;
            const quality = parameters
                .map((parameter) => parameter.trim())
                .find((parameter) => parameter.startsWith("q="));
            return quality === undefined || Number(quality.slice(2)) > 0;
        });
}

/** Compresses only the large authenticated catalog while preserving its JSON contract. */
export async function localPracticeLargeJsonResponse(request: Request, body: unknown): Promise<Response> {
    const headers = new Headers({ Vary: "Accept-Encoding" });
    if (!acceptsGzip(request)) {
        return localPracticeJsonResponse(body, { headers });
    }

    const compressed = await gzipAsync(Buffer.from(JSON.stringify(body)), {
        level: constants.Z_BEST_SPEED,
    });
    const encodedBody = Uint8Array.from(compressed);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Encoding", "gzip");
    headers.set("Content-Length", String(encodedBody.byteLength));
    headers.set("Content-Type", "application/json");
    return new Response(encodedBody, { headers });
}

export async function requireLocalPracticeAccount(request: Request): Promise<AuthenticatedAccount> {
    return getAuthenticatedAccount(request);
}

export function errorResponse(code: string, message: string, status: number) {
    return localPracticeJsonResponse({ error: { code, message } }, { status });
}

export function handleLocalPracticeError(error: unknown) {
    if (error instanceof LocalPracticeRequestError) {
        return errorResponse(error.code, error.message, error.status);
    }
    if (error instanceof AuthServiceError) {
        return errorResponse(error.code, error.message, error.status);
    }
    if (error instanceof LocalPostgresUnavailableError) {
        return errorResponse(
            "LOCAL_POSTGRES_UNAVAILABLE",
            "本機 PostgreSQL 題庫尚未啟動，請先啟動本機資料庫。",
            503,
        );
    }
    console.error("Local practice API failed", error);
    return errorResponse("LOCAL_PRACTICE_FAILED", "本機試題服務目前無法完成要求。", 500);
}

function boundedFilter(value: string | null, fallback: string): string | null {
    if (value === null) return fallback;
    // Catalog names are persisted with their source typography. NFC keeps
    // canonically equivalent Unicode equal without collapsing full-width
    // punctuation such as the parentheses in「語文常識（二）」.
    const normalized = value.normalize("NFC").trim();
    if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
    return normalized;
}

export function parseLocalPracticeFilters(searchParams: URLSearchParams): LocalPracticeFilters | null {
    const grade = boundedFilter(searchParams.get("grade"), LOCAL_PRACTICE_DEFAULT_FILTERS.grade);
    const subject = boundedFilter(searchParams.get("subject"), LOCAL_PRACTICE_DEFAULT_FILTERS.subject);
    const publisher = boundedFilter(searchParams.get("publisher"), LOCAL_PRACTICE_DEFAULT_FILTERS.publisher);
    const volume = boundedFilter(searchParams.get("volume"), LOCAL_PRACTICE_DEFAULT_FILTERS.volume);
    const lesson = boundedFilter(searchParams.get("lesson"), LOCAL_PRACTICE_DEFAULT_FILTERS.lesson);
    return grade && subject && publisher && volume && lesson
        ? { grade, subject, publisher, volume, lesson }
        : null;
}

export function parseBoundedInteger(
    value: string | null,
    fallback: number,
    minimum: number,
    maximum: number,
): number | null {
    if (value === null) return fallback;
    if (!/^\d+$/u.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
