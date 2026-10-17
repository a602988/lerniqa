import { NextResponse } from "next/server";

import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { questionRelationReviewSpec } from "@/app/lib/admin/question-relation-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RelationReviewContext {
    params: Promise<{ kind: string; targetId: string }>;
}

export async function POST(request: Request, context: RelationReviewContext): Promise<NextResponse> {
    const { kind, targetId } = await context.params;
    const revisionId = new URL(request.url).searchParams.get("revisionId") ?? undefined;
    return handleAdminMutation(
        request,
        adminMutationDependencies,
        questionRelationReviewSpec(kind, targetId, revisionId),
    );
}
