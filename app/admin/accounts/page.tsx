import { AccountsView } from "@/app/components/admin/views";
import { unstable_rethrow } from "next/navigation";
import {
    getAccountDetail,
    listAccounts,
    parseAccountListQuery,
    parseUuid,
} from "@/app/lib/admin";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildAccountsViewModel,
    readAdminDetailId,
} from "@/app/lib/admin/admin-view-model";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";

import { readAdminPageAccessInSnapshot } from "../admin-page-auth";

type AccountsPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminAccountsPage({ searchParams }: AccountsPageProps) {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;

            const rawQuery = await searchParams;
            let query;
            try {
                query = parseAccountListQuery(rawQuery);
            }
            catch (error) {
                const fallback = parseAccountListQuery({});
                return (
                    <AccountsView
                        {...buildAccountsViewModel({
                            query: fallback,
                            page: { items: [], page: 1, pageSize: 25, total: 0 },
                            detail: null,
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }

            const detailId = readAdminDetailId(rawQuery, "account");
            const [page, detail] = await Promise.all([
                listAccounts(runner, query),
                detailId
                    ? getAccountDetail(
                        runner,
                        parseUuid(detailId, "帳號識別碼"),
                    )
                    : Promise.resolve(null),
            ]);
            return <AccountsView {...buildAccountsViewModel({ query, page, detail })} />;
        });
    }
    catch (error) {
        unstable_rethrow(error);
        const query = parseAccountListQuery({});
        return (
            <AccountsView
                {...buildAccountsViewModel({
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
