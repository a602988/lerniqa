import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseSubscriptionPlanUpdateInput, parseUuid } from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";
import { getSubscriptionPlan } from "@/app/lib/admin/subscription-repository";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ planId: string }>;
}

export async function GET(
    request: Request,
    context: RouteContext,
): Promise<NextResponse> {
    try {
        const plan = await withAdminReadOnlySnapshot(async (runner) => {
            await requireAdminReadContext(request, runner);
            const { planId: rawPlanId } = await context.params;
            return getSubscriptionPlan(
                runner,
                parseUuid(rawPlanId, "方案識別碼"),
            );
        });
        return adminDataResponse({
            plan,
            catalogOnly: true,
            paymentIntegration: "not_connected",
        });
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}

export async function PATCH(
    request: Request,
    context: RouteContext,
): Promise<NextResponse> {
    const { planId: rawPlanId } = await context.params;
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: ["expectedLockVersion", "name", "description"],
        parse: (body, evidence) => parseSubscriptionPlanUpdateInput(
            { ...body, planId: parseUuid(rawPlanId, "方案識別碼") },
            evidence,
        ),
        mutate: (mutationContext, input) =>
            subscriptionCatalogService.updatePlan(mutationContext, input),
    });
}
