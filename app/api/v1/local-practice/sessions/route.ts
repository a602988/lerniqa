import {
    createLocalPracticeSession,
    getLocalPracticeSession,
    updateLocalPracticeSessionStatus,
    type LocalPracticeMutableSessionStatus,
} from "@/app/lib/local-practice-store";
import { LOCAL_PRACTICE_MAX_QUESTIONS } from "@/app/lib/local-practice-types";
import type { LocalPracticeSessionSettings, LocalPracticeSessionTarget } from "@/app/lib/local-practice-types";
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

function validQuestionCount(values: readonly unknown[]): boolean {
    return values.length > 0 && values.length <= LOCAL_PRACTICE_MAX_QUESTIONS;
}

function parseSessionTargets(value: unknown): LocalPracticeSessionTarget[] | null {
    if (!isRecord(value)) return null;
    if (Array.isArray(value.questions)) {
        if (!validQuestionCount(value.questions)) return null;
        const targets = value.questions.flatMap((entry): LocalPracticeSessionTarget[] => (
            isRecord(entry)
                && typeof entry.questionId === "string"
                && UUID_PATTERN.test(entry.questionId)
                && typeof entry.revisionId === "string"
                && UUID_PATTERN.test(entry.revisionId)
                && (
                    entry.partId === undefined
                    || (typeof entry.partId === "string" && UUID_PATTERN.test(entry.partId))
                )
                ? [{
                    questionId: entry.questionId.toLowerCase(),
                    revisionId: entry.revisionId.toLowerCase(),
                    ...(typeof entry.partId === "string" ? { partId: entry.partId.toLowerCase() } : {}),
                }]
                : []
        ));
        const identities = targets.map((target) => `${target.questionId}:${target.partId ?? "all"}`);
        const partsByQuestion = new Map<string, Array<string | null>>();
        for (const target of targets) {
            const parts = partsByQuestion.get(target.questionId) ?? [];
            parts.push(target.partId ?? null);
            partsByQuestion.set(target.questionId, parts);
        }
        const overlapsWholeQuestion = [...partsByQuestion.values()].some((parts) => (
            parts.length > 1 && parts.includes(null)
        ));
        if (
            targets.length !== value.questions.length
            || new Set(identities).size !== targets.length
            || overlapsWholeQuestion
        ) return null;
        return targets;
    }
    if (!Array.isArray(value.questionIds)) return null;
    const questionIds = value.questionIds.map((id) => typeof id === "string" ? id.toLowerCase() : id);
    if (
        !validQuestionCount(questionIds)
        || !questionIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
        || new Set(questionIds).size !== questionIds.length
    ) return null;
    return (questionIds as string[]).map((questionId) => ({ questionId }));
}

const actorFrom = (account: Awaited<ReturnType<typeof requireLocalPracticeAccount>>) => ({
    userId: account.userId,
    learnerId: account.learner.id,
});

/** Returns one resumable session without exposing submitted answers or answer keys. */
export async function GET(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        const sessionId = new URL(request.url).searchParams.get("id");
        if (!sessionId || !UUID_PATTERN.test(sessionId)) {
            return errorResponse("INVALID_SESSION_ID", "練習識別碼格式不正確。", 400);
        }
        const result = await getLocalPracticeSession(sessionId.toLowerCase(), actorFrom(account));
        return localPracticeJsonResponse({ data: result, meta: localPracticeMeta() });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}

/** Starts an ad-hoc session owned by the authenticated learner. */
export async function POST(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        let body: unknown;
        try {
            body = await request.json();
        }
        catch {
            return errorResponse("INVALID_SESSION_REQUEST", "練習題目格式不正確。", 400);
        }
        const targets = parseSessionTargets(body);
        if (!targets) {
            return errorResponse(
                "INVALID_SESSION_REQUEST",
                `請選擇 1 到 ${LOCAL_PRACTICE_MAX_QUESTIONS} 道有效題目。`,
                400,
            );
        }
        const mode = isRecord(body) ? body.mode ?? "practice" : "practice";
        const checkMode = isRecord(body) ? body.checkMode ?? "instant" : "instant";
        const sessionId = isRecord(body) ? body.sessionId : undefined;
        if (!["practice", "review", "similar"].includes(String(mode)) || !["complete", "instant", "score"].includes(String(checkMode))) {
            return errorResponse("INVALID_SESSION_REQUEST", "練習用途或檢核方式不正確。", 400);
        }
        if (sessionId !== undefined && (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId))) {
            return errorResponse("INVALID_SESSION_ID", "練習識別碼格式不正確。", 400);
        }

        const result = await createLocalPracticeSession(
            targets,
            actorFrom(account),
            { mode, checkMode } as LocalPracticeSessionSettings,
            typeof sessionId === "string" ? sessionId.toLowerCase() : sessionId,
        );
        return localPracticeJsonResponse(
            { data: { session: result.session }, meta: localPracticeMeta({ replayed: result.replayed }) },
            { status: result.replayed ? 200 : 201 },
        );
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}

/** Pauses, resumes, or abandons a session owned by the authenticated account. */
export async function PATCH(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        let body: unknown;
        try {
            body = await request.json();
        }
        catch {
            return errorResponse("INVALID_SESSION_REQUEST", "練習狀態格式不正確。", 400);
        }
        const sessionId = isRecord(body) ? body.sessionId : undefined;
        const status = isRecord(body) ? body.status : undefined;
        if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
            return errorResponse("INVALID_SESSION_ID", "練習識別碼格式不正確。", 400);
        }
        if (!["active", "paused", "abandoned"].includes(String(status))) {
            return errorResponse("INVALID_SESSION_STATUS", "練習狀態不正確。", 400);
        }
        const session = await updateLocalPracticeSessionStatus(
            sessionId.toLowerCase(),
            status as LocalPracticeMutableSessionStatus,
            actorFrom(account),
        );
        return localPracticeJsonResponse({ data: { session }, meta: localPracticeMeta() });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
