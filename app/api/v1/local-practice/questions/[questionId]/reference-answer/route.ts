import { getLocalPracticeQuestionReferenceAnswers } from "@/app/lib/local-practice-store";
import {
    errorResponse,
    handleLocalPracticeError,
    localPracticeJsonResponse,
    localPracticeMeta,
    requireLocalPracticeAccount,
    UUID_PATTERN,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns answers only for an explicitly opened, current published question. */
export async function GET(
    request: Request,
    context: { params: Promise<{ questionId: string }> },
) {
    try {
        const account = await requireLocalPracticeAccount(request);
        const { questionId } = await context.params;
        const revisionId = new URL(request.url).searchParams.get("revisionId");
        if (!UUID_PATTERN.test(questionId) || !revisionId || !UUID_PATTERN.test(revisionId)) {
            return errorResponse(
                "INVALID_QUESTION_REFERENCE",
                "題目或版本識別碼格式不正確。",
                400,
            );
        }
        const referenceAnswers = await getLocalPracticeQuestionReferenceAnswers(
            questionId.toLowerCase(),
            revisionId.toLowerCase(),
            { userId: account.userId, learnerId: account.learner.id },
        );
        return localPracticeJsonResponse({
            data: { questionId, revisionId, referenceAnswers },
            meta: localPracticeMeta(),
        });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
