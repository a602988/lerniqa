import { ReportsView } from "@/app/components/admin/views";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildReportsViewModel,
    parseAdminReportRange,
    resolveAdminReportQuery,
} from "@/app/lib/admin/admin-view-model";
import { getAdminReportSnapshot } from "@/app/lib/admin/report-repository";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "../admin-page-auth";

type ReportsPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;

            const now = new Date();
            const rawQuery = await searchParams;
            let range;
            let query;
            try {
                range = parseAdminReportRange(rawQuery);
                query = resolveAdminReportQuery(range, now);
            }
            catch (error) {
                const fallbackRange = "30d" as const;
                const fallbackQuery = resolveAdminReportQuery(fallbackRange, now);
                return (
                    <ReportsView
                        {...buildReportsViewModel({
                            range: fallbackRange,
                            query: fallbackQuery,
                            report: null,
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }

            const report = await getAdminReportSnapshot(runner, query);
            return (
                <ReportsView
                    {...buildReportsViewModel({ range, query, report })}
                />
            );
        });
    }
    catch (error) {
        const fallbackRange = "30d" as const;
        const fallbackQuery = resolveAdminReportQuery(fallbackRange, new Date());
        return <ReportsView {...buildReportsViewModel({
            range: fallbackRange,
            query: fallbackQuery,
            report: null,
            errorMessage: adminViewErrorMessage(error),
        })} />;
    }
}
