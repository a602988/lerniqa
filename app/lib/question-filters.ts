import {
    ALL_UNITS, getQuestionKindLabel, getUnitLabel, getUnitScopeValue, Question,
    QuestionCollection, QuestionKind, Subject,
} from "./demo-data";

export const ALL_QUESTION_FILTERS = "all";
export const QUESTION_SOURCE_CATEGORIES = [
    "題庫題目",
    "課本自我評量",
    "課本例題",
    "課本隨堂",
    "習作（基礎＋精熟）",
    "習作（綜合練習）",
    "素養題",
    "仿會考非選題",
    "基測",
    "會考",
    "校內卷",
] as const;

const SOURCE_ALIASES: Record<string, string> = {
    試題: "題庫題目",
    同步練習卷: "題庫題目",
    舊綱題: "題庫題目",
    校內練習卷: "校內卷",
    學校段考: "校內卷",
};
const SOURCE_WITHOUT_TEXTBOOK_VERSION = new Set(["校內卷", "基測", "會考", "仿會考非選題"]);
const SOURCE_WITHOUT_KNOWLEDGE = new Set(["校內卷"]);
const HIDDEN_METADATA_KEYS = new Set([
    "source",
    "source_category",
    "source_type",
    "source_path",
    "knowledge_point",
    "learning_content",
    "creator",
    "creator_role",
    "owner_role",
]);

export interface QuestionFilters {
    /** 科目條件。 */
    subject: Subject | "全部";
    /** 學期條件。 */
    semester: string;
    /** 書籍版本條件。 */
    version: string;
    /** 章節與單元條件。 */
    scope: string;
    /** 主題條件。 */
    topic: string;
    /** 知識點條件。 */
    knowledge: string;
    /** 難易度條件。 */
    difficulty: string;
    /** 題型條件。 */
    kind: QuestionKind | typeof ALL_QUESTION_FILTERS;
    /** 題目來源分類條件。 */
    source: string;
    /** 題目建立者條件。 */
    creator: string;
    /** 來源專屬的動態條件。 */
    metadata: Record<string, string>;
    /** 收藏清單條件。 */
    collection: string;
    /** 題目關鍵字。 */
    search: string;
}

export interface QuestionFilterFacet {
    /** 動態欄位鍵值。 */
    key: string;
    /** 畫面顯示名稱。 */
    label: string;
    /** 動態欄位選項。 */
    options: { value: string; label: string }[];
}

export interface QuestionFilterOptions {
    /** 學期選項。 */
    semesters: { value: string; label: string }[];
    /** 書籍版本選項。 */
    versions: { value: string; label: string }[];
    /** 章節與單元選項。 */
    scopes: { value: string; label: string }[];
    /** 主題選項。 */
    topics: { value: string; label: string }[];
    /** 知識點選項。 */
    knowledge: { value: string; label: string }[];
    /** 難易度選項。 */
    difficulties: { value: string; label: string }[];
    /** 題型選項。 */
    kinds: { value: string; label: string }[];
    /** 題目來源分類選項。 */
    sources: { value: string; label: string }[];
    /** 題目建立者選項。 */
    creators: { value: string; label: string }[];
    /** 來源專屬的動態欄位。 */
    facets: QuestionFilterFacet[];
    /** 收藏清單選項。 */
    collections: { value: string; label: string }[];
    /** 目前來源是否使用教材版本。 */
    showVersion: boolean;
    /** 目前來源是否提供主題。 */
    showTopic: boolean;
    /** 目前來源是否提供知識點。 */
    showKnowledge: boolean;
}

export const DEFAULT_QUESTION_FILTERS: QuestionFilters = {
    subject: "全部",
    semester: ALL_QUESTION_FILTERS,
    version: ALL_QUESTION_FILTERS,
    scope: ALL_UNITS,
    topic: ALL_QUESTION_FILTERS,
    knowledge: ALL_QUESTION_FILTERS,
    difficulty: ALL_QUESTION_FILTERS,
    kind: ALL_QUESTION_FILTERS,
    source: ALL_QUESTION_FILTERS,
    creator: ALL_QUESTION_FILTERS,
    metadata: {},
    collection: ALL_QUESTION_FILTERS,
    search: "",
};

/**
 * 判斷匯入欄位是否適合顯示為補充條件，避免與正式篩選欄位重複。
 * @param key 匯入欄位鍵值。
 * @returns 欄位是否可顯示於篩選與題目條件。
 */
export function isSupplementalQuestionMetadata(key: string) {
    return !HIDDEN_METADATA_KEYS.has(key);
}

/**
 * 將來源文件的歷史值轉成產品定義的來源分類。
 * @param value 原始來源值。
 * @returns 可供篩選的來源分類。
 */
export function normalizeQuestionSourceCategory(value: string) {
    const normalized = value.trim().replace(/^\d+[\s_-]*/, "");
    const category = QUESTION_SOURCE_CATEGORIES.find((item) => normalized.includes(item));
    if (category) return category;

    const alias = Object.entries(SOURCE_ALIASES).find(([key]) => normalized.includes(key));
    return alias?.[1] ?? "題庫題目";
}

/**
 * 取得題目的來源分類，優先採用明確欄位，再相容舊資料中的路徑與顯示文字。
 * @param question 題目資料。
 * @returns 可供篩選的來源分類。
 */
export function getQuestionSourceCategory(question: Question) {
    const metadata = question.metadata?.find((field) => field.key === "source_category")
        ?? question.metadata?.find((field) => field.key === "source_type")
        ?? question.metadata?.find((field) => field.key === "source_path");
    return normalizeQuestionSourceCategory(question.sourceCategory ?? metadata?.rawValue ?? question.source);
}

/**
 * 依來源規則判斷題目是否需要教材版本。
 * @param question 題目資料。
 * @returns 題目是否需要教材版本。
 */
export function questionUsesTextbookVersion(question: Question) {
    return sourceUsesTextbookVersion(getQuestionSourceCategory(question));
}

/**
 * 依來源分類判斷是否需要教材版本。
 * @param source 來源分類。
 * @returns 來源是否需要教材版本。
 */
export function sourceUsesTextbookVersion(source: string) {
    return !SOURCE_WITHOUT_TEXTBOOK_VERSION.has(source);
}

/**
 * 取得題目建立者欄位。
 * @param question 題目資料。
 * @returns 題目建立者；沒有欄位時不顯示建立者篩選。
 */
function getQuestionCreator(question: Question) {
    return question.metadata?.find((field) => ["creator", "creator_role", "owner_role"].includes(field.key))?.rawValue;
}

/**
 * 建立不重複且已排序的選項。
 * @param values 候選值。
 * @param allLabel 不限制條件時的顯示文字。
 * @returns 含全部選項的清單。
 */
function getValueOptions(values: Array<string | undefined>, allLabel: string) {
    const unique = [...new Set(values.filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
    return [{ value: ALL_QUESTION_FILTERS, label: allLabel }, ...unique.map((value) => ({ value, label: value }))];
}

/**
 * 判斷題目是否符合目前選擇的教材版本。
 * @param question 題目資料。
 * @param version 目前選擇的教材版本。
 * @returns 題目是否符合版本條件。
 */
function matchesVersion(question: Question, version: string) {
    return version === ALL_QUESTION_FILTERS || !questionUsesTextbookVersion(question) || question.bookVersion === version;
}

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
    const subjectQuestions = questions.filter((question) => filters.subject === "全部" || question.subject === filters.subject);
    const versionQuestions = subjectQuestions.filter((question) => matchesVersion(question, filters.version));
    const sourceQuestions = versionQuestions.filter((question) => filters.source === ALL_QUESTION_FILTERS
        || getQuestionSourceCategory(question) === filters.source);
    const selectedSource = filters.source === ALL_QUESTION_FILTERS ? undefined : filters.source;
    const showVersion = !selectedSource || !SOURCE_WITHOUT_TEXTBOOK_VERSION.has(selectedSource);
    const showTopic = !selectedSource || !SOURCE_WITHOUT_KNOWLEDGE.has(selectedSource);
    const showKnowledge = !selectedSource || !SOURCE_WITHOUT_KNOWLEDGE.has(selectedSource);
    const scopes = new Map(sourceQuestions.map((question) => [
        getUnitScopeValue(question),
        filters.subject === "全部" ? `${question.subject} · ${getUnitLabel(question.unit)}` : getUnitLabel(question.unit),
    ]));
    const facets = selectedSource ? [...sourceQuestions.reduce((catalog, question) => {
        question.metadata?.forEach((field) => {
            if (!isSupplementalQuestionMetadata(field.key) || !field.values.length) return;
            const current = catalog.get(field.key) ?? { key: field.key, label: field.label, values: new Set<string>() };
            field.values.forEach((value) => current.values.add(value));
            catalog.set(field.key, current);
        });
        return catalog;
    }, new Map<string, { key: string; label: string; values: Set<string> }>()).values()].map((facet) => ({
        key: facet.key,
        label: facet.label,
        options: getValueOptions([...facet.values], `全部${facet.label}`),
    })) : [];

    return {
        semesters: getValueOptions(sourceQuestions.map((question) => question.semester), "全部學期"),
        versions: getValueOptions(subjectQuestions.filter(questionUsesTextbookVersion).map((question) => question.bookVersion), "全部版本"),
        scopes: [
            { value: ALL_UNITS, label: "全部單元" },
            ...[...scopes].map(([value, label]) => ({ value, label })),
        ],
        topics: getValueOptions(sourceQuestions.map((question) => question.topic), "全部主題"),
        knowledge: getValueOptions(sourceQuestions.map((question) => question.knowledge), "全部知識點"),
        difficulties: getValueOptions(sourceQuestions.map((question) => question.difficulty), "全部難度"),
        kinds: [
            { value: ALL_QUESTION_FILTERS, label: "全部題型" },
            ...([...new Set(sourceQuestions.map((question) => question.kind))] as QuestionKind[])
                .map((kind) => ({ value: kind, label: getQuestionKindLabel(kind) })),
        ],
        sources: [
            { value: ALL_QUESTION_FILTERS, label: "全部來源" },
            ...QUESTION_SOURCE_CATEGORIES
                .filter((source) => versionQuestions.some((question) => getQuestionSourceCategory(question) === source))
                .map((source) => ({ value: source, label: source })),
        ],
        creators: getValueOptions(sourceQuestions.map(getQuestionCreator), "全部建立者"),
        facets,
        collections: [
            { value: ALL_QUESTION_FILTERS, label: "全部題目" },
            ...collections.map((collection) => ({
                value: collection.id,
                label: `${collection.name}（${collection.questionIds.length}）`,
            })),
        ],
        showVersion,
        showTopic: showTopic && sourceQuestions.some((question) => Boolean(question.topic)),
        showKnowledge: showKnowledge && sourceQuestions.some((question) => Boolean(question.knowledge)),
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
        .filter((question) => filters.semester === ALL_QUESTION_FILTERS || question.semester === filters.semester)
        .filter((question) => matchesVersion(question, filters.version))
        .filter((question) => filters.scope === ALL_UNITS || getUnitScopeValue(question) === filters.scope)
        .filter((question) => filters.topic === ALL_QUESTION_FILTERS || question.topic === filters.topic)
        .filter((question) => filters.knowledge === ALL_QUESTION_FILTERS || question.knowledge === filters.knowledge)
        .filter((question) => filters.difficulty === ALL_QUESTION_FILTERS || question.difficulty === filters.difficulty)
        .filter((question) => filters.kind === ALL_QUESTION_FILTERS || question.kind === filters.kind)
        .filter((question) => filters.source === ALL_QUESTION_FILTERS || getQuestionSourceCategory(question) === filters.source)
        .filter((question) => filters.creator === ALL_QUESTION_FILTERS || getQuestionCreator(question) === filters.creator)
        .filter((question) => Object.entries(filters.metadata).every(([key, value]) => value === ALL_QUESTION_FILTERS
            || question.metadata?.some((field) => field.key === key && field.values.includes(value))))
        .filter((question) => !collectionIds || collectionIds.includes(question.id))
        .filter((question) => !keyword || [
            question.code,
            question.prompt,
            question.knowledge,
            question.topic,
            question.source,
            getQuestionSourceCategory(question),
        ].some((value) => value?.toLocaleLowerCase().includes(keyword)));
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
    const normalized = { ...filters, subject };
    const options = getQuestionFilterOptions(questions, normalized, collections);
    const source = options.sources.some((option) => option.value === filters.source) ? filters.source : ALL_QUESTION_FILTERS;
    const sourceNormalized = source === filters.source ? normalized : { ...normalized, source, metadata: {} };
    const nextOptions = source === filters.source ? options : getQuestionFilterOptions(questions, sourceNormalized, collections);
    const metadata = Object.fromEntries(nextOptions.facets.map((facet) => [
        facet.key,
        facet.options.some((option) => option.value === filters.metadata[facet.key])
            ? filters.metadata[facet.key]
            : ALL_QUESTION_FILTERS,
    ]));

    return {
        ...sourceNormalized,
        semester: nextOptions.semesters.some((option) => option.value === filters.semester) ? filters.semester : ALL_QUESTION_FILTERS,
        version: nextOptions.showVersion && nextOptions.versions.some((option) => option.value === filters.version)
            ? filters.version
            : ALL_QUESTION_FILTERS,
        scope: nextOptions.scopes.some((option) => option.value === filters.scope) ? filters.scope : ALL_UNITS,
        topic: nextOptions.showTopic && nextOptions.topics.some((option) => option.value === filters.topic)
            ? filters.topic
            : ALL_QUESTION_FILTERS,
        knowledge: nextOptions.showKnowledge && nextOptions.knowledge.some((option) => option.value === filters.knowledge)
            ? filters.knowledge
            : ALL_QUESTION_FILTERS,
        difficulty: nextOptions.difficulties.some((option) => option.value === filters.difficulty)
            ? filters.difficulty
            : ALL_QUESTION_FILTERS,
        kind: nextOptions.kinds.some((option) => option.value === filters.kind) ? filters.kind : ALL_QUESTION_FILTERS,
        source,
        creator: nextOptions.creators.some((option) => option.value === filters.creator)
            ? filters.creator
            : ALL_QUESTION_FILTERS,
        metadata,
        collection: nextOptions.collections.some((option) => option.value === filters.collection)
            ? filters.collection
            : ALL_QUESTION_FILTERS,
    };
}
