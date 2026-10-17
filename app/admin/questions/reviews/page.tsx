import { unstable_rethrow } from "next/navigation";

import { QuestionReviewQueueView } from "@/app/components/admin/views";
import {
    listQuestionReviewQueue,
    parseQuestionReviewQueueQuery,
} from "@/app/lib/admin";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildQuestionReviewQueueViewModel,
} from "@/app/lib/admin/admin-view-model";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "../../admin-page-auth";

type QuestionReviewQueuePageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

function emptyPage(query: ReturnType<typeof parseQuestionReviewQueueQuery>) {
    return {
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
    };
}

export default async function AdminQuestionReviewQueuePage({
    searchParams,
}: QuestionReviewQueuePageProps) {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;

            const rawQuery = await searchParams;
            let query;
            try {
                query = parseQuestionReviewQueueQuery(rawQuery);
            }
            catch (error) {
                const fallback = parseQuestionReviewQueueQuery({});
                return (
                    <QuestionReviewQueueView
                        {...buildQuestionReviewQueueViewModel({
                            query: fallback,
                            page: emptyPage(fallback),
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }

            try {
                const page = await listQuestionReviewQueue(runner, query);
                return (
                    <QuestionReviewQueueView
                        {...buildQuestionReviewQueueViewModel({ query, page })}
                    />
                );
            }
            catch (error) {
                return (
                    <QuestionReviewQueueView
                        {...buildQuestionReviewQueueViewModel({
                            query,
                            page: emptyPage(query),
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }
        });
    }
    catch (error) {
        unstable_rethrow(error);
        const fallback = parseQuestionReviewQueueQuery({});
        return (
            <QuestionReviewQueueView
                {...buildQuestionReviewQueueViewModel({
                    query: fallback,
                    page: emptyPage(fallback),
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }
}
