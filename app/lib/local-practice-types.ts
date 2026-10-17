import { CHINESE_SUBJECT_LABEL } from "./subject-labels";

export const LOCAL_PRACTICE_DEFAULT_FILTERS = {
    grade: "國一",
    subject: CHINESE_SUBJECT_LABEL,
    publisher: "翰林",
    volume: "第一冊",
    lesson: "第四課",
} as const;

export const LOCAL_PRACTICE_CATALOG_LESSONS = ["第四課", "第五課", "第六課", "語文常識（二）"] as const;

export const LOCAL_PRACTICE_CATALOG_TARGETS = [
    ...LOCAL_PRACTICE_CATALOG_LESSONS.map((lesson) => ({
        ...LOCAL_PRACTICE_DEFAULT_FILTERS,
        lesson,
    })),
    ...[
        "2-1 因數與倍數",
        "2-2 最大公因數與最小公倍數",
        "2-3 分數的四則運算",
        "2-4 指數律",
    ].map((lesson) => ({
        grade: "國一",
        subject: "數學",
        publisher: "康軒",
        volume: "第一冊",
        lesson,
    })),
] as const;

export const LOCAL_PRACTICE_MAX_QUESTIONS = 500;
/** Matches the largest catalog range the existing practice UI can request. */
export const LOCAL_PRACTICE_MAX_CATALOG_PAGE_SIZE = 500;
export const LOCAL_PRACTICE_MAX_ANSWER_LENGTH = 4_000;
export const LOCAL_PRACTICE_MAX_DURATION_SECONDS = 24 * 60 * 60;
export const LOCAL_PRACTICE_MAX_RECOMMENDATIONS = 100;

export type LocalPracticeResult = "correct" | "wrong" | "pending";
export interface LocalPracticeSessionSettings {
    mode: "practice" | "review" | "similar";
    checkMode: "complete" | "instant" | "score";
}

export interface LocalPracticeSessionTarget {
    questionId: string;
    /** Omitted only by legacy callers that have not observed a catalog revision. */
    revisionId?: string;
    /** Limits a wrong-review item to one independently gradable part. */
    partId?: string;
}
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

export interface LocalPracticeKnowledgePoint extends LocalPracticeCatalogValue {
    isPrimary: boolean;
}

export interface LocalPracticeMetadataField {
    key: string;
    label: string;
    rawValue: string;
    values: string[];
    valueSource: "document" | "path" | "ai" | "user" | "migration";
    confidence: number | null;
}

export interface LocalPracticeQuestion {
    id: string;
    revisionId: string;
    revisionNumber: number;
    code: string | null;
    type: LocalPracticeCatalogValue;
    /** Fine-grained label retained from the source when the formal type is intentionally broad. */
    originalTypeLabel: string | null;
    grade: LocalPracticeCatalogValue;
    subject: LocalPracticeCatalogValue;
    semester: LocalPracticeCatalogValue | null;
    publisher: LocalPracticeCatalogValue | null;
    bookVersion: LocalPracticeCatalogValue;
    unit: LocalPracticeCatalogValue & { unitType: string };
    difficulty: LocalPracticeCatalogValue | null;
    /** Formal source classification used by question-bank filters. */
    sourceCategory?: LocalPracticeCatalogValue | null;
    /** Optional for compatibility with catalog responses created before knowledge-point projection. */
    knowledgePoints?: LocalPracticeKnowledgePoint[];
    /** Source-document fields that are both visible as tags and usable as exact-match filters. */
    metadata?: LocalPracticeMetadataField[];
    prompt: string;
    promptBlocks: LocalPracticeContentBlock[];
    parts: LocalPracticeQuestionPart[];
}

export type LocalPracticeRecommendationKind = "same_type" | "confirmed_similar" | "topic_similar" | "none";

export interface LocalPracticeRecommendationResult {
    recommendationKind: LocalPracticeRecommendationKind;
    availableCount: number;
    classificationLabel: string | null;
    explanation: string;
    questions: LocalPracticeQuestion[];
    /** Present only when a start request selected at least one eligible question. */
    session: LocalPracticeSession | null;
}

export interface LocalPracticeSessionItem {
    id: string;
    questionId: string;
    revisionId: string;
    /** Null means the item covers every independently gradable part in the revision. */
    partId: string | null;
    position: number;
    /** Resume-safe progress marker; it never contains an answer or grading result. */
    answered: boolean;
}

export interface LocalPracticeSessionMetadata {
    id: string;
    mode: LocalPracticeSessionSettings["mode"];
    checkMode: LocalPracticeSessionSettings["checkMode"];
    status: "active" | "paused" | "completed" | "abandoned";
    startedAt: string;
    completedAt: string | null;
}

export interface LocalPracticeSession extends LocalPracticeSessionMetadata {
    items: LocalPracticeSessionItem[];
}

/** Completed score-mode reads intentionally omit the per-question item list. */
export type LocalPracticeSessionView = LocalPracticeSession | LocalPracticeSessionMetadata;

export interface LocalPracticeAnswerInput {
    partId: string;
    value: LocalPracticeAnswerValue;
}

export interface LocalPracticeHandwritingInput {
    /** Browser canvas PNG. The server validates dimensions, PNG structure and visible ink. */
    dataUrl: string;
}

export interface LocalPracticeHandwritingAsset {
    id: string;
    mimeType: "image/png";
    width: number;
    height: number;
    /** Authorization is rechecked when this private URL is fetched. */
    url: string;
}

export interface LocalPracticeAttemptPartResult {
    partId: string;
    result: LocalPracticeResult;
    gradingSource: LocalPracticeGradingSource;
    feedbackCode: LocalPracticeFeedbackCode;
    handwritingAssets: LocalPracticeHandwritingAsset[];
    /** 手寫內容可清楚辨識時取得的文字。 */
    recognizedText?: string;
}

/** Reference material released only after the disclosure policy unlocks an attempt. */
export interface LocalPracticeReferenceAnswer {
    partId: string;
    answerMode: LocalPracticeAnswerMode;
    answerKeys: string[];
    acceptedValues: string[];
    /** Public choice labels are repeated here so answer keys remain understandable. */
    options: Array<{ key: string; label: string }>;
    /** The revision may have no authored explanation. */
    explanation: string | null;
}

export interface LocalPracticeAttempt {
    sessionMode?: LocalPracticeSessionSettings["mode"];
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
    /** Answers from the session-pinned revision, never from the catalog/current revision. */
    referenceAnswers: LocalPracticeReferenceAnswer[];
}

export interface LocalPracticeAttemptReceipt {
    /** Stable idempotency receipt only; score mode never persists answer or result detail. */
    id: string;
    sessionId: string;
    sessionItemId: string;
    questionId: string;
    revisionId: string;
    submittedAt: string;
}

export interface LocalPracticeScoreSummary {
    total: number;
    correct: number;
    wrong: number;
    pending: number;
    accuracy: number;
}

export type LocalPracticeAttemptSubmission = {
    disclosure: "detailed";
    session: Pick<LocalPracticeSessionMetadata, "id" | "status" | "completedAt">;
    attempt: LocalPracticeAttempt;
    /** Present when complete mode finishes and releases the whole session at once. */
    attempts?: LocalPracticeAttempt[];
} | {
    disclosure: "masked";
    session: Pick<LocalPracticeSessionMetadata, "id" | "status" | "completedAt">;
    receipt: LocalPracticeAttemptReceipt;
} | {
    disclosure: "score";
    session: Pick<LocalPracticeSessionMetadata, "id" | "status" | "completedAt">;
    summary: LocalPracticeScoreSummary;
};

export type LocalPracticeSessionRead = {
    disclosure: "detailed";
    session: LocalPracticeSessionView;
    attempts: LocalPracticeAttempt[];
} | {
    disclosure: "masked";
    session: LocalPracticeSessionView;
} | {
    disclosure: "score";
    session: LocalPracticeSessionMetadata;
    summary: LocalPracticeScoreSummary;
};

export interface LocalPracticeSessionHistory {
    id: string;
    mode: LocalPracticeSessionSettings["mode"];
    checkMode: LocalPracticeSessionSettings["checkMode"];
    status: LocalPracticeSession["status"];
    startedAt: string;
    completedAt: string | null;
    itemCount: number;
    attemptedItemCount: number;
    disclosure: "detailed" | "masked" | "score";
    summary?: LocalPracticeScoreSummary;
}

export interface LocalPracticeWrongQueueItem {
    id: string;
    questionId: string;
    revisionId: string;
    partId: string | null;
    createdAt: string;
}

export interface LocalPracticeHistory {
    /** Only instant attempts and completed complete-mode attempts are disclosed. */
    attempts: LocalPracticeAttempt[];
    wrongReviewQueue: { pendingCount: number; items: LocalPracticeWrongQueueItem[] };
    sessions: LocalPracticeSessionHistory[];
}

/** Score mode never releases answers; complete mode unlocks only after completion. */
export function canDiscloseLocalPracticeReferenceAnswers(
    checkMode: LocalPracticeSessionSettings["checkMode"],
    status: LocalPracticeSessionMetadata["status"],
): boolean {
    return checkMode === "instant" || (checkMode === "complete" && status === "completed");
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
