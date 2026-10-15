import {
    ALL_UNITS, getQuestionKindLabel, getUnitLabel, getUnitScopeValue, Question,
    QuestionCollection, QuestionKind, Subject,
} from "./demo-data";

export const ALL_QUESTION_FILTERS = "all";

export interface QuestionFilters {
    /** 科目條件。 */
    subject: Subject | "全部";
    /** 書籍版本條件。 */
    version: string;
    /** 章節與單元條件。 */
    scope: string;
    /** 題型條件。 */
    kind: QuestionKind | typeof ALL_QUESTION_FILTERS;
    /** 題目來源條件。 */
    source: string;
    /** 收藏清單條件。 */
    collection: string;
    /** 題目關鍵字。 */
    search: string;
}

export interface QuestionFilterOptions {
    /** 書籍版本選項。 */
    versions: { value: string; label: string }[];
    /** 章節與單元選項。 */
    scopes: { value: string; label: string }[];
    /** 題型選項。 */
    kinds: { value: string; label: string }[];
    /** 題目來源選項。 */
    sources: { value: string; label: string }[];
    /** 收藏清單選項。 */
    collections: { value: string; label: string }[];
}

export const DEFAULT_QUESTION_FILTERS: QuestionFilters = {
    subject: "全部",
    version: ALL_QUESTION_FILTERS,
    scope: ALL_UNITS,
    kind: ALL_QUESTION_FILTERS,
    source: ALL_QUESTION_FILTERS,
    collection: ALL_QUESTION_FILTERS,
    search: "",
};

/**
 * 建立題目總覽與錯題英雄榜共用的篩選選項。
 * @param questions 目前頁面可供篩選的候選題目。
 * @param filters 目前套用的篩選條件。
 * @param collections 目前學習者的收藏清單。
 * @returns 各欄位可顯示的選項。
 */
export function getQuestionFilterOptions(
    questions: Question[],
    filters: QuestionFilters,
    collections: QuestionCollection[],
): QuestionFilterOptions {
    const scopeQuestions = questions
        .filter((question) => filters.subject === "全部" || question.subject === filters.subject)
        .filter((question) => filters.version === ALL_QUESTION_FILTERS || question.bookVersion === filters.version);
    const scopes = new Map(scopeQuestions.map((question) => [
        getUnitScopeValue(question),
        filters.subject === "全部" ? `${question.subject} · ${getUnitLabel(question.unit)}` : getUnitLabel(question.unit),
    ]));

    return {
        versions: [
            { value: ALL_QUESTION_FILTERS, label: "全部版本" },
            ...[...new Set(questions.map((question) => question.bookVersion).filter((version): version is string => Boolean(version)))]
                .map((version) => ({ value: version, label: version })),
        ],
        scopes: [
            { value: ALL_UNITS, label: "全部單元" },
            ...[...scopes].map(([value, label]) => ({ value, label })),
        ],
        kinds: [
            { value: ALL_QUESTION_FILTERS, label: "全部題型" },
            ...(["choice", "multi-choice", "boolean", "written"] as QuestionKind[])
                .map((kind) => ({ value: kind, label: getQuestionKindLabel(kind) })),
        ],
        sources: [
            { value: ALL_QUESTION_FILTERS, label: "全部來源" },
            ...[...new Set(questions.map((question) => question.source))]
                .map((source) => ({ value: source, label: source })),
        ],
        collections: [
            { value: ALL_QUESTION_FILTERS, label: "全部題目" },
            ...collections.map((collection) => ({
                value: collection.id,
                label: `${collection.name}（${collection.questionIds.length}）`,
            })),
        ],
    };
}

/**
 * 依同一份條件篩選任意題目候選集合。
 * @param questions 目前頁面可供篩選的候選題目。
 * @param filters 目前套用的篩選條件。
 * @param collections 目前學習者的收藏清單。
 * @returns 符合全部條件的題目。
 */
export function filterQuestions(
    questions: Question[],
    filters: QuestionFilters,
    collections: QuestionCollection[],
) {
    const collectionIds = collections.find((collection) => collection.id === filters.collection)?.questionIds;
    const keyword = filters.search.trim().toLocaleLowerCase();

    return questions
        .filter((question) => filters.subject === "全部" || question.subject === filters.subject)
        .filter((question) => filters.version === ALL_QUESTION_FILTERS || question.bookVersion === filters.version)
        .filter((question) => filters.scope === ALL_UNITS || getUnitScopeValue(question) === filters.scope)
        .filter((question) => filters.kind === ALL_QUESTION_FILTERS || question.kind === filters.kind)
        .filter((question) => filters.source === ALL_QUESTION_FILTERS || question.source === filters.source)
        .filter((question) => !collectionIds || collectionIds.includes(question.id))
        .filter((question) => !keyword || [question.code, question.prompt, question.knowledge, question.topic, question.source]
            .some((value) => value?.toLocaleLowerCase().includes(keyword)));
}

/**
 * 移除候選集合中已不存在的篩選值。
 * @param filters 目前套用的篩選條件。
 * @param questions 新的候選題目集合。
 * @param collections 目前學習者的收藏清單。
 * @returns 仍能套用於候選集合的條件。
 */
export function normalizeQuestionFilters(
    filters: QuestionFilters,
    questions: Question[],
    collections: QuestionCollection[],
): QuestionFilters {
    const subjects = new Set(questions.map((question) => question.subject));
    const subject = filters.subject === "全部" || subjects.has(filters.subject) ? filters.subject : "全部";
    const versions = new Set(questions.map((question) => question.bookVersion).filter(Boolean));
    const version = filters.version === ALL_QUESTION_FILTERS || versions.has(filters.version)
        ? filters.version
        : ALL_QUESTION_FILTERS;
    const normalized = { ...filters, subject, version };
    const options = getQuestionFilterOptions(questions, normalized, collections);

    return {
        ...normalized,
        scope: options.scopes.some((option) => option.value === filters.scope) ? filters.scope : ALL_UNITS,
        kind: options.kinds.some((option) => option.value === filters.kind) ? filters.kind : ALL_QUESTION_FILTERS,
        source: options.sources.some((option) => option.value === filters.source) ? filters.source : ALL_QUESTION_FILTERS,
        collection: options.collections.some((option) => option.value === filters.collection)
            ? filters.collection
            : ALL_QUESTION_FILTERS,
    };
}
