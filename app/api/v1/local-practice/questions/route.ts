import { listLocalPracticeQuestions } from "@/app/lib/local-practice-store";
import { queryLocalPostgres } from "@/app/lib/local-postgres";
import {
    attachPracticeCatalogKnowledge,
    PRACTICE_CATALOG_KNOWLEDGE_SQL,
    type PracticeCatalogKnowledgeRow,
} from "@/app/lib/practice-catalog-knowledge";
import { LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE } from "@/app/lib/local-practice-types";
import {
    errorResponse,
    handleLocalPracticeError,
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
        const filters = parseLocalPracticeFilters(searchParams);
        const page = parseBoundedInteger(searchParams.get("page"), 1, 1, 10_000);
        const limit = parseBoundedInteger(
            searchParams.get("limit"),
            100,
            1,
            LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE,
        );
        if (!filters || page === null || limit === null) {
            return errorResponse("INVALID_QUESTION_FILTER", "題庫篩選或分頁參數格式不正確。", 400);
        }

        const result = await listLocalPracticeQuestions(filters, page, limit, {
            userId: account.userId,
            learnerId: account.learner.id,
        });
        const revisionIds = [...new Set(result.questions.map((question) => question.revisionId))];
        const knowledgeRows = revisionIds.length === 0
            ? []
            : (await queryLocalPostgres<PracticeCatalogKnowledgeRow>(
                PRACTICE_CATALOG_KNOWLEDGE_SQL,
                [revisionIds],
            )).rows;
        const questions = attachPracticeCatalogKnowledge(result.questions, knowledgeRows);
        return localPracticeJsonResponse({
            data: { questions },
            meta: localPracticeMeta({ filters, page, limit, total: result.total }),
        });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
