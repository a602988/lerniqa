import { NextResponse } from "next/server";

import { parseSubscriptionPlanStatusInput, parseUuid } from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ planId: string }>;
}

export async function POST(
    request: Request,
    context: RouteContext,
): Promise<NextResponse> {
    const { planId: rawPlanId } = await context.params;
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: ["expectedLockVersion", "targetStatus"],
        parse: (body, evidence) => parseSubscriptionPlanStatusInput(
            { ...body, planId: parseUuid(rawPlanId, "方案識別碼") },
            evidence,
        ),
        mutate: (mutationContext, input) =>
            subscriptionCatalogService.transitionPlan(mutationContext, input),
    });
}
