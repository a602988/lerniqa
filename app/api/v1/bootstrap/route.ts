import { NextResponse } from "next/server";
import { readDatabase } from "@/app/lib/mock-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 回傳前端啟動所需的學習狀態與題庫。 */
export async function GET() {
    try {
        const database = await readDatabase();
        return NextResponse.json({
            data: { state: database.state, questions: database.questions, imports: database.imports },
            meta: { mock: true, persistence: "runtime-json", version: database.version },
        });
    }
    catch {
        return NextResponse.json({ error: { code: "MOCK_STORE_READ_FAILED", message: "目前無法讀取模擬資料。" } }, { status: 500 });
    }
}
