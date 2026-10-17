import { NextResponse } from "next/server";
import { readEducationCatalog } from "@/app/lib/education-catalog";
import { handleAuthError } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 回傳註冊與學習者設定共用的正式教育目錄。 */
export async function GET() {
    try {
        const catalog = await readEducationCatalog();
        return NextResponse.json(
            { data: { catalog }, meta: { persistence: "local-postgresql" } },
            { headers: { "Cache-Control": "no-store" } },
        );
    }
    catch (error) {
        return handleAuthError(error);
    }
}
