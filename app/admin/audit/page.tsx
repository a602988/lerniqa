import { unstable_rethrow } from "next/navigation";

import { AuditView } from "@/app/components/admin/views";
import { listAuditLogs, parseAuditListQuery } from "@/app/lib/admin";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildAuditViewModel,
} from "@/app/lib/admin/admin-view-model";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "../admin-page-auth";

type AuditPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
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

            const page = await listAuditLogs(runner, query);
            return <AuditView {...buildAuditViewModel({ query, page })} />;
        });
    }
    catch (error) {
        unstable_rethrow(error);
        const fallback = parseAuditListQuery({});
        return (
            <AuditView
                {...buildAuditViewModel({
                    query: fallback,
                    page: {
                        items: [],
                        page: fallback.page,
                        pageSize: fallback.pageSize,
                        total: 0,
                    },
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }
}
