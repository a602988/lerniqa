import { AuditView } from "@/app/components/admin/views";
import { listAuditLogs, parseAuditListQuery } from "@/app/lib/admin";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildAuditViewModel,
} from "@/app/lib/admin/admin-view-model";
import { adminPostgresRunner } from "@/app/lib/admin/admin-server";

import { readAdminPageAccess } from "../admin-page-auth";

type AuditPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
    const access = await readAdminPageAccess();
    if (access.kind !== "authorized") return null;

    const rawQuery = await searchParams;
    let query;
    try {
        query = parseAuditListQuery(rawQuery);
    }
    catch (error) {
        const fallback = parseAuditListQuery({});
        return (
            <AuditView
                {...buildAuditViewModel({
                    query: fallback,
                    page: { items: [], page: 1, pageSize: 25, total: 0 },
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }

    try {
        const page = await listAuditLogs(adminPostgresRunner, query);
        return <AuditView {...buildAuditViewModel({ query, page })} />;
    }
    catch (error) {
        return (
            <AuditView
                {...buildAuditViewModel({
                    query,
                    page: {
                        items: [],
                        page: query.page,
                        pageSize: query.pageSize,
                        total: 0,
                    },
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }
}
