import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresReadTransaction, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import { parseQuestionImportPackage } from "@/app/lib/question-import-contract";
import {
    importQuestionPackage,
    listQuestionImportCatalog,
    QuestionImportStoreError,
} from "@/app/lib/question-import-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number, details?: unknown) {
    return NextResponse.json(
        { error: { code, message, ...(details === undefined ? {} : { details }) } },
        { status, headers: { "Cache-Control": "private, no-store" } },
    );
}

export async function GET(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const catalog = await withLocalPostgresReadTransaction((client) => listQuestionImportCatalog(client, account.userId));
        return NextResponse.json({ data: catalog }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question import catalog failed", error);
        return errorResponse("IMPORT_CATALOG_FAILED", "無法讀取新增題目需要的分類。", 500);
    }
}

export async function POST(request: Request) {
    try {
        const account = await getAuthenticatedAccount(request);
        const parsed = parseQuestionImportPackage(await request.json());
        if (!parsed.ok) return errorResponse("INVALID_IMPORT_PACKAGE", "匯入內容未通過檢查。", 400, parsed.errors);
        const result = await withLocalPostgresTransaction((client) => importQuestionPackage(client, parsed.value, account.userId));
        return NextResponse.json(
            { data: result },
            { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
        );
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return errorResponse(error.code, error.message, status);
        }
        console.error("Question package import failed", error);
        return errorResponse("IMPORT_FAILED", "題目匯入失敗，未寫入任何題目。", 500);
    }
}
