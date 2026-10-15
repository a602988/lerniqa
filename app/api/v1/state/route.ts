import { NextResponse } from "next/server";
import { parseStoredState, updateDatabase } from "@/app/lib/mock-store";

export const runtime = "nodejs";

/** 將前端學習狀態完整寫入 runtime JSON。 */
export async function PUT(request: Request) {
    try {
        const body: unknown = await request.json();
        const database = await updateDatabase((current) => {
            const state = parseStoredState(body, current.questions);
            if (!state) throw new Error("INVALID_STATE");
            return { ...current, state };
        });
        return NextResponse.json({ data: database.state, meta: { mock: true, persistence: "runtime-json" } });
    }
    catch (error) {
        if (error instanceof Error && error.message === "INVALID_STATE") {
            return NextResponse.json({ error: { code: "INVALID_STATE", message: "送出的學習資料格式不完整。" } }, { status: 400 });
        }
        return NextResponse.json({ error: { code: "MOCK_STORE_WRITE_FAILED", message: "目前無法保存模擬資料。" } }, { status: 500 });
    }
}
