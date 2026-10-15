import { Button, FormField, Input, NativeSelect } from "@keel-design/ui";
import { Library, RotateCcw, Search } from "lucide-react";
import { useMemo } from "react";
import { ALL_UNITS, Question, QuestionCollection, Subject } from "../lib/demo-data";
import { getQuestionFilterOptions, QuestionFilters } from "../lib/question-filters";

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
    /** 目前學習者的收藏清單。 */
    collections: QuestionCollection[];
    /** 目前套用的篩選條件。 */
    value: QuestionFilters;
    /** 更新全部篩選條件。 */
    onChange: (value: QuestionFilters) => void;
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
    collections,
    value,
    onChange,
    onReset,
}: QuestionFilterPanelProps) {
    const options = useMemo(
        () => getQuestionFilterOptions(questions, value, collections),
        [collections, questions, value],
    );

    /**
     * 更新單一條件，並在上游條件改變時清除已失效的單元。
     * @param field 要更新的條件欄位。
     * @param nextValue 新的條件值。
     */
    function updateFilter<K extends keyof QuestionFilters>(field: K, nextValue: QuestionFilters[K]) {
        const resetsScope = field === "subject" || field === "version";
        onChange({ ...value, [field]: nextValue, ...(resetsScope ? { scope: ALL_UNITS } : {}) });
    }

    return (
        <section className="question-filter-panel" aria-labelledby={`${idPrefix}-filter-title`}>
            <div className="question-filter-heading">
                <div>
                    <h3 id={`${idPrefix}-filter-title`}>篩選題目</h3>
                    <p>條件會同時套用到目前清單與批次範圍。</p>
                </div>
                <Button appearance="ghost" tone="muted" size="sm" onClick={onReset}><RotateCcw />清除篩選</Button>
            </div>
            <div className="question-filter-grid">
                <SubjectFilter className="question-filter-subject" subjects={subjects} value={value.subject} onChange={(subject) => updateFilter("subject", subject)} />
                <FormField label="版本"><NativeSelect options={options.versions} value={value.version} onChange={(event) => updateFilter("version", event.target.value)} /></FormField>
                <FormField label="單元"><NativeSelect options={options.scopes} value={value.scope} onChange={(event) => updateFilter("scope", event.target.value)} /></FormField>
                <FormField label="題型"><NativeSelect options={options.kinds} value={value.kind} onChange={(event) => updateFilter("kind", event.target.value as QuestionFilters["kind"])} /></FormField>
                <FormField label="來源"><NativeSelect options={options.sources} value={value.source} onChange={(event) => updateFilter("source", event.target.value)} /></FormField>
                <FormField label="收藏清單"><NativeSelect options={options.collections} value={value.collection} onChange={(event) => updateFilter("collection", event.target.value)} /></FormField>
                <FormField className="question-filter-search-field" label="搜尋">
                    <div className="question-search"><Search aria-hidden="true" /><Input aria-label="搜尋題目" value={value.search} placeholder="搜尋題目、編號或來源" onChange={(event) => updateFilter("search", event.target.value)} /></div>
                </FormField>
            </div>
        </section>
    );
}
