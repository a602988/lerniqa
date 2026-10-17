import { NextResponse } from "next/server";

import { handleAdminMutation } from "@/app/lib/admin/admin-mutation-handler";
import { adminMutationDependencies } from "@/app/lib/admin/admin-mutation-server";
import { reviewQuestionRevisionMutationSpec } from "@/app/lib/admin/question-mutation-spec";
import { questionMutationService } from "@/app/lib/admin/question-mutation-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QuestionRevisionContext {
    params: Promise<{ questionId: string; revisionId: string }>;
}

export async function POST(
    request: Request,
    context: QuestionRevisionContext,
): Promise<NextResponse> {
    const { questionId, revisionId } = await context.params;
    return handleAdminMutation(
        request,
        adminMutationDependencies,
        reviewQuestionRevisionMutationSpec(
            questionId,
            revisionId,
            questionMutationService,
        ),
    );
}
