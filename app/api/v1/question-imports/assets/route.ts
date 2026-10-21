import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import {
    deriveQuestionSourceIdentity,
    MAX_QUESTION_SOURCE_BYTES,
    removeQuestionSource,
    storeQuestionSource,
    validateQuestionSource,
} from "@/app/lib/question-source-object-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseError(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
    let stored: Awaited<ReturnType<typeof storeQuestionSource>> | undefined;
    try {
        const account = await getAuthenticatedAccount(request);
        const form = await request.formData();
        const file = form.get("file");
        const uploadKey = form.get("uploadKey");
        if (!(file instanceof File) || typeof uploadKey !== "string" || !uploadKey.trim() || uploadKey.length > 120) {
            return responseError("INVALID_QUESTION_IMAGE", "圖片上傳資料格式不正確。", 400);
        }
        if (file.size > MAX_QUESTION_SOURCE_BYTES) return responseError("QUESTION_IMAGE_TOO_LARGE", "單張圖片不可超過 20 MB。", 413);
        const source = validateQuestionSource(Buffer.from(await file.arrayBuffer()));
        if (!source || source.mimeType === "application/pdf") {
            return responseError("UNSUPPORTED_QUESTION_IMAGE", "題目圖片只接受 JPG、PNG 或 WebP；HEIC／HEIF 請先在裝置上轉存為 JPG。", 415);
        }
        const identity = deriveQuestionSourceIdentity(account.userId, `content:${uploadKey}`, source);
        stored = await storeQuestionSource(identity, source);
        await withLocalPostgresTransaction(async (client) => {
            const result = await client.query(`
                INSERT INTO assets(
                    id, storage_key, mime_type, byte_size, checksum, purpose,
                    sensitivity, scan_status, created_by_user_id
                ) VALUES($1,$2,$3,$4,$5,'question_content','private','clean',$6)
                ON CONFLICT(id) DO NOTHING
                RETURNING id
            `, [identity.assetId, identity.storageKey, source.mimeType, source.bytes.length, source.checksum, account.userId]);
            if (result.rowCount) return;
            const existing = await client.query(`
                SELECT 1 FROM assets
                WHERE id = $1 AND storage_key = $2 AND checksum = $3
                  AND purpose = 'question_content' AND scan_status = 'clean'
                  AND created_by_user_id = $4 AND deleted_at IS NULL
            `, [identity.assetId, identity.storageKey, source.checksum, account.userId]);
            if (!existing.rowCount) throw new Error("QUESTION_IMAGE_ASSET_CONFLICT");
        });
        return NextResponse.json({
            data: {
                assetId: identity.assetId,
                mimeType: source.mimeType,
                url: `/api/v1/question-import-assets/${identity.assetId}`,
            },
        }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        await (stored ? removeQuestionSource(stored) : Promise.resolve()).catch(() => undefined);
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return responseError(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question image upload failed", error);
        return responseError("QUESTION_IMAGE_UPLOAD_FAILED", "圖片上傳失敗，未加入題目。", 500);
    }
}
