import { ALL_UNITS, getQuestionTypeLabel, getUnitLabel, getUnitScopeValue } from "./demo-data";
import type { Question, QuestionCollection, Subject } from "./demo-data";

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
    /** 科目條件；陣列用於可複選的題目篩選。 */
    subject: Subject | "全部" | Subject[];
    /** 學期條件。 */
    semester: string;
    /** 書籍版本條件。 */
    version: string;
    /** 章節與單元條件；空陣列代表不限制。 */
    scope: string[];
    /** 主題條件；陣列用於可複選的題目篩選。 */
    topic: string | string[];
    /** 知識點條件；陣列用於可複選的題目篩選。 */
    knowledge: string | string[];
    /** 難易度條件；空陣列代表不限制。 */
    difficulty: string[];
    /** 題型條件；空陣列代表不限制。 */
    kind: string[];
    /** 題目來源分類條件；空陣列代表不限制。 */
    source: string[];
    /** 題目建立者條件；陣列用於可複選的題目篩選。 */
    creator: string | string[];
    /** 來源專屬的動態條件。 */
    metadata: Record<string, string | string[]>;
    /** 收藏清單條件；陣列用於可複選的題目篩選。 */
    collection: string | string[];
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
    scope: [],
    topic: ALL_QUESTION_FILTERS,
    knowledge: ALL_QUESTION_FILTERS,
    difficulty: [],
    kind: [],
    source: [],
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

/** 取得題目總覽「編號」欄實際顯示且應可搜尋的識別值。 */
export function getQuestionDisplayNumber(question: Question) {
    return question.code ?? question.sourceDetail?.questionNumber ?? String(question.id);
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
 * 只在目前科目真的有該學期題目時，套用學習者已保存的學期。
 * @param questions 目前學習者可使用的題目。
 * @param subject 即將切換到的科目。
 * @param preferredSemester 學習者已保存的學期。
 * @returns 可安全套用的學期；沒有候選時不限制。
 */
export function getPreferredQuestionSemester(
    questions: Question[],
    subject: Subject | "全部",
    preferredSemester?: string,
) {
    if (subject === "全部" || !preferredSemester) return ALL_QUESTION_FILTERS;
    return questions.some((question) => (
        question.subject === subject && question.semester === preferredSemester
    )) ? preferredSemester : ALL_QUESTION_FILTERS;
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
 * 將複選條件整理成不重複的陣列，並相容舊版保存的單一字串。
 * @param value 目前保存的條件。
 * @param legacyAllValue 舊版用來表示「全部」的字串。
 * @returns 空陣列表示不限制的複選值。
 */
export function normalizeQuestionFilterSelection(
    value: readonly string[] | string | null | undefined,
    legacyAllValue = ALL_QUESTION_FILTERS,
) {
    const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return [...new Set(values.map((item) => item.trim()).filter((item) => (
        Boolean(item) && item !== legacyAllValue && item !== ALL_QUESTION_FILTERS
    )))];
}

/**
 * 只保留目前候選集合中仍存在的複選值。
 * @param selected 目前選取值。
 * @param options 目前可用選項。
 * @returns 保留使用者選取順序的有效值。
 */
function retainAvailableSelections(
    selected: readonly string[],
    options: { value: string }[],
) {
    const available = new Set(options.map((option) => option.value));
    return [...new Set(selected.filter((value) => available.has(value)))];
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
    const selectedSources = normalizeQuestionFilterSelection(filters.source);
    const selectedSubjects = normalizeQuestionFilterSelection(filters.subject, "全部") as Subject[];
    const subjectQuestions = questions.filter((question) => !selectedSubjects.length || selectedSubjects.includes(question.subject));
    const semesterQuestions = subjectQuestions.filter((question) => filters.semester === ALL_QUESTION_FILTERS
        || question.semester === filters.semester);
    const versionQuestions = semesterQuestions.filter((question) => matchesVersion(question, filters.version));
    const availableSources = QUESTION_SOURCE_CATEGORIES.filter((source) => (
        versionQuestions.some((question) => getQuestionSourceCategory(question) === source)
    ));
    const sourceQuestions = versionQuestions.filter((question) => !selectedSources.length
        || selectedSources.includes(getQuestionSourceCategory(question)));
    const capabilitySources = selectedSources.length ? selectedSources : availableSources;
    const showVersion = capabilitySources.some(sourceUsesTextbookVersion);
    const showTopic = capabilitySources.some((source) => !SOURCE_WITHOUT_KNOWLEDGE.has(source));
    const showKnowledge = capabilitySources.some((source) => !SOURCE_WITHOUT_KNOWLEDGE.has(source));
    const scopes = new Map(sourceQuestions.map((question) => [
        getUnitScopeValue(question),
        selectedSubjects.length !== 1 ? `${question.subject} · ${getUnitLabel(question.unit)}` : getUnitLabel(question.unit),
    ]));
    const facets = [...sourceQuestions.reduce((catalog, question) => {
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
    }));

    return {
        semesters: getValueOptions(subjectQuestions.map((question) => question.semester), "全部學期"),
        versions: getValueOptions(semesterQuestions.filter(questionUsesTextbookVersion).map((question) => question.bookVersion), "全部版本"),
        scopes: [...scopes].map(([value, label]) => ({ value, label })),
        topics: getValueOptions(sourceQuestions.map((question) => question.topic), "全部主題"),
        knowledge: getValueOptions(sourceQuestions.map((question) => question.knowledge), "全部知識點"),
        difficulties: getValueOptions(sourceQuestions.map((question) => question.difficulty), "全部難度").slice(1),
        kinds: [...new Set(sourceQuestions.map(getQuestionTypeLabel))]
            .sort((left, right) => left.localeCompare(right, "zh-Hant"))
            .map((typeLabel) => ({ value: typeLabel, label: typeLabel })),
        sources: availableSources.map((source) => ({ value: source, label: source })),
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
    const subjects = normalizeQuestionFilterSelection(filters.subject, "全部") as Subject[];
    const scopes = normalizeQuestionFilterSelection(filters.scope, ALL_UNITS);
    const topics = normalizeQuestionFilterSelection(filters.topic);
    const knowledge = normalizeQuestionFilterSelection(filters.knowledge);
    const difficulties = normalizeQuestionFilterSelection(filters.difficulty);
    const kinds = normalizeQuestionFilterSelection(filters.kind);
    const sources = normalizeQuestionFilterSelection(filters.source);
    const creators = normalizeQuestionFilterSelection(filters.creator);
    const selectedCollections = normalizeQuestionFilterSelection(filters.collection);
    const collectionIds = selectedCollections.length
        ? new Set(collections.filter((collection) => selectedCollections.includes(collection.id)).flatMap((collection) => collection.questionIds))
        : null;
    const keyword = filters.search.trim().toLocaleLowerCase();

    return questions
        .filter((question) => !subjects.length || subjects.includes(question.subject))
        .filter((question) => filters.semester === ALL_QUESTION_FILTERS || question.semester === filters.semester)
        .filter((question) => matchesVersion(question, filters.version))
        .filter((question) => !scopes.length || scopes.includes(getUnitScopeValue(question)))
        .filter((question) => !topics.length || topics.includes(question.topic))
        .filter((question) => !knowledge.length || knowledge.includes(question.knowledge))
        .filter((question) => !difficulties.length || difficulties.includes(question.difficulty))
        .filter((question) => !kinds.length || kinds.includes(getQuestionTypeLabel(question)) || kinds.includes(question.kind))
        .filter((question) => !sources.length || sources.includes(getQuestionSourceCategory(question)))
        .filter((question) => !creators.length || creators.includes(getQuestionCreator(question) ?? ""))
        .filter((question) => Object.entries(filters.metadata).every(([key, value]) => {
            const selected = normalizeQuestionFilterSelection(value);
            return !selected.length || question.metadata?.some((field) => (
                field.key === key && field.values.some((item) => selected.includes(item))
            ));
        }))
        .filter((question) => !collectionIds || collectionIds.has(question.id))
        .filter((question) => !keyword || [
            getQuestionDisplayNumber(question),
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
    const selectedSubjects = normalizeQuestionFilterSelection(filters.subject, "全部")
        .filter((subject): subject is Subject => subjects.has(subject as Subject));
    const subject = Array.isArray(filters.subject)
        ? selectedSubjects
        : selectedSubjects[0] ?? "全部";
    const normalized: QuestionFilters = {
        ...filters,
        subject,
        scope: normalizeQuestionFilterSelection(filters.scope, ALL_UNITS),
        difficulty: normalizeQuestionFilterSelection(filters.difficulty),
        kind: normalizeQuestionFilterSelection(filters.kind),
        source: normalizeQuestionFilterSelection(filters.source),
    };

    // 先校正學期與版本，再以有效的上游條件決定來源。
    let nextOptions = getQuestionFilterOptions(questions, normalized, collections);
    const semester = nextOptions.semesters.some((option) => option.value === normalized.semester)
        ? normalized.semester
        : ALL_QUESTION_FILTERS;
    let sourceNormalized = semester === normalized.semester ? normalized : { ...normalized, semester };
    nextOptions = getQuestionFilterOptions(questions, sourceNormalized, collections);
    const version = nextOptions.versions.some((option) => option.value === normalized.version)
        ? normalized.version
        : ALL_QUESTION_FILTERS;
    sourceNormalized = version === sourceNormalized.version ? sourceNormalized : { ...sourceNormalized, version };
    nextOptions = getQuestionFilterOptions(questions, sourceNormalized, collections);

    const source = retainAvailableSelections(sourceNormalized.source, nextOptions.sources);
    sourceNormalized = { ...sourceNormalized, source };
    nextOptions = getQuestionFilterOptions(questions, sourceNormalized, collections);

    // 當選取的來源全部不綁教材版本時，隱藏並清除舊版本條件。
    if (!nextOptions.showVersion && sourceNormalized.version !== ALL_QUESTION_FILTERS) {
        sourceNormalized = { ...sourceNormalized, version: ALL_QUESTION_FILTERS };
        nextOptions = getQuestionFilterOptions(questions, sourceNormalized, collections);
    }

    const metadata = Object.fromEntries(nextOptions.facets.map((facet) => {
        const current = filters.metadata[facet.key] ?? ALL_QUESTION_FILTERS;
        const selected = retainAvailableSelections(normalizeQuestionFilterSelection(current), facet.options);
        return [facet.key, Array.isArray(current) ? selected : selected[0] ?? ALL_QUESTION_FILTERS];
    }));
    const retainValue = (current: string | string[], available: { value: string }[]) => {
        const selected = retainAvailableSelections(normalizeQuestionFilterSelection(current), available);
        return Array.isArray(current) ? selected : selected[0] ?? ALL_QUESTION_FILTERS;
    };

    return {
        ...sourceNormalized,
        semester: nextOptions.semesters.some((option) => option.value === filters.semester) ? filters.semester : ALL_QUESTION_FILTERS,
        version: nextOptions.showVersion && nextOptions.versions.some((option) => option.value === sourceNormalized.version)
            ? sourceNormalized.version
            : ALL_QUESTION_FILTERS,
        scope: retainAvailableSelections(sourceNormalized.scope, nextOptions.scopes),
        topic: nextOptions.showTopic ? retainValue(filters.topic, nextOptions.topics) : Array.isArray(filters.topic) ? [] : ALL_QUESTION_FILTERS,
        knowledge: nextOptions.showKnowledge ? retainValue(filters.knowledge, nextOptions.knowledge) : Array.isArray(filters.knowledge) ? [] : ALL_QUESTION_FILTERS,
        difficulty: retainAvailableSelections(sourceNormalized.difficulty, nextOptions.difficulties),
        kind: retainAvailableSelections(
            sourceNormalized.kind.flatMap((selected) => {
                if (!["choice", "boolean", "written", "multi-choice"].includes(selected)) return [selected];
                return questions
                    .filter((question) => question.kind === selected)
                    .map(getQuestionTypeLabel);
            }),
            nextOptions.kinds,
        ),
        source,
        creator: retainValue(filters.creator, nextOptions.creators),
        metadata,
        collection: retainValue(filters.collection, nextOptions.collections),
    };
}
