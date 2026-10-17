import { unstable_rethrow } from "next/navigation";

import { QuestionsView } from "@/app/components/admin/views";
import {
    getQuestionDetail,
    listQuestionFilterOptions,
    listQuestions,
    parseQuestionDetailQuery,
    parseQuestionListQuery,
    parseUuid,
} from "@/app/lib/admin";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildQuestionsViewModel,
    readAdminDetailId,
} from "@/app/lib/admin/admin-view-model";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "../admin-page-auth";

type QuestionsPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminQuestionsPage({ searchParams }: QuestionsPageProps) {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;

            const rawQuery = await searchParams;
            let query;
            let detailQuery;
            try {
                query = parseQuestionListQuery(rawQuery);
                detailQuery = parseQuestionDetailQuery(rawQuery);
            }
            catch (error) {
                const fallback = parseQuestionListQuery({});
                return (
                    <QuestionsView
                        {...buildQuestionsViewModel({
                            query: fallback,
                            page: { items: [], page: 1, pageSize: 25, total: 0 },
                            detail: null,
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }

            try {
                const detailId = readAdminDetailId(rawQuery, "question");
                const [page, detail, filterOptions] = await Promise.all([
                    listQuestions(runner, query),
                    detailId
                        ? getQuestionDetail(
                            runner,
                            parseUuid(detailId, "題目識別碼"),
                            detailQuery,
                        )
                        : Promise.resolve(null),
                    listQuestionFilterOptions(runner),
                ]);
                return (
                    <QuestionsView
                        {...buildQuestionsViewModel({
                            query,
                            page,
                            detail,
                            filterOptions,
                            actorUserId: access.actor.userId,
                        })}
                    />
                );
            }
            catch (error) {
                return (
                    <QuestionsView
                        {...buildQuestionsViewModel({
                            query,
                            page: {
                                items: [],
                                page: query.page,
                                pageSize: query.pageSize,
                                total: 0,
                            },
                            detail: null,
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }
        });
    }
    catch (error) {
        unstable_rethrow(error);
        const fallback = parseQuestionListQuery({});
        return (
            <QuestionsView
                {...buildQuestionsViewModel({
                    query: fallback,
                    page: {
                        items: [],
                        page: fallback.page,
                        pageSize: fallback.pageSize,
                        total: 0,
                    },
                    detail: null,
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }
}
