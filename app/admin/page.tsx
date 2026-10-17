import { unstable_rethrow } from "next/navigation";

import { DashboardView } from "@/app/components/admin/views";
import {
    listAccounts,
    listAuditLogs,
    listQuestions,
    parseAccountListQuery,
    parseAuditListQuery,
    parseQuestionListQuery,
} from "@/app/lib/admin";
import {
    adminViewErrorMessage,
    buildDashboardViewModel,
} from "@/app/lib/admin/admin-view-model";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "./admin-page-auth";

export default async function AdminDashboardPage() {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;

            const [accounts, questions, audit] = await Promise.all([
                listAccounts(
                    runner,
                    parseAccountListQuery({ page: "1", perPage: "1" }),
                ),
                listQuestions(
                    runner,
                    parseQuestionListQuery({ page: "1", perPage: "1" }),
                ),
                listAuditLogs(
                    runner,
                    parseAuditListQuery({ page: "1", perPage: "5" }),
                ),
            ]);

            return (
                <DashboardView
                    {...buildDashboardViewModel({
                        accountTotal: accounts.total,
                        questionTotal: questions.total,
                        recentAudit: audit.items,
                    })}
                />
            );
        });
    }
    catch (error) {
        unstable_rethrow(error);
        return (
            <DashboardView
                {...buildDashboardViewModel({
                    accountTotal: null,
                    questionTotal: null,
                    recentAudit: [],
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }
}
