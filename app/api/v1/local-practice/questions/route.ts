import { readLocalPracticeCatalog } from "@/app/lib/local-practice-store";
import { LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE } from "@/app/lib/local-practice-types";
import {
    errorResponse,
    handleLocalPracticeError,
    localPracticeLargeJsonResponse,
    localPracticeJsonResponse,
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
        const filterNames = ["grade", "subject", "publisher", "volume", "lesson"] as const;
        const suppliedFilterCount = filterNames.filter((name) => searchParams.has(name)).length;
        const hasPagination = searchParams.has("page") || searchParams.has("limit");
        if (
            (suppliedFilterCount !== 0 && suppliedFilterCount !== filterNames.length)
            || (suppliedFilterCount === 0 && hasPagination)
        ) {
            return errorResponse("INVALID_QUESTION_FILTER", "題庫篩選或分頁參數格式不正確。", 400);
        }

        const filters = suppliedFilterCount === filterNames.length
            ? parseLocalPracticeFilters(searchParams)
            : null;
        const page = filters ? parseBoundedInteger(searchParams.get("page"), 1, 1, 10_000) : 1;
        const limit = filters ? parseBoundedInteger(
            searchParams.get("limit"), 100, 1, LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE,
        ) : 0;
        if (suppliedFilterCount > 0 && (!filters || page === null || limit === null)) {
            return errorResponse("INVALID_QUESTION_FILTER", "題庫篩選或分頁參數格式不正確。", 400);
        }

        const query = filters
            ? { kind: "filtered" as const, filters, page: page!, limit: limit! }
            : { kind: "accessible" as const };
        const result = await readLocalPracticeCatalog(query, {
            userId: account.userId,
            learnerId: account.learner.id,
        });
        const body = {
            data: { questions: result.questions },
            meta: localPracticeMeta(query.kind === "accessible"
                ? { scope: "accessible", total: result.total }
                : { scope: "filtered", filters, page, limit, total: result.total }),
        };
        return query.kind === "accessible"
            ? localPracticeLargeJsonResponse(request, body)
            : localPracticeJsonResponse(body);
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
