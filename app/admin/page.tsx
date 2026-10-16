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
import { adminPostgresRunner } from "@/app/lib/admin/admin-server";

import { readAdminPageAccess } from "./admin-page-auth";

export default async function AdminDashboardPage() {
    const access = await readAdminPageAccess();
    if (access.kind !== "authorized") return null;

    try {
        const [accounts, questions, audit] = await Promise.all([
            listAccounts(
                adminPostgresRunner,
                parseAccountListQuery({ page: "1", perPage: "1" }),
            ),
            listQuestions(
                adminPostgresRunner,
                parseQuestionListQuery({ page: "1", perPage: "1" }),
            ),
            listAuditLogs(
                adminPostgresRunner,
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
    }
    catch (error) {
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
