import { SubscriptionPlansView } from "@/app/components/admin/views";
import { unstable_rethrow } from "next/navigation";
import {
    parseSubscriptionPlanListQuery,
    parseUuid,
} from "@/app/lib/admin/admin-input";
import {
    type AdminPageSearchParams,
    adminViewErrorMessage,
    buildSubscriptionPlansViewModel,
    readAdminDetailId,
} from "@/app/lib/admin/admin-view-model";
import { withAdminReadOnlySnapshot } from "@/app/lib/admin/admin-server";
import {
    getSubscriptionPlan,
    listSubscriptionFeatureDefinitions,
    listSubscriptionPlans,
} from "@/app/lib/admin/subscription-repository";

import { readAdminPageAccessInSnapshot } from "../admin-page-auth";

type SubscriptionPlansPageProps = {
    searchParams: Promise<AdminPageSearchParams>;
};

export default async function AdminSubscriptionPlansPage({
    searchParams,
}: SubscriptionPlansPageProps) {
    try {
        return await withAdminReadOnlySnapshot(async (runner) => {
            const access = await readAdminPageAccessInSnapshot(runner);
            if (access.kind !== "authorized") return null;

            const rawQuery = await searchParams;
            let query;
            try {
                query = parseSubscriptionPlanListQuery(rawQuery);
            }
            catch (error) {
                const fallback = parseSubscriptionPlanListQuery({});
                return (
                    <SubscriptionPlansView
                        {...buildSubscriptionPlansViewModel({
                            query: fallback,
                            page: { items: [], page: 1, pageSize: 25, total: 0 },
                            detail: null,
                            featureDefinitions: [],
                            errorMessage: adminViewErrorMessage(error),
                        })}
                    />
                );
            }

            const detailId = readAdminDetailId(rawQuery, "plan");
            const [page, detail, featureDefinitions] = await Promise.all([
                listSubscriptionPlans(runner, query),
                detailId
                    ? getSubscriptionPlan(
                        runner,
                        parseUuid(detailId, "方案識別碼"),
                    )
                    : Promise.resolve(null),
                listSubscriptionFeatureDefinitions(runner),
            ]);
            return (
                <SubscriptionPlansView
                    {...buildSubscriptionPlansViewModel({
                        query,
                        page,
                        detail,
                        featureDefinitions,
                    })}
                />
            );
        });
    }
    catch (error) {
        unstable_rethrow(error);
        const query = parseSubscriptionPlanListQuery({});
        return (
            <SubscriptionPlansView
                {...buildSubscriptionPlansViewModel({
                    query,
                    page: {
                        items: [],
                        page: query.page,
                        pageSize: query.pageSize,
                        total: 0,
                    },
                    detail: null,
                    featureDefinitions: [],
                    errorMessage: adminViewErrorMessage(error),
                })}
            />
        );
    }
}
