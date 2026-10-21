import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import {
    createQuestionSourceBatch,
    QuestionImportStoreError,
    type QuestionSourceBatchInput,
} from "@/app/lib/question-import-store";
import {
    deriveQuestionSourceIdentity,
    removeQuestionSource,
    storeQuestionSource,
} from "@/app/lib/question-source-object-store";
import {
    cleanQuestionSourceUploadField,
    isQuestionSourceUploadTooLarge,
    MAX_QUESTION_SOURCE_FILES,
    prepareQuestionSourceUploads,
    QuestionSourceUploadError,
} from "@/app/lib/question-source-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function responseError(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
    const stored: Array<Awaited<ReturnType<typeof storeQuestionSource>>> = [];
    try {
        const account = await getAuthenticatedAccount(request);
        if (isQuestionSourceUploadTooLarge(request)) {
            return responseError("SOURCE_TOO_LARGE", "每個檔案不可超過 20 MB，一次最多 20 個檔案。", 413);
        }
        const form = await request.formData();
        const learnerId = cleanQuestionSourceUploadField(form.get("learnerId"), 36);
        const idempotencyKey = cleanQuestionSourceUploadField(form.get("idempotencyKey"), 120);
        const analyze = form.get("analyze");
        if (!learnerId || !UUID_PATTERN.test(learnerId) || !idempotencyKey || !["true", "false"].includes(String(analyze))
        ) {
            return responseError("INVALID_SOURCE_UPLOAD", "上傳資料格式不正確。", 400);
        }
        const prepared = await prepareQuestionSourceUploads(form, MAX_QUESTION_SOURCE_FILES);
        const sources: QuestionSourceBatchInput["sources"] = [];
        for (const [position, item] of prepared.entries()) {
            const { fileName, role, source } = item;
            const identity = deriveQuestionSourceIdentity(account.userId, `${idempotencyKey}:${position}`, source);
            stored.push(await storeQuestionSource(identity, source));
            sources.push({
                asset: {
                    byteSize: source.bytes.length,
                    checksum: source.checksum,
                    id: identity.assetId,
                    mimeType: source.mimeType,
                    storageKey: identity.storageKey,
                },
                fileName,
                role,
            });
        }
        const result = await withLocalPostgresTransaction((client) => createQuestionSourceBatch(client, {
            analyze: analyze === "true",
            idempotencyKey,
            learnerId: learnerId.toLowerCase(),
            sources,
        }, account.userId));
        return NextResponse.json(
            { data: result },
            { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
        );
    }
    catch (error) {
        await Promise.all(stored.map((source) => removeQuestionSource(source).catch(() => undefined)));
        if (error instanceof QuestionSourceUploadError) {
            return responseError(error.code, error.message, error.status);
        }
        if (error instanceof QuestionImportStoreError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return responseError(error.code, error.message, status);
        }
        console.error("Question source upload failed", error);
        return responseError("SOURCE_UPLOAD_FAILED", "檔案上傳失敗，未建立匯入批次。", 500);
    }
}
