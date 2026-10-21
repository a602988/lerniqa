import { Button, FormField, Input } from "@keel-design/ui";
import { ChevronDown, ChevronUp, Library, RotateCcw, Search } from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef } from "react";
import { AppSelect, AppSelect as NativeSelect } from "./app-select";
import { ALL_UNITS, Question, QuestionCollection, Subject } from "../lib/demo-data";
import {
    ALL_QUESTION_FILTERS, getPreferredQuestionSemester, getQuestionFilterOptions, normalizeQuestionFilterSelection,
    normalizeQuestionFilters, QuestionFilters,
} from "../lib/question-filters";

interface SubjectFilterProps {
    /** 目前年級可使用的科目。 */
    subjects: Subject[];
    /** 目前選取的科目。 */
    value: Subject | "全部" | Subject[];
    /** 是否允許同時選取多個科目。 */
    multiple?: boolean;
    /** 元件所在區塊的額外樣式。 */
    className?: string;
    /** 科目更新事件。 */
    onChange: (value: Subject | "全部" | Subject[]) => void;
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
    /** 目前學習者已保存的學期。 */
    preferredSemester?: string;
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
    /** 重設按鈕文案。 */
    resetLabel?: string;
    /** 除學期與版本外，將其餘選項式欄位顯示為複選。 */
    multiSelectCatalogFields?: boolean;
}

interface MultiSelectFilterProps {
    /** 區分標籤與觸發按鈕的識別碼。 */
    id: string;
    /** 條件名稱。 */
    label: string;
    /** 目前可用選項。 */
    options: { value: string; label: string }[];
    /** 目前選取值；空陣列表示全部。 */
    value: readonly string[];
    /** 是否禁止操作。 */
    disabled?: boolean;
    /** 選取值更新事件。 */
    onChange: (value: string[]) => void;
}

interface MultiSelectMenuPlacement {
    side: "top" | "bottom";
    maxHeight: number;
}

const MULTI_SELECT_VIEWPORT_PADDING = 16;
const MULTI_SELECT_MENU_GAP = 4;

function getMultiSelectMenuPlacement(trigger: HTMLElement, content: HTMLElement): MultiSelectMenuPlacement {
    const triggerRect = trigger.getBoundingClientRect();
    const spaceAbove = Math.max(0, triggerRect.top - MULTI_SELECT_VIEWPORT_PADDING - MULTI_SELECT_MENU_GAP);
    const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - MULTI_SELECT_VIEWPORT_PADDING - MULTI_SELECT_MENU_GAP);
    const preferredHeight = content.scrollHeight;
    const side = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove ? "bottom" : "top";

    return {
        side,
        maxHeight: Math.max(0, side === "bottom" ? spaceBelow : spaceAbove),
    };
}

/** 以 KEEL MultiSelect 顯示可搜尋、全選與清除的複選條件。 */
function MultiSelectFilter({ id, label, options, value, disabled = false, onChange }: MultiSelectFilterProps) {
    const selected = normalizeQuestionFilterSelection(value);
    const containerRef = useRef<HTMLDivElement>(null);

    function fitMenuToViewport() {
        const container = containerRef.current;
        const trigger = container?.querySelector<HTMLElement>("[data-slot='multi-select'] > button");
        const content = container?.querySelector<HTMLElement>("[data-slot='multi-select-content']");
        if (!trigger || !content) return;

        const placement = getMultiSelectMenuPlacement(trigger, content);
        content.dataset.side = placement.side;
        content.style.setProperty("--question-filter-menu-max-height", `${placement.maxHeight}px`);
    }

    function scheduleMenuFit() {
        requestAnimationFrame(fitMenuToViewport);
    }

    function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) scheduleMenuFit();
    }

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new MutationObserver(fitMenuToViewport);
        observer.observe(container, { childList: true, subtree: true });
        window.addEventListener("resize", fitMenuToViewport);
        window.addEventListener("scroll", fitMenuToViewport, true);

        return () => {
            observer.disconnect();
            window.removeEventListener("resize", fitMenuToViewport);
            window.removeEventListener("scroll", fitMenuToViewport, true);
        };
    }, []);

    return (
        <div className="question-filter-multi-select grid content-start gap-2" ref={containerRef} onClickCapture={scheduleMenuFit} onKeyDownCapture={handleKeyDownCapture}>
            <p className="text-sm font-semibold" id={`${id}-label`}>{label}</p>
            <AppSelect
                aria-labelledby={`${id}-label`}
                clearAllLabel="全部清除"
                clearable
                disabled={disabled || !options.length}
                emptyLabel={`尚無可選${label}`}
                matchTriggerWidth
                noResultsLabel={`找不到符合的${label}`}
                onValuesChange={onChange}
                options={options}
                placeholder={options.length ? `全部${label}` : `尚無可選${label}`}
                searchable
                searchFieldStyle="outlined"
                searchPlaceholder={`搜尋${label}...`}
                selectAll
                selectAllLabel="全選"
                selectionIndicator="checkbox"
                selection="multiple"
                triggerLabelMode="count"
                values={selected}
            />
        </div>
    );
}

/** 顯示各頁共用的科目篩選按鈕。 */
export function SubjectFilter({ subjects, value, multiple = false, className = "", onChange }: SubjectFilterProps) {
    const options: { value: Subject | "全部"; label: string }[] = [
        { value: "全部", label: "全部" },
        ...subjects.map((subject) => ({ value: subject, label: subject })),
    ];
    const selected = normalizeQuestionFilterSelection(value, "全部") as Subject[];

    function selectSubject(subject: Subject | "全部") {
        if (!multiple) {
            onChange(subject);
            return;
        }
        if (subject === "全部") {
            onChange([]);
            return;
        }
        onChange(selected.includes(subject)
            ? selected.filter((item) => item !== subject)
            : [...selected, subject]);
    }

    return (
        <fieldset className={`subject-filter grid gap-2 ${className}`.trim()}>
            <legend><span className="practice-field-label field-dot-violet"><Library aria-hidden="true" />科目</span></legend>
            <div className="subject-filter-options">
                {options.map((option) => (
                    <button
                        aria-pressed={option.value === "全部" ? selected.length === 0 : selected.includes(option.value)}
                        className="plan-choice plan-subject-choice"
                        data-selected={option.value === "全部" ? selected.length === 0 : selected.includes(option.value)}
                        key={option.value}
                        onClick={() => selectSubject(option.value)}
                        type="button"
                    >
                        <span className="text-sm font-semibold">{option.label}</span>
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

/** 顯示題目總覽與錯題排行榜共用的完整題目篩選。 */
export function QuestionFilterPanel({
    idPrefix,
    subjects,
    questions,
    grade,
    preferredVersions,
    preferredSemester,
    collections,
    value,
    expanded,
    disabledFields = {},
    children,
    onChange,
    onExpandedChange,
    onReset,
    resetLabel = "清除篩選",
    multiSelectCatalogFields = false,
}: QuestionFilterPanelProps) {
    const options = useMemo(
        () => getQuestionFilterOptions(questions, value, collections),
        [collections, questions, value],
    );
    const activeFilterCount = [
        normalizeQuestionFilterSelection(value.subject, "全部").length > 0,
        value.semester !== ALL_QUESTION_FILTERS,
        value.version !== ALL_QUESTION_FILTERS,
        normalizeQuestionFilterSelection(value.scope, ALL_UNITS).length > 0,
        normalizeQuestionFilterSelection(value.topic).length > 0,
        normalizeQuestionFilterSelection(value.knowledge).length > 0,
        normalizeQuestionFilterSelection(value.difficulty).length > 0,
        normalizeQuestionFilterSelection(value.kind).length > 0,
        normalizeQuestionFilterSelection(value.source).length > 0,
        normalizeQuestionFilterSelection(value.creator).length > 0,
        Object.values(value.metadata).some((item) => normalizeQuestionFilterSelection(item).length > 0),
        normalizeQuestionFilterSelection(value.collection).length > 0,
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
            const selectedSubjects = normalizeQuestionFilterSelection(subject, "全部") as Subject[];
            const singleSubject = selectedSubjects.length === 1 ? selectedSubjects[0] : undefined;
            const semester = singleSubject
                ? getPreferredQuestionSemester(questions, singleSubject, preferredSemester)
                : value.semester;
            const preferredVersion = singleSubject ? preferredVersions[singleSubject] : undefined;
            const version = preferredVersion && questions.some((question) => (
                question.subject === singleSubject
                && (semester === ALL_QUESTION_FILTERS || question.semester === semester)
                && question.bookVersion === preferredVersion
            ))
                ? preferredVersion
                : ALL_QUESTION_FILTERS;
            onChange({
                ...value,
                subject,
                semester,
                version,
                scope: [],
                topic: multiSelectCatalogFields ? [] : ALL_QUESTION_FILTERS,
                knowledge: multiSelectCatalogFields ? [] : ALL_QUESTION_FILTERS,
                difficulty: [],
                kind: [],
                source: [],
                creator: multiSelectCatalogFields ? [] : ALL_QUESTION_FILTERS,
                metadata: {},
                collection: value.collection,
            });
            return;
        }

        onChange(normalizeQuestionFilters({ ...value, [field]: nextValue }, questions, collections));
    }

    return (
        <section className="question-filter-panel" aria-labelledby={`${idPrefix}-filter-title`}>
            <div className="question-filter-heading">
                <div>
                    <h3 id={`${idPrefix}-filter-title`}>篩選題目</h3>
                </div>
                <div className="question-filter-heading-actions">
                    {activeFilterCount > 0 && <span>{activeFilterCount} 個條件</span>}
                    <Button appearance="ghost" tone="muted" size="sm" onClick={onReset}><RotateCcw />{resetLabel}</Button>
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
            <SubjectFilter className="question-filter-subject" subjects={subjects} value={value.subject} multiple={multiSelectCatalogFields} onChange={(subject) => updateFilter("subject", subject)} />
            <div className="question-filter-grid question-filter-core">
                <FormField label="學期"><NativeSelect disabled={disabledFields.semester} options={options.semesters} value={value.semester} onChange={(event) => updateFilter("semester", event.target.value)} /></FormField>
                <FormField label="版本"><NativeSelect disabled={disabledFields.version || !options.showVersion} options={options.versions} value={value.version} onChange={(event) => updateFilter("version", event.target.value)} /></FormField>
                <MultiSelectFilter id={`${idPrefix}-source`} label="來源" disabled={disabledFields.source} options={options.sources} value={value.source} onChange={(next) => updateFilter("source", next)} />
                <MultiSelectFilter id={`${idPrefix}-scope`} label="單元" disabled={disabledFields.scope} options={options.scopes} value={value.scope} onChange={(next) => updateFilter("scope", next)} />
            </div>
            {expanded && <div className="question-filter-grid" id={contentId}>
                {options.showTopic && (multiSelectCatalogFields
                    ? <MultiSelectFilter id={`${idPrefix}-topic`} label="主題" disabled={disabledFields.topic} options={options.topics.filter((option) => option.value !== ALL_QUESTION_FILTERS)} value={normalizeQuestionFilterSelection(value.topic)} onChange={(next) => updateFilter("topic", next)} />
                    : <FormField label="主題"><NativeSelect disabled={disabledFields.topic} options={options.topics} value={value.topic as string} onChange={(event) => updateFilter("topic", event.target.value)} /></FormField>)}
                {options.showKnowledge && (multiSelectCatalogFields
                    ? <MultiSelectFilter id={`${idPrefix}-knowledge`} label="知識點" disabled={disabledFields.knowledge} options={options.knowledge.filter((option) => option.value !== ALL_QUESTION_FILTERS)} value={normalizeQuestionFilterSelection(value.knowledge)} onChange={(next) => updateFilter("knowledge", next)} />
                    : <FormField label="知識點"><NativeSelect disabled={disabledFields.knowledge} options={options.knowledge} value={value.knowledge as string} onChange={(event) => updateFilter("knowledge", event.target.value)} /></FormField>)}
                <MultiSelectFilter id={`${idPrefix}-difficulty`} label="難易度" disabled={disabledFields.difficulty} options={options.difficulties} value={value.difficulty} onChange={(next) => updateFilter("difficulty", next)} />
                <MultiSelectFilter id={`${idPrefix}-kind`} label="題型" disabled={disabledFields.kind} options={options.kinds} value={value.kind} onChange={(next) => updateFilter("kind", next)} />
                {options.creators.length > 1 && (multiSelectCatalogFields
                    ? <MultiSelectFilter id={`${idPrefix}-creator`} label="建立者" disabled={disabledFields.creator} options={options.creators.filter((option) => option.value !== ALL_QUESTION_FILTERS)} value={normalizeQuestionFilterSelection(value.creator)} onChange={(next) => updateFilter("creator", next)} />
                    : <FormField label="建立者"><NativeSelect disabled={disabledFields.creator} options={options.creators} value={value.creator as string} onChange={(event) => updateFilter("creator", event.target.value)} /></FormField>)}
                {options.facets.map((facet) => multiSelectCatalogFields
                    ? <MultiSelectFilter id={`${idPrefix}-metadata-${facet.key}`} label={facet.label} key={facet.key} disabled={disabledFields.metadata} options={facet.options.filter((option) => option.value !== ALL_QUESTION_FILTERS)} value={normalizeQuestionFilterSelection(value.metadata[facet.key])} onChange={(next) => updateFilter("metadata", { ...value.metadata, [facet.key]: next })} />
                    : <FormField label={facet.label} key={facet.key}><NativeSelect disabled={disabledFields.metadata} options={facet.options} value={(value.metadata[facet.key] as string) ?? ALL_QUESTION_FILTERS} onChange={(event) => updateFilter("metadata", { ...value.metadata, [facet.key]: event.target.value })} /></FormField>)}
                {multiSelectCatalogFields
                    ? <MultiSelectFilter id={`${idPrefix}-collection`} label="收藏清單" disabled={disabledFields.collection} options={options.collections.filter((option) => option.value !== ALL_QUESTION_FILTERS)} value={normalizeQuestionFilterSelection(value.collection)} onChange={(next) => updateFilter("collection", next)} />
                    : <FormField label="收藏清單"><NativeSelect disabled={disabledFields.collection} options={options.collections} value={value.collection as string} onChange={(event) => updateFilter("collection", event.target.value)} /></FormField>}
                <FormField className="question-filter-search-field" label="搜尋">
                    <div className="question-search"><Search aria-hidden="true" /><Input disabled={disabledFields.search} aria-label="搜尋編號或題目" value={value.search} placeholder="搜尋編號或題目" onChange={(event) => updateFilter("search", event.target.value)} /></div>
                </FormField>
                {children && <div className="question-filter-extra">{children}</div>}
            </div>}
        </section>
    );
}
