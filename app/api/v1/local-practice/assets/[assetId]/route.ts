import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
    findLocalPracticeAnswerAsset,
    findLocalPracticeAsset,
    findLocalPracticeSessionAsset,
} from "@/app/lib/local-practice-store";
import {
    errorResponse,
    handleLocalPracticeError,
    parseLocalPracticeFilters,
    requireLocalPracticeAccount,
    UUID_PATTERN,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const SAFE_MIME_TYPES = new Set([
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "audio/aac",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
]);

function validStorageKey(storageKey: string): boolean {
    if (!storageKey || storageKey.includes("\\") || path.posix.isAbsolute(storageKey)) return false;
    const segments = storageKey.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function readSafeAsset(storageKey: string, expectedSize: number, expectedChecksum: string): Promise<Uint8Array | null> {
    if (
        !validStorageKey(storageKey)
        || expectedSize <= 0
        || expectedSize > MAX_ASSET_BYTES
        || !/^[0-9a-f]{64}$/iu.test(expectedChecksum)
    ) return null;
    const root = path.resolve(process.cwd(), "local-data", "assets");
    const candidate = path.resolve(root, ...storageKey.split("/"));
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) return null;

    try {
        const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
        if (!realCandidate.startsWith(`${realRoot}${path.sep}`)) return null;
        const info = await stat(realCandidate);
        if (!info.isFile() || info.size !== expectedSize || info.size > MAX_ASSET_BYTES) return null;
        const bytes = await readFile(realCandidate);
        const checksum = createHash("sha256").update(bytes).digest("hex");
        return checksum.toLowerCase() === expectedChecksum.toLowerCase() ? bytes : null;
    }
    catch {
        return null;
    }
}

/** Serves clean media referenced by an authorized current target or session-pinned revision. */
export async function GET(
    request: Request,
    context: { params: Promise<{ assetId: string }> },
) {
    try {
        const account = await requireLocalPracticeAccount(request);
        const { assetId } = await context.params;
        if (!UUID_PATTERN.test(assetId)) return errorResponse("ASSET_NOT_FOUND", "找不到題目媒體。", 404);
        const searchParams = new URL(request.url).searchParams;
        const kind = searchParams.get("kind");
        const sessionId = searchParams.get("sessionId");
        if (sessionId !== null && (!UUID_PATTERN.test(sessionId) || kind !== null)) {
            return errorResponse("ASSET_NOT_FOUND", "找不到題目媒體。", 404);
        }
        const actor = { userId: account.userId, learnerId: account.learner.id };
        const asset = kind === "answer"
            ? await findLocalPracticeAnswerAsset(assetId, actor)
            : sessionId !== null
                ? await findLocalPracticeSessionAsset(assetId.toLowerCase(), sessionId.toLowerCase(), actor)
            : kind === null
                ? await (async () => {
                    const filters = parseLocalPracticeFilters(searchParams);
                    return filters ? findLocalPracticeAsset(assetId, filters, actor) : null;
                })()
                : null;
        if (!asset || !SAFE_MIME_TYPES.has(asset.mimeType)) {
            return errorResponse("ASSET_NOT_FOUND", "找不到題目媒體。", 404);
        }
        const bytes = await readSafeAsset(asset.storageKey, asset.byteSize, asset.checksum);
        if (!bytes) return errorResponse("ASSET_NOT_FOUND", "找不到題目媒體。", 404);

        const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return new Response(body, {
            status: 200,
            headers: {
                "Cache-Control": "private, no-store",
                "Content-Length": String(bytes.byteLength),
                "Content-Type": asset.mimeType,
                "X-Content-Type-Options": "nosniff",
            },
        });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
