import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresReadTransaction, withLocalPostgresTransaction } from "@/app/lib/local-postgres";
import { cropQuestionImage } from "@/app/lib/question-image-crop";
import {
    deriveQuestionSourceIdentity,
    removeQuestionSource,
    resolveQuestionSourcePath,
    storeQuestionSource,
    validateQuestionSource,
} from "@/app/lib/question-source-object-store";
import { findQuestionImportAsset } from "@/app/lib/question-source-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type CropRect = { x: number; y: number; width: number; height: number };

function responseError(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseRect(value: unknown): CropRect | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 4 || !("x" in record) || !("y" in record) || !("width" in record) || !("height" in record)) return null;
    const entries = [record.x, record.y, record.width, record.height];
    if (!entries.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
    const rect = { x: Number(record.x), y: Number(record.y), width: Number(record.width), height: Number(record.height) };
    return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
        && rect.x + rect.width <= 1 && rect.y + rect.height <= 1
        ? rect
        : null;
}

export async function POST(request: Request) {
    let stored: Awaited<ReturnType<typeof storeQuestionSource>> | undefined;
    try {
        const account = await getAuthenticatedAccount(request);
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return responseError("INVALID_CROP_REQUEST", "裁切資料格式不正確。", 400);
        }
        const record = body as Record<string, unknown>;
        const assetId = typeof record.assetId === "string" && UUID_PATTERN.test(record.assetId) ? record.assetId.toLowerCase() : null;
        const uploadKey = typeof record.uploadKey === "string" && /^[A-Za-z0-9._-]{1,120}$/u.test(record.uploadKey) ? record.uploadKey : null;
        const rect = parseRect(record.rect);
        if (!assetId || !uploadKey || !rect || Object.keys(record).length !== 3) {
            return responseError("INVALID_CROP_REQUEST", "裁切圖片、範圍或重送識別碼格式不正確。", 400);
        }
        const asset = await withLocalPostgresReadTransaction((client) => findQuestionImportAsset(client, assetId, account.userId));
        if (!asset || !asset.mimeType.startsWith("image/")) {
            return responseError("CROP_SOURCE_NOT_FOUND", "找不到可裁切的頁面圖片。", 404);
        }
        const bytes = await readFile(await resolveQuestionSourcePath(asset.storageKey));
        if (bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.checksum) {
            throw new Error("CROP_SOURCE_CHECKSUM_MISMATCH");
        }
        const crop = await cropQuestionImage(bytes, rect);
        const source = validateQuestionSource(crop.bytes);
        if (!source) throw new Error("CROP_OUTPUT_INVALID");
        const identity = deriveQuestionSourceIdentity(account.userId, `crop:${uploadKey}`, source);
        stored = await storeQuestionSource(identity, source);
        await withLocalPostgresTransaction(async (client) => {
            const inserted = await client.query(`
                INSERT INTO assets(
                    id, storage_key, mime_type, byte_size, width, height, checksum,
                    purpose, sensitivity, scan_status, created_by_user_id
                ) VALUES($1,$2,$3,$4,$5,$6,$7,'page_crop','private','clean',$8)
                ON CONFLICT(id) DO NOTHING
                RETURNING id
            `, [identity.assetId, identity.storageKey, source.mimeType, source.bytes.length, crop.width, crop.height, source.checksum, account.userId]);
            if (inserted.rowCount) return;
            const existing = await client.query(`
                SELECT 1 FROM assets
                WHERE id = $1 AND storage_key = $2 AND checksum = $3
                  AND purpose = 'page_crop' AND created_by_user_id = $4
                  AND scan_status = 'clean' AND deleted_at IS NULL
            `, [identity.assetId, identity.storageKey, source.checksum, account.userId]);
            if (!existing.rowCount) throw new Error("CROP_ASSET_CONFLICT");
        });
        return NextResponse.json({
            data: {
                assetId: identity.assetId,
                mimeType: source.mimeType,
                width: crop.width,
                height: crop.height,
                url: `/api/v1/question-import-assets/${identity.assetId}`,
            },
        }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        await (stored ? removeQuestionSource(stored) : Promise.resolve()).catch(() => undefined);
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return responseError(error.code, error.message, status);
        }
        console.error("Question image crop failed", error);
        return responseError("QUESTION_IMAGE_CROP_FAILED", "圖片裁切失敗，請重新調整範圍。", 500);
    }
}
