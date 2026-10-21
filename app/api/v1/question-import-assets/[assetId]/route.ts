import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { LocalPostgresUnavailableError, withLocalPostgresReadTransaction } from "@/app/lib/local-postgres";
import { resolveQuestionSourcePath } from "@/app/lib/question-source-object-store";
import { findQuestionImportAsset } from "@/app/lib/question-source-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function missing() {
    return Response.json({ error: { code: "IMPORT_ASSET_NOT_FOUND", message: "找不到匯入檔案。" } }, { status: 404 });
}

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
    try {
        const account = await getAuthenticatedAccount(request);
        const { assetId } = await context.params;
        if (!UUID_PATTERN.test(assetId)) return missing();
        const asset = await withLocalPostgresReadTransaction((client) => findQuestionImportAsset(client, assetId.toLowerCase(), account.userId));
        if (!asset || !SAFE_MIME.has(asset.mimeType) || asset.byteSize <= 0 || asset.byteSize > 20 * 1024 * 1024) return missing();
        const bytes = await readFile(await resolveQuestionSourcePath(asset.storageKey));
        if (bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.checksum) return missing();
        return new Response(bytes, {
            headers: {
                "Cache-Control": "private, no-store",
                "Content-Length": String(bytes.length),
                "Content-Type": asset.mimeType,
                "X-Content-Type-Options": "nosniff",
            },
        });
    }
    catch (error) {
        if (error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            const status = error instanceof LocalPostgresUnavailableError ? 503 : error.status;
            return Response.json({ error: { code: error.code, message: error.message } }, { status });
        }
        return missing();
    }
}
