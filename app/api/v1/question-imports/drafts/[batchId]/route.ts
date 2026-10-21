import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import { parseQuestionDraftPackage } from "@/app/lib/question-import-contract";
import {
    cancelQuestionDraft,
    QuestionImportStoreError,
    saveQuestionDraft,
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

export async function PATCH(request: Request, context: { params: Promise<{ batchId: string }> }) {
    try {
        const account = await getAuthenticatedAccount(request);
        const { batchId } = await context.params;
        if (!UUID_PATTERN.test(batchId)) return errorResponse("IMPORT_DRAFT_NOT_FOUND", "找不到這份題目草稿。", 404);
        const draft = parseQuestionDraftPackage(await request.json());
        if (!draft.ok) return errorResponse("INVALID_IMPORT_DRAFT", "題目草稿未通過檢查。", 400, draft.errors);
        await withLocalPostgresTransaction((client) => saveQuestionDraft(client, batchId.toLowerCase(), draft.value, account.userId));
        return NextResponse.json({ data: { saved: true } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return errorResponse(error.code, error.message, status);
        }
        console.error("Question draft update failed", error);
        return errorResponse("IMPORT_DRAFT_SAVE_FAILED", "題目草稿儲存失敗。", 500);
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ batchId: string }> }) {
    try {
        const account = await getAuthenticatedAccount(request);
        const { batchId } = await context.params;
        if (!UUID_PATTERN.test(batchId)) return errorResponse("IMPORT_DRAFT_NOT_FOUND", "找不到這份題目草稿。", 404);
        await withLocalPostgresTransaction((client) => cancelQuestionDraft(client, batchId.toLowerCase(), account.userId));
        return NextResponse.json({ data: { deleted: true } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return errorResponse(error.code, error.message, status);
        }
        console.error("Question draft deletion failed", error);
        return errorResponse("IMPORT_DRAFT_DELETE_FAILED", "題目草稿刪除失敗。", 500);
    }
}
