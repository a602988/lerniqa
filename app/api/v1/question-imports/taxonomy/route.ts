import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import {
    createAccountClassificationField,
    createAccountClassificationOption,
    createAccountSubject,
    QuestionImportStoreError,
} from "@/app/lib/question-import-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function text(value: unknown, maximum: number): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.normalize("NFC").trim();
    return normalized && normalized.length <= maximum ? normalized : null;
}

export async function POST(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return errorResponse("INVALID_TAXONOMY_REQUEST", "分類設定格式不正確。", 400);
        }
        const values = body as Record<string, unknown>;
        const action = values.action;
        let result: unknown;
        if (action === "create_subject" && Object.keys(values).length === 2) {
            const name = text(values.name, 80);
            if (!name) return errorResponse("INVALID_SUBJECT_NAME", "科目名稱不可為空或超過 80 字元。", 400);
            result = await withLocalPostgresTransaction((client) => createAccountSubject(client, name, account.userId));
        }
        else if (action === "create_field" && Object.keys(values).length === 4) {
            const subjectId = typeof values.subjectId === "string" && UUID_PATTERN.test(values.subjectId) ? values.subjectId.toLowerCase() : null;
            const name = text(values.name, 100);
            const selectionMode = values.selectionMode === "single" || values.selectionMode === "multiple" ? values.selectionMode : null;
            if (!subjectId || !name || !selectionMode) return errorResponse("INVALID_CLASSIFICATION_FIELD", "分類欄位設定不正確。", 400);
            result = await withLocalPostgresTransaction((client) => createAccountClassificationField(client, subjectId, name, selectionMode, account.userId));
        }
        else if (action === "create_option" && Object.keys(values).length === 3) {
            const fieldId = typeof values.fieldId === "string" && UUID_PATTERN.test(values.fieldId) ? values.fieldId.toLowerCase() : null;
            const label = text(values.label, 160);
            if (!fieldId || !label) return errorResponse("INVALID_CLASSIFICATION_OPTION", "分類選項設定不正確。", 400);
            result = await withLocalPostgresTransaction((client) => createAccountClassificationOption(client, fieldId, label, account.userId));
        }
        else {
            return errorResponse("INVALID_TAXONOMY_REQUEST", "分類設定格式不正確或含有未知欄位。", 400);
        }
        return NextResponse.json({ data: result }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return errorResponse(error.code, error.message, status);
        }
        console.error("Question taxonomy update failed", error);
        return errorResponse("TAXONOMY_UPDATE_FAILED", "無法更新科目分類設定。", 500);
    }
}
