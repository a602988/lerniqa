"use client";

import {
    Button,
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@keel-design/ui";
import { ArrowLeft, ArrowRight, Camera, Check, Copy, Eye, FileJson, FileText, FolderOpen, LayoutTemplate, LoaderCircle, Plus, Save, ScanLine, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppSelect } from "@/app/components/app-select";
import { LerniqaLogo } from "@/app/components/lerniqa-mark";
import { useAppRouter } from "@/app/components/navigation-feedback";
import { PersistedContentBlocks, PersistedQuestionFields, PersistedQuestionPromptContent } from "@/app/components/persisted-question-fields";
import type {
    ImportAnswerMode,
    ImportContentBlock,
    ImportGradingPolicy,
    ImportPartDraft,
    ImportQuestionClassification,
    ImportQuestionDraft,
    QuestionDraftPackage,
    QuestionImportPackage,
} from "@/app/lib/question-import-contract";
import { parseQuestionDraftPackage } from "@/app/lib/question-import-contract";
import {
    createQuestionExchangePrompt,
    createQuestionExchangeTemplate,
    listQuestionExchangeAssets,
    parseQuestionExchangePackage,
    resolveQuestionExchangePackage,
    type QuestionExchangeAsset,
    type QuestionExchangePackage,
} from "@/app/lib/question-exchange-contract";
import {
    createQuestionFromTemplate,
    getQuestionTemplate,
    inferQuestionTemplate,
    QUESTION_TEMPLATE_IDS,
    replaceQuestionTemplate,
} from "@/app/lib/question-authoring-templates";
import type { QuestionTemplateDefinition, QuestionTemplateId } from "@/app/lib/question-authoring-templates";
import type { LocalPracticeContentBlock, LocalPracticeQuestion } from "@/app/lib/local-practice-types";
import { invalidatePersistedPracticeCatalog } from "@/app/lib/practice-client";
import { QUESTION_SOURCE_ROLE_LABELS, type QuestionSourceRole, type QuestionSourceRoleSource } from "@/app/lib/question-source-role";
import { FileSourcePicker } from "./file-source-picker";
import { QuestionTemplateSelector } from "./question-template-selector";
import { RichContentEditor } from "./rich-content-editor";
import styles from "./question-import.module.css";

type CatalogItem = { id: string; code: string | null; name: string };
type CurriculumUnit = CatalogItem & {
    subjectId: string;
    gradeId: string | null;
    semesterId: string | null;
    bookVersionId: string | null;
    parentUnitId: string | null;
    unitType: string;
};
type CatalogSuggestion = {
    subjectId: string;
    subjectName: string;
    gradeId: string | null;
    gradeName: string | null;
    semesterId: string | null;
    semesterName: string | null;
    bookVersionId: string | null;
    bookVersionName: string | null;
    unitId: string;
    unitName: string;
};
type ClassificationOption = { id: string; label: string; value: string; sortOrder: number };
type ClassificationField = {
    id: string;
    name: string;
    selectionMode: "single" | "multiple";
    subjectIds: string[];
    options: ClassificationOption[];
};
type ClassificationSuggestion = ImportQuestionClassification & { draftKey: string; confidence: number; reason: string };
type Catalog = {
    subjects: CatalogItem[];
    grades: CatalogItem[];
    semesters: CatalogItem[];
    bookVersions: Array<CatalogItem & { subjectId: string; gradeId: string }>;
    curriculumUnits: CurriculumUnit[];
    difficulties: CatalogItem[];
    sourceCategories: CatalogItem[];
    questionTypes: CatalogItem[];
    classificationFields: ClassificationField[];
};
type Learner = { id: string; displayName: string; gradeCode: string | null; semesterCode: string | null };
type ScanPage = {
    documentPosition?: number;
    fileName?: string;
    page: number;
    ocrText: string;
    role?: Exclude<QuestionSourceRole, "auto">;
    sourceDocumentId?: string;
    warnings: string[];
    files: Record<string, { assetId: string; url: string }>;
};
type EditorPart = ImportPartDraft & { uid: string };
type EditorQuestion = Omit<ImportQuestionDraft, "parts"> & {
    uid: string;
    parts: EditorPart[];
};
type PersistDraftOptions = {
    batchId?: string | null;
    idempotencyKey?: string;
    questions?: EditorQuestion[];
    title?: string;
};
type QuestionDraftSourceAsset = {
    fileName: string;
    id: string;
    mimeType: string;
    position: number;
    role: QuestionSourceRole;
    roleConfidence: number | null;
    roleReason: string | null;
    roleSource: QuestionSourceRoleSource;
    sourceDocumentId: string;
    url: string;
};
type QuestionDraftRecord = QuestionDraftPackage & {
    batchId: string;
    createdAt: string;
    idempotencyKey: string;
    inputType: "image" | "pdf" | "text";
    learnerId: string;
    sourceAssets: QuestionDraftSourceAsset[];
    status: "draft" | "recognizing" | "review" | "failed";
};
type WorkspaceTab = "drafts" | "editor" | "scan" | "json";

const QUESTION_AUTHORING_PATHS = {
    drafts: "/questions/drafts",
    edit: "/questions/new/edit",
    import: "/questions/new/import",
    upload: "/questions/new/upload",
} as const;

/**
 * 由目前網址決定題目工作台要顯示的畫面。
 *
 * @param pathname 瀏覽器目前路徑。
 * @returns 對應的工作台頁籤與草稿識別碼。
 */
function resolveWorkspaceRoute(pathname: string): { draftId: string | null; tab: WorkspaceTab } {
    const draftPrefix = `${QUESTION_AUTHORING_PATHS.drafts}/`;
    if (pathname.startsWith(draftPrefix)) {
        return { draftId: pathname.slice(draftPrefix.length), tab: "editor" };
    }
    if (pathname === QUESTION_AUTHORING_PATHS.drafts) return { draftId: null, tab: "drafts" };
    if (pathname === QUESTION_AUTHORING_PATHS.import) return { draftId: null, tab: "json" };
    if (pathname === QUESTION_AUTHORING_PATHS.edit) return { draftId: null, tab: "editor" };
    return { draftId: null, tab: "scan" };
}

/**
 * 建立可直接開啟指定草稿的網址。
 *
 * @param batchId 草稿批次識別碼。
 * @returns 草稿編輯頁路徑。
 */
function getDraftPath(batchId: string): string {
    return `${QUESTION_AUTHORING_PATHS.drafts}/${encodeURIComponent(batchId)}`;
}
type AnswerSuggestion = {
    answers: string[];
    confidence: number;
    evidence: { page: number; sourceDocumentId: string } | null;
    explanation: string;
    partStableKey: string;
    questionDraftKey: string;
};
type AnswerAnalysisState =
    | { kind: "idle" }
    | { key: string; kind: "running"; message: string }
    | { key: string; kind: "success"; message: string }
    | { key: string; kind: "empty"; message: string }
    | { key: string; kind: "error"; message: string };
type SourceAnalysisState = {
    batchId: string;
    errorCode: string | null;
    result: {
        answerSuggestionError: string | null;
        answerSuggestions: AnswerSuggestion[];
        catalogSuggestion: CatalogSuggestion | null;
        pages: ScanPage[];
    } | null;
    status: "queued" | "retry" | "running" | "completed" | "failed";
};
type PendingSource = { file: File; id: string; role: QuestionSourceRole };

const ANSWER_LABELS: Record<ImportAnswerMode, string> = {
    single_choice: "單選",
    multiple_choice: "複選",
    boolean: "是非",
    text: "文字作答",
};
const ANSWER_OPTIONS = Object.entries(ANSWER_LABELS).map(([value, label]) => ({ label, value }));
const GRADING_LABELS: Record<ImportGradingPolicy, string> = {
    manual_review: "人工批改",
    ai_assisted_review: "AI 輔助批改",
    automatic: "自動判分",
};
const GRADING_OPTIONS = Object.entries(GRADING_LABELS).map(([value, label]) => ({ label, value }));
const SOURCE_ROLE_OPTIONS = Object.entries(QUESTION_SOURCE_ROLE_LABELS).map(([value, label]) => ({ label, value }));
const DRAFT_STATUS_LABELS: Record<QuestionDraftRecord["status"], string> = {
    draft: "處理中",
    recognizing: "處理中",
    review: "可編輯",
    failed: "分析失敗",
};

function DraftDeleteDialog({
    busy,
    draft,
    onDelete,
}: {
    busy: boolean;
    draft: QuestionDraftRecord;
    onDelete: (target: QuestionDraftRecord) => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    function handleOpenChange(nextOpen: boolean) {
        if (busy) return;
        setOpen(nextOpen);
        if (!nextOpen) setDeleteError("");
    }

    async function confirmDelete() {
        setDeleteError("");
        try {
            await onDelete(draft);
        }
        catch (reason) {
            setDeleteError(reason instanceof Error ? reason.message : "題目草稿刪除失敗。");
        }
    }

    return <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
            <button
                className={styles.iconButton}
                type="button"
                aria-label={`刪除草稿 ${draft.sourceTitle}`}
                disabled={busy || draft.status === "recognizing"}
            >
                <Trash2 />
            </button>
        </DialogTrigger>
        <DialogContent size="sm" closeLabel="關閉刪除草稿視窗">
            <DialogHeader>
                <DialogTitle>刪除草稿</DialogTitle>
                <DialogDescription>刪除後無法復原，原始檔與尚未加入題庫的內容也會一併移除。</DialogDescription>
            </DialogHeader>
            <DialogBody>
                <p className={styles.deleteDraftSummary}>確定要刪除「<strong>{draft.sourceTitle}</strong>」嗎？</p>
                {deleteError && <p className={styles.deleteDraftError} role="alert">{deleteError}</p>}
            </DialogBody>
            <DialogFooter>
                <DialogClose asChild>
                    <Button appearance="outline" disabled={busy} type="button">取消</Button>
                </DialogClose>
                <Button disabled={busy} tone="danger" type="button" onClick={() => void confirmDelete()}>
                    {busy ? "刪除中…" : "刪除草稿"}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>;
}

function SourceAssetDialog({ sourceAsset }: { sourceAsset: QuestionDraftSourceAsset }) {
    const isImage = sourceAsset.mimeType.startsWith("image/");

    return <Dialog>
        <DialogTrigger asChild>
            <button
                className={styles.sourceAssetTrigger}
                type="button"
                aria-label={isImage ? `查看上傳的圖片：${sourceAsset.fileName}` : `查看上傳的檔案：${sourceAsset.fileName}`}
            >
                {isImage
                    ? <img src={sourceAsset.url} alt="" />
                    : <span><FileText /><strong>PDF</strong></span>}
            </button>
        </DialogTrigger>
        <DialogContent size="xl" fullscreen="sm" scrollable closeLabel="關閉原始檔預覽">
            <DialogHeader>
                <DialogTitle>上傳的原始檔</DialogTitle>
                <DialogDescription>{sourceAsset.fileName} · {QUESTION_SOURCE_ROLE_LABELS[sourceAsset.role]}</DialogDescription>
            </DialogHeader>
            <DialogBody className={styles.sourceAssetDialogBody}>
                {isImage
                    ? <img src={sourceAsset.url} alt={`上傳的原始圖片：${sourceAsset.fileName}`} className={styles.sourceAssetDialogImage} />
                    : <iframe src={sourceAsset.url} title={`上傳的 PDF：${sourceAsset.fileName}`} className={styles.sourceAssetDialogPdf} />}
            </DialogBody>
            <DialogFooter>
                <Button appearance="outline" asChild>
                    <a href={sourceAsset.url} target="_blank" rel="noreferrer">另開原始檔</a>
                </Button>
                <DialogClose asChild>
                    <Button type="button">關閉</Button>
                </DialogClose>
            </DialogFooter>
        </DialogContent>
    </Dialog>;
}

function uid() {
    return crypto.randomUUID();
}

function blankPart(index: number): EditorPart {
    return {
        uid: uid(), stableKey: `part-${index + 1}`, parentStableKey: null,
        prompt: [], hints: [], explanation: [{ kind: "text", text: "" }], answerMode: "text", answerFieldCount: 1,
        gradingPolicy: "manual_review", options: [], answers: [],
    };
}

function blankQuestion(): EditorQuestion {
    return {
        uid: uid(), draftKey: uid(), classifications: [], sourceQuestionNumber: null, sourcePage: null, sharedPrompt: [],
        parts: [blankPart(0)],
    };
}

function nextPartKey(parts: EditorPart[]): string {
    const used = new Set(parts.map((part) => part.stableKey));
    let index = parts.length + 1;
    while (used.has(`part-${index}`)) index += 1;
    return `part-${index}`;
}

function cleanBlocks(blocks: ImportContentBlock[]): ImportContentBlock[] {
    return blocks.flatMap((block): ImportContentBlock[] => {
        if (block.kind === "text") {
            const text = block.text.trim();
            return text ? [{ kind: "text", text }] : [];
        }
        if (block.kind === "formula") {
            const tex = block.tex.trim();
            return tex ? [{ kind: "formula", tex }] : [];
        }
        if (block.kind === "table") {
            const rows = block.rows.map((row) => row.map((cell) => cell.trim()));
            return rows.some((row) => row.some(Boolean)) ? [{ kind: "table", rows }] : [];
        }
        const alt = block.alt.trim();
        return alt ? [{ ...block, alt }] : [];
    });
}

function toQuestion(question: EditorQuestion): ImportQuestionDraft {
    return {
        draftKey: question.draftKey,
        classifications: question.classifications,
        sourceQuestionNumber: question.sourceQuestionNumber,
        sourcePage: question.sourcePage,
        sharedPrompt: cleanBlocks(question.sharedPrompt),
        parts: question.parts.map((part) => ({
            stableKey: part.stableKey,
            parentStableKey: part.parentStableKey,
            prompt: cleanBlocks(part.prompt),
            answerMode: part.answerMode,
            answerFieldCount: part.answerFieldCount,
            gradingPolicy: part.gradingPolicy,
            options: part.options.map((option) => ({ ...option, blocks: cleanBlocks(option.blocks) })),
            answers: part.answers,
            hints: part.hints.map(cleanBlocks).filter((hint) => hint.length > 0),
            explanation: cleanBlocks(part.explanation),
        })),
    };
}

function toEditorQuestion(question: ImportQuestionDraft, stableId?: string): EditorQuestion {
    return {
        uid: stableId ?? uid(),
        draftKey: question.draftKey,
        classifications: question.classifications,
        sourceQuestionNumber: question.sourceQuestionNumber,
        sourcePage: question.sourcePage,
        sharedPrompt: question.sharedPrompt,
        parts: question.parts.map((part) => ({
            ...part,
            uid: stableId ? `${stableId}-${part.stableKey}` : uid(),
            hints: part.hints ?? [],
        })),
    };
}

function createTemplatePreview(templateId: QuestionTemplateId, scope: string): EditorQuestion {
    const stableId = `${scope}-${templateId}`;
    const question = createQuestionFromTemplate(templateId, () => stableId);
    return toEditorQuestion(question, stableId);
}

function toPreviewBlock(block: ImportContentBlock, id: string, position: number): LocalPracticeContentBlock {
    if (block.kind === "image" || block.kind === "page_crop") {
        return {
            id,
            contentType: block.kind,
            position,
            text: null,
            altText: block.alt,
            asset: {
                id: block.assetId,
                mimeType: "image/*",
                width: null,
                height: null,
                url: `/api/v1/question-import-assets/${block.assetId}`,
            },
        };
    }
    const text = block.kind === "formula" ? block.tex : block.kind === "table"
        ? block.rows.map((row) => row.join("\t")).join("\n")
        : block.text;
    return { id, contentType: block.kind, position, text, altText: null, asset: null };
}

function toPreviewQuestion(
    question: EditorQuestion,
    previewOptionImages?: QuestionTemplateDefinition["previewOptionImages"],
): LocalPracticeQuestion {
    const draft = toQuestion(question);
    const placeholder = { id: "preview", code: null, name: "未分類" };
    const promptBlocks = draft.sharedPrompt.map((block, index) => toPreviewBlock(block, `${question.uid}-prompt-${index}`, index));
    const prompt = draft.sharedPrompt.filter((block) => block.kind === "text").map((block) => block.text).join("\n");
    return {
        id: question.uid,
        revisionId: question.uid,
        revisionNumber: 1,
        code: null,
        type: placeholder,
        originalTypeLabel: null,
        grade: placeholder,
        subject: placeholder,
        semester: null,
        publisher: null,
        bookVersion: placeholder,
        unit: { ...placeholder, unitType: "preview" },
        difficulty: null,
        sourceCategory: null,
        prompt,
        promptBlocks,
        parts: draft.parts.map((part, partIndex) => {
            const partId = `${question.uid}-${part.stableKey}`;
            const promptBlocks = part.prompt.map((block, blockIndex) => toPreviewBlock(block, `${partId}-prompt-${blockIndex}`, blockIndex));
            return {
                id: partId,
                stableKey: part.stableKey,
                position: partIndex,
                answerMode: part.answerMode,
                answerFieldCount: part.answerFieldCount,
                gradingPolicy: part.gradingPolicy,
                isIndependentlyGradable: true,
                prompt: part.prompt.filter((block) => block.kind === "text").map((block) => block.text).join("\n"),
                promptBlocks,
                hints: part.hints.map((hint, hintIndex) => ({
                    position: hintIndex,
                    blocks: hint.map((block, blockIndex) => toPreviewBlock(block, `${partId}-hint-${hintIndex}-${blockIndex}`, blockIndex)),
                })),
                options: part.options.map((option, optionIndex) => {
                    const previewImage = previewOptionImages?.[option.key];
                    const label = option.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n");
                    const contentBlocks = previewImage
                        ? [{
                            id: `${partId}-option-${optionIndex}-preview-image`,
                            contentType: "image" as const,
                            position: 0,
                            text: null,
                            altText: previewImage.alt,
                            asset: {
                                id: `${partId}-option-${optionIndex}-preview-image`,
                                mimeType: "image/svg+xml",
                                width: 320,
                                height: 180,
                                url: previewImage.src,
                            },
                        }]
                        : option.blocks.map((block, blockIndex) => toPreviewBlock(block, `${partId}-option-${optionIndex}-${blockIndex}`, blockIndex));
                    return {
                        id: `${partId}-option-${option.key}`,
                        key: option.key,
                        position: optionIndex,
                        label: previewImage?.label ?? label,
                        contentBlocks,
                    };
                }),
            };
        }),
    };
}

function QuestionSolutionPreview({
    question,
    previewOptionImages,
}: {
    question: EditorQuestion;
    previewOptionImages?: QuestionTemplateDefinition["previewOptionImages"];
}) {
    const draft = toQuestion(question);
    return <section className={styles.previewSolution}><h3>解答與解析</h3>{draft.parts.map((part, partIndex) => {
        const answerLabels = part.answerMode === "text"
            ? part.answers
            : part.answers.map((answer) => {
                const option = part.options.find((candidate) => candidate.key === answer);
                const text = option?.blocks.filter((block) => block.kind === "text").map((block) => block.text).join(" ").trim();
                return previewOptionImages?.[answer]?.label ?? (text || `選項 ${answer}`);
            });
        const explanation = part.explanation.map((block, blockIndex) => toPreviewBlock(block, `${question.uid}-solution-${partIndex}-${blockIndex}`, blockIndex));
        return <article key={part.stableKey}>{draft.parts.length > 1 && <strong>小題 {partIndex + 1}</strong>}<p>參考答案：{answerLabels.join("、") || "未設定"}</p><PersistedContentBlocks blocks={explanation} /></article>;
    })}</section>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
        window.location.assign("/account");
        throw new Error("登入狀態已失效，正在返回登入頁。");
    }
    if (!response.ok) throw new Error(body.error?.message ?? "服務暫時無法完成操作。");
    return body.data as T;
}

export function QuestionImportWorkspace() {
    const router = useAppRouter();
    const pathname = usePathname();
    const route = useMemo(() => resolveWorkspaceRoute(pathname), [pathname]);
    const tab = route.tab;
    const isDraftRoute = pathname === QUESTION_AUTHORING_PATHS.drafts || pathname.startsWith(`${QUESTION_AUTHORING_PATHS.drafts}/`);
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [learners, setLearners] = useState<Learner[]>([]);
    const [drafts, setDrafts] = useState<QuestionDraftRecord[]>([]);
    const [draftsLoaded, setDraftsLoaded] = useState(false);
    const [learnerId, setLearnerId] = useState("");
    const [catalogIds, setCatalogIds] = useState({ subjectId: "", gradeId: "", semesterId: "", bookVersionId: "", curriculumUnitId: "", difficultyLevelId: "", sourceCategoryId: "", questionTypeId: "" });
    const [questions, setQuestions] = useState<EditorQuestion[]>([]);
    const [editorIndex, setEditorIndex] = useState(0);
    const [sourceTitle, setSourceTitle] = useState("自行新增題目");
    const [sourceBatchId, setSourceBatchId] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState(uid());
    const [scanPages, setScanPages] = useState<ScanPage[]>([]);
    const [jsonText, setJsonText] = useState("");
    const [formatTemplateIds, setFormatTemplateIds] = useState<QuestionTemplateId[]>([...QUESTION_TEMPLATE_IDS]);
    const [formatPreviewTemplateId, setFormatPreviewTemplateId] = useState<QuestionTemplateId>("single-choice");
    const [exchangePackage, setExchangePackage] = useState<QuestionExchangePackage | null>(null);
    const [exchangeAssets, setExchangeAssets] = useState<Record<string, string>>({});
    const [exchangeSources, setExchangeSources] = useState<Record<string, ScanPage[]>>({});
    const [exchangeSourceModes, setExchangeSourceModes] = useState<Record<string, string>>({});
    const [exchangeRects, setExchangeRects] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewAnswer, setPreviewAnswer] = useState("");
    const [previewSolutionOpen, setPreviewSolutionOpen] = useState(false);
    const [templateOpen, setTemplateOpen] = useState(false);
    const [templateId, setTemplateId] = useState<QuestionTemplateId>("single-choice");
    const [templateTarget, setTemplateTarget] = useState<number | null>(null);
    const [templateAnswer, setTemplateAnswer] = useState("");
    const [templateSolutionOpen, setTemplateSolutionOpen] = useState(false);
    const [publishOpen, setPublishOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [newSubjectName, setNewSubjectName] = useState("");
    const [newFieldName, setNewFieldName] = useState("");
    const [newFieldMode, setNewFieldMode] = useState<"single" | "multiple">("single");
    const [newOptionNames, setNewOptionNames] = useState<Record<string, string>>({});
    const [suggestions, setSuggestions] = useState<ClassificationSuggestion[]>([]);
    const [answerSuggestions, setAnswerSuggestions] = useState<AnswerSuggestion[]>([]);
    const [answerAnalysisState, setAnswerAnalysisState] = useState<AnswerAnalysisState>({ kind: "idle" });
    const [pendingSources, setPendingSources] = useState<PendingSource[]>([]);
    const [sourceRoles, setSourceRoles] = useState<Record<string, QuestionSourceRole>>({});
    const loadedRouteDraftId = useRef<string | null>(null);

    useEffect(() => {
        Promise.all([
            api<Catalog>("/api/v1/question-imports"),
            api<{ account: { learner: Learner; learners: Learner[] } }>("/api/v1/auth/me"),
            api<QuestionDraftRecord[]>("/api/v1/question-imports/drafts"),
        ]).then(([nextCatalog, auth, nextDrafts]) => {
            setCatalog(nextCatalog);
            setLearners(auth.account.learners);
            setLearnerId(auth.account.learner.id);
            setCatalogIds({
                subjectId: "", gradeId: "", semesterId: "", bookVersionId: "", curriculumUnitId: "",
                difficultyLevelId: "", sourceCategoryId: "", questionTypeId: "",
            });
            setDrafts(nextDrafts);
            setDraftsLoaded(true);
        }).catch((reason) => setError(reason instanceof Error ? reason.message : "載入失敗。"));
    }, []);

    const versions = useMemo(() => catalog?.bookVersions.filter((item) => item.subjectId === catalogIds.subjectId && item.gradeId === catalogIds.gradeId) ?? [], [catalog, catalogIds.gradeId, catalogIds.subjectId]);
    const curriculumUnits = useMemo(() => catalog?.curriculumUnits.filter((item) => item.subjectId === catalogIds.subjectId
        && (!catalogIds.gradeId || !item.gradeId || item.gradeId === catalogIds.gradeId)
        && (!catalogIds.semesterId || !item.semesterId || item.semesterId === catalogIds.semesterId)
        && (!catalogIds.bookVersionId || !item.bookVersionId || item.bookVersionId === catalogIds.bookVersionId)) ?? [], [catalog, catalogIds]);
    const classificationFields = useMemo(() => catalog?.classificationFields.filter((field) => field.subjectIds.includes(catalogIds.subjectId)) ?? [], [catalog, catalogIds.subjectId]);
    const previewEditorQuestion = questions[Math.min(previewIndex, questions.length - 1)] ?? null;
    const previewQuestion = useMemo(() => previewEditorQuestion ? toPreviewQuestion(previewEditorQuestion) : null, [previewEditorQuestion]);
    const templateDefinition = getQuestionTemplate(templateId);
    const templateEditorQuestion = useMemo(() => createTemplatePreview(templateId, "template-preview"), [templateId]);
    const templatePreviewQuestion = useMemo(
        () => toPreviewQuestion(templateEditorQuestion, templateDefinition.previewOptionImages),
        [templateDefinition.previewOptionImages, templateEditorQuestion],
    );
    const formatTemplateDefinition = getQuestionTemplate(formatPreviewTemplateId);
    const formatTemplateEditorQuestion = useMemo(() => createTemplatePreview(formatPreviewTemplateId, "format-preview"), [formatPreviewTemplateId]);
    const formatTemplatePreviewQuestion = useMemo(
        () => toPreviewQuestion(formatTemplateEditorQuestion, formatTemplateDefinition.previewOptionImages),
        [formatTemplateDefinition.previewOptionImages, formatTemplateEditorQuestion],
    );
    const pendingExchangeAssets = useMemo(() => exchangePackage ? listQuestionExchangeAssets(exchangePackage) : [], [exchangePackage]);
    const activeDraft = useMemo(() => drafts.find((draft) => draft.batchId === sourceBatchId) ?? null, [drafts, sourceBatchId]);
    const editorPath = sourceBatchId ? getDraftPath(sourceBatchId) : QUESTION_AUTHORING_PATHS.edit;
    const draftProcessing = activeDraft?.status === "draft" || activeDraft?.status === "recognizing";
    const draftStatusMessage = activeDraft?.status === "draft"
        ? "已排入背景分析，可以離開這個畫面。"
        : activeDraft?.status === "recognizing"
            ? "正在背景分析，可以離開並稍後返回。"
            : activeDraft?.status === "failed"
                ? "分析失敗，原始檔仍保留。"
                : activeDraft
                    ? "這份草稿已存入你的清單。"
                    : sourceBatchId
                        ? "原始檔已保留，正在建立背景工作。"
                        : "尚未儲存。題目不需要先選科目、年級或題庫。";
    const sourceAppendMessage = (activeDraft?.sourceAssets.length ?? 0) >= 20
        ? "已達每份草稿 20 個檔案的上限"
        : draftProcessing
            ? "背景分析完成後即可繼續新增檔案"
            : "可一次新增多張圖片或 PDF，新增後會重新分析整份草稿";
    const sourceSummaryMessage = [
        sourceAppendMessage,
        ...(scanPages.length > 0 ? ["掃描影像已套用透視校正、展平與去除手寫預覽，OCR 內容可能有誤，請對照原圖校正"] : []),
        draftStatusMessage.replace(/。$/u, ""),
    ].join("；");
    useEffect(() => {
        if (!drafts.some((draft) => draft.status === "draft" || draft.status === "recognizing")) return;
        const timer = window.setInterval(() => void refreshDrafts(), 3_000);
        return () => window.clearInterval(timer);
    }, [drafts, questions.length, sourceBatchId]);
    const activeEditorIndex = Math.min(editorIndex, Math.max(questions.length - 1, 0));
    const editorProgress = questions.length > 0 ? ((activeEditorIndex + 1) / questions.length) * 100 : 0;

    useEffect(() => {
        if (!draftsLoaded || !route.draftId || loadedRouteDraftId.current === route.draftId) return;
        const draft = drafts.find((candidate) => candidate.batchId === route.draftId);
        if (!draft) {
            setError("找不到指定草稿，草稿可能已被刪除。");
            return;
        }
        loadedRouteDraftId.current = route.draftId;
        void openDraft(draft);
    }, [drafts, draftsLoaded, route.draftId]);

    function draftPackage(nextQuestions = questions, nextTitle = sourceTitle): QuestionDraftPackage {
        return { schemaVersion: 2, sourceTitle: nextTitle, questions: nextQuestions.map(toQuestion) };
    }

    async function refreshDrafts() {
        const nextDrafts = await api<QuestionDraftRecord[]>("/api/v1/question-imports/drafts");
        setDrafts(nextDrafts);
        const active = nextDrafts.find((draft) => draft.batchId === sourceBatchId);
        if (!active) return;
        if (active.status === "draft") setStatus("已排入背景分析，可以離開這個畫面。完成後會顯示在我的草稿。");
        if (active.status === "recognizing") setStatus("正在背景校正頁面、辨識文字並分析題目。你可以離開這個畫面。");
        if (active.status === "failed") setStatus("");
        if (active.status === "review" && active.questions.length > 0 && questions.length === 0) {
            setQuestions(active.questions.map((question) => toEditorQuestion(question)));
            setEditorIndex(0);
            const analysis = await api<SourceAnalysisState>(`/api/v1/question-imports/${active.batchId}/process`).catch(() => null);
            if (analysis?.result) {
                setScanPages(analysis.result.pages);
                setAnswerSuggestions(analysis.result.answerSuggestions ?? []);
                applyCatalogSuggestion(analysis.result.catalogSuggestion);
            }
            setStatus(analysis?.result?.answerSuggestionError
                ? `背景分析完成，共建立 ${active.questions.length} 題。答案建議未完成，請自行校對或輸入答案。`
                : `背景分析完成，共建立 ${active.questions.length} 題。請逐題校對題幹、圖片與答案建議。`);
        }
    }

    function resetEditor() {
        setQuestions([]);
        setEditorIndex(0);
        setSourceTitle("自行新增題目");
        setSourceBatchId(null);
        setIdempotencyKey(uid());
        setScanPages([]);
        setExchangePackage(null);
        setExchangeAssets({});
        setExchangeSources({});
        setExchangeSourceModes({});
        setExchangeRects({});
        setPreviewIndex(0);
        setPreviewAnswer("");
        setPreviewSolutionOpen(false);
        setTemplateId("single-choice");
        setTemplateTarget(null);
        setTemplateAnswer("");
        setTemplateSolutionOpen(false);
        setTemplateOpen(true);
        setPublishOpen(false);
        setSuggestions([]);
        setAnswerSuggestions([]);
        setAnswerAnalysisState({ kind: "idle" });
        setPendingSources([]);
        setSourceRoles({});
    }

    async function openDraft(draft: QuestionDraftRecord) {
        setSourceBatchId(draft.batchId);
        setIdempotencyKey(draft.idempotencyKey);
        setSourceTitle(draft.sourceTitle);
        setLearnerId(draft.learnerId);
        setQuestions(draft.status === "draft" || draft.status === "recognizing"
            ? []
            : draft.questions.map((question) => toEditorQuestion(question)));
        setEditorIndex(0);
        setScanPages([]);
        setAnswerSuggestions([]);
        setAnswerAnalysisState({ kind: "idle" });
        setSourceRoles(Object.fromEntries(draft.sourceAssets.map((asset) => [asset.sourceDocumentId, asset.role])));
        setPreviewIndex(0);
        setPreviewAnswer("");
        setPreviewSolutionOpen(false);
        setTemplateOpen(false);
        setPublishOpen(false);
        setError("");
        setStatus(draft.status === "draft"
            ? "已排入背景分析，可以離開這個畫面。"
            : draft.status === "recognizing"
                ? "正在背景分析。你可以離開這個畫面，稍後從我的草稿返回。"
                : draft.status === "failed"
                    ? "圖片分析失敗，原始檔仍保留，可重新分析。"
                    : "已開啟草稿，修改後請儲存。");
        if (draft.status === "review") {
            const analysis = await api<SourceAnalysisState>(`/api/v1/question-imports/${draft.batchId}/process`).catch(() => null);
            if (analysis?.result) {
                setScanPages(analysis.result.pages);
                setAnswerSuggestions(analysis.result.answerSuggestions ?? []);
                applyCatalogSuggestion(analysis.result.catalogSuggestion);
                if (analysis.result.answerSuggestionError) {
                    setStatus("已開啟草稿。答案建議未完成，請自行校對或輸入答案。");
                }
            }
        }
    }

    async function persistDraft({
        batchId = sourceBatchId,
        idempotencyKey: nextIdempotencyKey = idempotencyKey,
        questions: nextQuestions = questions,
        title: nextTitle = sourceTitle,
    }: PersistDraftOptions = {}) {
        const draft = draftPackage(nextQuestions, nextTitle);
        const validated = parseQuestionDraftPackage(draft);
        if (!validated.ok) throw new Error(validated.errors[0]?.message ?? "題目草稿未通過檢查。");
        if (batchId) {
            await api<{ saved: true }>(`/api/v1/question-imports/drafts/${batchId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validated.value),
            });
            return batchId;
        }
        const created = await api<{ batchId: string }>("/api/v1/question-imports/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ learnerId, idempotencyKey: nextIdempotencyKey, draft: validated.value }),
        });
        setSourceBatchId(created.batchId);
        return created.batchId;
    }

    async function saveDraft() {
        setBusy(true); setError(""); setStatus("");
        try {
            const batchId = await persistDraft();
            await refreshDrafts();
            loadedRouteDraftId.current = batchId;
            router.replace(getDraftPath(batchId));
            setStatus("草稿已儲存到你的題目清單。尚未加入題庫，也不會出現在正式練習中。");
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "題目草稿儲存失敗。"); }
        finally { setBusy(false); }
    }

    async function deleteDraft(draft: QuestionDraftRecord) {
        setBusy(true); setError("");
        try {
            await api<{ deleted: true }>(`/api/v1/question-imports/drafts/${draft.batchId}`, { method: "DELETE" });
            if (sourceBatchId === draft.batchId) resetEditor();
            await refreshDrafts();
            if (route.draftId === draft.batchId) router.replace(QUESTION_AUTHORING_PATHS.drafts);
            setStatus("草稿已刪除。");
        }
        catch (reason) {
            throw reason instanceof Error ? reason : new Error("題目草稿刪除失敗。");
        }
        finally { setBusy(false); }
    }

    function patchQuestion(questionIndex: number, patch: Partial<EditorQuestion>) {
        setQuestions((current) => current.map((question, index) => index === questionIndex ? { ...question, ...patch } : question));
    }

    function patchClassification(questionIndex: number, field: ClassificationField, optionId: string, checked: boolean) {
        const question = questions[questionIndex]!;
        const current = question.classifications.find((classification) => classification.fieldId === field.id)?.optionIds ?? [];
        const optionIds = field.selectionMode === "single"
            ? checked ? [optionId] : []
            : checked ? [...new Set([...current, optionId])] : current.filter((id) => id !== optionId);
        patchQuestion(questionIndex, {
            classifications: optionIds.length
                ? [...question.classifications.filter((classification) => classification.fieldId !== field.id), { fieldId: field.id, optionIds }]
                : question.classifications.filter((classification) => classification.fieldId !== field.id),
        });
    }

    async function refreshCatalog(subjectId = catalogIds.subjectId) {
        const nextCatalog = await api<Catalog>("/api/v1/question-imports");
        setCatalog(nextCatalog);
        if (subjectId) setCatalogIds((current) => ({ ...current, subjectId }));
    }

    async function createSubject() {
        if (!newSubjectName.trim()) return;
        setBusy(true); setError("");
        try {
            const subject = await api<CatalogItem>("/api/v1/question-imports/taxonomy", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create_subject", name: newSubjectName.trim() }),
            });
            setNewSubjectName("");
            await refreshCatalog(subject.id);
            setStatus(`已建立科目「${subject.name}」。其他分類可以稍後再設定。`);
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "科目建立失敗。"); }
        finally { setBusy(false); }
    }

    async function createField() {
        if (!catalogIds.subjectId || !newFieldName.trim()) return;
        setBusy(true); setError("");
        try {
            await api<ClassificationField>("/api/v1/question-imports/taxonomy", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create_field", subjectId: catalogIds.subjectId, name: newFieldName.trim(), selectionMode: newFieldMode }),
            });
            setNewFieldName("");
            await refreshCatalog();
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "分類欄位建立失敗。"); }
        finally { setBusy(false); }
    }

    async function createOption(field: ClassificationField) {
        const label = newOptionNames[field.id]?.trim();
        if (!label) return;
        setBusy(true); setError("");
        try {
            await api<ClassificationOption>("/api/v1/question-imports/taxonomy", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "create_option", fieldId: field.id, label }),
            });
            setNewOptionNames((current) => ({ ...current, [field.id]: "" }));
            await refreshCatalog();
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "分類選項建立失敗。"); }
        finally { setBusy(false); }
    }

    async function requestSuggestions() {
        if (!catalogIds.subjectId) return;
        setBusy(true); setError(""); setSuggestions([]);
        try {
            const nextSuggestions = await api<ClassificationSuggestion[]>("/api/v1/question-imports/classify", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subjectId: catalogIds.subjectId, questions: questions.map(toQuestion) }),
            });
            setSuggestions(nextSuggestions);
            setStatus(nextSuggestions.length ? `AI 提供 ${nextSuggestions.length} 筆分類建議，確認後才會套用。` : "AI 沒有足夠把握提出分類建議。");
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "AI 分類暫時無法使用；你仍可手動分類。"); }
        finally { setBusy(false); }
    }

    function acceptSuggestion(suggestion: ClassificationSuggestion) {
        setQuestions((current) => current.map((question) => question.draftKey === suggestion.draftKey
            ? {
                ...question,
                classifications: [
                    ...question.classifications.filter((classification) => classification.fieldId !== suggestion.fieldId),
                    { fieldId: suggestion.fieldId, optionIds: suggestion.optionIds },
                ],
            }
            : question));
        setSuggestions((current) => current.filter((item) => item !== suggestion));
    }

    function patchPart(questionIndex: number, partIndex: number, patch: Partial<EditorPart>) {
        setQuestions((current) => current.map((question, index) => index === questionIndex
            ? { ...question, parts: question.parts.map((part, currentPart) => currentPart === partIndex ? { ...part, ...patch } : part) }
            : question));
    }

    function acceptAnswerSuggestion(suggestion: AnswerSuggestion) {
        const questionIndex = questions.findIndex((question) => question.draftKey === suggestion.questionDraftKey);
        const question = questions[questionIndex];
        const partIndex = question?.parts.findIndex((part) => part.stableKey === suggestion.partStableKey) ?? -1;
        const part = question?.parts[partIndex];
        if (!part || questionIndex < 0 || partIndex < 0) return;
        patchPart(questionIndex, partIndex, {
            answers: suggestion.answers,
            explanation: cleanBlocks(part.explanation).length ? part.explanation : [{ kind: "text", text: suggestion.explanation }],
            gradingPolicy: part.answerMode === "text" && part.answerFieldCount > 1 ? "manual_review" : "automatic",
        });
        setAnswerSuggestions((current) => current.filter((item) => item !== suggestion));
        setAnswerAnalysisState((current) => current.kind !== "idle" && current.key === `${suggestion.questionDraftKey}:${suggestion.partStableKey}`
            ? { kind: "idle" }
            : current);
        setStatus("已套用答案與解析。請核對內容後儲存草稿。");
    }

    async function requestAnswerSuggestion(questionIndex: number, partIndex: number) {
        const question = questions[questionIndex];
        const part = question?.parts[partIndex];
        if (!question || !part || part.answers.length > 0) return;
        const analysisKey = `${question.draftKey}:${part.stableKey}`;
        setAnswerAnalysisState({ kind: "running", key: analysisKey, message: "正在分析答案與解析…" });
        setError("");
        setStatus("AI 正在分析答案與解析…");
        try {
            const suggestion = await api<AnswerSuggestion | null>("/api/v1/question-imports/answer-suggestions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: toQuestion(question), partStableKey: part.stableKey }),
            });
            setAnswerSuggestions((current) => [
                ...current.filter((item) => item.questionDraftKey !== question.draftKey || item.partStableKey !== part.stableKey),
                ...(suggestion ? [suggestion] : []),
            ]);
            setAnswerAnalysisState(suggestion
                ? { kind: "success", key: analysisKey, message: "已產生答案與解析，請確認後套用。" }
                : { kind: "empty", key: analysisKey, message: "資訊不足，未產生答案或解析。" });
            setStatus(suggestion ? "AI 已產生答案與解析，確認後再套用。" : "AI 沒有足夠資訊產生可靠的答案與解析。");
        }
        catch (reason) {
            const message = reason instanceof Error ? reason.message : "AI 暫時無法產生答案與解析。";
            setAnswerAnalysisState({ kind: "error", key: analysisKey, message });
            setStatus("");
        }
    }

    function openTemplatePicker(questionIndex: number | null = null) {
        const question = questionIndex === null ? null : questions[questionIndex];
        setTemplateTarget(questionIndex);
        setTemplateId(question ? inferQuestionTemplate(toQuestion(question)) : "single-choice");
        setTemplateAnswer("");
        setTemplateSolutionOpen(false);
        setTemplateOpen(true);
    }

    function applyTemplate() {
        const target = templateTarget;
        setEditorIndex(target ?? questions.length);
        setQuestions((current) => {
            if (target === null) return [...current, toEditorQuestion(createQuestionFromTemplate(templateId))];
            const question = current[target];
            if (!question) return current;
            const replaced = replaceQuestionTemplate(toQuestion(question), templateId);
            return current.map((item, index) => index === target ? toEditorQuestion(replaced) : item);
        });
        setTemplateOpen(false);
        setTemplateAnswer("");
        setTemplateSolutionOpen(false);
        router.push(editorPath);
        setStatus(target === null ? `已建立${templateDefinition.name}，請修改題目與答案。` : `已套用${templateDefinition.name}，題目內容與來源資訊已保留。`);
    }

    /**
     * 移除目前題目並停留在仍存在的相鄰題目。
     * @param questionIndex 要移除的題目位置。
     * @returns 無回傳值。
     */
    function removeQuestion(questionIndex: number) {
        setQuestions((current) => current.filter((_, index) => index !== questionIndex));
        setEditorIndex((current) => Math.max(0, Math.min(current, questions.length - 2)));
    }

    function setAnswerMode(questionIndex: number, partIndex: number, answerMode: ImportAnswerMode) {
        const choice = answerMode !== "text";
        const optionEntries = answerMode === "boolean"
            ? [["true", "是"], ["false", "否"]]
            : [["A", "選項 A"], ["B", "選項 B"]];
        patchPart(questionIndex, partIndex, {
            answerMode,
            answerFieldCount: 1,
            gradingPolicy: choice ? "automatic" : "manual_review",
            options: choice ? optionEntries.map(([key, text]) => ({ key, blocks: [{ kind: "text", text }] })) : [],
            answers: [],
        });
    }

    async function uploadContentImage(file: File): Promise<ImportContentBlock> {
        setBusy(true); setError("");
        try {
            const form = new FormData();
            form.set("file", file); form.set("uploadKey", uid());
            const image = await api<{ assetId: string; url: string }>("/api/v1/question-imports/assets", { method: "POST", body: form });
            return { kind: "image", assetId: image.assetId, alt: file.name };
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : "圖片上傳失敗。");
            throw reason;
        }
        finally { setBusy(false); }
    }

    function applyCatalogSuggestion(suggestion: CatalogSuggestion | null) {
        if (!suggestion) return;
        setCatalogIds((current) => ({
            ...current,
            subjectId: suggestion.subjectId,
            gradeId: suggestion.gradeId ?? "",
            semesterId: suggestion.semesterId ?? "",
            bookVersionId: suggestion.bookVersionId ?? "",
            curriculumUnitId: suggestion.unitId,
        }));
    }

    async function processSourceBatch(batchId: string, analyze = true): Promise<{
        catalogSuggestion: CatalogSuggestion | null;
        pages: ScanPage[];
        questions: ImportQuestionDraft[];
    }> {
        setStatus(analyze ? "已排入背景分析，可以離開這個畫面。" : "已排入背景校正工作。");
        await api<SourceAnalysisState>(`/api/v1/question-imports/${batchId}/process`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analyze, dewarp: true, corners: {} }),
        });
        while (true) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_500));
            const state = await api<SourceAnalysisState>(`/api/v1/question-imports/${batchId}/process`);
            if (state.status === "failed") throw new Error("圖片分析失敗，原始檔已保留，可稍後重新分析。");
            if (state.status === "completed" && state.result) {
                const nextDrafts = await api<QuestionDraftRecord[]>("/api/v1/question-imports/drafts");
                const draft = nextDrafts.find((item) => item.batchId === batchId);
                return { ...state.result, questions: draft?.questions ?? [] };
            }
        }
    }

    async function uploadSourceFiles(sources: Array<Pick<PendingSource, "file" | "role">>, analyze = true): Promise<{ batchId: string; key: string }> {
        if (!learnerId) throw new Error("找不到目前的學習者，請重新登入。");
        if (!sources.length || sources.length > 20) throw new Error("一次可上傳 1 至 20 個檔案。");
        const key = uid();
        const form = new FormData();
        for (const source of sources) {
            form.append("file", source.file);
            form.append("role", source.role);
        }
        form.set("learnerId", learnerId);
        form.set("idempotencyKey", key);
        form.set("analyze", String(analyze));
        const uploaded = await api<{ batchId: string }>("/api/v1/question-imports/upload", { method: "POST", body: form });
        return { batchId: uploaded.batchId, key };
    }

    async function uploadSourceFile(file: File, analyze = true): Promise<{ batchId: string; key: string }> {
        return uploadSourceFiles([{ file, role: "auto" }], analyze);
    }

    async function processSourceFile(file: File, analyze = true): Promise<{
        batchId: string;
        catalogSuggestion: CatalogSuggestion | null;
        key: string;
        pages: ScanPage[];
        questions: ImportQuestionDraft[];
    }> {
        const uploaded = await uploadSourceFile(file, analyze);
        const result = await processSourceBatch(uploaded.batchId, analyze);
        return { batchId: uploaded.batchId, catalogSuggestion: result.catalogSuggestion, key: uploaded.key, pages: result.pages, questions: result.questions };
    }

    async function scanFiles(files: File[]) {
        if (!files.length) return;
        if (pendingSources.length + files.length > 20) {
            setError("一次最多可加入 20 個檔案。");
            return;
        }
        setError("");
        setPendingSources((current) => [
            ...current,
            ...files.map((file) => ({ file, id: uid(), role: "auto" as const })),
        ]);
        setStatus(`已選擇 ${pendingSources.length + files.length} 個檔案，請確認每張圖片的用途後開始分析。`);
    }

    async function startSourceAnalysis() {
        if (!pendingSources.length) return;
        setBusy(true); setError(""); setStatus("正在上傳原始檔…");
        try {
            const uploaded = await uploadSourceFiles(pendingSources);
            const batchId = uploaded.batchId;
            setSourceBatchId(batchId);
            setIdempotencyKey(uploaded.key);
            setSourceTitle(pendingSources.length === 1
                ? pendingSources[0]!.file.name
                : `${pendingSources[0]!.file.name} 等 ${pendingSources.length} 個檔案`);
            setScanPages([]);
            setQuestions([]);
            setAnswerSuggestions([]);
            setEditorIndex(0);
            setTemplateOpen(false);
            setPendingSources([]);
            await refreshDrafts();
            loadedRouteDraftId.current = batchId;
            router.push(getDraftPath(batchId));
            setStatus("原始檔已上傳並排入背景分析。系統會先辨識題目、答案與解析圖片；可以離開這個畫面。");
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "掃描處理失敗。"); setStatus(""); }
        finally { setBusy(false); }
    }

    async function reanalyzeDraft() {
        if (!sourceBatchId) return;
        setBusy(true); setError(""); setStatus("正在排入背景重新分析…");
        try {
            if (activeDraft?.sourceAssets.length) {
                await api<{ updated: true }>(`/api/v1/question-imports/${sourceBatchId}/sources`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sources: activeDraft.sourceAssets.map((asset) => ({
                            sourceDocumentId: asset.sourceDocumentId,
                            role: sourceRoles[asset.sourceDocumentId] ?? asset.role,
                        })),
                    }),
                });
            }
            await api<SourceAnalysisState>(`/api/v1/question-imports/${sourceBatchId}/process`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analyze: true, dewarp: true, corners: {} }),
            });
            setQuestions([]);
            setScanPages([]);
            setAnswerSuggestions([]);
            await refreshDrafts();
            setStatus("已排入背景重新分析，可以離開這個畫面。完成後會更新我的草稿。");
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "圖片重新分析失敗。"); setStatus(""); }
        finally { setBusy(false); }
    }

    async function appendDraftSources(files: File[]) {
        if (!sourceBatchId || !activeDraft || !files.length) return;
        if (activeDraft.sourceAssets.length + files.length > 20) {
            setError(`這份草稿還能新增 ${Math.max(0, 20 - activeDraft.sourceAssets.length)} 個檔案。`);
            return;
        }
        setBusy(true); setError(""); setStatus("正在新增原始檔案…");
        try {
            await api<{ updated: true }>(`/api/v1/question-imports/${sourceBatchId}/sources`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sources: activeDraft.sourceAssets.map((asset) => ({
                        sourceDocumentId: asset.sourceDocumentId,
                        role: sourceRoles[asset.sourceDocumentId] ?? asset.role,
                    })),
                }),
            });
            const form = new FormData();
            for (const file of files) {
                form.append("file", file);
                form.append("role", "auto");
            }
            form.set("idempotencyKey", uid());
            await api<{ batchId: string; replayed: boolean; sourceCount: number }>(
                `/api/v1/question-imports/${sourceBatchId}/sources`,
                { method: "POST", body: form },
            );
            setQuestions([]);
            setScanPages([]);
            setAnswerSuggestions([]);
            setEditorIndex(0);
            await refreshDrafts();
            setStatus(`已新增 ${files.length} 個檔案並重新分析整份草稿。可以離開這個畫面，完成後會自動更新。`);
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : "新增原始檔案失敗。");
            setStatus("");
        }
        finally { setBusy(false); }
    }

    async function createImportedDraft(draft: QuestionDraftPackage) {
        const nextQuestions = draft.questions.map((question) => toEditorQuestion(question));
        const nextIdempotencyKey = uid();
        setBusy(true);
        setError("");
        setStatus("正在建立格式匯入草稿…");
        try {
            const batchId = await persistDraft({
                batchId: null,
                idempotencyKey: nextIdempotencyKey,
                questions: nextQuestions,
                title: draft.sourceTitle,
            });
            setSourceTitle(draft.sourceTitle);
            setQuestions(nextQuestions);
            setEditorIndex(0);
            setTemplateOpen(false);
            setExchangePackage(null);
            setSourceBatchId(batchId);
            setIdempotencyKey(nextIdempotencyKey);
            await refreshDrafts();
            loadedRouteDraftId.current = batchId;
            router.replace(getDraftPath(batchId));
            setStatus(`已建立新草稿，共 ${draft.questions.length} 題。請校對內容後再加入題庫。`);
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : "格式匯入草稿建立失敗。");
            setStatus("");
        }
        finally {
            setBusy(false);
        }
    }

    function loadJson() {
        try {
            if (new Blob([jsonText]).size > 5 * 1024 * 1024) throw new Error("JSON 內容不可超過 5 MB。");
            const value: unknown = JSON.parse(jsonText);
            const exchange = parseQuestionExchangePackage(value);
            if (exchange.ok) {
                const assets = listQuestionExchangeAssets(exchange.value);
                setExchangePackage(exchange.value);
                setExchangeAssets({});
                setExchangeSources({});
                setExchangeSourceModes(Object.fromEntries([...new Set(assets.flatMap((asset) => asset.kind === "crop" ? [asset.sourceRef] : []))].map((ref) => [ref, "handwriting-removed"])));
                setExchangeRects(Object.fromEntries(assets.flatMap((asset) => asset.kind === "crop" ? [[asset.ref, asset.rect]] : [])));
                setSourceBatchId(null);
                setIdempotencyKey(uid());
                if (assets.length === 0) {
                    const resolved = resolveQuestionExchangePackage(exchange.value, {});
                    if (!resolved.ok) throw new Error("圖片參照尚未補齊。");
                    void createImportedDraft(resolved.value);
                    return;
                }
                setStatus(`格式已通過檢查，共 ${exchange.value.questions.length} 題。請補上 ${assets.length} 個圖片參照。`);
                setError("");
                return;
            }
            const draft = parseQuestionDraftPackage(value);
            if (!draft.ok) throw new Error(exchange.errors[0]?.message ?? draft.errors[0]?.message ?? "題目格式不正確。");
            setExchangePackage(null);
            setSourceBatchId(null);
            setIdempotencyKey(uid());
            void createImportedDraft(draft.value);
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "JSON 格式不正確。"); }
    }

    function finishExchangeImport() {
        if (!exchangePackage) return;
        const resolved = resolveQuestionExchangePackage(exchangePackage, exchangeAssets);
        if (!resolved.ok) {
            setError(`還缺少圖片：${resolved.missingRefs.join("、")}`);
            return;
        }
        void createImportedDraft(resolved.value);
    }

    async function mapImageReference(reference: Extract<QuestionExchangeAsset, { kind: "image" }>, files: File[]) {
        const file = files[0];
        if (!file) return;
        const block = await uploadContentImage(file);
        if (block.kind !== "image") throw new Error("圖片上傳結果不正確。");
        setExchangeAssets((current) => ({ ...current, [reference.ref]: block.assetId }));
        setStatus(`已補上圖片「${reference.ref}」。`);
    }

    async function cropExchangeReference(reference: Extract<QuestionExchangeAsset, { kind: "crop" }>, pages: ScanPage[]) {
        const page = pages.find((candidate) => candidate.page === reference.page);
        const mode = exchangeSourceModes[reference.sourceRef] ?? "handwriting-removed";
        const source = page?.files[mode] ?? page?.files.color;
        const rect = exchangeRects[reference.ref] ?? reference.rect;
        if (!source) throw new Error(`原稿沒有第 ${reference.page} 頁，無法建立「${reference.ref}」。`);
        const result = await api<{ assetId: string }>("/api/v1/question-imports/assets/crop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetId: source.assetId, rect, uploadKey: `${reference.ref}-${uid()}` }),
        });
        setExchangeAssets((current) => ({ ...current, [reference.ref]: result.assetId }));
    }

    async function mapCropSource(sourceRef: string, files: File[]) {
        const file = files[0];
        if (!file || !exchangePackage) return;
        setBusy(true); setError(""); setStatus(`正在校正原稿「${sourceRef}」…`);
        try {
            const processed = await processSourceFile(file, false);
            setSourceBatchId(processed.batchId);
            setIdempotencyKey(processed.key);
            setExchangeSources((current) => ({ ...current, [sourceRef]: processed.pages }));
            const references = listQuestionExchangeAssets(exchangePackage).filter((asset): asset is Extract<QuestionExchangeAsset, { kind: "crop" }> => asset.kind === "crop" && asset.sourceRef === sourceRef);
            for (const reference of references) await cropExchangeReference(reference, processed.pages);
            setStatus(`已校正原稿並建立 ${references.length} 張題目裁切圖。你可以切換影像模式或調整裁切範圍。`);
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "原稿處理失敗。"); setStatus(""); }
        finally { setBusy(false); }
    }

    async function recropReference(reference: Extract<QuestionExchangeAsset, { kind: "crop" }>) {
        const pages = exchangeSources[reference.sourceRef];
        if (!pages) return;
        setBusy(true); setError("");
        try {
            await cropExchangeReference(reference, pages);
            setStatus(`已更新裁切圖片「${reference.ref}」。`);
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "圖片裁切失敗。"); }
        finally { setBusy(false); }
    }

    function updateExchangeRect(
        ref: string,
        field: "x" | "y" | "width" | "height",
        value: number,
        current: { x: number; y: number; width: number; height: number },
    ) {
        const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
        const next = { ...current, [field]: normalized };
        if (field === "x") next.width = Math.min(next.width, 1 - next.x);
        if (field === "y") next.height = Math.min(next.height, 1 - next.y);
        if (field === "width") next.width = Math.min(next.width, 1 - next.x);
        if (field === "height") next.height = Math.min(next.height, 1 - next.y);
        setExchangeRects((rects) => ({ ...rects, [ref]: next }));
    }

    async function loadFormatFile(files: File[]) {
        const file = files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            setError("JSON 格式檔不可超過 5 MB。");
            return;
        }
        setJsonText(await file.text());
        setExchangePackage(null);
        setStatus(`已讀取「${file.name}」，請檢查後載入。`);
        setError("");
    }

    async function copyFormatPrompt() {
        if (formatTemplateIds.length === 0) {
            setError("請至少選擇一種題型。");
            return;
        }
        await navigator.clipboard.writeText(createQuestionExchangePrompt(formatTemplateIds));
        setStatus(`已複製 ${formatTemplateIds.length} 種題型的 AI 指令。`);
        setError("");
    }

    async function copyFormatTemplate() {
        if (formatTemplateIds.length === 0) {
            setError("請至少選擇一種題型。");
            return;
        }
        const template = JSON.stringify(createQuestionExchangeTemplate(formatTemplateIds), null, 2);
        await navigator.clipboard.writeText(template);
        setJsonText(template);
        setStatus(`已複製並帶入 ${formatTemplateIds.length} 種題型的格式。`);
        setError("");
    }

    function downloadTemplate() {
        if (formatTemplateIds.length === 0) {
            setError("請至少選擇一種題型。");
            return;
        }
        const payload = createQuestionExchangeTemplate(formatTemplateIds);
        const selectionName = formatTemplateIds.length === QUESTION_TEMPLATE_IDS.length
            ? "all"
            : formatTemplateIds.length === 1 ? formatTemplateIds[0] : `selected-${formatTemplateIds.length}`;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
        link.download = `lerniqa-${selectionName}-ai-format-v1.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        setStatus(`已下載 ${formatTemplateIds.length} 種題型的格式檔。`);
        setError("");
    }

    async function submit() {
        setBusy(true); setError(""); setStatus("");
        try {
            const payload: QuestionImportPackage = {
                schemaVersion: 2, learnerId, idempotencyKey, sourceBatchId, sourceTitle,
                catalog: {
                    ...catalogIds,
                    semesterId: catalogIds.semesterId || null, bookVersionId: catalogIds.bookVersionId || null,
                    curriculumUnitId: catalogIds.curriculumUnitId || null,
                    difficultyLevelId: catalogIds.difficultyLevelId || null, sourceCategoryId: catalogIds.sourceCategoryId || null,
                    gradeId: catalogIds.gradeId || null, questionTypeId: null,
                },
                questions: questions.map(toQuestion),
            };
            const result = await api<{ importedCount: number }>("/api/v1/question-imports", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
            });
            invalidatePersistedPracticeCatalog();
            setPublishOpen(false);
            await refreshDrafts();
            setStatus(`已將 ${result.importedCount} 題加入題庫。`);
        }
        catch (reason) { setError(reason instanceof Error ? reason.message : "題目匯入失敗。"); }
        finally { setBusy(false); }
    }

    const select = (label: string, key: keyof typeof catalogIds, items: CatalogItem[], optional = false) => <label><span>{label}</span><select value={catalogIds[key]} onChange={(event) => {
        const value = event.target.value;
        const clearsVersion = key === "subjectId" || key === "gradeId";
        const clearsUnit = clearsVersion || key === "semesterId" || key === "bookVersionId";
        setCatalogIds((current) => ({
            ...current,
            [key]: value,
            ...(clearsVersion ? { bookVersionId: "" } : {}),
            ...(clearsUnit ? { curriculumUnitId: "" } : {}),
        }));
        if (key === "subjectId") {
            const allowedFields = new Set(catalog?.classificationFields.filter((field) => field.subjectIds.includes(value)).map((field) => field.id) ?? []);
            setQuestions((current) => current.map((question) => ({
                ...question,
                classifications: question.classifications.filter((classification) => allowedFields.has(classification.fieldId)),
            })));
            setSuggestions([]);
        }
    }}><option value="">{optional ? "不指定" : `請選擇${label}`}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;

    return <main className={styles.page}>
        <aside className={styles.sidebar}>
            <Link className={styles.back} href="/questions"><ArrowLeft />返回題目總覽</Link>
            <div><LerniqaLogo className={styles.brand} /><p>題目工作台</p></div>
            <nav aria-label="題目工作台">
                <button type="button" data-active={!isDraftRoute} onClick={() => router.push(QUESTION_AUTHORING_PATHS.upload)}><FileText />建立題目</button>
                <button type="button" data-active={isDraftRoute} onClick={() => router.push(QUESTION_AUTHORING_PATHS.drafts)}><FolderOpen />我的草稿</button>
            </nav>
            <div className={styles.help}><ScanLine /><span>自動偵測頁面、透視校正、展平、去陰影、OCR，並提供去除彩色手寫預覽。</span></div>
        </aside>
        <section className={styles.workspace}>
            <header className={styles.workspaceHeader}>
                <div className={styles.headerCopy}>
                    <p>個人題目空間</p>
                    <div className={styles.headerTitleRow}>
                        <h1>{tab === "drafts" ? "我的草稿" : "建立題目"}</h1>
                        {status && <span className={styles.headerStatus} role="status">{status}</span>}
                    </div>
                    <span>{tab === "drafts" ? "繼續編輯尚未加入題庫的內容。" : "先儲存、校對與試做；確定後再選擇分類加入題庫。"}</span>
                </div>
                <div className={styles.headerArtwork} aria-hidden="true">
                    <span className={styles.headerPaper}><FileText /></span>
                    <span className={styles.headerCamera}><Camera /></span>
                    <span className={styles.headerSparkle}><Sparkles /></span>
                </div>
                {tab === "editor" && <div className={styles.headerActions}><button className={styles.secondary} disabled={busy} onClick={() => openTemplatePicker()}><LayoutTemplate />從範本新增</button><button className={styles.secondary} disabled={busy || questions.length === 0} onClick={() => { setPreviewIndex(0); setPreviewAnswer(""); setPreviewSolutionOpen(false); setPreviewOpen(true); }}><Eye />預覽練習</button><button className={styles.secondary} disabled={busy || !learnerId || questions.length === 0} onClick={() => void saveDraft()}><Save />儲存草稿</button><button className={styles.primary} disabled={busy || !catalog || questions.length === 0} onClick={() => setPublishOpen(true)}>加入題庫</button></div>}
            </header>
            {tab !== "drafts" && <nav className={styles.createTabs} aria-label="建立題目方式" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "scan"} data-active={tab === "scan"} onClick={() => router.push(QUESTION_AUTHORING_PATHS.upload)}><Camera />檔案上傳</button>
                <button type="button" role="tab" aria-selected={tab === "json"} data-active={tab === "json"} onClick={() => router.push(QUESTION_AUTHORING_PATHS.import)}><FileJson />格式匯入</button>
                <button type="button" role="tab" aria-selected={tab === "editor"} data-active={tab === "editor"} onClick={() => router.push(editorPath)}><FileText />手動編輯</button>
            </nav>}
            {error && <div className={styles.error} role="alert">{error}</div>}
            {tab === "drafts" && <section className={styles.draftsPanel}><div className={styles.sectionHeading}><div><h2>草稿清單</h2><p>只有你看得到。背景分析期間可以離開，草稿不會進入題庫、正式練習或學習統計。</p></div><button className={styles.primary} onClick={() => { resetEditor(); router.push(QUESTION_AUTHORING_PATHS.edit); }}><Plus />建立新草稿</button></div>{drafts.length === 0 ? <div className={styles.emptyState}><FolderOpen /><h3>目前沒有草稿</h3><p>可直接建立題目，也可以從照片、PDF 或 JSON 開始。</p></div> : <div className={styles.draftGrid}>{drafts.map((draft) => <article className={styles.draftCard} key={draft.batchId}><div><span className={styles.draftStatus} data-processing={draft.status === "draft" || draft.status === "recognizing"} role="status">{DRAFT_STATUS_LABELS[draft.status]} · {draft.questions.length} 題</span><h3>{draft.sourceTitle}</h3><p>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.createdAt))}</p></div><div className={styles.draftActions}><button className={styles.secondary} onClick={() => router.push(getDraftPath(draft.batchId))}>{draft.status === "review" ? "開啟編輯" : "查看狀態"}</button><DraftDeleteDialog busy={busy} draft={draft} onDelete={deleteDraft} /></div></article>)}</div>}</section>}
            {tab === "scan" && <section className={styles.uploadPanel} data-has-files={pendingSources.length > 0}>
                <Camera />
                <h2>拍照、圖片或 PDF</h2>
                <p>可一次加入題目、答案與解析圖片。系統會自動判斷用途，也可先手動指定。支援 JPG、PNG、WebP、PDF，單檔 20 MB，最多 20 個檔案。</p>
                <FileSourcePicker accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" camera disabled={busy} driveMimeTypes={["image/jpeg", "image/png", "image/webp", "application/pdf"]} multiple systemLabel={busy ? "正在處理…" : "從裝置或雲端選擇"} onError={setError} onFiles={scanFiles} />
                {pendingSources.length > 0 && <div className={styles.pendingSources}>
                    <div className={styles.pendingSourcesHead}><div><strong>已選擇 {pendingSources.length} 個檔案</strong><span>不確定時保留「由 AI 判斷」即可。</span></div><button className={styles.primary} disabled={busy} onClick={() => void startSourceAnalysis()}><Sparkles />開始分析</button></div>
                    {pendingSources.map((source) => <article className={styles.pendingSource} key={source.id}>
                        <div><FileText /><span><strong>{source.file.name}</strong><small>{Math.max(1, Math.ceil(source.file.size / 1024))} KB</small></span></div>
                        <label><span>圖片用途</span><select value={source.role} onChange={(event) => setPendingSources((current) => current.map((item) => item.id === source.id ? { ...item, role: event.target.value as QuestionSourceRole } : item))}>{Object.entries(QUESTION_SOURCE_ROLE_LABELS).map(([role, label]) => <option value={role} key={role}>{label}</option>)}</select></label>
                        <button className={styles.iconButton} aria-label={`移除 ${source.file.name}`} onClick={() => setPendingSources((current) => current.filter((item) => item.id !== source.id))}><Trash2 /></button>
                    </article>)}
                </div>}
            </section>}
            {tab === "json" && <section className={styles.jsonPanel}>
                <div className={styles.formatIntro}><h2>依格式建立草稿</h2><p>可選擇一種、多種或全部題型。下載檔與 AI 指令只會包含已選題型，產生的 JSON 可混合多種題目。</p></div>
                <QuestionTemplateSelector
                    selectionMode="multiple"
                    selected={formatTemplateIds}
                    onSelect={(next) => {
                        setFormatTemplateIds(next);
                        setExchangePackage(null);
                        if (!next.includes(formatPreviewTemplateId) && next[0]) setFormatPreviewTemplateId(next[0]);
                    }}
                    preview={formatTemplateIds.length > 0
                        ? <section className={styles.templatePreview} aria-label={`${formatTemplateDefinition.name}格式預覽`}><div className={styles.templatePreviewHead}><div><span>已選 {formatTemplateIds.length} 種題型</span><h3>{formatTemplateDefinition.name}範例</h3></div><span>匯入後可修改</span></div><div className={styles.previewBody}><PersistedQuestionPromptContent question={formatTemplatePreviewQuestion} title /><PersistedQuestionFields question={formatTemplatePreviewQuestion} answer="" onAnswer={() => undefined} hidePromptContent /></div><p className={styles.previewNote}>下載內容會依選取結果產生，每種題型提供兩題範例。</p></section>
                        : <section className={styles.templatePreview} aria-label="尚未選擇題型"><div className={styles.templatePreviewHead}><div><span>格式預覽</span><h3>尚未選擇題型</h3></div></div><p className={styles.previewNote}>請至少選擇一種題型，或按「全選」。</p></section>}
                />
                <div className={styles.formatActions}>
                    <button className={styles.secondary} disabled={formatTemplateIds.length === 0} type="button" onClick={() => void copyFormatPrompt()}><Copy />複製給 AI 的指令</button>
                    <button className={styles.secondary} disabled={formatTemplateIds.length === 0} type="button" onClick={() => void copyFormatTemplate()}><Copy />複製 JSON 範本</button>
                    <button className={styles.secondary} disabled={formatTemplateIds.length === 0} type="button" onClick={downloadTemplate}><FileJson />下載格式檔</button>
                    <FileSourcePicker accept=".json,application/json" disabled={busy} driveMimeTypes={["application/json"]} systemLabel="從裝置或雲端選擇格式檔" onError={setError} onFiles={loadFormatFile} />
                </div>
                <label className={styles.jsonInput}><span>貼上 AI 產生的 JSON</span><textarea value={jsonText} onChange={(event) => { setJsonText(event.target.value); setExchangePackage(null); }} placeholder={'{\n  "schemaVersion": 1,\n  "sourceTitle": "題目名稱",\n  "questions": [...]\n}'} /></label>
                <div className={styles.buttonRow}><button className={styles.primary} disabled={busy || !jsonText.trim()} onClick={loadJson}>{busy ? "正在建立草稿…" : "檢查並建立草稿"}</button></div>
                {exchangePackage && pendingExchangeAssets.length > 0 && <section className={styles.assetResolver}>
                    <div><h3>補上格式中的圖片</h3><p>圖片只會存入你的私人題目空間。全部配對完成後，才會轉成可預覽的題目草稿。</p></div>
                    {pendingExchangeAssets.filter((asset): asset is Extract<QuestionExchangeAsset, { kind: "image" }> => asset.kind === "image").map((asset) => <article className={styles.assetCard} key={asset.ref}>
                        <div><strong>{asset.ref}</strong><p>{asset.alt}</p></div>
                        {exchangeAssets[asset.ref] && <img src={`/api/v1/question-import-assets/${exchangeAssets[asset.ref]}`} alt={asset.alt} />}
                        <div className={styles.assetActions}>{exchangeAssets[asset.ref] && <span><Check />已配對</span>}<FileSourcePicker accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" camera disabled={busy} driveMimeTypes={["image/jpeg", "image/png", "image/webp"]} systemLabel={exchangeAssets[asset.ref] ? "更換圖片" : "從裝置或雲端選擇圖片"} onError={setError} onFiles={(files) => mapImageReference(asset, files)} /></div>
                    </article>)}
                    {[...new Set(pendingExchangeAssets.flatMap((asset) => asset.kind === "crop" ? [asset.sourceRef] : []))].map((sourceRef) => {
                        const pages = exchangeSources[sourceRef];
                        return <section className={styles.sourceResolver} key={sourceRef}>
                            <div className={styles.sectionHeading}><div><h3>原稿：{sourceRef}</h3><p>上傳一次照片或 PDF，系統會先校正與去除彩色手寫，再按 AI 提供的位置裁切。</p></div><FileSourcePicker accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" camera disabled={busy} driveMimeTypes={["image/jpeg", "image/png", "image/webp", "application/pdf"]} systemLabel={pages ? "更換原稿" : "從裝置或雲端選擇原稿"} onError={setError} onFiles={(files) => mapCropSource(sourceRef, files)} /></div>
                            {pages && <label className={styles.modeSelect}><span>裁切使用的影像</span><select value={exchangeSourceModes[sourceRef] ?? "handwriting-removed"} onChange={(event) => setExchangeSourceModes((current) => ({ ...current, [sourceRef]: event.target.value }))}><option value="handwriting-removed">去除彩色手寫</option><option value="color">校正彩色原稿</option><option value="gray">灰階</option><option value="bw">黑白文件</option></select></label>}
                            {pendingExchangeAssets.filter((asset): asset is Extract<QuestionExchangeAsset, { kind: "crop" }> => asset.kind === "crop" && asset.sourceRef === sourceRef).map((asset) => {
                                const page = pages?.find((candidate) => candidate.page === asset.page);
                                const mode = exchangeSourceModes[sourceRef] ?? "handwriting-removed";
                                const pageImage = page?.files[mode] ?? page?.files.color;
                                const rect = exchangeRects[asset.ref] ?? asset.rect;
                                return <article className={styles.cropCard} key={asset.ref}><div className={styles.cropHeading}><div><strong>{asset.ref}</strong><p>第 {asset.page} 頁 · {asset.alt}</p></div>{exchangeAssets[asset.ref] && <span><Check />已建立裁切圖</span>}</div>{pageImage && <div className={styles.cropWorkspace}><div className={styles.cropCanvas}><img src={pageImage.url} alt={`${sourceRef} 第 ${asset.page} 頁`} /><span style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} /></div>{exchangeAssets[asset.ref] && <img className={styles.cropResult} src={`/api/v1/question-import-assets/${exchangeAssets[asset.ref]}`} alt={asset.alt} />}</div>}<div className={styles.cropInputs}>{(["x", "y", "width", "height"] as const).map((field) => <label key={field}><span>{field === "x" ? "左側" : field === "y" ? "上方" : field === "width" ? "寬度" : "高度"}</span><input type="number" min="0" max="1" step="0.01" value={rect[field]} onChange={(event) => updateExchangeRect(asset.ref, field, Number(event.target.value), rect)} /></label>)}</div><button className={styles.secondary} type="button" disabled={!pages || busy || rect.width <= 0 || rect.height <= 0} onClick={() => void recropReference(asset)}>套用裁切範圍</button></article>;
                            })}
                        </section>;
                    })}
                    <div className={styles.dialogActions}><button className={styles.primary} disabled={busy || pendingExchangeAssets.some((asset) => !exchangeAssets[asset.ref])} onClick={finishExchangeImport}>{busy ? "正在建立草稿…" : "建立草稿並校對"}</button></div>
                </section>}
            </section>}
            {tab === "editor" && <>
                <section className={styles.draftMeta} data-merged={questions.length === 0}>
                    <div className={styles.draftTitleRow}>
                        <label><span>草稿名稱</span><input value={sourceTitle} maxLength={300} onChange={(event) => setSourceTitle(event.target.value)} placeholder="例如：10 月自然練習題" /></label>
                        {activeDraft && activeDraft.inputType !== "text" && !draftProcessing && <button className={styles.secondary} disabled={busy} onClick={() => void reanalyzeDraft()}><Sparkles />儲存用途並重新分析</button>}
                    </div>
                    {activeDraft?.sourceAssets.length ? <section className={styles.sourceAssets} aria-label="草稿原始檔案">
                        <div className={styles.sourceAssetsHeading}>
                            <div className={styles.sourceAssetsCopy}>
                                <div className={styles.sourceAssetsTitle}><strong>原始檔案</strong><span>共 {activeDraft.sourceAssets.length} 個檔案</span></div>
                                <p className={styles.sourceAssetsHint}>{sourceSummaryMessage}。</p>
                            </div>
                            <FileSourcePicker
                                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                                camera
                                cameraLabel="拍照新增"
                                disabled={busy || draftProcessing || activeDraft.sourceAssets.length >= 20}
                                driveMimeTypes={["image/jpeg", "image/png", "image/webp", "application/pdf"]}
                                multiple
                                systemLabel="新增圖片或 PDF"
                                onError={setError}
                                onFiles={appendDraftSources}
                            />
                        </div>
                        <div className={styles.sourceAssetList}>{activeDraft.sourceAssets.map((sourceAsset) => <article className={styles.sourceAssetItem} key={sourceAsset.sourceDocumentId}>
                            <SourceAssetDialog sourceAsset={sourceAsset} />
                            <AppSelect aria-label={`圖片用途：${sourceAsset.fileName}`} className={styles.sourceRoleSelect} disabled={activeDraft.status === "recognizing"} options={SOURCE_ROLE_OPTIONS} value={sourceRoles[sourceAsset.sourceDocumentId] ?? sourceAsset.role} onChange={(event) => setSourceRoles((current) => ({ ...current, [sourceAsset.sourceDocumentId]: event.target.value as QuestionSourceRole }))} />
                            {sourceAsset.roleSource === "ai" && <small title={sourceAsset.roleReason ?? undefined}>AI 判斷 · {Math.round((sourceAsset.roleConfidence ?? 0) * 100)}%</small>}
                        </article>)}</div>
                    </section> : null}
                    {!activeDraft?.sourceAssets.length && <div className={styles.draftMetaFooter}><p>{draftStatusMessage}</p></div>}
                </section>
                {scanPages.length > 0 && !activeDraft?.sourceAssets.length && <div className={styles.scanNotice}>掃描影像已套用透視校正、展平與去除手寫預覽。OCR 內容可能有誤，請對照原圖校正。</div>}
                {questions.length === 0 && (sourceBatchId && activeDraft?.status !== "failed"
                    ? <section className={styles.processingState} role="status" aria-busy="true" aria-live="polite">
                        <div className={styles.processingLead}>
                            <span className={styles.processingIcon} aria-hidden="true"><ScanLine /></span>
                            <div><span>題目處理中</span><h3>背景分析中</h3><p>系統正在處理原始檔。你可以離開，完成後會顯示在我的草稿。</p></div>
                        </div>
                        <ul className={styles.processingSteps} aria-label="背景分析內容">
                            <li>頁面校正</li>
                            <li>文字辨識</li>
                            <li>題目分析</li>
                        </ul>
                    </section>
                    : <div className={styles.emptyState}><LayoutTemplate /><h3>先選擇題目範本</h3><p>範本會先展示實際作答方式，再建立可修改的題目與答案。</p><button className={styles.primary} onClick={() => openTemplatePicker()}>選擇範本</button></div>)}
                {questions.length > 0 && <section className={styles.editorStepper} aria-label="題目編輯進度">
                    <div className={styles.editorStepperCopy}>
                        <span>逐題編輯</span>
                        <strong>第 {activeEditorIndex + 1} 題，共 {questions.length} 題</strong>
                    </div>
                    <div className={styles.editorStepperActions}>
                        <button className={styles.secondary} disabled={activeEditorIndex === 0} onClick={() => setEditorIndex((index) => Math.max(0, index - 1))}><ArrowLeft />上一題</button>
                        <button className={styles.secondary} disabled={activeEditorIndex >= questions.length - 1} onClick={() => setEditorIndex((index) => Math.min(questions.length - 1, index + 1))}>下一題<ArrowRight /></button>
                        <button className={styles.primary} onClick={() => openTemplatePicker()}><Plus />新增下一題</button>
                    </div>
                    <div className={styles.editorProgressTrack}><span style={{ width: `${editorProgress}%` }} /></div>
                </section>}
                <div className={styles.questionList}>{questions.map((question, questionIndex) => {
                    if (questionIndex !== activeEditorIndex) return null;
                    const questionTemplate = getQuestionTemplate(inferQuestionTemplate(toQuestion(question)));
                    return <article className={styles.question} key={question.uid}>
                    <div className={styles.questionHead}><div><h2>第 {questionIndex + 1} 題</h2><span className={styles.templateBadge}>{questionTemplate.name}</span></div><div className={styles.questionActions}><button className={styles.secondary} type="button" onClick={() => openTemplatePicker(questionIndex)}><LayoutTemplate />更換範本</button>{questions.length > 1 && <button className={styles.iconButton} aria-label={`刪除第 ${questionIndex + 1} 題`} onClick={() => removeQuestion(questionIndex)}><Trash2 /></button>}</div></div>
                    <div className={styles.authoringLayout} data-authoring-layout="practice">
                    <section className={styles.authoringCanvas}>
                    <RichContentEditor
                        blocks={question.sharedPrompt}
                        description={question.parts.length > 1 ? "這段內容會在切換小題時保持顯示。" : "輸入題目文字，也可以依原始順序加入圖片、公式或表格。"}
                        label={question.parts.length > 1 ? "大題說明" : "題目內容"}
                        onChange={(sharedPrompt) => patchQuestion(questionIndex, { sharedPrompt })}
                        onUploadImage={uploadContentImage}
                    />
                    <div className={styles.parts}>{question.parts.map((part, partIndex) => <section className={styles.part} data-part-authoring key={part.uid}>
                        <div className={styles.partHead}><div><span>學習者作答區</span><h3>{question.parts.length > 1 ? `小題 ${partIndex + 1}` : "本題作答"}</h3></div>{question.parts.length > 1 && <button className={styles.iconButton} aria-label={`刪除小題 ${partIndex + 1}`} onClick={() => patchQuestion(questionIndex, { parts: question.parts.filter((_, index) => index !== partIndex) })}><Trash2 /></button>}</div>
                        {question.parts.length > 1
                            ? <RichContentEditor blocks={part.prompt} label="小題內容" onChange={(prompt) => patchPart(questionIndex, partIndex, { prompt })} onUploadImage={uploadContentImage} />
                            : part.prompt.length > 0 && <details className={styles.advanced}><summary>作答區補充內容</summary><RichContentEditor blocks={part.prompt} label="補充內容" onChange={(prompt) => patchPart(questionIndex, partIndex, { prompt })} onUploadImage={uploadContentImage} /></details>}
                        <div className={styles.answerSettings} data-text-answer={part.answerMode === "text"}>
                            <label><span>作答方式</span><AppSelect options={ANSWER_OPTIONS} value={part.answerMode} onChange={(event) => setAnswerMode(questionIndex, partIndex, event.target.value as ImportAnswerMode)} /></label>
                            {part.answerMode === "text" && <><label><span>正確答案</span><input value={part.answers.join("；")} onChange={(event) => patchPart(questionIndex, partIndex, { answers: event.target.value.split("；").map((value) => value.trim()).filter(Boolean) })} placeholder="尚未確定可留空；多個答案以；分隔" /></label><label><span>作答格數</span><input type="number" min="1" max="8" value={part.answerFieldCount} onChange={(event) => patchPart(questionIndex, partIndex, { answerFieldCount: Number(event.target.value), gradingPolicy: Number(event.target.value) > 1 ? "manual_review" : part.gradingPolicy })} /></label></>}
                        </div>
                        {part.answers.length === 0 && (() => {
                            const analysisKey = `${question.draftKey}:${part.stableKey}`;
                            const localState = answerAnalysisState.kind !== "idle" && answerAnalysisState.key === analysisKey ? answerAnalysisState : null;
                            const isRunning = localState?.kind === "running";
                            return <div className={styles.answerAnalysisActions}>
                                {localState && <span className={styles.answerAnalysisNotice} data-tone={localState.kind} role="status" aria-live="polite">{localState.message}</span>}
                                <button className={styles.primary} type="button" aria-busy={isRunning} disabled={answerAnalysisState.kind === "running"} onClick={() => void requestAnswerSuggestion(questionIndex, partIndex)}>
                                    {isRunning ? <LoaderCircle className={styles.answerAnalysisSpinner} /> : <Sparkles />}
                                    {isRunning ? "分析中…" : "AI 分析答案與解析"}
                                </button>
                            </div>;
                        })()}
                        {(() => {
                            const suggestion = answerSuggestions.find((item) => item.questionDraftKey === question.draftKey && item.partStableKey === part.stableKey);
                            if (!suggestion || part.answers.length > 0) return null;
                            const evidence = suggestion.evidence && activeDraft?.sourceAssets.find((asset) => asset.sourceDocumentId === suggestion.evidence?.sourceDocumentId);
                            return <aside className={styles.answerSuggestion} aria-label="AI 答案建議">
                                <div><span><Sparkles />AI 答案建議</span><strong>{suggestion.answers.join("、")}</strong><p>{suggestion.explanation}</p><small>{evidence ? `${evidence.fileName} · 第 ${suggestion.evidence?.page} 頁 · ` : "依題目推導 · "}信心 {Math.round(suggestion.confidence * 100)}%</small></div>
                                <div><button className={styles.primary} type="button" onClick={() => acceptAnswerSuggestion(suggestion)}>套用答案與解析</button><button className={styles.secondary} type="button" onClick={() => {
                                    setAnswerSuggestions((current) => current.filter((item) => item !== suggestion));
                                    setAnswerAnalysisState({ kind: "idle" });
                                }}>略過</button></div>
                            </aside>;
                        })()}
                        {part.answerMode !== "text" && <div className={styles.options}>{part.options.map((option) => <article className={styles.optionCard} key={option.key}><div className={styles.optionHead}><label><input type={part.answerMode === "multiple_choice" ? "checkbox" : "radio"} name={`${question.uid}-${part.uid}`} checked={part.answers.includes(option.key)} onChange={(event) => patchPart(questionIndex, partIndex, { answers: part.answerMode === "multiple_choice" ? event.target.checked ? [...part.answers, option.key] : part.answers.filter((answer) => answer !== option.key) : [option.key] })} /><strong>{option.key}</strong><span>設為正確答案</span></label>{part.answerMode !== "boolean" && part.options.length > 2 && <button className={styles.iconButton} aria-label={`移除選項 ${option.key}`} onClick={() => patchPart(questionIndex, partIndex, { options: part.options.filter((item) => item.key !== option.key), answers: part.answers.filter((answer) => answer !== option.key) })}><Trash2 /></button>}</div><RichContentEditor blocks={option.blocks} label={`選項 ${option.key} 內容`} onChange={(blocks) => patchPart(questionIndex, partIndex, { options: part.options.map((item) => item.key === option.key ? { ...item, blocks } : item) })} onUploadImage={uploadContentImage} /></article>)}{part.answerMode !== "boolean" && <button className={styles.secondary} onClick={() => {
                            const usedKeys = new Set(part.options.map((option) => option.key));
                            const key = Array.from({ length: 20 }, (_, index) => String.fromCharCode(65 + index)).find((candidate) => !usedKeys.has(candidate));
                            if (!key) return;
                            patchPart(questionIndex, partIndex, { options: [...part.options, { key, blocks: [{ kind: "text", text: `選項 ${key}` }] }] });
                        }}><Plus />新增選項</button>}</div>}
                        <RichContentEditor blocks={part.explanation.length > 0 ? part.explanation : [{ kind: "text", text: "" }]} label="解答與解析" onChange={(explanation) => patchPart(questionIndex, partIndex, { explanation })} onUploadImage={uploadContentImage} />
                        <section className={styles.hints}><div className={styles.sectionHeading}>{part.hints.length > 0 && <h4>作答前提示</h4>}<button className={styles.secondary} type="button" onClick={() => patchPart(questionIndex, partIndex, { hints: [...part.hints, [{ kind: "text", text: "" }]] })}><Plus />新增提示</button></div>{part.hints.map((hint, hintIndex) => <div className={styles.hintEditor} key={hintIndex}><div className={styles.hintHead}><strong>提示 {hintIndex + 1}</strong><button className={styles.iconButton} type="button" aria-label={`移除提示 ${hintIndex + 1}`} onClick={() => patchPart(questionIndex, partIndex, { hints: part.hints.filter((_, index) => index !== hintIndex) })}><Trash2 /></button></div><RichContentEditor blocks={hint} label={`提示 ${hintIndex + 1} 內容`} onChange={(blocks) => patchPart(questionIndex, partIndex, { hints: part.hints.map((item, index) => index === hintIndex ? blocks : item) })} onUploadImage={uploadContentImage} /></div>)}</section>
                        <details className={styles.advanced}><summary>更多設定</summary><div className={styles.two}><label><span>如何批改</span><AppSelect options={GRADING_OPTIONS} value={part.gradingPolicy} onChange={(event) => patchPart(questionIndex, partIndex, { gradingPolicy: event.target.value as ImportGradingPolicy })} /></label>{question.parts.length > 1 && <label><span>設為子題</span><select value={part.parentStableKey ?? ""} onChange={(event) => patchPart(questionIndex, partIndex, { parentStableKey: event.target.value || null })}><option value="">不設上層題目</option>{question.parts.filter((item) => item.uid !== part.uid).map((item) => <option key={item.uid} value={item.stableKey}>小題 {question.parts.findIndex((candidate) => candidate.uid === item.uid) + 1}</option>)}</select></label>}</div></details>
                    </section>)}<button className={styles.secondary} onClick={() => {
                        const part = blankPart(question.parts.length);
                        part.stableKey = nextPartKey(question.parts);
                        patchQuestion(questionIndex, { parts: [...question.parts, part] });
                    }}><Plus />{question.parts.length > 1 ? "新增小題" : "建立題組"}</button></div>
                    </section>
                    </div>
                </article>})}</div>
            </>}
            {templateOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateOpen(false); }}><section aria-modal="true" className={styles.templateDialog} role="dialog" aria-labelledby="template-title"><div className={styles.dialogHead}><div><p>建立題目</p><h2 id="template-title">選擇題目範本</h2></div><button className={styles.iconButton} aria-label="關閉範本選擇" onClick={() => setTemplateOpen(false)}><X /></button></div><p className={styles.dialogDescription}>{templateTarget === null ? "先查看學習者實際作答的樣子，再用範本建立題目。所有內容、答案與解析都能修改。" : "更換範本會保留題目內容與來源資訊，並以範本內容重建作答設定、選項、答案、提示與解析。"}</p><QuestionTemplateSelector selected={templateId} onSelect={(next) => { setTemplateId(next); setTemplateAnswer(""); setTemplateSolutionOpen(false); }} preview={<section className={styles.templatePreview} aria-label={`${templateDefinition.name}練習預覽`}><div className={styles.templatePreviewHead}><div><span>練習預覽</span><h3>{templateDefinition.name}</h3></div><span>可直接試答</span></div><div className={styles.previewBody}><PersistedQuestionPromptContent question={templatePreviewQuestion} title /><PersistedQuestionFields question={templatePreviewQuestion} answer={templateAnswer} onAnswer={setTemplateAnswer} hidePromptContent />{templateSolutionOpen && <QuestionSolutionPreview question={templateEditorQuestion} previewOptionImages={templateDefinition.previewOptionImages} />}</div><div className={styles.previewTools}><p className={styles.previewNote}>圖片選擇題會先建立圖片位置，套用後再上傳各選項圖片。</p><button className={styles.secondary} type="button" onClick={() => setTemplateSolutionOpen((open) => !open)}>{templateSolutionOpen ? "隱藏範本答案" : "查看範本答案"}</button></div></section>} /><div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setTemplateOpen(false)}>取消</button><button className={styles.primary} onClick={applyTemplate}>{templateTarget === null ? "使用這個範本" : "套用這個範本"}</button></div></section></div>}
            {publishOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPublishOpen(false); }}><section aria-modal="true" className={styles.publishDialog} role="dialog" aria-labelledby="publish-title"><div className={styles.dialogHead}><div><p>正式發布</p><h2 id="publish-title">加入題庫</h2></div><button className={styles.iconButton} aria-label="關閉加入題庫視窗" onClick={() => setPublishOpen(false)}><X /></button></div><p>科目是唯一必填分類。年級、單元、版本與自訂分類都可以留空，之後再補。</p><div className={styles.publishGrid}><label><span>提供給</span><select value={learnerId} onChange={(event) => setLearnerId(event.target.value)}>{learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.displayName}</option>)}</select></label>{catalog && <>{select("科目", "subjectId", catalog.subjects)}{select("年級", "gradeId", catalog.grades, true)}{select("學期", "semesterId", catalog.semesters, true)}{select("版本", "bookVersionId", versions, true)}{select("單元", "curriculumUnitId", curriculumUnits, true)}{select("難易度", "difficultyLevelId", catalog.difficulties, true)}{select("來源", "sourceCategoryId", catalog.sourceCategories, true)}</>}</div><section className={styles.taxonomyBuilder}><div><h3>建立自己的科目</h3><p>例如「英文終極檢定」。建立後只屬於這個帳號，帳號下的學習者可共用。</p></div><div className={styles.inlineCreate}><input value={newSubjectName} maxLength={80} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="新科目名稱" /><button className={styles.secondary} disabled={busy || !newSubjectName.trim()} onClick={() => void createSubject()}><Plus />建立科目</button></div></section>{catalogIds.subjectId && <section className={styles.taxonomyBuilder}><div className={styles.sectionHeading}><div><h3>科目分類設定</h3><p>分類不是必填。AI 只會從你建立的選項提出建議，不會自行新增或直接套用。</p></div><button className={styles.secondary} disabled={busy || classificationFields.every((field) => field.options.length === 0)} onClick={() => void requestSuggestions()}><Sparkles />AI 建議分類</button></div><div className={styles.inlineCreate}><input value={newFieldName} maxLength={100} onChange={(event) => setNewFieldName(event.target.value)} placeholder="分類欄位，例如：內容類型" /><select value={newFieldMode} onChange={(event) => setNewFieldMode(event.target.value as "single" | "multiple")}><option value="single">單選</option><option value="multiple">複選</option></select><button className={styles.secondary} disabled={busy || !newFieldName.trim()} onClick={() => void createField()}><Plus />新增欄位</button></div>{classificationFields.map((field) => <div className={styles.fieldEditor} key={field.id}><strong>{field.name}<small>{field.selectionMode === "single" ? "單選" : "複選"}</small></strong><div className={styles.optionTags}>{field.options.map((option) => <span key={option.id}>{option.label}</span>)}</div><div className={styles.inlineCreate}><input value={newOptionNames[field.id] ?? ""} maxLength={160} onChange={(event) => setNewOptionNames((current) => ({ ...current, [field.id]: event.target.value }))} placeholder={`新增${field.name}選項`} /><button className={styles.secondary} disabled={busy || !newOptionNames[field.id]?.trim()} onClick={() => void createOption(field)}><Plus />新增選項</button></div></div>)}</section>}{catalogIds.subjectId && classificationFields.some((field) => field.options.length > 0) && <section className={styles.questionClassifications}><h3>逐題分類</h3>{questions.map((question, questionIndex) => <article key={question.draftKey}><strong>第 {questionIndex + 1} 題</strong>{classificationFields.filter((field) => field.options.length > 0).map((field) => <fieldset key={field.id}><legend>{field.name}（{field.selectionMode === "single" ? "單選" : "可複選"}）</legend>{field.options.map((option) => { const checked = question.classifications.find((classification) => classification.fieldId === field.id)?.optionIds.includes(option.id) ?? false; return <label key={option.id}><input type={field.selectionMode === "single" ? "radio" : "checkbox"} name={`${question.draftKey}-${field.id}`} checked={checked} onChange={(event) => patchClassification(questionIndex, field, option.id, event.target.checked)} />{option.label}</label>; })}</fieldset>)}</article>)}</section>}{suggestions.length > 0 && <section className={styles.suggestions}><div className={styles.sectionHeading}><div><h3>AI 分類建議</h3><p>請逐筆確認；未接受的建議不會寫入題目。</p></div><button className={styles.secondary} onClick={() => { suggestions.forEach(acceptSuggestion); setSuggestions([]); }}>全部接受</button></div>{suggestions.map((suggestion) => { const questionIndex = questions.findIndex((question) => question.draftKey === suggestion.draftKey); const field = classificationFields.find((item) => item.id === suggestion.fieldId); const labels = suggestion.optionIds.map((optionId) => field?.options.find((option) => option.id === optionId)?.label).filter(Boolean).join("、"); return <div className={styles.suggestionCard} key={`${suggestion.draftKey}-${suggestion.fieldId}`}><div><strong>第 {questionIndex + 1} 題 · {field?.name}：{labels}</strong><p>{suggestion.reason} · 信心 {Math.round(suggestion.confidence * 100)}%</p></div><div><button className={styles.secondary} onClick={() => acceptSuggestion(suggestion)}>接受</button><button className={styles.iconButton} onClick={() => setSuggestions((current) => current.filter((item) => item !== suggestion))}>略過</button></div></div>; })}</section>}<div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setPublishOpen(false)}>稍後再說</button><button className={styles.primary} disabled={busy || !catalogIds.subjectId} onClick={() => void submit()}>{busy ? "加入中…" : "確認加入題庫"}</button></div></section></div>}
            {previewOpen && previewEditorQuestion && previewQuestion && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}><section aria-modal="true" className={styles.previewDialog} role="dialog" aria-labelledby="preview-title"><div className={styles.dialogHead}><div><p>實際練習介面</p><h2 id="preview-title">第 {previewIndex + 1} 題預覽</h2></div><button className={styles.iconButton} aria-label="關閉預覽" onClick={() => setPreviewOpen(false)}><X /></button></div><div className={styles.previewBody}><PersistedQuestionPromptContent question={previewQuestion} title /><PersistedQuestionFields question={previewQuestion} answer={previewAnswer} onAnswer={setPreviewAnswer} hidePromptContent />{previewSolutionOpen && <QuestionSolutionPreview question={previewEditorQuestion} />}</div><div className={styles.previewTools}><p className={styles.previewNote}>這裡的作答只供預覽，關閉後不會建立作答紀錄。</p><button className={styles.secondary} type="button" onClick={() => setPreviewSolutionOpen((open) => !open)}>{previewSolutionOpen ? "隱藏解答" : "顯示解答"}</button></div><div className={styles.previewNav}><button className={styles.secondary} disabled={previewIndex === 0} onClick={() => { setPreviewIndex((index) => index - 1); setPreviewAnswer(""); setPreviewSolutionOpen(false); }}>上一題</button><span>{previewIndex + 1}／{questions.length}</span><button className={styles.secondary} disabled={previewIndex >= questions.length - 1} onClick={() => { setPreviewIndex((index) => index + 1); setPreviewAnswer(""); setPreviewSolutionOpen(false); }}>下一題</button></div></section></div>}
        </section>
    </main>;
}
