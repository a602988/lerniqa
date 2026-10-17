import {
    createLocalPracticeRecommendationSession,
    previewLocalPracticeRecommendations,
} from "@/app/lib/local-practice-store";
import {
    LOCAL_PRACTICE_MAX_QUESTIONS,
    LOCAL_PRACTICE_MAX_RECOMMENDATIONS,
} from "@/app/lib/local-practice-types";
import type { LocalPracticeSessionSettings } from "@/app/lib/local-practice-types";
import {
    errorResponse,
    handleLocalPracticeError,
    isRecord,
    localPracticeJsonResponse,
    localPracticeMeta,
    requireLocalPracticeAccount,
    UUID_PATTERN,
} from "../_shared";

export const runtime = "nodejs";

const actorFrom = (account: Awaited<ReturnType<typeof requireLocalPracticeAccount>>) => ({
    userId: account.userId,
    learnerId: account.learner.id,
});

function parseQueueItemIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > LOCAL_PRACTICE_MAX_QUESTIONS) {
        return null;
    }
    const ids = value.map((id) => typeof id === "string" ? id.toLowerCase() : id);
    if (
        !ids.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
        || new Set(ids).size !== ids.length
    ) return null;
    return ids as string[];
}

function parseLimit(value: unknown): number | null {
    if (value === undefined) return 5;
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= LOCAL_PRACTICE_MAX_RECOMMENDATIONS
        ? Number(value)
        : null;
}

/** Previews or atomically starts strict wrong-answer extension practice. */
export async function POST(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        let body: unknown;
        try {
            body = await request.json();
        }
        catch {
            return errorResponse("INVALID_RECOMMENDATION_REQUEST", "錯題延伸練習格式不正確。", 400);
        }
        if (!isRecord(body)) {
            return errorResponse("INVALID_RECOMMENDATION_REQUEST", "錯題延伸練習格式不正確。", 400);
        }
        const sourceQueueItemIds = parseQueueItemIds(body.sourceQueueItemIds);
        const limit = parseLimit(body.limit);
        const action = body.action ?? "preview";
        if (!sourceQueueItemIds || limit === null || !["preview", "start"].includes(String(action))) {
            return errorResponse("INVALID_RECOMMENDATION_REQUEST", "錯題來源或延伸練習題數不正確。", 400);
        }

        if (action === "preview") {
            const recommendation = await previewLocalPracticeRecommendations(
                sourceQueueItemIds,
                limit,
                actorFrom(account),
            );
            return localPracticeJsonResponse({ data: recommendation, meta: localPracticeMeta() });
        }

        const checkMode = body.checkMode ?? "instant";
        const sessionId = body.sessionId;
        if (!["complete", "instant"].includes(String(checkMode))) {
            return errorResponse("INVALID_RECOMMENDATION_REQUEST", "答案檢核方式不正確。", 400);
        }
        if (sessionId !== undefined && (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId))) {
            return errorResponse("INVALID_SESSION_ID", "練習識別碼格式不正確。", 400);
        }
        const created = await createLocalPracticeRecommendationSession(
            sourceQueueItemIds,
            limit,
            actorFrom(account),
            checkMode as LocalPracticeSessionSettings["checkMode"],
            typeof sessionId === "string" ? sessionId.toLowerCase() : undefined,
        );
        const hasSession = created.recommendation.session !== null;
        return localPracticeJsonResponse(
            {
                data: created.recommendation,
                meta: localPracticeMeta({ replayed: created.replayed }),
            },
            { status: hasSession && !created.replayed ? 201 : 200 },
        );
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
