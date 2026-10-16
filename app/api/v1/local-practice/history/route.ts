import { NextResponse } from "next/server";
import { getLocalPracticeHistory } from "@/app/lib/local-practice-store";
import {
    errorResponse,
    handleLocalPracticeError,
    localPracticeMeta,
    parseBoundedInteger,
    requireLocalPracticeAccount,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the authenticated learner's durable history without private answer payloads. */
export async function GET(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        const limit = parseBoundedInteger(new URL(request.url).searchParams.get("limit"), 50, 1, 100);
        if (limit === null) return errorResponse("INVALID_HISTORY_LIMIT", "歷史紀錄筆數必須介於 1 到 100。", 400);
        const history = await getLocalPracticeHistory(limit, {
            userId: account.userId,
            learnerId: account.learner.id,
        });
        return NextResponse.json({ data: history, meta: localPracticeMeta({ limit }) });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
