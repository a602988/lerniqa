import { NextResponse } from "next/server";
import { createLocalPracticeSession } from "@/app/lib/local-practice-store";
import { LOCAL_PRACTICE_MAX_QUESTIONS } from "@/app/lib/local-practice-types";
import {
    errorResponse,
    handleLocalPracticeError,
    isRecord,
    localPracticeMeta,
    requireLocalPracticeAccount,
    UUID_PATTERN,
} from "../_shared";

export const runtime = "nodejs";

function parseQuestionIds(value: unknown): string[] | null {
    if (!isRecord(value) || !Array.isArray(value.questionIds)) return null;
    const questionIds = value.questionIds;
    if (
        questionIds.length === 0
        || questionIds.length > LOCAL_PRACTICE_MAX_QUESTIONS
        || !questionIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
        || new Set(questionIds).size !== questionIds.length
    ) return null;
    return questionIds as string[];
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
        const questionIds = parseQuestionIds(body);
        if (!questionIds) return errorResponse("INVALID_SESSION_REQUEST", "請選擇 1 到 100 道有效題目。", 400);

        const session = await createLocalPracticeSession(questionIds, {
            userId: account.userId,
            learnerId: account.learner.id,
        });
        return NextResponse.json(
            { data: { session }, meta: localPracticeMeta() },
            { status: 201 },
        );
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
