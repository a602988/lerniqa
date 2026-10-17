import { NextResponse } from "next/server.js";

import {
    type AdminQueryRunner,
    requireSystemAdminToken,
    type SystemAdminActor,
} from "./admin-auth.ts";
import {
    adminDataResponse,
    handleAdminHttpError,
} from "./admin-http.ts";
import {
    type AdminMutationEvidence,
    type AdminMutationTransactionProvider,
    readAdminMutationToken,
    readStrictAdminMutationJson,
    requireAdminMutationEvidence,
    revalidateSystemAdminMutation,
} from "./admin-mutation-security.ts";
import { resolveAdminRequestId } from "./admin-observability.ts";
import { AdminApiError } from "./admin-types.ts";

const CONFLICT_DATABASE_CODES = new Set(["23505", "40001", "40P01", "55P03"]);
const INVALID_DATABASE_CODES = new Set([
    "22001",
    "22003",
    "22007",
    "22008",
    "22P02",
]);
const UNAVAILABLE_DATABASE_CODES = new Set([
    "3D000",
    "53300",
    "57P01",
    "57P02",
    "57P03",
    "EACCES",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOENT",
    "ENOTDIR",
    "EPIPE",
    "ETIMEDOUT",
    "LOCAL_POSTGRES_UNAVAILABLE",
]);

export interface AdminMutationContext {
    actor: SystemAdminActor;
    runner: AdminQueryRunner;
    evidence: AdminMutationEvidence;
}

export interface AdminMutationDependencies {
    readRunner: AdminQueryRunner;
    transactions: AdminMutationTransactionProvider;
}

export interface AdminMutationSpec<Input, Output> {
    allowedFields: readonly string[];
    parse(
        body: Readonly<Record<string, unknown>>,
        evidence: Readonly<AdminMutationEvidence>,
    ): Input;
    mutate(context: AdminMutationContext, input: Input): Promise<Output>;
    successStatus?: number;
}

interface CodedFailure {
    code?: unknown;
}

function failureCode(error: unknown): string | null {
    if (typeof error !== "object" || error === null) return null;
    try {
        const code = (error as CodedFailure).code;
        return typeof code === "string" ? code : null;
    }
    catch {
        return null;
    }
}

function safeServerError(status: 500 | 503): AdminApiError {
    return new AdminApiError(
        "INTERNAL_ERROR",
        status === 503
            ? "管理後台資料庫暫時無法使用，請稍後再試。"
            : "系統暫時無法完成操作，請稍後再試。",
        status,
    );
}

/**
 * Converts only known database classifications. Messages, detail, hints,
 * queries, values and stacks from the original exception are never copied.
 */
export function normalizeAdminMutationError(error: unknown): unknown {
    if (error instanceof AdminApiError) {
        if (error.status === 400 && error.code.startsWith("INVALID_")) {
            return new AdminApiError(error.code, error.message, 422, error.requestId);
        }
        if (error.status === 503) return safeServerError(503);
        if (error.status >= 500) return safeServerError(500);
        return error;
    }

    const code = failureCode(error);
    if (!code) return error;
    if (CONFLICT_DATABASE_CODES.has(code)) {
        return new AdminApiError(
            "CONFLICT",
            "資料已被其他操作更新，請重新載入後再試。",
            409,
        );
    }
    if (INVALID_DATABASE_CODES.has(code)) {
        return new AdminApiError(
            "INVALID_INPUT",
            "送出的資料不符合目前規則。",
            422,
        );
    }
    if (code.startsWith("08") || code.startsWith("28") || UNAVAILABLE_DATABASE_CODES.has(code)) {
        return safeServerError(503);
    }
    return error;
}

/**
 * Authenticates before inspecting Origin, idempotency headers or JSON. The
 * session is then revalidated after the transaction and auth lock begin.
 */
export async function runAdminMutation<Input, Output>(
    request: Request,
    dependencies: AdminMutationDependencies,
    spec: AdminMutationSpec<Input, Output>,
    requestId = resolveAdminRequestId(request.headers.get("x-request-id")),
): Promise<Output> {
    const token = readAdminMutationToken(request);
    const initialActor = await requireSystemAdminToken(token, dependencies.readRunner);

    const evidence = requireAdminMutationEvidence(request, requestId);
    const body = await readStrictAdminMutationJson(request, spec.allowedFields);
    const input = spec.parse(body, evidence);

    return dependencies.transactions.runInTransaction(async (runner) => {
        const actor = await revalidateSystemAdminMutation(token, initialActor, runner);
        return spec.mutate({ actor, runner, evidence }, input);
    });
}

export async function handleAdminMutation<Input, Output>(
    request: Request,
    dependencies: AdminMutationDependencies,
    spec: AdminMutationSpec<Input, Output>,
): Promise<NextResponse> {
    const requestId = resolveAdminRequestId(request.headers.get("x-request-id"));
    try {
        const output = await runAdminMutation(request, dependencies, spec, requestId);
        return adminDataResponse(output, {}, spec.successStatus ?? 200);
    }
    catch (error) {
        return handleAdminHttpError(normalizeAdminMutationError(error), {
            requestId,
        });
    }
}
