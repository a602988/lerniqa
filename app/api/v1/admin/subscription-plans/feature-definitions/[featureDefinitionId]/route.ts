import { NextResponse } from "next/server";

import {
    parseSubscriptionFeatureDefinitionUpdateInput,
    parseUuid,
} from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ featureDefinitionId: string }>;
}

export async function PATCH(
    request: Request,
    context: RouteContext,
): Promise<NextResponse> {
    const { featureDefinitionId: rawId } = await context.params;
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: [
            "expectedLockVersion",
            "displayName",
            "description",
            "valueType",
            "unit",
        ],
        parse: (body, evidence) => parseSubscriptionFeatureDefinitionUpdateInput(
            {
                ...body,
                featureDefinitionId: parseUuid(rawId, "功能定義識別碼"),
            },
            evidence,
        ),
        mutate: (mutationContext, input) =>
            subscriptionCatalogService.updateFeatureDefinition(mutationContext, input),
    });
}
