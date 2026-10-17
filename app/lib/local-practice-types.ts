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
    ...[
        "2-1 食物中的養分",
        "2-2 酵素",
        "2-3 植物如何獲得養分",
        "2-4 動物如何獲得養分",
        "3-1 植物的運輸構造",
        "3-2 植物體內物質的運輸",
        "3-3 人體內物質的運輸",
        "3-4 人體的防禦作用",
    ].map((lesson) => ({
        grade: "國一",
        subject: "生物",
        publisher: "康軒",
        volume: "第一冊",
        lesson,
    })),
    ...[
        "Starter Unit",
        "Unit 1 Who's That Handsome Boy?",
        "Unit 2 Where Are My Pencils?",
        "Unit 3 Open the Magic Door",
        "Unit 4 What Time Is the Concert?",
        "Unit 5 What's the Date?",
        "Unit 6 There Are Some Elephants Over There",
        "Review 1",
        "Review 2",
        "Review 3",
    ].map((lesson) => ({
        grade: "國一",
        subject: "英文",
        publisher: "翰林",
        volume: "第一冊",
        lesson,
    })),
    ...[
        "1-1 如何表示位置", "1-2 經緯線網格", "1-3 位置與生活的關聯", "1-4 如何閱讀地圖",
        "2-1 全球海陸分布", "2-2 臺灣的位置及其影響", "2-3 臺灣地區的範圍",
        "3-1 地形如何被形塑", "3-2 常見的地形表示方法", "3-3 臺灣地形的特徵與分布",
        "4-1 海岸的類型與特色", "4-2 臺灣的海岸與利用", "4-3 臺灣離島的成因",
        "5-1 天氣", "5-2 氣候", "5-3 臺灣的氣候特徵", "5-4 臺灣的氣象災害",
        "6-1 水循環", "6-2 水系與流域", "6-3 臺灣河川的特色", "6-4 臺灣水資源利用與保育",
    ].map((lesson) => ({ grade: "國一", subject: "地理", publisher: "翰林", volume: "第一冊", lesson })),
    ...[
        "導言 歷史的基礎觀念", "1-1 考古發掘與史前文化", "1-2 臺灣原住民的遷徙與傳說",
        "2-1 大航海時代的到來", "2-2 各方勢力在臺灣的競逐", "3-1 歐洲人與原住民",
        "3-2 鄭氏政權與原住民", "4-1 清初治臺政策與措施", "4-2 外力入侵與現代化建設",
        "5-1 農業發展", "5-2 商業活動", "6-1 漢人社會與文教的發展", "6-2 原住民的社會文化變遷",
    ].map((lesson) => ({ grade: "國一", subject: "歷史", publisher: "翰林", volume: "第一冊", lesson })),
    ...[
        "1-1 什麼是公民？", "1-2 現代公民應具備的基本德性", "2-1 人性尊嚴與人權", "2-2 人權保障的落實",
        "3-1 家庭中的親屬關係", "3-2 家庭型態與生活模式", "3-3 家庭成員的權利與義務",
        "4-1 家庭的功能與轉變", "4-2 政府如何協助家庭發揮功能？", "5-1 校園中的權利與維護",
        "5-2 如何參與校園公共事務？", "6-1 部落的意義與重要性", "6-2 部落的挑戰與公民參與",
    ].map((lesson) => ({ grade: "國一", subject: "公民", publisher: "翰林", volume: "第一冊", lesson })),
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

export type LocalPracticeRecommendationKind =
    | "same_template"
    | "keyword_similar"
    | "confirmed_similar"
    | "topic_similar"
    | "same_type"
    | "none";

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
