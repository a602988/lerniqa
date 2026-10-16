import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";

export const ADMIN_ASSET_MAX_BYTES = 20 * 1024 * 1024;

const MIME_EXTENSIONS = new Map<string, string>([
    ["image/avif", "avif"],
    ["image/gif", "gif"],
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["audio/aac", "aac"],
    ["audio/mpeg", "mp3"],
    ["audio/mp4", "m4a"],
    ["audio/ogg", "ogg"],
    ["audio/wav", "wav"],
]);

export interface AdminQuestionAssetRecord {
    id: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
}

export interface AdminQuestionAssetFile {
    bytes: Uint8Array;
    mimeType: string;
    extension: string;
}

interface AdminQuestionAssetRow extends QueryResultRow {
    id: string;
    storage_key: string;
    mime_type: string;
    byte_size: string | number;
    checksum: string;
}

export const ADMIN_QUESTION_ASSET_SQL = `
    SELECT
        asset.id,
        asset.storage_key,
        asset.mime_type,
        asset.byte_size,
        asset.checksum
    FROM assets AS asset
    WHERE asset.id = $1
        AND asset.deleted_at IS NULL
        AND asset.scan_status = 'clean'
        AND (
            EXISTS (
                SELECT 1
                FROM question_content_blocks AS content_block
                WHERE content_block.asset_id = asset.id
                    AND (
                        (
                            content_block.content_type = 'image'
                            AND asset.purpose = 'question_content'
                            AND asset.mime_type LIKE 'image/%'
                        )
                        OR (
                            content_block.content_type = 'audio'
                            AND asset.purpose = 'question_content'
                            AND asset.mime_type LIKE 'audio/%'
                        )
                        OR (
                            content_block.content_type = 'page_crop'
                            AND asset.purpose = 'page_crop'
                            AND asset.mime_type LIKE 'image/%'
                        )
                    )
            )
            OR (
                asset.purpose = 'page_crop'
                AND asset.mime_type LIKE 'image/%'
                AND EXISTS (
                    SELECT 1
                    FROM question_revision_sources AS revision_source
                    WHERE revision_source.crop_asset_id = asset.id
                )
            )
        )
    LIMIT 1
`;

function safeByteSize(value: string | number): number | null {
    const parsed = typeof value === "number"
        ? value
        : /^[1-9]\d*$/u.test(value)
            ? Number(value)
            : Number.NaN;
    return Number.isSafeInteger(parsed) && parsed > 0
        ? parsed
        : null;
}

function safeStorageKey(storageKey: string): boolean {
    if (
        !storageKey
        || storageKey.length > 500
        || storageKey.includes("\\")
        || storageKey.includes("\0")
        || path.posix.isAbsolute(storageKey)
    ) return false;

    const segments = storageKey.split("/");
    return segments.every((segment) => (
        segment.length > 0
        && segment.length <= 255
        && segment !== "."
        && segment !== ".."
    ));
}

/**
 * Finds only active, clean assets that are formally attached to question
 * content or a revision source crop. Storage metadata remains server-only.
 */
export async function findAdminQuestionAsset(
    runner: AdminQueryRunner,
    assetId: string,
): Promise<AdminQuestionAssetRecord | null> {
    const result = await runner.query<AdminQuestionAssetRow>(
        ADMIN_QUESTION_ASSET_SQL,
        [assetId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const byteSize = safeByteSize(row.byte_size);
    if (
        byteSize === null
        || typeof row.storage_key !== "string"
        || typeof row.mime_type !== "string"
        || typeof row.checksum !== "string"
    ) return null;

    return {
        id: row.id,
        storageKey: row.storage_key,
        mimeType: row.mime_type.toLowerCase(),
        byteSize,
        checksum: row.checksum.toLowerCase(),
    };
}

async function hasNoSymlinkComponents(
    root: string,
    segments: readonly string[],
): Promise<boolean> {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return false;

    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
        current = path.join(current, segments[index] ?? "");
        const info = await lstat(current);
        if (info.isSymbolicLink()) return false;
        const isLast = index === segments.length - 1;
        if (isLast ? !info.isFile() : !info.isDirectory()) return false;
    }

    return true;
}

/**
 * Reads an asset from the repository-owned local storage root. Any invalid
 * metadata, path escape, symlink, missing file or integrity mismatch is treated
 * as unavailable so callers can return one non-disclosing 404 response.
 */
export async function readAdminQuestionAssetFile(
    asset: AdminQuestionAssetRecord,
    assetRoot = path.resolve(process.cwd(), "local-data", "assets"),
): Promise<AdminQuestionAssetFile | null> {
    const extension = MIME_EXTENSIONS.get(asset.mimeType);
    if (
        !extension
        || !safeStorageKey(asset.storageKey)
        || !Number.isSafeInteger(asset.byteSize)
        || asset.byteSize <= 0
        || asset.byteSize > ADMIN_ASSET_MAX_BYTES
        || !/^[0-9a-f]{64}$/u.test(asset.checksum)
    ) return null;

    const root = path.resolve(assetRoot);
    const segments = asset.storageKey.split("/");
    const candidate = path.resolve(root, ...segments);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) return null;

    try {
        if (!await hasNoSymlinkComponents(root, segments)) return null;

        const [realRoot, realCandidate] = await Promise.all([
            realpath(root),
            realpath(candidate),
        ]);
        if (
            realCandidate === realRoot
            || !realCandidate.startsWith(`${realRoot}${path.sep}`)
        ) return null;

        const finalInfo = await lstat(realCandidate);
        if (
            finalInfo.isSymbolicLink()
            || !finalInfo.isFile()
            || finalInfo.size !== asset.byteSize
            || finalInfo.size > ADMIN_ASSET_MAX_BYTES
        ) return null;

        const bytes = await readFile(realCandidate);
        if (bytes.byteLength !== asset.byteSize) return null;
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (checksum !== asset.checksum) return null;

        return {
            bytes,
            mimeType: asset.mimeType,
            extension,
        };
    }
    catch {
        return null;
    }
}
