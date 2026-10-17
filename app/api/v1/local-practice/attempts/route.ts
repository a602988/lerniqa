import {
    findLocalPracticeHandwritingPart,
    submitLocalPracticeAttempt,
    type SubmitLocalPracticeAttemptInput,
} from "@/app/lib/local-practice-store";
import {
    LOCAL_PRACTICE_MAX_ANSWER_LENGTH,
    LOCAL_PRACTICE_MAX_DURATION_SECONDS,
    type LocalPracticeAnswerInput,
} from "@/app/lib/local-practice-types";
import {
    MAX_HANDWRITING_BYTES,
    validateHandwritingPngDataUrl,
} from "@/app/lib/handwriting-png";
import {
    errorResponse,
    handleLocalPracticeError,
    isRecord,
    localPracticeJsonResponse,
    localPracticeMeta,
    requireLocalPracticeAccount,
    UUID_PATTERN,
} from "../_shared";
import {
    transcribeLocalHandwriting,
} from "@/app/lib/handwriting-transcription.mjs";

export const runtime = "nodejs";

function parseAnswer(value: unknown): LocalPracticeAnswerInput | null {
    if (!isRecord(value) || typeof value.partId !== "string" || !UUID_PATTERN.test(value.partId)) return null;
    if (typeof value.value === "string") {
        return value.value.length <= LOCAL_PRACTICE_MAX_ANSWER_LENGTH
            ? { partId: value.partId.toLowerCase(), value: value.value }
            : null;
    }
    if (
        Array.isArray(value.value)
        && value.value.length <= 20
        && value.value.every((entry) => typeof entry === "string" && entry.length <= 120)
    ) {
        return { partId: value.partId.toLowerCase(), value: value.value as string[] };
    }
    return null;
}

type ParsedAttemptRequest = Omit<SubmitLocalPracticeAttemptInput, "handwriting"> & {
    handwritingDataUrl?: string;
};

function parseAttemptRequest(value: unknown): ParsedAttemptRequest | null {
    if (
        !isRecord(value)
        || typeof value.sessionId !== "string"
        || !UUID_PATTERN.test(value.sessionId)
        || typeof value.questionId !== "string"
        || !UUID_PATTERN.test(value.questionId)
        || (
            value.sessionItemId !== undefined
            && (typeof value.sessionItemId !== "string" || !UUID_PATTERN.test(value.sessionItemId))
        )
        || (
            value.partId !== undefined
            && (typeof value.partId !== "string" || !UUID_PATTERN.test(value.partId))
        )
        || typeof value.idempotencyKey !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value.idempotencyKey)
        || !Array.isArray(value.answers)
        || value.answers.length > 100
        || (
            value.handwriting !== undefined
            && (
                !isRecord(value.handwriting)
                || typeof value.handwriting.dataUrl !== "string"
                || value.handwriting.dataUrl.length > Math.ceil(MAX_HANDWRITING_BYTES * 4 / 3) + 64
            )
        )
    ) return null;

    const answers = value.answers.map(parseAnswer);
    if (answers.some((answer) => answer === null)) return null;
    const parsedAnswers = answers as LocalPracticeAnswerInput[];
    if (new Set(parsedAnswers.map((answer) => answer.partId)).size !== parsedAnswers.length) return null;

    const durationSeconds: unknown = value.durationSeconds === undefined ? null : value.durationSeconds;
    if (
        durationSeconds !== null
        && (
            typeof durationSeconds !== "number"
            || !Number.isSafeInteger(durationSeconds)
            || durationSeconds < 0
            || durationSeconds > LOCAL_PRACTICE_MAX_DURATION_SECONDS
        )
    ) return null;

    return {
        sessionId: value.sessionId.toLowerCase(),
        questionId: value.questionId.toLowerCase(),
        ...(typeof value.sessionItemId === "string" ? { sessionItemId: value.sessionItemId.toLowerCase() } : {}),
        ...(typeof value.partId === "string" ? { partId: value.partId.toLowerCase() } : {}),
        idempotencyKey: value.idempotencyKey,
        durationSeconds,
        answers: parsedAnswers,
        ...(isRecord(value.handwriting) && typeof value.handwriting.dataUrl === "string"
            ? { handwritingDataUrl: value.handwriting.dataUrl }
            : {}),
    };
}

/** Stores one server-graded attempt, its part results, queue work and outbox event atomically. */
export async function POST(request: Request) {
    try {
        const account = await requireLocalPracticeAccount(request);
        let body: unknown;
        try {
            body = await request.json();
        }
        catch {
            return errorResponse("INVALID_ATTEMPT_REQUEST", "作答資料格式不正確。", 400);
        }
        const input = parseAttemptRequest(body);
        if (!input) return errorResponse("INVALID_ATTEMPT_REQUEST", "作答資料格式不正確或超過限制。", 400);

        const handwriting = input.handwritingDataUrl === undefined
            ? undefined
            : validateHandwritingPngDataUrl(input.handwritingDataUrl);
        if (input.handwritingDataUrl !== undefined && !handwriting) {
            return errorResponse("INVALID_HANDWRITING", "手寫板沒有有效筆跡，請先書寫後再送出。", 400);
        }
        const { handwritingDataUrl: _handwritingDataUrl, ...attemptInput } = input;
        void _handwritingDataUrl;
        let handwritingTranscriptionPartId: string | undefined;
        if (handwriting) {
            const handwritingTarget = await findLocalPracticeHandwritingPart(attemptInput, {
                userId: account.userId,
                learnerId: account.learner.id,
            });
            handwritingTranscriptionPartId = handwritingTarget?.partId;
            if (handwritingTarget) {
                try {
                    const transcription = await transcribeLocalHandwriting(handwriting.bytes, {
                        mode: handwritingTarget.mode,
                    });
                    if (transcription.legibility === "clear" && transcription.transcription) {
                        attemptInput.answers.push({
                            partId: handwritingTarget.partId,
                            value: transcription.transcription,
                        });
                    }
                    else {
                        handwritingTranscriptionPartId = undefined;
                    }
                }
                catch {
                    handwritingTranscriptionPartId = undefined;
                }
            }
        }
        const result = await submitLocalPracticeAttempt({
            ...attemptInput,
            ...(handwriting ? { handwriting } : {}),
            ...(handwritingTranscriptionPartId ? { handwritingTranscriptionPartId } : {}),
        }, {
            userId: account.userId,
            learnerId: account.learner.id,
        });
        const { replayed, ...data } = result;
        return localPracticeJsonResponse({
            data,
            meta: localPracticeMeta({ replayed }),
        }, { status: replayed ? 200 : 201 });
    }
    catch (error) {
        return handleLocalPracticeError(error);
    }
}
