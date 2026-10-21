import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import {
    appendQuestionSourceBatch,
    QuestionImportStoreError,
    type QuestionSourceBatchInput,
    updateQuestionSourceRoles,
} from "@/app/lib/question-import-store";
import { isQuestionSourceRole } from "@/app/lib/question-source-role";
import {
    deriveQuestionSourceIdentity,
    removeQuestionSource,
    storeQuestionSource,
} from "@/app/lib/question-source-object-store";
import {
    cleanQuestionSourceUploadField,
    isQuestionSourceUploadTooLarge,
    prepareQuestionSourceUploads,
    QuestionSourceUploadError,
} from "@/app/lib/question-source-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function errorResponse(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * 將新的來源圖片或 PDF 加入既有草稿，並排入整份草稿重新分析。
 *
 * @param request multipart 檔案上傳請求。
 * @param context 包含目標批次識別碼的路由參數。
 * @returns 追加結果，重送相同內容時回傳既有結果。
 */
export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
    const stored: Array<Awaited<ReturnType<typeof storeQuestionSource>>> = [];
    try {
        const account = await getAuthenticatedAccount(request);
        const { batchId: rawBatchId } = await context.params;
        if (!UUID_PATTERN.test(rawBatchId)) return errorResponse("INVALID_SOURCE_UPLOAD", "草稿識別碼不正確。", 400);
        if (isQuestionSourceUploadTooLarge(request)) {
            return errorResponse("SOURCE_TOO_LARGE", "每個檔案不可超過 20 MB，每份草稿最多 20 個檔案。", 413);
        }
        const batchId = rawBatchId.toLowerCase();
        const form = await request.formData();
        const idempotencyKey = cleanQuestionSourceUploadField(form.get("idempotencyKey"), 120);
        if (!idempotencyKey) return errorResponse("INVALID_SOURCE_UPLOAD", "上傳資料格式不正確。", 400);
        const prepared = await prepareQuestionSourceUploads(form);
        const sources: QuestionSourceBatchInput["sources"] = [];
        for (const [position, item] of prepared.entries()) {
            const identity = deriveQuestionSourceIdentity(
                account.userId,
                `append:${batchId}:${idempotencyKey}:${position}`,
                item.source,
            );
            stored.push(await storeQuestionSource(identity, item.source));
            sources.push({
                asset: {
                    byteSize: item.source.bytes.length,
                    checksum: item.source.checksum,
                    id: identity.assetId,
                    mimeType: item.source.mimeType,
                    storageKey: identity.storageKey,
                },
                fileName: item.fileName,
                role: item.role,
            });
        }
        const result = await withLocalPostgresTransaction((client) => appendQuestionSourceBatch(
            client,
            batchId,
            { sources },
            account.userId,
        ));
        return NextResponse.json(
            { data: result },
            { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
        );
    }
    catch (error) {
        await Promise.all(stored.map((source) => removeQuestionSource(source).catch(() => undefined)));
        if (error instanceof QuestionSourceUploadError) {
            return errorResponse(error.code, error.message, error.status);
        }
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question source append failed", error);
        return errorResponse("SOURCE_APPEND_FAILED", "檔案新增失敗，草稿內容未變更。", 500);
    }
}

export async function PATCH(request: Request, context: { params: Promise<{ batchId: string }> }) {
    try {
        const account = await getAuthenticatedAccount(request);
        const { batchId } = await context.params;
        const body: unknown = await request.json().catch(() => null);
        if (!UUID_PATTERN.test(batchId) || !body || typeof body !== "object" || Array.isArray(body)
            || Object.keys(body).length !== 1 || !("sources" in body) || !Array.isArray(body.sources)
            || body.sources.length < 1 || body.sources.length > 20) {
            return errorResponse("INVALID_SOURCE_ROLES", "來源圖片用途格式不正確。", 400);
        }
        const sources = body.sources.flatMap((source) => {
            if (!source || typeof source !== "object" || Array.isArray(source)
                || Object.keys(source).length !== 2 || !("sourceDocumentId" in source) || !("role" in source)
                || typeof source.sourceDocumentId !== "string" || !UUID_PATTERN.test(source.sourceDocumentId)
                || !isQuestionSourceRole(source.role)) return [];
            return [{ sourceDocumentId: source.sourceDocumentId.toLowerCase(), role: source.role }];
        });
        if (sources.length !== body.sources.length || new Set(sources.map((source) => source.sourceDocumentId)).size !== sources.length) {
            return errorResponse("INVALID_SOURCE_ROLES", "來源圖片用途格式不正確。", 400);
        }
        await withLocalPostgresTransaction((client) => updateQuestionSourceRoles(client, batchId.toLowerCase(), sources, account.userId));
        return NextResponse.json({ data: { updated: true } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question source role update failed", error);
        return errorResponse("SOURCE_ROLE_UPDATE_FAILED", "無法更新來源圖片用途。", 500);
    }
}
