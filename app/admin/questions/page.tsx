import { QuestionsView } from "@/app/components/admin/views";
import {
    getQuestionDetail,
    listQuestions,
    parseQuestionListQuery,
    parseUuid,
} from "@/app/lib/admin";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildQuestionsViewModel,
    readAdminDetailId,
} from "@/app/lib/admin/admin-view-model";
import { adminPostgresRunner } from "@/app/lib/admin/admin-server";

import { readAdminPageAccess } from "../admin-page-auth";

type QuestionsPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminQuestionsPage({ searchParams }: QuestionsPageProps) {
    const access = await readAdminPageAccess();
    if (access.kind !== "authorized") return null;

    const rawQuery = await searchParams;
    let query;
    try {
        query = parseQuestionListQuery(rawQuery);
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
        const [page, detail] = await Promise.all([
            listQuestions(adminPostgresRunner, query),
            detailId
                ? getQuestionDetail(
                    adminPostgresRunner,
                    parseUuid(detailId, "題目識別碼"),
                )
                : Promise.resolve(null),
        ]);
        return <QuestionsView {...buildQuestionsViewModel({ query, page, detail })} />;
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
}
