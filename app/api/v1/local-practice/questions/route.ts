import { NextResponse } from "next/server";
import { listLocalPracticeQuestions } from "@/app/lib/local-practice-store";
import {
    errorResponse,
    handleLocalPracticeError,
    localPracticeMeta,
    parseBoundedInteger,
    parseLocalPracticeFilters,
    requireLocalPracticeAccount,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists current published prompt and option content; answer content never enters this response. */
export async function GET(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        const { searchParams } = new URL(request.url);
        const filters = parseLocalPracticeFilters(searchParams);
        const page = parseBoundedInteger(searchParams.get("page"), 1, 1, 10_000);
        const limit = parseBoundedInteger(searchParams.get("limit"), 100, 1, 100);
        if (!filters || page === null || limit === null) {
            return errorResponse("INVALID_QUESTION_FILTER", "題庫篩選或分頁參數格式不正確。", 400);
        }

        const result = await listLocalPracticeQuestions(filters, page, limit, {
            userId: account.userId,
            learnerId: account.learner.id,
        });
        return NextResponse.json({
            data: { questions: result.questions },
            meta: localPracticeMeta({ filters, page, limit, total: result.total }),
        });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
