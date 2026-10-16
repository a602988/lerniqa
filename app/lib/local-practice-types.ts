export const LOCAL_PRACTICE_DEFAULT_FILTERS = {
    grade: "國一",
    subject: "國文",
    publisher: "翰林",
    volume: "第一冊",
    lesson: "第四課",
} as const;

export const LOCAL_PRACTICE_MAX_QUESTIONS = 100;
export const LOCAL_PRACTICE_MAX_ANSWER_LENGTH = 4_000;
export const LOCAL_PRACTICE_MAX_DURATION_SECONDS = 24 * 60 * 60;

export type LocalPracticeResult = "correct" | "wrong" | "pending";
export type LocalPracticeGradingSource = "automatic" | "manual_review" | "ai_assisted_review";
export type LocalPracticeAnswerMode = "single_choice" | "multiple_choice" | "boolean" | "text";
export type LocalPracticeAnswerValue = string | string[];
export type LocalPracticeFeedbackCode =
    | "correct"
    | "wrong"
    | "missing_answer"
    | "missing_answer_key"
    | "manual_review"
    | "ai_assisted_review";

export interface LocalPracticeFilters {
    grade: string;
    subject: string;
    publisher: string;
    volume: string;
    lesson: string;
}

export interface LocalPracticeContentBlock {
    id: string;
    contentType: "text" | "image" | "audio" | "transcript" | "formula" | "table" | "page_crop";
    position: number;
    text: string | null;
    altText: string | null;
    asset: {
        id: string;
        mimeType: string;
        width: number | null;
        height: number | null;
        url: string;
    } | null;
}

export interface LocalPracticeOption {
    id: string;
    key: string;
    position: number;
    label: string;
    contentBlocks: LocalPracticeContentBlock[];
}

export interface LocalPracticeQuestionPart {
    id: string;
    stableKey: string;
    position: number;
    answerMode: LocalPracticeAnswerMode;
    gradingPolicy: LocalPracticeGradingSource;
    isIndependentlyGradable: boolean;
    prompt: string;
    promptBlocks: LocalPracticeContentBlock[];
    options: LocalPracticeOption[];
}

interface LocalPracticeCatalogValue {
    id: string;
    code: string | null;
    name: string;
}

export interface LocalPracticeQuestion {
    id: string;
    revisionId: string;
    revisionNumber: number;
    code: string | null;
    type: LocalPracticeCatalogValue;
    grade: LocalPracticeCatalogValue;
    subject: LocalPracticeCatalogValue;
    semester: LocalPracticeCatalogValue | null;
    publisher: LocalPracticeCatalogValue | null;
    bookVersion: LocalPracticeCatalogValue;
    unit: LocalPracticeCatalogValue & { unitType: string };
    difficulty: LocalPracticeCatalogValue | null;
    prompt: string;
    promptBlocks: LocalPracticeContentBlock[];
    parts: LocalPracticeQuestionPart[];
}

export interface LocalPracticeSessionItem {
    id: string;
    questionId: string;
    revisionId: string;
    position: number;
}

export interface LocalPracticeSession {
    id: string;
    status: "active" | "paused" | "completed" | "abandoned";
    startedAt: string;
    completedAt: string | null;
    items: LocalPracticeSessionItem[];
}

export interface LocalPracticeAnswerInput {
    partId: string;
    value: LocalPracticeAnswerValue;
}

export interface LocalPracticeAttemptPartResult {
    partId: string;
    result: LocalPracticeResult;
    gradingSource: LocalPracticeGradingSource;
    feedbackCode: LocalPracticeFeedbackCode;
}

export interface LocalPracticeAttempt {
    id: string;
    sessionId: string;
    sessionItemId: string;
    questionId: string;
    revisionId: string;
    overallResult: LocalPracticeResult;
    gradingSource: LocalPracticeGradingSource;
    durationSeconds: number | null;
    submittedAt: string;
    parts: LocalPracticeAttemptPartResult[];
}

export interface LocalPracticeSessionHistory {
    id: string;
    status: LocalPracticeSession["status"];
    startedAt: string;
    completedAt: string | null;
    itemCount: number;
    attemptedItemCount: number;
}

export interface LocalPracticeWrongQueueItem {
    id: string;
    questionId: string;
    revisionId: string;
    partId: string | null;
    createdAt: string;
}

export interface LocalPracticeGradeDefinition {
    answerMode: LocalPracticeAnswerMode;
    gradingPolicy: LocalPracticeGradingSource;
    acceptedKeys: string[];
    acceptedValues: string[];
    validOptionKeys: string[];
}

export interface LocalPracticeGradeDecision {
    result: LocalPracticeResult;
    gradingSource: LocalPracticeGradingSource;
    feedbackCode: LocalPracticeFeedbackCode;
    answerPayload: { value: string | string[] | null };
}

/** Canonicalizes text without weakening exact Chinese-language answer matching. */
export function normalizeLocalPracticeText(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-Hant");
}

/** Canonicalizes a submitted answer and removes duplicate multiple-choice keys. */
export function normalizeLocalPracticeAnswer(value: LocalPracticeAnswerValue): string | string[] {
    if (Array.isArray(value)) {
        return [...new Set(value.map(normalizeLocalPracticeText).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
    }
    return normalizeLocalPracticeText(value);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Grades one part without exposing its accepted answer. Non-automatic parts,
 * unanswered parts, and automatic parts without a complete answer key stay pending.
 */
export function gradeLocalPracticePart(
    definition: LocalPracticeGradeDefinition,
    submittedValue: LocalPracticeAnswerValue | undefined,
): LocalPracticeGradeDecision {
    const gradingSource = definition.gradingPolicy;

    if (submittedValue === undefined) {
        return {
            result: "pending",
            gradingSource,
            feedbackCode: "missing_answer",
            answerPayload: { value: null },
        };
    }

    const normalized = normalizeLocalPracticeAnswer(submittedValue);
    const storedValue = Array.isArray(submittedValue) ? normalized : submittedValue;
    const hasAnswer = Array.isArray(normalized) ? normalized.length > 0 : normalized.length > 0;
    if (!hasAnswer) {
        return {
            result: "pending",
            gradingSource,
            feedbackCode: "missing_answer",
            answerPayload: { value: storedValue },
        };
    }

    if (gradingSource !== "automatic") {
        return {
            result: "pending",
            gradingSource,
            feedbackCode: gradingSource,
            answerPayload: { value: storedValue },
        };
    }

    const acceptedKeys = [...new Set(definition.acceptedKeys.map(normalizeLocalPracticeText).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "zh-Hant"));
    const acceptedValues = [...new Set(definition.acceptedValues.map(normalizeLocalPracticeText).filter(Boolean))];
    const validOptionKeys = new Set(
        definition.validOptionKeys.map(normalizeLocalPracticeText).filter(Boolean),
    );
    const choiceNeedsOneKey = definition.answerMode === "single_choice" || definition.answerMode === "boolean";
    const choiceKeyIsInvalid = (definition.answerMode === "multiple_choice" || choiceNeedsOneKey)
        && acceptedKeys.some((key) => !validOptionKeys.has(key));
    const answerKeyIsIncomplete = choiceKeyIsInvalid
        || (definition.answerMode === "multiple_choice"
            ? acceptedKeys.length === 0
            : choiceNeedsOneKey
                ? acceptedKeys.length !== 1
                : acceptedValues.length === 0);
    if (answerKeyIsIncomplete) {
        return {
            result: "pending",
            gradingSource,
            feedbackCode: "missing_answer_key",
            answerPayload: { value: storedValue },
        };
    }

    let isCorrect = false;
    if (definition.answerMode === "multiple_choice") {
        const selected = Array.isArray(normalized) ? normalized : [normalized];
        isCorrect = sameStringArray(selected, acceptedKeys);
    }
    else if (choiceNeedsOneKey) {
        const submitted = Array.isArray(normalized) ? normalized[0] ?? "" : normalized;
        isCorrect = acceptedKeys.includes(submitted);
    }
    else {
        const submitted = Array.isArray(normalized) ? normalized[0] ?? "" : normalized;
        isCorrect = acceptedValues.includes(submitted);
    }

    return {
        result: isCorrect ? "correct" : "wrong",
        gradingSource,
        feedbackCode: isCorrect ? "correct" : "wrong",
        answerPayload: { value: storedValue },
    };
}

export function deriveLocalPracticeOverallResult(results: readonly LocalPracticeResult[]): LocalPracticeResult {
    if (results.some((result) => result === "pending") || results.length === 0) return "pending";
    if (results.some((result) => result === "wrong")) return "wrong";
    return "correct";
}

export function deriveLocalPracticeGradingSource(
    sources: readonly LocalPracticeGradingSource[],
): LocalPracticeGradingSource {
    if (sources.includes("manual_review")) return "manual_review";
    if (sources.includes("ai_assisted_review")) return "ai_assisted_review";
    return "automatic";
}
