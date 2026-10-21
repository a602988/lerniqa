import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresReadTransaction, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import { parseQuestionDraftPackage } from "@/app/lib/question-import-contract";
import {
    createQuestionDraft,
    listQuestionDrafts,
    QuestionImportStoreError,
} from "@/app/lib/question-import-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(code: string, message: string, status: number, details?: unknown) {
    return NextResponse.json(
        { error: { code, message, ...(details === undefined ? {} : { details }) } },
        { status, headers: { "Cache-Control": "private, no-store" } },
    );
}

export async function GET(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const drafts = await withLocalPostgresReadTransaction((client) => listQuestionDrafts(client, account.userId));
        return NextResponse.json({ data: drafts }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question draft list failed", error);
        return errorResponse("IMPORT_DRAFT_LIST_FAILED", "無法讀取題目草稿。", 500);
    }
}

export async function POST(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return errorResponse("INVALID_IMPORT_DRAFT", "題目草稿格式不正確。", 400);
        }
        const values = body as Record<string, unknown>;
        const expectedKeys = new Set(["learnerId", "idempotencyKey", "draft"]);
        if (Object.keys(values).length !== expectedKeys.size || Object.keys(values).some((key) => !expectedKeys.has(key))) {
            return errorResponse("INVALID_IMPORT_DRAFT", "題目草稿格式不正確或含有未知欄位。", 400);
        }
        const learnerId = typeof values.learnerId === "string" && UUID_PATTERN.test(values.learnerId)
            ? values.learnerId.toLowerCase()
            : null;
        const idempotencyKey = typeof values.idempotencyKey === "string" && values.idempotencyKey.trim().length <= 120
            ? values.idempotencyKey.trim()
            : "";
        const draft = parseQuestionDraftPackage(values.draft);
        if (!learnerId || !idempotencyKey || !draft.ok) {
            return errorResponse(
                "INVALID_IMPORT_DRAFT",
                "題目草稿未通過檢查。",
                400,
                draft.ok ? undefined : draft.errors,
            );
        }
        const result = await withLocalPostgresTransaction((client) => createQuestionDraft(client, {
            draft: draft.value,
            idempotencyKey,
            learnerId,
        }, account.userId));
        return NextResponse.json({ data: result }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return errorResponse(error.code, error.message, status);
        }
        console.error("Question draft creation failed", error);
        return errorResponse("IMPORT_DRAFT_CREATE_FAILED", "題目草稿儲存失敗。", 500);
    }
}
