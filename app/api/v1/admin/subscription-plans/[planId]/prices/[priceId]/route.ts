import { NextResponse } from "next/server";

import { parseSubscriptionPriceUpdateInput, parseUuid } from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ planId: string; priceId: string }>;
}

export async function PATCH(
    request: Request,
    context: RouteContext,
): Promise<NextResponse> {
    const params = await context.params;
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: [
            "expectedLockVersion",
            "currency",
            "amountMinor",
            "billingInterval",
            "billingIntervalCount",
            "effectiveFrom",
            "effectiveUntil",
        ],
        parse: (body, evidence) => parseSubscriptionPriceUpdateInput(
            {
                ...body,
                planId: parseUuid(params.planId, "方案識別碼"),
                priceId: parseUuid(params.priceId, "價格識別碼"),
            },
            evidence,
        ),
        mutate: (mutationContext, input) =>
            subscriptionCatalogService.updatePrice(mutationContext, input),
    });
}
