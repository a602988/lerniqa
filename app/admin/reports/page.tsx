import { ReportsView } from "@/app/components/admin/views";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildReportsViewModel,
    parseAdminReportRange,
} from "@/app/lib/admin/admin-view-model";

import { readAdminPageAccess } from "../admin-page-auth";

type ReportsPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
    const access = await readAdminPageAccess();
    if (access.kind !== "authorized") return null;

    try {
        const range = parseAdminReportRange(await searchParams);
        return <ReportsView {...buildReportsViewModel(range)} />;
    }
    catch (error) {
        const viewModel = buildReportsViewModel("30d");
        return (
            <ReportsView
                {...viewModel}
                state={{
                    kind: "error",
                    message: adminViewErrorMessage(error),
                    retryHref: "/admin/reports",
                }}
            />
        );
    }
}
