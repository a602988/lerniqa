import { NextResponse } from "next/server";
import { AuthServiceError, getAuthenticatedAccount } from "@/app/lib/auth-service";
import { parseQuestionDraftPackage } from "@/app/lib/question-import-contract";
import { LocalPostgresUnavailableError } from "@/app/lib/local-postgres";
import {
    QuestionSourceAnalysisError,
    suggestQuestionPartAnswer,
} from "@/app/lib/question-source-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
    return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
    try {
        await getAuthenticatedAccount(request);
        const body: unknown = await request.json();
        if (!isRecord(body)) {
            return errorResponse("INVALID_ANSWER_SUGGESTION_REQUEST", "AI 答案分析內容格式不正確。", 400);
        }
        if (Object.keys(body).length !== 2 || !("question" in body) || !("partStableKey" in body)) {
            return errorResponse("INVALID_ANSWER_SUGGESTION_REQUEST", "AI 答案分析內容格式不正確或含有未知欄位。", 400);
        }
        const partStableKey = typeof body.partStableKey === "string" ? body.partStableKey : "";
        const draft = parseQuestionDraftPackage({
            questions: [body.question],
            schemaVersion: 2,
            sourceTitle: "AI 答案分析",
        });
        if (!draft.ok || !partStableKey) {
            return errorResponse("INVALID_ANSWER_SUGGESTION_REQUEST", "AI 答案分析內容未通過檢查。", 400);
        }
        const question = draft.value.questions[0];
        if (!question) return errorResponse("INVALID_ANSWER_SUGGESTION_REQUEST", "AI 答案分析內容未包含題目。", 400);
        const part = question.parts.find((candidate) => candidate.stableKey === partStableKey);
        if (!part) return errorResponse("ANSWER_SUGGESTION_PART_NOT_FOUND", "找不到要分析的作答區。", 404);
        if (part.answers.length > 0) {
            return errorResponse("ANSWER_SUGGESTION_ALREADY_ANSWERED", "這個作答區已有答案，不會用 AI 覆寫。", 409);
        }
        const suggestion = await suggestQuestionPartAnswer(question, partStableKey);
        return NextResponse.json({ data: suggestion }, { headers: { "Cache-Control": "private, no-store" } });
    }
    catch (error) {
        if (error instanceof QuestionSourceAnalysisError || error instanceof AuthServiceError || error instanceof LocalPostgresUnavailableError) {
            return errorResponse(error.code, error.message, error instanceof LocalPostgresUnavailableError ? 503 : error.status);
        }
        console.error("Question answer suggestion failed", error);
        return errorResponse("QUESTION_ANSWER_SUGGESTION_FAILED", "AI 暫時無法產生答案與解析，請稍後再試或手動輸入。", 503);
    }
}
