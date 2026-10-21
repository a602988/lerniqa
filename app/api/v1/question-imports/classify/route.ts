import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { suggestQuestionClassifications, type ClassificationField } from "@/app/lib/question-classification-ai";
import { parseQuestionDraftPackage } from "@/app/lib/question-import-contract";
import { LocalPostgresUnavailableError, withLocalPostgresReadTransaction } from "@/app/lib/local-postgres";
import { listQuestionImportCatalog } from "@/app/lib/question-import-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse("INVALID_CLASSIFICATION_REQUEST", "AI 分類內容格式不正確。", 400);
        const values = body as Record<string, unknown>;
        if (Object.keys(values).length !== 2 || !("subjectId" in values) || !("questions" in values)) {
            return errorResponse("INVALID_CLASSIFICATION_REQUEST", "AI 分類內容格式不正確或含有未知欄位。", 400);
        }
        const subjectId = typeof values.subjectId === "string" && UUID_PATTERN.test(values.subjectId) ? values.subjectId.toLowerCase() : null;
        const draft = parseQuestionDraftPackage({ schemaVersion: 2, sourceTitle: "AI 分類", questions: values.questions });
        if (!subjectId || !draft.ok) return errorResponse("INVALID_CLASSIFICATION_REQUEST", "AI 分類內容未通過檢查。", 400);
        const catalog = await withLocalPostgresReadTransaction((client) => listQuestionImportCatalog(client, account.userId));
        const subjectAllowed = (catalog.subjects as Array<{ id: string }>).some((subject) => subject.id === subjectId);
        if (!subjectAllowed) return errorResponse("CLASSIFICATION_SUBJECT_DENIED", "這個科目不存在或不屬於目前帳號。", 403);
        const fields = (catalog.classificationFields as ClassificationField[]).filter((field) => field.subjectIds.includes(subjectId) && field.options.length > 0);
        if (!fields.length) return errorResponse("CLASSIFICATION_FIELDS_EMPTY", "請先為這個科目建立分類欄位與選項。", 409);
        const suggestions = await suggestQuestionClassifications(draft.value.questions, fields);
        return NextResponse.json({ data: suggestions }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        const message = error instanceof Error ? error.message : "AI 分類暫時無法使用；你仍可手動分類。";
        console.error("Question draft classification failed", error);
        return errorResponse("QUESTION_CLASSIFICATION_FAILED", message, 503);
    }
}
