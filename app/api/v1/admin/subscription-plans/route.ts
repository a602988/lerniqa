import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import {
    parseSubscriptionPlanInput,
    parseSubscriptionPlanListQuery,
} from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";
import { listSubscriptionPlans } from "@/app/lib/admin/subscription-repository";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const page = await withAdminReadOnlySnapshot(async (runner) => {
            await requireAdminReadContext(request, runner);
            const query = parseSubscriptionPlanListQuery(new URL(request.url).searchParams);
            return listSubscriptionPlans(runner, query);
        });
        return adminDataResponse(
            { plans: page.items, catalogOnly: true, paymentIntegration: "not_connected" },
            { page: page.page, pageSize: page.pageSize, total: page.total },
        );
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}

export async function POST(request: Request): Promise<NextResponse> {
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: ["code", "name", "description", "status"],
        parse: parseSubscriptionPlanInput,
        mutate: (context, input) => subscriptionCatalogService.createPlan(context, input),
        successStatus: 201,
    });
}
