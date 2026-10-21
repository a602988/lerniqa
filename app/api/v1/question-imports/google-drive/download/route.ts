import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { MAX_QUESTION_SOURCE_BYTES, validateQuestionSource } from "@/app/lib/question-source-object-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+\/=\-]{20,4096}$/u;
const SAFE_MIME = new Set(["application/json", "application/pdf", "image/jpeg", "image/png", "image/webp"]);

function responseError(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function safeFileName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const name = value.normalize("NFC").trim();
    return name && name.length <= 255 && !/[\u0000-\u001f\u007f/\\]/u.test(name) ? name : null;
}

export async function POST(request: Request) {
    try {
        await getAuthenticatedAccount(request);
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return responseError("INVALID_DRIVE_FILE", "Google 雲端硬碟檔案資料格式不正確。", 400);
        }
        const record = body as Record<string, unknown>;
        const fileId = typeof record.fileId === "string" && FILE_ID_PATTERN.test(record.fileId) ? record.fileId : null;
        const accessToken = typeof record.accessToken === "string" && TOKEN_PATTERN.test(record.accessToken) ? record.accessToken : null;
        if (!fileId || !accessToken || Object.keys(record).length !== 2) {
            return responseError("INVALID_DRIVE_FILE", "Google 雲端硬碟授權或檔案識別碼不正確。", 400);
        }
        const signal = AbortSignal.timeout(30_000);
        const authorization = { Authorization: `Bearer ${accessToken}` };
        const metadataUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
        metadataUrl.searchParams.set("fields", "id,name,mimeType,size,trashed,capabilities(canDownload)");
        metadataUrl.searchParams.set("supportsAllDrives", "true");
        const metadataResponse = await fetch(metadataUrl, { headers: authorization, redirect: "error", signal });
        if (!metadataResponse.ok) return responseError("DRIVE_FILE_UNAVAILABLE", "無法讀取選取的 Google 雲端硬碟檔案。", metadataResponse.status === 401 || metadataResponse.status === 403 ? 403 : 502);
        const metadata: unknown = await metadataResponse.json();
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
            return responseError("DRIVE_FILE_INVALID", "Google 雲端硬碟回傳的檔案資料不完整。", 502);
        }
        const details = metadata as Record<string, unknown>;
        const name = safeFileName(details.name);
        const mimeType = typeof details.mimeType === "string" && SAFE_MIME.has(details.mimeType) ? details.mimeType : null;
        const size = typeof details.size === "string" && /^\d+$/u.test(details.size) ? Number(details.size) : null;
        const capabilities = details.capabilities && typeof details.capabilities === "object" && !Array.isArray(details.capabilities)
            ? details.capabilities as Record<string, unknown>
            : null;
        if (details.trashed === true || capabilities?.canDownload !== true) {
            return responseError("DRIVE_FILE_DOWNLOAD_BLOCKED", "這個 Google 雲端硬碟檔案不允許下載。", 403);
        }
        if (!name || !mimeType || !size || size > MAX_QUESTION_SOURCE_BYTES) {
            return responseError("DRIVE_FILE_UNSUPPORTED", "只接受 20 MB 以內的 JPG、PNG、WebP、PDF 或 JSON。", 415);
        }
        const contentUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
        contentUrl.searchParams.set("alt", "media");
        contentUrl.searchParams.set("supportsAllDrives", "true");
        const contentResponse = await fetch(contentUrl, { headers: authorization, redirect: "error", signal });
        if (!contentResponse.ok) return responseError("DRIVE_FILE_DOWNLOAD_FAILED", "Google 雲端硬碟檔案下載失敗。", 502);
        const bytes = Buffer.from(await contentResponse.arrayBuffer());
        if (bytes.length !== size || bytes.length > MAX_QUESTION_SOURCE_BYTES) {
            return responseError("DRIVE_FILE_SIZE_MISMATCH", "Google 雲端硬碟檔案大小與資料不一致。", 502);
        }
        if (mimeType === "application/json") {
            try {
                JSON.parse(bytes.toString("utf8"));
            }
            catch {
                return responseError("DRIVE_JSON_INVALID", "選取的 JSON 檔案內容不正確。", 415);
            }
        }
        else {
            const source = validateQuestionSource(bytes);
            if (!source || source.mimeType !== mimeType) {
                return responseError("DRIVE_FILE_CONTENT_MISMATCH", "檔案內容與 Google 雲端硬碟標示的格式不一致。", 415);
            }
        }
        return new Response(bytes, {
            headers: {
                "Cache-Control": "private, no-store",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
                "Content-Length": String(bytes.length),
                "Content-Type": mimeType,
                "X-Content-Type-Options": "nosniff",
                "X-Lerniqa-File-Name": encodeURIComponent(name),
            },
        });
    }
    catch (error) {
        if (error instanceof AuthServiceError) return responseError(error.code, error.message, error.status);
        if (error instanceof DOMException && error.name === "TimeoutError") {
            return responseError("DRIVE_FILE_TIMEOUT", "Google 雲端硬碟下載逾時，請稍後再試。", 504);
        }
        console.error("Google Drive question file download failed", error);
        return responseError("DRIVE_FILE_DOWNLOAD_FAILED", "Google 雲端硬碟檔案下載失敗。", 502);
    }
}
