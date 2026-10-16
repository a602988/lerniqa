import { Button, FormField, Input, NativeSelect } from "@keel-design/ui";
import { ChevronDown, ChevronUp, Library, RotateCcw, Search } from "lucide-react";
import { ReactNode, useMemo } from "react";
import { ALL_UNITS, Question, QuestionCollection, Subject } from "../lib/demo-data";
import {
    ALL_QUESTION_FILTERS, getQuestionFilterOptions, QuestionFilters, sourceUsesTextbookVersion,
} from "../lib/question-filters";

interface SubjectFilterProps {
    /** 目前年級可使用的科目。 */
    subjects: Subject[];
    /** 目前選取的科目。 */
    value: Subject | "全部";
    /** 元件所在區塊的額外樣式。 */
    className?: string;
    /** 科目更新事件。 */
    onChange: (value: Subject | "全部") => void;
}

interface QuestionFilterPanelProps {
    /** 區分頁面上欄位識別碼的前綴。 */
    idPrefix: string;
    /** 目前年級可使用的科目。 */
    subjects: Subject[];
    /** 目前頁面可供篩選的候選題目。 */
    questions: Question[];
    /** 目前學習者年級，由頁面候選資料預先套用。 */
    grade: string;
    /** 目前學習者各科使用的教材版本。 */
    preferredVersions: Partial<Record<Subject, string>>;
    /** 目前學習者的收藏清單。 */
    collections: QuestionCollection[];
    /** 目前套用的篩選條件。 */
    value: QuestionFilters;
    /** 是否顯示完整篩選欄位。 */
    expanded: boolean;
    /** 需要停用的欄位；仍保留目前值供畫面說明。 */
    disabledFields?: Partial<Record<keyof QuestionFilters, boolean>>;
    /** 篩選欄位後方的頁面專屬設定。 */
    children?: ReactNode;
    /** 更新全部篩選條件。 */
    onChange: (value: QuestionFilters) => void;
    /** 展開狀態更新事件。 */
    onExpandedChange: (expanded: boolean) => void;
    /** 清除全部篩選條件。 */
    onReset: () => void;
}

/** 顯示各頁共用的科目篩選按鈕。 */
export function SubjectFilter({ subjects, value, className = "", onChange }: SubjectFilterProps) {
    const options: { value: Subject | "全部"; label: string }[] = [
        { value: "全部", label: "全部" },
        ...subjects.map((subject) => ({ value: subject, label: subject })),
    ];

    return (
        <fieldset className={`subject-filter grid gap-2 ${className}`.trim()}>
            <legend><span className="practice-field-label field-dot-violet"><Library aria-hidden="true" />科目</span></legend>
            <div className="subject-filter-options">
                {options.map((option) => (
                    <button
                        aria-pressed={value === option.value}
                        className="plan-choice plan-subject-choice"
                        data-selected={value === option.value}
                        key={option.value}
                        onClick={() => onChange(option.value)}
                        type="button"
                    >
                        <span className="text-sm font-semibold">{option.label}</span>
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

/** 顯示題目總覽與錯題英雄榜共用的完整題目篩選。 */
export function QuestionFilterPanel({
    idPrefix,
    subjects,
    questions,
    grade,
    preferredVersions,
    collections,
    value,
    expanded,
    disabledFields = {},
    children,
    onChange,
    onExpandedChange,
    onReset,
}: QuestionFilterPanelProps) {
    const options = useMemo(
        () => getQuestionFilterOptions(questions, value, collections),
        [collections, questions, value],
    );
    const activeFilterCount = [
        value.subject !== "全部",
        value.semester !== ALL_QUESTION_FILTERS,
        value.version !== ALL_QUESTION_FILTERS,
        value.scope !== ALL_UNITS,
        value.topic !== ALL_QUESTION_FILTERS,
        value.knowledge !== ALL_QUESTION_FILTERS,
        value.difficulty !== ALL_QUESTION_FILTERS,
        value.kind !== ALL_QUESTION_FILTERS,
        value.source !== ALL_QUESTION_FILTERS,
        value.creator !== ALL_QUESTION_FILTERS,
        Object.values(value.metadata).some((item) => item !== ALL_QUESTION_FILTERS),
        value.collection !== ALL_QUESTION_FILTERS,
        Boolean(value.search.trim()),
    ].filter(Boolean).length;
    const contentId = `${idPrefix}-filter-content`;

    /**
     * 更新單一條件，並在上游條件改變時清除已失效的單元。
     * @param field 要更新的條件欄位。
     * @param nextValue 新的條件值。
     */
    function updateFilter<K extends keyof QuestionFilters>(field: K, nextValue: QuestionFilters[K]) {
        if (field === "subject") {
            const subject = nextValue as QuestionFilters["subject"];
            const preferredVersion = subject === "全部" ? undefined : preferredVersions[subject];
            const version = preferredVersion && questions.some((question) => question.subject === subject && question.bookVersion === preferredVersion)
                ? preferredVersion
                : ALL_QUESTION_FILTERS;
            onChange({
                ...value,
                subject,
                semester: ALL_QUESTION_FILTERS,
                version,
                scope: ALL_UNITS,
                topic: ALL_QUESTION_FILTERS,
                knowledge: ALL_QUESTION_FILTERS,
                difficulty: ALL_QUESTION_FILTERS,
                kind: ALL_QUESTION_FILTERS,
                source: ALL_QUESTION_FILTERS,
                creator: ALL_QUESTION_FILTERS,
                metadata: {},
            });
            return;
        }

        if (field === "version") {
            onChange({
                ...value,
                version: String(nextValue),
                scope: ALL_UNITS,
                topic: ALL_QUESTION_FILTERS,
                knowledge: ALL_QUESTION_FILTERS,
                source: ALL_QUESTION_FILTERS,
                metadata: {},
            });
            return;
        }

        if (field === "source") {
            onChange({
                ...value,
                source: String(nextValue),
                version: sourceUsesTextbookVersion(String(nextValue))
                    ? value.version
                    : ALL_QUESTION_FILTERS,
                scope: ALL_UNITS,
                topic: ALL_QUESTION_FILTERS,
                knowledge: ALL_QUESTION_FILTERS,
                creator: ALL_QUESTION_FILTERS,
                metadata: {},
            });
            return;
        }

        onChange({ ...value, [field]: nextValue });
    }

    return (
        <section className="question-filter-panel" aria-labelledby={`${idPrefix}-filter-title`}>
            <div className="question-filter-heading">
                <div>
                    <h3 id={`${idPrefix}-filter-title`}>篩選題目</h3>
                    <p>{grade}由目前學習者帶入；切換科目會套用該科教材版本。</p>
                </div>
                <div className="question-filter-heading-actions">
                    {activeFilterCount > 0 && <span>{activeFilterCount} 個條件</span>}
                    <Button appearance="ghost" tone="muted" size="sm" onClick={onReset}><RotateCcw />清除篩選</Button>
                    <Button
                        appearance="outline"
                        tone="muted"
                        size="sm"
                        aria-controls={contentId}
                        aria-expanded={expanded}
                        onClick={() => onExpandedChange(!expanded)}
                    >
                        {expanded ? <ChevronUp /> : <ChevronDown />}{expanded ? "收合篩選" : "展開篩選"}
                    </Button>
                </div>
            </div>
            {expanded && <div className="question-filter-grid" id={contentId}>
                <SubjectFilter className="question-filter-subject" subjects={subjects} value={value.subject} onChange={(subject) => updateFilter("subject", subject)} />
                <FormField label="學期"><NativeSelect disabled={disabledFields.semester} options={options.semesters} value={value.semester} onChange={(event) => updateFilter("semester", event.target.value)} /></FormField>
                {options.showVersion && <FormField label="版本"><NativeSelect disabled={disabledFields.version} options={options.versions} value={value.version} onChange={(event) => updateFilter("version", event.target.value)} /></FormField>}
                <FormField label="來源"><NativeSelect disabled={disabledFields.source} options={options.sources} value={value.source} onChange={(event) => updateFilter("source", event.target.value)} /></FormField>
                <FormField label="單元"><NativeSelect disabled={disabledFields.scope} options={options.scopes} value={value.scope} onChange={(event) => updateFilter("scope", event.target.value)} /></FormField>
                {options.showTopic && <FormField label="主題"><NativeSelect disabled={disabledFields.topic} options={options.topics} value={value.topic} onChange={(event) => updateFilter("topic", event.target.value)} /></FormField>}
                {options.showKnowledge && <FormField label="知識點"><NativeSelect disabled={disabledFields.knowledge} options={options.knowledge} value={value.knowledge} onChange={(event) => updateFilter("knowledge", event.target.value)} /></FormField>}
                <FormField label="難易度"><NativeSelect disabled={disabledFields.difficulty} options={options.difficulties} value={value.difficulty} onChange={(event) => updateFilter("difficulty", event.target.value)} /></FormField>
                <FormField label="題型"><NativeSelect disabled={disabledFields.kind} options={options.kinds} value={value.kind} onChange={(event) => updateFilter("kind", event.target.value as QuestionFilters["kind"])} /></FormField>
                {options.creators.length > 1 && <FormField label="建立者"><NativeSelect disabled={disabledFields.creator} options={options.creators} value={value.creator} onChange={(event) => updateFilter("creator", event.target.value)} /></FormField>}
                {options.facets.map((facet) => <FormField label={facet.label} key={facet.key}>
                    <NativeSelect
                        disabled={disabledFields.metadata}
                        options={facet.options}
                        value={value.metadata[facet.key] ?? ALL_QUESTION_FILTERS}
                        onChange={(event) => updateFilter("metadata", { ...value.metadata, [facet.key]: event.target.value })}
                    />
                </FormField>)}
                <FormField label="收藏清單"><NativeSelect disabled={disabledFields.collection} options={options.collections} value={value.collection} onChange={(event) => updateFilter("collection", event.target.value)} /></FormField>
                <FormField className="question-filter-search-field" label="搜尋">
                    <div className="question-search"><Search aria-hidden="true" /><Input disabled={disabledFields.search} aria-label="搜尋題目" value={value.search} placeholder="搜尋題目、編號或來源" onChange={(event) => updateFilter("search", event.target.value)} /></div>
                </FormField>
                {children && <div className="question-filter-extra">{children}</div>}
            </div>}
        </section>
    );
}
