import { getLocalPracticeHistory } from "@/app/lib/local-practice-store";
import {
    errorResponse,
    handleLocalPracticeError,
    localPracticeJsonResponse,
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
        const params = new URL(request.url).searchParams;
        const limit = parseBoundedInteger(params.get("limit"), 50, 1, 100);
        const page = parseBoundedInteger(params.get("page"), 1, 1, 10_000);
        if (limit === null || page === null) return errorResponse("INVALID_HISTORY_LIMIT", "歷史紀錄筆數或頁碼格式不正確。", 400);
        const history = await getLocalPracticeHistory(limit, {
            userId: account.userId,
            learnerId: account.learner.id,
        }, (page - 1) * limit);
        return localPracticeJsonResponse({ data: history, meta: localPracticeMeta({ limit, page }) });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
