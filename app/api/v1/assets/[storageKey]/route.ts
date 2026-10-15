import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getAssetPath, getFixtureAssetPath } from "@/app/lib/mock-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
};

/**
 * 讀取題目或答案引用的圖片；runtime 缺漏時改讀內建題庫原圖。
 * @param _request 圖片請求。
 * @param context 包含圖片儲存識別碼的路由參數。
 * @returns 圖片內容或對應的錯誤回應。
 */
export async function GET(_request: Request, context: { params: Promise<{ storageKey: string }> }) {
    const { storageKey } = await context.params;
    const assetPath = getAssetPath(storageKey);
    if (!assetPath) return NextResponse.json({ error: { code: "INVALID_ASSET_KEY", message: "圖片識別碼格式錯誤。" } }, { status: 400 });

    try {
        const body = await readFile(assetPath).catch(() => readFile(getFixtureAssetPath(storageKey)));
        const extension = storageKey.split(".").pop()?.toLowerCase() ?? "";
        return new NextResponse(body, {
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
                "X-Content-Type-Options": "nosniff",
            },
        });
    }
    catch {
        return NextResponse.json({ error: { code: "ASSET_NOT_FOUND", message: "找不到指定圖片。" } }, { status: 404 });
    }
}
