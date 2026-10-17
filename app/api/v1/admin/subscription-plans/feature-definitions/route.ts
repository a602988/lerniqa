import { NextResponse } from "next/server";

import { adminDataResponse, handleAdminHttpError } from "@/app/lib/admin/admin-http";
import { parseSubscriptionFeatureDefinitionInput } from "@/app/lib/admin/admin-input";
import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import {
    requireAdminReadContext,
    withAdminReadOnlySnapshot,
} from "@/app/lib/admin/admin-server";
import { listSubscriptionFeatureDefinitions } from "@/app/lib/admin/subscription-repository";
import { subscriptionCatalogService } from "@/app/lib/admin/subscription-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
    try {
        const featureDefinitions = await withAdminReadOnlySnapshot(async (runner) => {
            await requireAdminReadContext(request, runner);
            return listSubscriptionFeatureDefinitions(runner);
        });
        return adminDataResponse({ featureDefinitions, catalogOnly: true });
    }
    catch (error) {
        return handleAdminHttpError(error);
    }
}

export async function POST(request: Request): Promise<NextResponse> {
    return handleAdminMutation(request, adminMutationDependencies, {
        allowedFields: ["featureKey", "displayName", "description", "valueType", "unit"],
        parse: parseSubscriptionFeatureDefinitionInput,
        mutate: (context, input) =>
            subscriptionCatalogService.createFeatureDefinition(context, input),
        successStatus: 201,
    });
}
