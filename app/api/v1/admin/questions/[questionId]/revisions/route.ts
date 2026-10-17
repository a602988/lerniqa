import { NextResponse } from "next/server";

import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { createQuestionDraftMutationSpec } from "@/app/lib/admin/question-mutation-spec";
import { questionMutationService } from "@/app/lib/admin/question-mutation-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuestionRevisionCollectionContext {
    params: Promise<{ questionId: string }>;
}

export async function POST(
    request: Request,
    context: QuestionRevisionCollectionContext,
): Promise<NextResponse> {
    const { questionId } = await context.params;
    return handleAdminMutation(
        request,
        adminMutationDependencies,
        createQuestionDraftMutationSpec(questionId, questionMutationService),
    );
}
