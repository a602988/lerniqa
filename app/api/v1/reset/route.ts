import { NextResponse } from "next/server";
import { resetDatabase } from "@/app/lib/mock-store";

export const runtime = "nodejs";

/** 將可寫入 JSON 還原為 repository 內的 fixture。 */
export async function POST() {
    try {
        const database = await resetDatabase();
        return NextResponse.json({
            data: { state: database.state, questions: database.questions, imports: database.imports },
            meta: { mock: true, persistence: "runtime-json", version: database.version },
        });
    }
    catch {
        return NextResponse.json({ error: { code: "MOCK_STORE_RESET_FAILED", message: "目前無法重設模擬資料。" } }, { status: 500 });
    }
}
