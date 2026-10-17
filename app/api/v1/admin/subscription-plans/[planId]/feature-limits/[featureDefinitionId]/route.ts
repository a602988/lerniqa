import { NextResponse } from "next/server";

import { parseSubscriptionFeatureLimitWriteInput, parseUuid } from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ planId: string; featureDefinitionId: string }>;
}

export async function PUT(
    request: Request,
    context: RouteContext,
): Promise<NextResponse> {
    const params = await context.params;
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: ["expectedLockVersion", "included", "unlimited", "limit"],
        parse: (body, evidence) => parseSubscriptionFeatureLimitWriteInput(
            {
                ...body,
                planId: parseUuid(params.planId, "方案識別碼"),
                featureDefinitionId: parseUuid(
                    params.featureDefinitionId,
                    "功能定義識別碼",
                ),
            },
            evidence,
        ),
        mutate: (mutationContext, input) =>
            subscriptionCatalogService.setFeatureLimit(mutationContext, input),
    });
}
