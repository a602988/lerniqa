"use client";

import {
    Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox,
    Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, DialogTrigger, Dropdown, DropdownCheckboxItem, DropdownContent, DropdownIndicator,
    DropdownItem, DropdownLabel, DropdownRadioGroup, DropdownRadioItem, DropdownSeparator,
    DropdownSub, DropdownSubContent, DropdownSubTrigger, DropdownTrigger, FormField, Input,
    NativeSelect, Progress, Radio, Tabs, TabsContent, TabsList, TabsTrigger,
} from "@keel-design/ui";
import {
    ArrowLeft, ArrowRight, BarChart3, BookOpen, Bookmark, CalendarDays, CheckCircle2, ClipboardCheck,
    ChevronDown, ChevronRight, Clock3, FileUp, Flame, GraduationCap, Image as ImageIcon, Link2, LogIn, LogOut,
    FolderInput, ListChecks, Menu, Pause, Pencil, Plus, RotateCcw, Save, Search, Settings2, ShieldCheck, Sparkles, Target, Trash2, UploadCloud, UserCheck, UserPlus, Users, X, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HandwritingPad } from "./components/handwriting-pad";
import { LerniqaLogo, LerniqaMark } from "./components/lerniqa-mark";
import { QuestionFilterPanel } from "./components/question-filter-panel";
import {
    ACCEPTED_FILE_TYPES, AccountRole, ALL_KNOWLEDGE, ALL_UNITS, ASSESSMENT_OPTIONS, AssessmentRange, Attempt, BOOK_OPTIONS, BOOK_SETTING_OPTIONS, CheckMode,
    DEFAULT_QUESTION_LIMIT_OPTIONS,
    DEFAULT_ASSESSMENT_RANGES, DEFAULT_EXAM_SETTING, DEFAULT_PLAN, ExamSetting, FILE_SIZE_LIMIT, formatAnswer, getQuestionPartResults,
    GRADE_OPTIONS, getQuestionKindLabel, getUnitLabel, getUnitScopeValue, ImportBatch, ImportBook, Learner, PracticePlan, PracticeSession, Question, QuestionBlock, QuestionCollection,
    QuestionMetadataField, RoleAccess, ScheduledPractice, Section,
    SEMESTER_OPTIONS, Subject, SUBJECTS, checkAnswer, DEFAULT_ROLE_ACCESS,
} from "./lib/demo-data";
import {
    ALL_QUESTION_FILTERS, DEFAULT_QUESTION_FILTERS, filterQuestions, getPreferredQuestionSemester, getQuestionSourceCategory, normalizeQuestionFilters,
    isSupplementalQuestionMetadata, normalizeQuestionSourceCategory, QUESTION_SOURCE_CATEGORIES, QuestionFilters, questionUsesTextbookVersion,
} from "./lib/question-filters";
import { normalizeSubjectLabel } from "./lib/subject-labels";
import {
    findEducationStage,
    type EducationCatalog,
    type EducationStage,
} from "./lib/education-catalog-contract";
import {
    broadcastAuthSessionContextChanged,
    broadcastAuthSessionExpired,
    isAuthSessionContextStorageEvent,
    isAuthSessionStorageEvent,
} from "./lib/auth-session-client";
import { PersistedQuestionFields } from "./components/persisted-question-fields";
import { adaptPracticeAttempt, adaptPracticeQuestion, formatPracticeResponse, parsePracticeAnswers, practiceRouteId } from "./lib/practice-catalog-adapter";
import {
    clearPracticeSessionHint,
    createPracticeLearner,
    createInitialPracticePlan,
    getPersistedQuestionReferenceAnswers,
    getPersistedPracticeSession,
    isDeterministicPracticeApiError,
    isPracticeSessionExpired,
    loadEducationCatalog,
    loadPersistedPractice,
    mapPracticeAccountLearner,
    normalizeLoadedPracticePlan,
    PracticeApiError,
    PRACTICE_AUTH_EXPIRED_EVENT,
    type PracticeAccount,
    type PracticeAccountLearner,
    type PracticeAccountRole,
    readPracticePreferences,
    readPracticeSessionHint,
    previewPersistedPracticeRecommendations,
    shouldAdvanceAfterSubmit,
    selectPracticeLearner,
    startPersistedPracticeRecommendations,
    startPersistedPractice,
    submitPersistedPracticeAttempt,
    switchPracticeAccountRole,
    transcribePersistedHandwriting,
    updatePracticeAccountIdentity,
    updatePracticeLearner,
    updatePracticeLearnerSubjectSetting,
    updatePersistedPracticeSessionStatus,
    writePracticePreferences,
    writePracticeSessionHint,
} from "./lib/practice-client";
import {
    LOCAL_PRACTICE_MAX_QUESTIONS,
    LOCAL_PRACTICE_MAX_RECOMMENDATIONS,
    type LocalPracticeQuestion,
    type LocalPracticeRecommendationKind,
    type LocalPracticeRecommendationResult,
    type LocalPracticeReferenceAnswer,
    type LocalPracticeScoreSummary,
    type LocalPracticeSessionHistory,
    type LocalPracticeWrongQueueItem,
} from "./lib/local-practice-types";

type RecommendationPreviewState = {
    sourceKey: string;
    status: "loading" | "ready" | "error";
    result?: LocalPracticeRecommendationResult;
    error?: string;
};

interface QuestionFlowProps {
    serverQuestion?: LocalPracticeQuestion;
    busy?: boolean;
    answerLocked?: boolean;
    /** 目前題目。 */
    question: Question;
    /** 目前題號。 */
    index: number;
    /** 題目總數。 */
    total: number;
    /** 錯題複習時只顯示的小題識別碼。 */
    partIds?: string[];
    /** 檢核方式。 */
    checkMode: CheckMode;
    /** 文字答案。 */
    answer: string;
    /** 手寫內容。 */
    handwriting: string;
    /** 逐題檢核結果。 */
    feedback?: Attempt;
    /** 更新文字答案。 */
    onAnswer: (value: string) => void;
    /** 更新手寫內容。 */
    onHandwriting: (value: string) => void;
    /** 送出答案。 */
    onSubmit: () => void;
    /** 前往下一題。 */
    onNext: () => void;
}

interface WorkspaceHeadingProps {
    /** 標題圖示。 */
    icon: LucideIcon;
    /** 區塊標題。 */
    title: string;
    /** 區塊用途說明。 */
    description?: string;
}

interface PracticeFieldLabelProps {
    /** 子標題圖示。 */
    icon: LucideIcon;
    /** 子標題文字。 */
    label: string;
    /** 子標題配色。 */
    className?: string;
}

interface QuestionLimitControlProps {
    /** 目前題數。 */
    value: number;
    /** 可輸入的最大題數。 */
    maximum?: number;
    /** 是否禁止操作。 */
    disabled?: boolean;
    /** 下拉選單顯示的題數選項。 */
    options: number[];
    /** 題數更新事件。 */
    onChange: (value: number) => void;
}

interface QuestionReviewProps {
    serverQuestion?: LocalPracticeQuestion;
    /** 目前檢視的題目。 */
    question: Question;
    /** 目前題目在清單中的索引。 */
    index: number;
    /** 清單題目總數。 */
    total: number;
    /** 檢視來源名稱。 */
    title: string;
    /** 標題列的來源頁專屬操作。 */
    headerActions?: ReactNode;
    /** 以目前題目開始正式練習。 */
    onStartPractice?: () => void;
    /** 返回來源頁。 */
    onBack: () => void;
    /** 切換到上一題。 */
    onPrevious: () => void;
    /** 切換到下一題。 */
    onNext: () => void;
}

interface LearnerProfileDraft {
    learnerId?: string;
    displayName: string;
    educationStatus: PracticeAccountLearner["educationStatus"];
    educationStage: EducationStage | "";
    gradeCode: string;
    semesterCode: string;
}

interface QuestionAnswerFieldsProps {
    /** 目前題目。 */
    question: Question;
    /** 目前文字或結構化答案。 */
    answer: string;
    /** 只需顯示的小題識別碼。 */
    partIds?: string[];
    /** 是否禁止修改答案。 */
    disabled?: boolean;
    /** 更新目前答案。 */
    onAnswer: (value: string) => void;
}

const CHARACTER_HANDWRITING_LABEL = "寫出國字、注音";
const ANSWER_GRID_FOUR_COLUMN_BYTES = 48;
const ANSWER_GRID_TWO_COLUMN_BYTES = 144;
const AVATAR_FILE_SIZE_LIMIT = 1024 * 1024;
const AVATAR_FILE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MISTAKE_PAGE_SIZE = 10;
const RECENT_IMPORT_LIMIT = 10;
const QUESTION_OVERVIEW_PAGE_SIZE = 12;
/** 顯示練習設定欄位共用的圖示與標題。 */
function PracticeFieldLabel({ icon: Icon, label, className = "" }: PracticeFieldLabelProps) {
    return <span className={`practice-field-label ${className}`}><Icon aria-hidden="true" />{label}</span>;
}

/** 判斷題目是否必須以手寫方式作答並交由 AI 辨識。 */
function isCharacterHandwritingQuestion(question: Question) {
    return question.kind === "written" && question.typeLabel === CHARACTER_HANDWRITING_LABEL;
}

/** 依選項數量、內容長度與媒體內容決定答案欄數。 */
function getOptionColumnCount(options: string[], hasOptionMedia = false) {
    if (hasOptionMedia || options.length < 2) return 1;
    const totalBytes = options.reduce((total, option) => total + new TextEncoder().encode(option).length, 0);
    if (options.length >= 4 && totalBytes <= ANSWER_GRID_FOUR_COLUMN_BYTES) return 4;
    if (totalBytes <= ANSWER_GRID_TWO_COLUMN_BYTES) return 2;
    return 1;
}

/** 判斷小題文字是否只是把同一組答案選項再次串接顯示。 */
function isRepeatedOptionPrompt(prompt: string, options: string[]) {
    if (!prompt || !options.length) return false;

    const normalize = (value: string) => value
        .normalize("NFKC")
        .replace(/[\s。．.、；;]/g, "")
        .toLocaleLowerCase();

    return normalize(prompt) === normalize(options.join(""));
}

/** 依整題選項內容決定答案欄數。 */
function getAnswerColumnCount(question: Question) {
    const hasOptionMedia = question.blocks?.some((block) => block.placement === "option" && block.type !== "text");
    return getOptionColumnCount(question.options ?? [], hasOptionMedia);
}

/** 將複合題保存的 JSON 答案轉成各小題答案。 */
function getSelectedAnswers(answer: string) {
    try {
        const parsed = JSON.parse(answer) as unknown;
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return [];
    }
}

/** 整理題目可供辨識與篩選的條件，避免來源欄位重複顯示同一單元。 */
function getQuestionConditions(question: Question) {
    const unit = getUnitLabel(question.unit);
    const normalizeValue = (value: string) => value.replace(/\.[^.]+$/, "").replace(/[\s·_\-/\\]+/g, "").toLowerCase();
    const fixedConditions = [
        { label: "編號", value: question.code ?? question.sourceDetail?.questionNumber ?? String(question.id) },
        { label: "科目", value: question.subject },
        { label: "年級", value: question.grade },
        { label: "學期", value: question.semester },
        { label: "版本", value: question.bookVersion },
        { label: "章節", value: question.chapter && !normalizeValue(unit).startsWith(normalizeValue(question.chapter)) ? question.chapter : undefined },
        { label: "單元", value: unit },
        { label: "主題", value: question.topic },
        { label: "知識點", value: question.knowledge },
        { label: "難度", value: question.difficulty },
        { label: "題型", value: question.typeLabel ?? getQuestionKindLabel(question.kind) },
        { label: "來源", value: getQuestionSourceCategory(question) },
    ];
    const importedConditions = question.metadata
        ?.filter((field) => isSupplementalQuestionMetadata(field.key))
        .map((field) => ({ label: field.label, value: field.rawValue })) ?? [];
    const unique = new Set<string>();
    return [...fixedConditions, ...importedConditions].filter((condition): condition is { label: string; value: string } => {
        if (!condition.value) return false;
        const key = normalizeValue(condition.value);
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
    });
}

/**
 * 顯示題目可供辨識與篩選的條件標籤。
 * @param props 題目資料。
 * @returns 題目條件標籤清單。
 */
function QuestionConditions({ question }: { question: Question }) {
    const conditions = getQuestionConditions(question);

    return <dl className="practice-question-conditions" aria-label="題目條件">
        {conditions.map((condition) => (
            <div className="practice-question-condition" data-wide={condition.label === "來源" || condition.label === "來源文件"} key={`${condition.label}-${condition.value}`}>
                <dt>{condition.label}</dt><dd>{condition.value}</dd>
            </div>
        ))}
    </dl>;
}

interface CreatableSelectFieldProps {
    /** 欄位名稱。 */
    label: string;
    /** 可直接選取的既有項目。 */
    items: string[];
    /** 目前選取值。 */
    value: string;
    /** 新增項目的暫存文字。 */
    customValue: string;
    /** 新增項目的輸入提示。 */
    placeholder: string;
    /** 是否橫跨表單兩欄。 */
    wide?: boolean;
    /** 更新選取值。 */
    onChange: (value: string) => void;
    /** 更新新增項目的暫存文字。 */
    onCustomChange: (value: string) => void;
}

type AuthMode = "login" | "register" | "logout" | "forgot-password" | "quick-register" | "account-link";

type ImportDifficulty = "" | "易" | "中" | "難";
interface DifficultyMix {
    /** 簡單題占比。 */
    easy: number;
    /** 中等題占比。 */
    medium: number;
    /** 困難題占比。 */
    hard: number;
}

interface ImportQuestionDraft {
    /** 匯入流程中的暫時識別碼。 */
    id: string;
    /** 來源文件中的題目編號。 */
    code: string;
    /** AI 拆分後待校正的題幹。 */
    prompt: string;
    /** AI 辨識後待校正的答案。 */
    answer: string;
    /** 題目科目，空值交由 AI 建議。 */
    subject: Subject | "";
    /** 題目所屬書籍版本。 */
    version: string;
    /** 使用者自行新增的書籍版本。 */
    customVersion: string;
    /** 題目所在章節或課次。 */
    chapter: string;
    /** 使用者自行新增的章節或課次。 */
    customChapter: string;
    /** 題目在教材中的單元或課次。 */
    unit: string;
    /** 使用者自行新增的單元或課次。 */
    customUnit: string;
    /** 跨版本共用的學習主題。 */
    topic: string;
    /** 使用者自行新增的學習主題。 */
    customTopic: string;
    /** 題目難易度，空值交由 AI 建議。 */
    difficulty: ImportDifficulty;
    /** 已選擇的題目來源。 */
    source: string;
    /** 使用者自行輸入的題目來源。 */
    customSource: string;
    /** 來源文件中需要完整保留的其他欄位。 */
    metadata: QuestionMetadataField[];
    /** 與這一題關聯的題目圖片。 */
    imageUrl?: string;
    /** 題目圖片的原始檔名。 */
    imageName?: string;
    /** 與答案關聯的圖片。 */
    answerImageUrl?: string;
    /** 答案圖片的原始檔名。 */
    answerImageName?: string;
}

interface PracticeRecord {
    /** 練習紀錄識別碼。 */
    id: string;
    /** 練習用途。 */
    mode: PracticeSession["mode"];
    /** 該次練習的所有作答。 */
    attempts: Attempt[];
    /** Server disclosure mode for this completed session. */
    checkMode: CheckMode;
    /** Durable item count, including score-only sessions whose attempts stay masked. */
    itemCount: number;
    /** Number of items submitted before the session completed. */
    attemptedItemCount: number;
    /** Aggregate-only result for score mode; never contains per-question answers. */
    scoreSummary?: LocalPracticeScoreSummary;
    /** 練習開始時間。 */
    startedAt: string;
    /** 練習結束時間。 */
    completedAt: string;
}

const EMPTY_LEARNER: Learner = {
    id: "",
    name: "",
    educationStatus: "enrolled",
    grade: "",
    semester: "",
    bookVersions: { 數學: "", 國語: "", 英文: "", 理化: "", 生物: "", 歷史: "", 地理: "", 公民: "" },
    customSubjects: [],
    school: "",
    defaultQuestionLimit: 10,
    questionLimitOptions: [...DEFAULT_QUESTION_LIMIT_OPTIONS],
};

const NAV_ITEMS = [
    { id: "overview" as const, label: "總覽", icon: BarChart3 },
    { id: "practice" as const, label: "練習", icon: BookOpen },
    { id: "questions" as const, label: "題目總覽", icon: ListChecks },
    { id: "mistakes" as const, label: "錯題", icon: Target },
    { id: "settings" as const, label: "學習者設定", icon: UserCheck },
    { id: "system-settings" as const, label: "系統設定", icon: Settings2 },
];

const ACCOUNT_ROLE_LABELS: Record<PracticeAccountRole, AccountRole> = {
    parent: "家長",
    learner: "學習者",
    tutor: "家教",
};
const ACCOUNT_ROLE_CODES: Record<AccountRole, PracticeAccountRole> = {
    家長: "parent",
    學習者: "learner",
    家教: "tutor",
};
const ACCOUNT_IDENTITY_OPTIONS = (["parent", "learner", "tutor"] satisfies PracticeAccountRole[])
    .map((value) => ({ value, label: ACCOUNT_ROLE_LABELS[value] }));
const EMPTY_LEARNER_PROFILE_DRAFT: LearnerProfileDraft = {
    displayName: "",
    educationStatus: "enrolled",
    educationStage: "",
    gradeCode: "",
    semesterCode: "",
};

function roleAccessFromPracticeAccount(account: PracticeAccount): RoleAccess {
    const learnerIdsByRole: RoleAccess["learnerIdsByRole"] = { 家長: [], 學習者: [], 家教: [] };
    for (const profile of account.learners ?? []) {
        learnerIdsByRole[ACCOUNT_ROLE_LABELS[profile.accessRole ?? account.activeRole]].push(profile.id);
    }
    return {
        activeRole: ACCOUNT_ROLE_LABELS[account.activeRole],
        // The formal workspace never stores account email or legacy role PINs in client state.
        registrationEmail: "",
        pinHashes: {},
        learnerIdsByRole,
    };
}

const SECTION_PATHS: Record<Section, string> = {
    overview: "/overview",
    practice: "/practice",
    questions: "/questions",
    bank: "/bank",
    mistakes: "/mistakes",
    results: "/overview",
    settings: "/settings",
    "system-settings": "/system-settings",
};

const SESSION_PATH = "/practice/session";
const PRACTICE_SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PRACTICE_SCHEDULES_PATH = "/practice/schedules";
const QUESTION_OVERVIEW_PATH = "/questions";
const AUTH_PATHS: Record<AuthMode, string> = {
    login: "/login",
    register: "/register",
    logout: "/logout",
    "forgot-password": "/forgot-password",
    "quick-register": "/quick-register",
    "account-link": "/account-link",
};
const CUSTOM_IMPORT_VALUE = "__custom__";
const CUSTOM_SUBJECT_VALUE = "__custom_subject__";
const IMPORT_DIFFICULTY_OPTIONS = [
    { value: "", label: "交由 AI 分析" },
    { value: "易", label: "易" },
    { value: "中", label: "中" },
    { value: "難", label: "難" },
];
const DEFAULT_DIFFICULTY_MIX: DifficultyMix = DEFAULT_PLAN.difficultyMix;

/**
 * 依指定比例挑選各難易度題目，個別難度不足時由其餘符合條件的題目補足。
 * @param questions 已套用一般條件的候選題目。
 * @param limit 本輪題數上限。
 * @param mix 三種難易度的百分比。
 * @returns 維持原候選順序的題目清單。
 */
function selectQuestionsByDifficulty(questions: Question[], limit: number, mix: DifficultyMix) {
    const cappedLimit = Math.min(limit, questions.length);
    const groups = [
        { key: "easy" as const, label: "基礎" },
        { key: "medium" as const, label: "中等" },
        { key: "hard" as const, label: "進階" },
    ].map((group) => {
        const exact = cappedLimit * mix[group.key] / 100;
        return { ...group, target: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let unassigned = cappedLimit - groups.reduce((total, group) => total + group.target, 0);
    [...groups].sort((left, right) => right.remainder - left.remainder).forEach((group) => {
        if (unassigned <= 0) return;
        group.target += 1;
        unassigned -= 1;
    });

    const selectedIds = new Set<number>();
    groups.forEach((group) => questions
        .filter((question) => question.difficulty === group.label)
        .slice(0, group.target)
        .forEach((question) => selectedIds.add(question.id)));
    questions.forEach((question) => {
        if (selectedIds.size < cappedLimit) selectedIds.add(question.id);
    });
    return questions.filter((question) => selectedIds.has(question.id));
}
const IMPORT_DEMO_QUESTIONS = [
    { code: "", prompt: "請計算圖中陰影部分的面積。", answer: "24 平方公分", subject: "數學" as const, version: "康軒", chapter: "第 5 單元", unit: "面積", topic: "複合圖形面積", difficulty: "中" as const, source: "校內練習卷" },
    { code: "", prompt: "一個平角是多少度？", answer: "180°", subject: "數學" as const, version: "康軒", chapter: "第 3 單元", unit: "角度", topic: "角的分類", difficulty: "易" as const, source: "康軒數學四上" },
    { code: "", prompt: "一個周角相當於幾個平角？", answer: "2 個", subject: "數學" as const, version: "康軒", chapter: "第 3 單元", unit: "角度", topic: "周角與平角", difficulty: "易" as const, source: "康軒數學四上" },
    { code: "05010001", prompt: "銀「ㄅㄧˋ」：", answer: "幣", subject: "國語" as const, version: "翰林", chapter: "第一課", unit: "夏夜", topic: "寫出國字、注音", difficulty: "易" as const, source: "翰林國語第一冊 · 夏夜 · 試題" },
];

/** 建立可在確認後寫入 JSON 題庫的模擬辨識資料。 */
function createImportDrafts(images: Array<{ name: string; url: string }> = []): ImportQuestionDraft[] {
    return IMPORT_DEMO_QUESTIONS.map((question, index) => ({
        id: `import-${index + 1}`,
        code: question.code,
        prompt: question.prompt,
        answer: question.answer,
        subject: question.subject,
        version: question.version,
        customVersion: "",
        chapter: question.chapter,
        customChapter: "",
        unit: question.unit,
        customUnit: "",
        topic: question.topic,
        customTopic: "",
        difficulty: question.difficulty,
        source: normalizeQuestionSourceCategory(question.source),
        customSource: "",
        metadata: question.code ? [
            { key: "source_type", label: "出處", rawValue: "試題", values: ["試題"], valueSource: "document", confidence: 1 },
            { key: "cognitive_dimension", label: "認知向度", rawValue: "基本語文知識", values: ["基本語文知識"], valueSource: "document", confidence: 1 },
            { key: "knowledge_dimension", label: "知識向度", rawValue: "正確用字", values: ["正確用字"], valueSource: "document", confidence: 1 },
        ] : [{ key: "source_type", label: "來源類型", rawValue: "同步練習卷", values: ["同步練習卷"], valueSource: "ai", confidence: 0.75 }],
        ...(images[index] ? { imageName: images[index].name, imageUrl: images[index].url } : {}),
    }));
}

/** 將本機圖片讀成只存在目前頁面的預覽資料。 */
function readImage(file: File) {
    return new Promise<{ name: string; url: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, url: String(reader.result) });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/** 由目前網址取得工作區，未知路徑回到總覽。 */
function getSectionFromPath(pathname: string): Section {
    if (pathname === SECTION_PATHS.bank) return "questions";
    const section = Object.entries(SECTION_PATHS).find(([, path]) => path === pathname)?.[0];
    return section as Section | undefined
        ?? (getSettingsExamId(pathname)
            ? "settings"
            : getOverviewQuestionId(pathname) !== undefined
                ? "questions"
                : getSessionQuestionId(pathname) !== undefined || pathname === SESSION_PATH || pathname === PRACTICE_SCHEDULES_PATH
                    ? "practice"
                    : "overview");
}

/** 建立考試設定內頁網址。 */
function getSettingsExamPath(examId: string) {
    return `/settings/exams/${encodeURIComponent(examId)}`;
}

/** 從考試設定內頁網址取得考試識別碼。 */
function getSettingsExamId(pathname: string) {
    const match = pathname.match(/^\/settings\/exams\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

/** 建立可重新整理與分享的單題練習網址。 */
function getSessionQuestionPath(questionId: number) {
    return `${SESSION_PATH}/${questionId}`;
}

/** 從單題練習網址取得題目識別碼。 */
function getSessionQuestionId(pathname: string) {
    const match = pathname.match(/^\/practice\/session\/(\d+)$/);
    if (!match) return undefined;
    const questionId = Number(match[1]);
    return Number.isSafeInteger(questionId) ? questionId : undefined;
}

/** 建立題目總覽詳情頁網址。 */
function getOverviewQuestionPath(questionId: number) {
    return `${QUESTION_OVERVIEW_PATH}/${questionId}`;
}

/** 從題目總覽詳情頁網址取得題目識別碼。 */
function getOverviewQuestionId(pathname: string) {
    const match = pathname.match(/^\/questions\/(\d+)$/);
    if (!match) return undefined;
    const questionId = Number(match[1]);
    return Number.isSafeInteger(questionId) ? questionId : undefined;
}

/**
 * 取得同一大題的全部小題識別碼。
 * @param question 目前網址對應的題目。
 * @param questions 完整題庫。
 * @returns 依小題序號排列的題目識別碼。
 */
function getQuestionGroupIds(question: Question, questions: Question[]) {
    if (!question.group) return [question.id];
    return questions
        .filter((item) => item.group?.id === question.group?.id)
        .sort((left, right) => (left.group?.part ?? 0) - (right.group?.part ?? 0))
        .map((item) => item.id);
}

/**
 * 建立目前題目在本輪中的大題與小題標示。
 * @param question 目前作答題目。
 * @param session 本輪練習狀態。
 * @param questions 完整題庫。
 * @returns 一般題號或大題／小題標示。
 */
function getSessionQuestionLabel(question: Question | undefined, session: PracticeSession | undefined, questions: Question[]) {
    if (!question || !session) return "";
    if (!question.group) return `第 ${session.index + 1} 題`;
    const groupIds = session.questionIds.reduce<string[]>((ids, questionId) => {
        const item = questions.find((candidate) => candidate.id === questionId);
        const groupId = item?.group?.id ?? `question-${questionId}`;
        return ids.includes(groupId) ? ids : [...ids, groupId];
    }, []);
    const groupIndex = groupIds.indexOf(question.group.id) + 1;
    return `第 ${groupIndex} 大題・第 ${question.group.part} 小題`;
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 只保留各題最新一次作答。 */
function getLatestAttempts(attempts: Attempt[]) {
    const latest = new Map<number, Attempt>();
    attempts.forEach((attempt) => latest.set(attempt.questionId, attempt));
    return [...latest.values()];
}

/** Pending grading may coexist with an already incorrect part. */
function needsWrongReview(attempt: Attempt) {
    return attempt.correct === false || Boolean(attempt.partResults?.some((part) => !part.correct));
}

/** 取得每一題最新作答中需要再次練習的小題。 */
function getWrongPartIdsByQuestion(attempts: Attempt[]) {
    return attempts.reduce<Record<number, string[]>>((targets, attempt) => {
        const wrongPartIds = attempt.partResults?.filter((result) => !result.correct).map((result) => result.partId) ?? [];
        if (wrongPartIds.length) targets[attempt.questionId] = wrongPartIds;
        return targets;
    }, {});
}

/** 取得作答紀錄中答錯小題的原始題序標示。 */
function getWrongPartLabels(question: Question, attempt: Attempt) {
    return attempt.partResults?.flatMap((result) => {
        if (result.correct) return [];
        const index = question.parts?.findIndex((part) => part.id === result.partId) ?? -1;
        return index >= 0 ? [`第 ${index + 1} 小題`] : [];
    }) ?? [];
}

/** 將作答紀錄依每次練習分組；舊資料以相鄰三十分鐘視為同一次。 */
function getPracticeRecords(attempts: Attempt[], sessions: LocalPracticeSessionHistory[]) {
    const records = new Map<string, PracticeRecord>();
    let legacyId = "";
    let previousLegacyTime = 0;
    const sorted = [...attempts].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

    sorted.forEach((attempt) => {
        const attemptTime = new Date(attempt.date).getTime();
        if (!attempt.sessionId && (!legacyId || attemptTime - previousLegacyTime > 30 * 60 * 1000)) legacyId = `legacy-${attempt.date}`;
        const id = attempt.sessionId ?? legacyId;
        const existing = records.get(id);
        const mode = attempt.sessionMode ?? "practice";
        if (existing) {
            existing.attempts.push(attempt);
            existing.itemCount = existing.attempts.length;
            existing.attemptedItemCount = existing.attempts.length;
            existing.completedAt = attempt.date;
        }
        else {
            records.set(id, {
                id,
                mode,
                attempts: [attempt],
                checkMode: "instant",
                itemCount: 1,
                attemptedItemCount: 1,
                startedAt: attempt.date,
                completedAt: attempt.date,
            });
        }
        if (!attempt.sessionId) previousLegacyTime = attemptTime;
    });

    sessions.filter((session) => session.status === "completed").forEach((session) => {
        const existing = records.get(session.id);
        if (existing) {
            existing.checkMode = session.checkMode;
            existing.itemCount = session.itemCount;
            existing.attemptedItemCount = session.attemptedItemCount;
            existing.startedAt = session.startedAt;
            existing.completedAt = session.completedAt ?? existing.completedAt;
            if (session.summary) existing.scoreSummary = session.summary;
        }
        else if (session.disclosure === "score" && session.summary) {
            records.set(session.id, {
                id: session.id,
                mode: session.mode,
                attempts: [],
                checkMode: session.checkMode,
                itemCount: session.itemCount,
                attemptedItemCount: session.attemptedItemCount,
                scoreSummary: session.summary,
                startedAt: session.startedAt,
                completedAt: session.completedAt ?? session.startedAt,
            });
        }
    });

    return [...records.values()].sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
}

/**
 * 依臺北日期計算目前連續練習天數。
 * @param attempts 學習者的全部作答紀錄。
 * @returns 截至今天或昨天仍連續的練習天數。
 */
function getPracticeStreak(attempts: Attempt[]) {
    const practiceDays = new Set(attempts.flatMap((attempt) => {
        const timestamp = new Date(attempt.date).getTime();
        if (Number.isNaN(timestamp)) return [];
        return [new Date(timestamp + TAIPEI_OFFSET_MS).toISOString().slice(0, 10)];
    }));
    if (!practiceDays.size) return 0;

    const today = new Date(Date.now() + TAIPEI_OFFSET_MS);
    today.setUTCHours(0, 0, 0, 0);
    const dayKey = (date: Date) => date.toISOString().slice(0, 10);
    let cursor = new Date(today);

    if (!practiceDays.has(dayKey(cursor))) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        if (!practiceDays.has(dayKey(cursor))) return 0;
    }

    let streak = 0;
    while (practiceDays.has(dayKey(cursor))) {
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return streak;
}

/** 將秒數轉成易讀文字。 */
function formatDuration(seconds: number) {
    return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/** 顯示含日期與時間的本機作答時間。 */
function formatAttemptDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "日期未知";
    const taipeiDate = new Date(date.getTime() + TAIPEI_OFFSET_MS);
    const hour = taipeiDate.getUTCHours();
    const period = hour < 12 ? "上午" : "下午";
    const displayHour = String(hour % 12 || 12).padStart(2, "0");
    const minute = String(taipeiDate.getUTCMinutes()).padStart(2, "0");
    return `${taipeiDate.getUTCFullYear()}/${taipeiDate.getUTCMonth() + 1}/${taipeiDate.getUTCDate()} ${period}${displayHour}:${minute}`;
}

/** 由目前題目建立可擴充的文件欄位篩選目錄。 */
function getMetadataCatalog(questions: Question[]) {
    const catalog = new Map<string, { key: string; label: string; values: string[] }>();
    questions.forEach((question) => question.metadata?.forEach((field) => {
        if (!isSupplementalQuestionMetadata(field.key)) return;
        const current = catalog.get(field.key) ?? { key: field.key, label: field.label, values: [] };
        current.values = [...new Set([...current.values, ...field.values])].sort((left, right) => left.localeCompare(right, "zh-Hant"));
        catalog.set(field.key, current);
    }));
    return [...catalog.values()];
}

/** 依台北日期計算考試日期與今天相差的完整天數。 */
function getDayDifference(examDate: string) {
    if (!examDate) return null;
    const today = new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
    const examTimestamp = Date.parse(`${examDate}T00:00:00Z`);
    const todayTimestamp = Date.parse(`${today}T00:00:00Z`);
    return Number.isNaN(examTimestamp) ? null : Math.ceil((examTimestamp - todayTimestamp) / 86400000);
}

/** 將考試日期差顯示為頁首可辨識的倒數狀態。 */
function getExamCountdownLabel(dayDifference: number | null) {
    if (dayDifference === null) return "";
    if (dayDifference < 0) return "已結束";
    if (dayDifference === 0) return "今天";
    return `倒數 ${dayDifference} 天`;
}

/** 取得台北時區今天的日期字串。 */
function getTaipeiDate() {
    return new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 取得指定週次的週一至週日日期。 */
function getScheduleWeek(offset: number) {
    const today = getTaipeiDate();
    const todayDate = new Date(`${today}T00:00:00Z`);
    const mondayOffset = (todayDate.getUTCDay() + 6) % 7;
    const monday = new Date(todayDate);
    monday.setUTCDate(todayDate.getUTCDate() - mondayOffset + (offset * 7));
    const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
    return weekdayLabels.map((weekday, index) => {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + index);
        const value = date.toISOString().slice(0, 10);
        return { value, weekday, day: Number(value.slice(8, 10)), isToday: value === today };
    });
}

/** 顯示練習檢核方式。 */
function getCheckModeLabel(mode: CheckMode) {
    if (mode === "instant") return "逐題檢核";
    if (mode === "score") return "只顯示成績";
    return "全部作答後檢核";
}

/** 將題數輸入轉成可保存的正整數。 */
function parseLimit(value: string, maximum?: number) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1) return null;
    return maximum === undefined ? limit : Math.min(limit, maximum);
}

/** 由網址取得帳號頁面模式。 */
function getAuthMode(pathname: string): AuthMode | undefined {
    return Object.entries(AUTH_PATHS).find(([, path]) => path === pathname)?.[0] as AuthMode | undefined;
}

/** 將逗號分隔的題數清單轉成不重複的正整數。 */
function parseQuestionLimitOptions(value: string) {
    const parts = value.split(/[,，]/).map((part) => part.trim());
    if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) return null;
    const limits = [...new Set(parts.map(Number))];
    if (!limits.length || limits.length > 20 || limits.some((limit) => limit < 1 || limit > 500)) return null;
    return limits;
}

/** 提供學習者設定的常用題數與單次自訂整數輸入。 */
function QuestionLimitControl({ value, maximum, disabled = false, options: limits, onChange }: QuestionLimitControlProps) {
    const quickOptions = limits.map((limit) => ({ value: String(limit), label: `${limit} 題` }));
    const quickValue = limits.includes(value) ? String(value) : "";
    const options = quickValue
        ? quickOptions
        : [{ value: "", label: `自訂：${value} 題` }, ...quickOptions];

    return (
        <div className="grid gap-3 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(10rem,1fr)]">
            <NativeSelect
                aria-label="快速選擇題數"
                disabled={disabled}
                options={options}
                value={quickValue}
                onChange={(event) => {
                    const limit = parseLimit(event.target.value, maximum);
                    if (limit !== null) onChange(limit);
                }}
            />
            <Input
                aria-label="輸入題數"
                disabled={disabled}
                inputMode="numeric"
                max={maximum}
                min={1}
                step={1}
                type="number"
                value={disabled ? "" : value}
                onBlur={(event) => {
                    const limit = parseLimit(event.target.value, maximum);
                    onChange(limit ?? value);
                }}
                onChange={(event) => {
                    const limit = parseLimit(event.target.value, maximum);
                    if (limit !== null) onChange(limit);
                }}
            />
        </div>
    );
}

/** 顯示可從選單底部切換為新增模式的 Keel 表單欄位。 */
function CreatableSelectField({ label, items, value, customValue, placeholder, wide = false, onChange, onCustomChange }: CreatableSelectFieldProps) {
    const options = [
        { value: "", label: "交由 AI 分析" },
        ...[...new Set(items.filter(Boolean))].map((item) => ({ value: item, label: item })),
        { value: CUSTOM_IMPORT_VALUE, label: `＋ 新增${label}` },
    ];

    return (
        <div className={`grid gap-3 ${wide ? "sm:col-span-2" : ""}`}>
            <FormField label={label}><NativeSelect options={options} value={value} onChange={(event) => {
                onChange(event.target.value);
                if (event.target.value !== CUSTOM_IMPORT_VALUE) onCustomChange("");
            }} /></FormField>
            {value === CUSTOM_IMPORT_VALUE && <FormField label={`新增${label}`}><Input maxLength={120} placeholder={placeholder} value={customValue} onChange={(event) => onCustomChange(event.target.value)} /></FormField>}
        </div>
    );
}

/** 依 API 題目資料取得指定年級可使用的科目。 */
function getSubjectsForGrade(grade: string, questions: Question[], customSubjects: Subject[] = []) {
    const subjects = new Set(questions
        .filter((question) => !question.generatedFrom && question.grade === grade)
        .map((question) => question.subject));
    const systemSubjects = SUBJECTS.filter((subject) => subjects.has(subject));
    return [
        ...systemSubjects,
        ...customSubjects.filter((subject) => !systemSubjects.includes(subject as typeof systemSubjects[number])),
    ];
}

/** 顯示題目、答案或解析中的單一圖片區塊。 */
function ContentImage({ block }: { block: QuestionBlock }) {
    return <img
        alt={block.asset?.alt ?? "題目附圖"}
        className="max-h-64 w-full rounded-2xl border border-border bg-[#fafafa] object-contain p-2"
        src={`/api/v1/assets/${encodeURIComponent(block.asset?.storageKey ?? "")}`}
    />;
}

/** 顯示題目、答案或解析中的圖片區塊。 */
function ContentImages({ blocks, placement }: { blocks?: QuestionBlock[]; placement: QuestionBlock["placement"] }) {
    const images = blocks?.filter((block) => block.placement === placement && block.type === "image" && block.asset)
        .sort((first, second) => first.order - second.order) ?? [];
    if (!images.length) return null;

    return <div className="mt-4 grid gap-3">{images.map((block) => <ContentImage block={block} key={block.id} />)}</div>;
}

/** 將題目來源中的連續空白轉成可辨識的填答底線。 */
function PromptText({ text }: { text: string }) {
    const segments = text.split(/( {4,}|　{2,})/g);

    return <>{segments.map((segment, index) => {
        const isBlank = /^(?: {4,}|　{2,})$/.test(segment);
        if (!isBlank) return <Fragment key={`${index}-${segment}`}>{segment}</Fragment>;

        const blankWidth = [...segment].reduce((width, character) => width + (character === "　" ? 1 : 0.5), 0);
        const width = `${Math.min(Math.max(blankWidth, 3), 8)}em`;
        return <Fragment key={`blank-${index}`}>
            <span aria-hidden="true" className="question-prompt-blank" style={{ width }} />
            <span className="sr-only">填答處</span>
        </Fragment>;
    })}</>;
}

/**
 * 依題目區塊順序呈現文字與圖片，並依科目套用主要題幹字級。
 * @param question 題目資料。
 * @param className 題幹的額外樣式。
 * @param id 題幹元素識別碼。
 * @param title 是否以主要題幹標題呈現。
 * @returns 依內容順序排列的題幹與圖片。
 */
function QuestionPrompt({ question, className, id, title = false }: { question: Question; className?: string; id?: string; title?: boolean }) {
    const titleSize = title
        ? question.subject === "英文" ? "text-base lg:text-lg" : "text-xl lg:text-2xl"
        : "";
    const promptClassName = [className, titleSize].filter(Boolean).join(" ");
    const blocks = question.blocks?.filter((block) => block.placement === "prompt")
        .sort((first, second) => first.order - second.order) ?? [];
    const hasInterleavedContent = blocks.filter((block) => block.type === "text" && block.text).length > 1;
    if (!hasInterleavedContent) {
        return <>{title
            ? <CardTitle className={promptClassName} id={id}><PromptText text={question.prompt} /></CardTitle>
            : <p className={promptClassName} id={id}><PromptText text={question.prompt} /></p>}<ContentImages blocks={question.blocks} placement="prompt" /></>;
    }

    let textIndex = 0;
    return <div className="grid gap-4">{blocks.map((block) => {
        if (block.type === "image" && block.asset) return <ContentImage block={block} key={block.id} />;
        if (block.type !== "text" || !block.text) return null;

        const isFirstText = textIndex === 0;
        textIndex += 1;
        return title && isFirstText
            ? <CardTitle className={promptClassName} id={id} key={block.id}><PromptText text={block.text} /></CardTitle>
            : <p className={promptClassName} key={block.id}><PromptText text={block.text} /></p>;
    })}</div>;
}

/**
 * 顯示題庫設定的正式題型名稱，舊資料才退回一般題型名稱。
 * @param question 題目資料。
 * @returns 題型標示。
 */
function QuestionTypeLabel({ question }: { question: Question }) {
    const label = question.typeLabel?.trim() || getQuestionKindLabel(question.kind);

    return <p className="practice-question-type"><span>題型</span><strong>{label}</strong></p>;
}

/** 依題目資料逐題顯示複合選擇題的小題與選項。 */
function MultiChoiceAnswerFields({ question, answer, partIds, disabled = false, onAnswer }: QuestionAnswerFieldsProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const targetIds = partIds?.length ? new Set(partIds) : undefined;
    const parts = question.parts?.filter((part) => !targetIds || targetIds.has(part.id)) ?? [];
    const currentIndex = Math.min(activeIndex, Math.max(parts.length - 1, 0));
    const currentPart = parts[currentIndex];
    const selectedAnswers = question.parts?.length ? getSelectedAnswers(answer) : [];

    useEffect(() => setActiveIndex(0), [question.id]);

    if (!currentPart) return <p className="multi-choice-step-empty" role="status">這題缺少小題資料，暫時無法作答。</p>;

    const options = currentPart.options ?? [];
    const hasOptionMedia = question.blocks?.some((block) => block.placement === "option" && block.type !== "text");
    const answerColumnCount = getOptionColumnCount(options, hasOptionMedia);
    const showPrompt = !isRepeatedOptionPrompt(currentPart.prompt, options);

    /** 保存目前小題答案，不改變其他小題的選擇。 */
    function selectOption(option: string) {
        const answerCount = question.parts?.length ?? 0;
        const sourceIndex = question.parts?.findIndex((part) => part.id === currentPart.id) ?? -1;
        if (sourceIndex < 0) return;
        const nextAnswers = Array.from({ length: answerCount }, (_, answerIndex) => selectedAnswers[answerIndex] ?? "");
        nextAnswers[sourceIndex] = option;
        onAnswer(JSON.stringify(nextAnswers));
    }

    const sourceIndex = question.parts?.findIndex((part) => part.id === currentPart.id) ?? -1;
    const isPartReview = Boolean(targetIds);

    return <section className="multi-choice-step" aria-label="分題作答">
        <div className="multi-choice-step-header">
            <p aria-live="polite">{isPartReview ? <>第 <strong>{sourceIndex + 1}</strong> 小題 · 複習 {currentIndex + 1}／{parts.length}</> : <>小題 <strong>{currentIndex + 1}</strong>／{parts.length}</>}</p>
            {parts.length > 1 && <div className="multi-choice-step-actions">
                <Button appearance="outline" size="sm" disabled={currentIndex <= 0} onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}><ArrowLeft />上一小題</Button>
                <Button appearance="outline" size="sm" disabled={currentIndex >= parts.length - 1} onClick={() => setActiveIndex((index) => Math.min(index + 1, parts.length - 1))}>下一小題<ArrowRight /></Button>
            </div>}
        </div>
        <fieldset className={`answer-grid answer-grid-${answerColumnCount}`} data-answer-columns={answerColumnCount} disabled={disabled}>
            <legend className={showPrompt ? "multi-choice-step-prompt" : "sr-only"}>{showPrompt ? <PromptText text={currentPart.prompt} /> : "選擇答案"}</legend>
            {options.length
                ? options.map((option) => <label className="answer-option" key={option}><Radio name={`question-${question.id}-part-${currentPart.id}`} value={option} checked={sourceIndex >= 0 && selectedAnswers[sourceIndex] === option} onChange={() => selectOption(option)} /><span>{option}</span></label>)
                : <p className="multi-choice-step-empty" role="status">這一小題沒有可選答案。</p>}
        </fieldset>
    </section>;
}

/** 顯示正式練習與題目檢視共用的作答欄位。 */
function QuestionAnswerFields({ question, answer, partIds, disabled = false, onAnswer }: QuestionAnswerFieldsProps) {
    const needsCharacterRecognition = isCharacterHandwritingQuestion(question);
    const answerColumnCount = getAnswerColumnCount(question);
    const selectedAnswers = question.parts?.length ? getSelectedAnswers(answer) : [];
    const targetIds = partIds?.length ? new Set(partIds) : undefined;
    const visibleParts = question.parts?.filter((part) => !targetIds || targetIds.has(part.id)) ?? [];

    if (question.kind === "written") {
        if (needsCharacterRecognition) return null;

        if (visibleParts.length) {
            return <div className="written-answer-parts">
                {visibleParts.map((part) => {
                    const sourceIndex = question.parts?.findIndex((candidate) => candidate.id === part.id) ?? -1;
                    const isNamedPoint = /^[A-Z]$/i.test(part.id);
                    return <FormField
                        className="practice-answer-field"
                        key={part.id}
                        label={isNamedPoint ? part.id.toUpperCase() : `第 ${sourceIndex + 1} 空`}
                        layout="horizontal"
                        description={isNamedPoint ? undefined : <PromptText text={part.prompt} />}
                    >
                        <Input
                            value={sourceIndex >= 0 ? selectedAnswers[sourceIndex] ?? "" : ""}
                            disabled={disabled}
                            placeholder="輸入答案"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            onChange={(event) => {
                                if (sourceIndex < 0) return;
                                const nextAnswers = Array.from({ length: question.parts?.length ?? 0 }, (_, answerIndex) => selectedAnswers[answerIndex] ?? "");
                                nextAnswers[sourceIndex] = event.target.value;
                                onAnswer(JSON.stringify(nextAnswers));
                            }}
                        />
                    </FormField>;
                })}
            </div>;
        }

        return <FormField className="practice-answer-field" label="文字答案（選填）" layout="horizontal" description="可以直接手寫；送出後由本機 AI 逐字辨識手寫內容，不會判斷答案正誤。">
            <Input value={answer} disabled={disabled} placeholder="也可以只使用右側手寫板作答" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} onChange={(event) => onAnswer(event.target.value)} />
        </FormField>;
    }

    if (question.kind === "multi-choice") {
        return <MultiChoiceAnswerFields key={question.id} question={question} answer={answer} partIds={partIds} disabled={disabled} onAnswer={onAnswer} />;
    }

    return <fieldset className={`answer-grid answer-grid-${answerColumnCount}`} data-answer-columns={answerColumnCount} disabled={disabled}>
        <legend className="mb-1 text-sm font-semibold">選擇答案</legend>
        {question.options?.map((option) => <label className="answer-option" key={option}><Radio name={`question-${question.id}`} value={option} checked={answer === option} onChange={() => onAnswer(option)} /><span>{option}</span></label>)}
    </fieldset>;
}

/** 將伺服器解鎖的固定版本答案轉成人類可讀文字。 */
function formatReferenceAnswers(referenceAnswers: readonly LocalPracticeReferenceAnswer[]) {
    return referenceAnswers.map((reference, index) => {
        const optionLabels = new Map(reference.options.map((option) => [option.key, option.label]));
        const values = reference.acceptedValues.length
            ? reference.acceptedValues
            : reference.answerKeys.map((key) => optionLabels.get(key) ?? key);
        const value = values.length ? values.join("、") : "需人工批改";
        return referenceAnswers.length > 1 ? `第 ${index + 1} 小題：${value}` : value;
    }).join("；");
}

/** 將伺服器解鎖的固定版本解析去重後轉成人類可讀文字。 */
function formatReferenceExplanations(referenceAnswers: readonly LocalPracticeReferenceAnswer[]) {
    return [...new Set(referenceAnswers
        .map((reference) => reference.explanation?.trim())
        .filter((explanation): explanation is string => Boolean(explanation)))]
        .join("；");
}

/** 顯示題目總覽與匯入紀錄共用的滿版只讀題目內容。 */
function QuestionReview({ question, serverQuestion, index, total, title, headerActions, onStartPractice, onBack, onPrevious, onNext }: QuestionReviewProps) {
    const [referenceAnswers, setReferenceAnswers] = useState<LocalPracticeReferenceAnswer[]>([]);
    const [referenceAnswerStatus, setReferenceAnswerStatus] = useState("");
    const questionNumber = index >= 0 ? index + 1 : 1;
    const progress = total ? (questionNumber / total) * 100 : 0;
    const referenceExplanation = formatReferenceExplanations(referenceAnswers);

    useEffect(() => {
        let active = true;
        if (!serverQuestion) {
            setReferenceAnswers([]);
            setReferenceAnswerStatus("");
            return () => { active = false; };
        }
        setReferenceAnswers([]);
        setReferenceAnswerStatus("正在讀取參考答案…");
        void getPersistedQuestionReferenceAnswers(serverQuestion.id, serverQuestion.revisionId)
            .then((result) => {
                if (!active) return;
                setReferenceAnswers(result.referenceAnswers);
                setReferenceAnswerStatus(result.referenceAnswers.length ? "" : "這個版本尚無可顯示的參考答案。");
            })
            .catch((error) => {
                if (!active) return;
                setReferenceAnswerStatus(error instanceof Error ? error.message : "目前無法讀取參考答案。");
            });
        return () => { active = false; };
    }, [serverQuestion]);

    return <main className="practice-focus-shell question-review-shell">
        <div className="practice-focus-frame">
            <header className="practice-focus-header question-review-header">
                <div className="practice-focus-title flex min-w-0 items-center gap-3">
                    <div className="practice-focus-mark"><LerniqaMark className="h-6 w-6" /></div>
                    <h1 className="truncate text-base font-bold sm:text-lg">{title} · 第 {questionNumber} 題，共 {total} 題</h1>
                </div>
                <div className="practice-focus-actions">
                    {headerActions}
                    {onStartPractice && <Button onClick={onStartPractice}><BookOpen />開始練習</Button>}
                    <Button appearance="outline" tone="muted" onClick={onBack}><X />返回</Button>
                    <Button appearance="outline" disabled={index <= 0} onClick={onPrevious}><ArrowLeft />上一題</Button>
                    <Button appearance="outline" disabled={index < 0 || index >= total - 1} onClick={onNext}>下一題<ArrowRight /></Button>
                </div>
                <Progress className="practice-focus-progress" aria-label={`題目進度：第 ${questionNumber} 題，共 ${total} 題`} value={progress} />
            </header>
            <section className="practice-focus-content">
                <Card className="practice-question-card overflow-hidden border-border/80 shadow-sm">
                    <CardContent className="question-review-layout bg-white p-4">
                        <section className="practice-question-pane" aria-labelledby={`question-${question.id}-title`}>
                            <div className="practice-prompt">
                                <QuestionTypeLabel question={question} />
                                <QuestionPrompt question={question} id={`question-${question.id}-title`} className="question-review-prompt whitespace-pre-line" title />
                            </div>
                            <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground" role="note">這裡是題目預覽，不會保存作答；請按「開始練習」正式作答。</p>
                            {serverQuestion ? <PersistedQuestionFields question={serverQuestion} answer="" disabled onAnswer={() => {}} /> : <QuestionAnswerFields question={question} answer="" disabled onAnswer={() => {}} />}
                            <div className="question-review-solution">
                                <p className="question-detail-label">解答</p>
                                <strong>{serverQuestion
                                    ? referenceAnswers.length ? formatReferenceAnswers(referenceAnswers) : referenceAnswerStatus
                                    : formatAnswer(question, question.sourceAnswer ?? question.answer)}</strong>
                                {serverQuestion && referenceExplanation && <p className="mt-2 text-sm text-muted-foreground">{referenceExplanation}</p>}
                                <ContentImages blocks={question.blocks} placement="answer" />
                            </div>
                            <QuestionConditions question={question} />
                        </section>
                        <aside className="practice-handwriting-pane question-review-handwriting-pane">
                            <HandwritingPad value="" disabled recognitionStatus="預覽模式" onChange={() => {}} />
                        </aside>
                    </CardContent>
                </Card>
            </section>
        </div>
    </main>;
}

/** 顯示首頁的抽象學習圖形，不使用幼兒化角色。 */
function LearningScene() {
    return (
        <div className="learning-scene" aria-hidden="true">
            <div className="learning-scene-main"><BookOpen size={38} strokeWidth={1.8} /></div>
            <div className="learning-scene-star"><Sparkles size={17} /></div>
            <div className="learning-scene-dot"><Target size={19} /></div>
        </div>
    );
}

/** 統一工作區卡片的標題層級與圖示容器。 */
function WorkspaceHeading({ icon: Icon, title, description }: WorkspaceHeadingProps) {
    return (
        <div className="workspace-heading">
            <div className="workspace-heading-icon"><Icon size={19} /></div>
            <div>
                <CardTitle>{title}</CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
            </div>
        </div>
    );
}

/** 將舊工作區帳號路徑導向已連接 PostgreSQL 的正式帳號頁。 */
function AuthScreen({ mode }: { mode: AuthMode }) {
    const router = useRouter();
    const titles: Record<AuthMode, { title: string; description: string }> = {
        login: { title: "登入 Lerniqa", description: "使用電子郵件與密碼登入，繼續目前的學習進度。" },
        register: { title: "建立帳號", description: "建立帳號時會同步建立學習者資料並連到個人練習紀錄。" },
        logout: { title: "登出帳號", description: "登出後，此裝置將回到登入頁。" },
        "forgot-password": { title: "重設密碼", description: "郵件寄送尚未啟用，因此目前不能安全地重設密碼。" },
        "quick-register": { title: "第三方登入尚未開放", description: "目前請使用電子郵件與密碼建立帳號。" },
        "account-link": { title: "帳號綁定尚未開放", description: "目前只有電子郵件與密碼登入，不會建立假的第三方綁定。" },
    };
    const current = titles[mode];

    return (
        <main className="auth-shell">
            <div className="auth-ambient" aria-hidden="true">
                <span className="auth-orb auth-orb-primary" />
                <span className="auth-orb auth-orb-cyan" />
                <span className="auth-orb auth-orb-rose" />
                <span className="auth-float-card auth-float-card-book"><BookOpen /></span>
                <span className="auth-float-card auth-float-card-spark"><Sparkles /></span>
            </div>
            <Card className="auth-card border-border/80 shadow-sm">
                <CardHeader className="border-b border-border/80">
                    <Button className="auth-brand" appearance="ghost" tone="muted" onClick={() => router.push(SECTION_PATHS.overview)}>
                        <LerniqaLogo className="auth-wordmark" />
                    </Button>
                    {mode !== "login" && <div className="mt-6"><CardTitle>{current.title}</CardTitle><CardDescription>{current.description}</CardDescription></div>}
                </CardHeader>
                <CardContent className="grid gap-5 p-6 sm:p-8">
                    <div className="grid gap-3 text-center">
                        <div className="auth-logout-icon">{mode === "register" ? <UserPlus /> : mode === "logout" ? <LogOut /> : <LogIn />}</div>
                        <div><CardTitle>{current.title}</CardTitle><CardDescription className="mt-2">{current.description}</CardDescription></div>
                    </div>
                    <Button onClick={() => router.push("/account")}>{mode === "register" ? "前往建立帳號" : mode === "logout" ? "前往帳號中心登出" : "前往安全帳號頁"}<ArrowRight /></Button>
                    <Button appearance="ghost" tone="muted" onClick={() => router.push(SECTION_PATHS.overview)}>返回學習工作區</Button>
                </CardContent>
            </Card>
        </main>
    );
}

/** 顯示單題作答及手寫區。 */
function QuestionFlow(props: QuestionFlowProps) {
    const { question, serverQuestion, index, total, partIds, checkMode, answer, handwriting, feedback } = props;
    const reviewRef = useRef<HTMLElement>(null);
    const [handwritingAnalysis, setHandwritingAnalysis] = useState<{
        status: "idle" | "loading" | "clear" | "unreadable" | "error";
        message: string;
        recognizedAnswers?: Record<string, string>;
    }>({ status: "idle", message: "" });
    const needsCharacterRecognition = isCharacterHandwritingQuestion(question);
    const isLast = index === total - 1;
    const selectedAnswers = question.parts?.length ? getSelectedAnswers(answer) : [];
    const targetIds = partIds?.length ? new Set(partIds) : undefined;
    const targetParts = question.parts?.filter((part) => !targetIds || targetIds.has(part.id)) ?? [];
    const hasCompletePartAnswers = targetParts.length > 0 && targetParts.every((part) => {
        const partIndex = question.parts?.findIndex((candidate) => candidate.id === part.id) ?? -1;
        return partIndex >= 0 && Boolean(selectedAnswers[partIndex]);
    });
    const enteredParts = new Map(parsePracticeAnswers(answer).map((entry) => [entry.partId, entry.value]));
    const serverTargetParts = serverQuestion?.parts.filter((part) => !partIds?.length || partIds.includes(part.id)) ?? [];
    const handwritingTextParts = serverTargetParts.filter((part) => part.answerMode === "text");
    const handwritingPart = handwritingTextParts.length === 1 ? handwritingTextParts[0] : undefined;
    const hasCompleteServerAnswers = serverTargetParts.length > 0 && serverTargetParts.every((part) => {
        const value = enteredParts.get(part.id);
        return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
    });
    const missingServerParts = serverTargetParts.filter((part) => {
        const value = enteredParts.get(part.id);
        return Array.isArray(value) ? value.length === 0 : !value?.trim();
    });
    const canUseServerHandwriting = checkMode !== "score"
        && Boolean(handwriting)
        && missingServerParts.length > 0
        && missingServerParts.every((part) => part.answerMode === "text");
    const canSubmit = serverQuestion ? hasCompleteServerAnswers || canUseServerHandwriting : question.kind === "written"
        ? needsCharacterRecognition
            ? Boolean(handwriting)
            : targetParts.length
                ? hasCompletePartAnswers || Boolean(handwriting)
                : Boolean(answer.trim() || handwriting)
        : question.kind === "multi-choice"
            ? hasCompletePartAnswers
            : Boolean(answer.trim());
    const referenceExplanation = feedback?.referenceAnswers?.length
        ? formatReferenceExplanations(feedback.referenceAnswers)
        : "";

    useEffect(() => {
        setHandwritingAnalysis({ status: "idle", message: "" });
    }, [question.id, serverQuestion?.revisionId]);

    useEffect(() => {
        if (!feedback || !window.matchMedia("(min-width: 640px) and (max-width: 1023px)").matches) return;

        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        const frame = window.requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior, block: "nearest" }));
        return () => window.cancelAnimationFrame(frame);
    }, [feedback]);

    /**
     * 清除舊辨識結果後更新筆跡，避免作答區顯示先前畫面的文字。
     * @param value 最新手寫 PNG；空字串代表已清除。
     * @returns 無回傳值。
     */
    function changeHandwriting(value: string) {
        setHandwritingAnalysis({ status: "idle", message: "" });
        props.onHandwriting(value);
    }

    /**
     * 辨識目前手寫內容並把文字顯示在唯一的文字作答欄位。
     * @returns 無回傳值。
     */
    async function analyzeHandwriting() {
        if (!handwriting || !handwritingPart || handwritingAnalysis.status === "loading") return;

        setHandwritingAnalysis({ status: "loading", message: "正在辨識手寫內容…" });
        try {
            const result = await transcribePersistedHandwriting({ dataUrl: handwriting });
            if (result.legibility === "clear" && result.transcription) {
                setHandwritingAnalysis({
                    status: "clear",
                    message: "已將辨識文字放入作答；若內容不符，請清除後重新書寫。",
                    recognizedAnswers: { [handwritingPart.id]: result.transcription },
                });
                return;
            }
            setHandwritingAnalysis({
                status: "unreadable",
                message: "目前無法清楚辨識。請清除後重新書寫，或直接送出等待人工批改。",
            });
        }
        catch (error) {
            setHandwritingAnalysis({
                status: "error",
                message: error instanceof Error
                    ? error.message
                    : "本機 AI 目前無法使用，可直接送出並等待人工批改。",
            });
        }
    }

    const canAnalyzeHandwriting = needsCharacterRecognition && Boolean(serverQuestion && handwritingPart);
    const recognitionStatus = handwritingAnalysis.status === "loading"
        ? "正在分析"
        : handwritingAnalysis.status === "clear"
            ? "已填入作答"
            : "寫完後按 AI 分析";

    return (
        <Card className="practice-question-card overflow-hidden border-border/80 shadow-sm">
            <CardContent className="practice-question-layout bg-white p-4" data-has-feedback={feedback ? "true" : "false"}>
                <div className="practice-question-main">
                    <section className="practice-question-pane" aria-labelledby={`question-${question.id}-title`}>
                        <div className="practice-prompt">
                            <QuestionTypeLabel question={question} />
                            <QuestionPrompt question={question} id={`question-${question.id}-title`} className="whitespace-pre-line leading-relaxed" title />
                        </div>
                        {serverQuestion ? <PersistedQuestionFields question={serverQuestion} answer={answer} handwritingOnly={needsCharacterRecognition} submitted={Boolean(feedback)} recognizedAnswers={feedback?.recognizedAnswers ?? handwritingAnalysis.recognizedAnswers} partIds={partIds} disabled={Boolean(feedback) || props.busy || props.answerLocked} onAnswer={props.onAnswer} /> : <QuestionAnswerFields question={question} answer={answer} partIds={partIds} disabled={Boolean(feedback)} onAnswer={props.onAnswer} />}
                    </section>
                    {feedback && <aside ref={reviewRef} className={`practice-answer-review rounded-2xl border p-4 ${feedback.correct === true ? "border-emerald-200 bg-emerald-50" : feedback.correct === false ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`} role="status">
                        <div className="flex items-center gap-2 font-bold">{feedback.correct === true ? <CheckCircle2 className="text-emerald-700" /> : feedback.correct === false ? <XCircle className="text-rose-700" /> : <Clock3 className="text-amber-700" />}{serverQuestion ? feedback.correct === true ? "答對了，作答已保存" : feedback.correct === false ? "答案不符標準答案，已加入錯題複習" : "作答已保存，等待批改或補齊標準答案" : feedback.correct === true ? "答對了" : feedback.correct === false ? `答錯了。正確答案：${formatAnswer(question, question.answer)}` : needsCharacterRecognition ? "手寫內容已保存，等待 AI 辨識" : "手寫內容已保存，等待檢視"}</div>
                        {serverQuestion && feedback.referenceAnswers?.length ? <p className="mt-2 text-sm font-semibold">參考答案：{formatReferenceAnswers(feedback.referenceAnswers)}</p> : null}
                        {feedback.correct !== null && <ContentImages blocks={question.blocks} placement="answer" />}
                        {feedback.correct !== null && (serverQuestion
                            ? referenceExplanation ? <p className="mt-2 text-sm text-muted-foreground">解析：{referenceExplanation}</p> : null
                            : <p className="mt-2 text-sm text-muted-foreground">{question.explanation}</p>)}
                    </aside>}
                    <div className="practice-question-meta"><QuestionConditions question={question} /></div>
                    <div className="practice-question-actions">{feedback
                        ? <Button onClick={props.onNext}>{isLast ? "查看結果" : "下一題"}<ArrowRight /></Button>
                        : <Button disabled={!canSubmit || props.busy} onClick={props.onSubmit}>{props.busy ? "正在保存…" : checkMode === "instant" ? "檢查答案" : isLast ? checkMode === "score" ? "完成並看成績" : "完成並檢核" : checkMode === "score" ? "計入成績並到下一題" : "儲存並到下一題"}<ArrowRight /></Button>}
                    </div>
                </div>
                <aside className="practice-handwriting-pane">
                    {checkMode === "score" && <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="note">只顯示成績模式不保存作答內容，因此不能提交手寫板。請改用「逐題檢核」或「全部作答後檢核」保存筆跡。</p>}
                    <HandwritingPad
                        value={handwriting}
                        disabled={Boolean(feedback) || props.busy || props.answerLocked || checkMode === "score" || handwritingAnalysis.status === "loading"}
                        recognitionStatus={canAnalyzeHandwriting ? recognitionStatus : needsCharacterRecognition ? "送出後辨識文字" : undefined}
                        analysisBusy={handwritingAnalysis.status === "loading"}
                        onAnalyze={canAnalyzeHandwriting ? analyzeHandwriting : undefined}
                        onChange={changeHandwriting}
                    />
                    {canAnalyzeHandwriting && handwritingAnalysis.message && <p className="text-sm text-muted-foreground" role="status">{handwritingAnalysis.message}</p>}
                </aside>
            </CardContent>
        </Card>
    );
}

/** Lerniqa 多科目學習工作區。 */
export default function Home() {
    const pathname = usePathname();
    const router = useRouter();
    const [learners, setLearners] = useState<Learner[]>([]);
    const [activeLearnerId, setActiveLearnerId] = useState("");
    const [attemptsByLearner, setAttemptsByLearner] = useState<Record<string, Attempt[]>>({});
    const [practiceSessionsByLearner, setPracticeSessionsByLearner] = useState<Record<string, LocalPracticeSessionHistory[]>>({});
    const [plansByLearner, setPlansByLearner] = useState<Record<string, PracticePlan>>({});
    const [schedulesByLearner, setSchedulesByLearner] = useState<Record<string, ScheduledPractice[]>>({});
    const [wrongReviewQueue, setWrongReviewQueue] = useState<LocalPracticeWrongQueueItem[]>([]);
    const [recommendationQueueRefreshing, setRecommendationQueueRefreshing] = useState(false);
    const [recommendationPreviews, setRecommendationPreviews] = useState<Record<number, RecommendationPreviewState>>({});
    const [recommendationNotice, setRecommendationNotice] = useState("");
    const [questionCollectionsByLearner, setQuestionCollectionsByLearner] = useState<Record<string, QuestionCollection[]>>({});
    const [roleAccess, setRoleAccess] = useState<RoleAccess>(DEFAULT_ROLE_ACCESS);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [persistedQuestions, setPersistedQuestions] = useState<Map<number, LocalPracticeQuestion>>(new Map());
    const [persistedLearnerId, setPersistedLearnerId] = useState("");
    const [practiceAccount, setPracticeAccount] = useState<PracticeAccount>();
    const [educationCatalog, setEducationCatalog] = useState<EducationCatalog>();
    const [educationCatalogError, setEducationCatalogError] = useState("");
    const [practiceReloadToken, setPracticeReloadToken] = useState(0);
    const [practiceServiceError, setPracticeServiceError] = useState("");
    const [practiceBusy, setPracticeBusy] = useState(false);
    const practiceRequestRef = useRef(false);
    const sessionRequestRef = useRef<{ fingerprint: string; sessionId: string } | undefined>(undefined);
    const attemptRequestRef = useRef<{
        questionId: string;
        sessionId: string;
        sessionItemId?: string;
        partId?: string;
        idempotencyKey: string;
        answers: ReturnType<typeof parsePracticeAnswers>;
        handwriting?: { dataUrl: string };
        durationSeconds: number;
    } | undefined>(undefined);
    const recommendationRequestRef = useRef<{ fingerprint: string; sessionId: string } | undefined>(undefined);
    const [imports, setImports] = useState<ImportBatch[]>([]);
    const [importBooks, setImportBooks] = useState<ImportBook[]>([]);
    const [section, setSection] = useState<Section>("overview");
    const [session, setSession] = useState<PracticeSession>();
    const [recommendationSessionKind, setRecommendationSessionKind] = useState<Exclude<LocalPracticeRecommendationKind, "none"> | null>(null);
    const [sessionPaused, setSessionPaused] = useState(false);
    const [sessionExitOpen, setSessionExitOpen] = useState(false);
    const [answer, setAnswer] = useState("");
    const [handwriting, setHandwriting] = useState("");
    const [mistakeFilters, setMistakeFilters] = useState<QuestionFilters>(DEFAULT_QUESTION_FILTERS);
    const [mistakeFiltersOpen, setMistakeFiltersOpen] = useState(false);
    const [mistakePage, setMistakePage] = useState(1);
    const [mistakeRankingView, setMistakeRankingView] = useState<"personal" | "community">("personal");
    const [selectedMistakes, setSelectedMistakes] = useState<number[]>([]);
    const [questionFilters, setQuestionFilters] = useState<QuestionFilters>(DEFAULT_QUESTION_FILTERS);
    const [questionFiltersOpen, setQuestionFiltersOpen] = useState(false);
    const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
    const [selectedQuestionId, setSelectedQuestionId] = useState<number>();
    const [questionPage, setQuestionPage] = useState(1);
    const [questionBatchScope, setQuestionBatchScope] = useState<"selected" | "filtered">("selected");
    const [questionCollectionAction, setQuestionCollectionAction] = useState<"add" | "move">("add");
    const [targetCollectionId, setTargetCollectionId] = useState("");
    const [questionBatchOpen, setQuestionBatchOpen] = useState(false);
    const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState("");
    const [questionPlanDialogOpen, setQuestionPlanDialogOpen] = useState(false);
    const [questionPlanDate, setQuestionPlanDate] = useState(getTaipeiDate);
    const [questionPlanTime, setQuestionPlanTime] = useState("");
    const [pendingQuestionIds, setPendingQuestionIds] = useState<number[]>([]);
    const [questionPlanSource, setQuestionPlanSource] = useState<"題目總覽" | "錯題">("題目總覽");
    const [questionActionStatus, setQuestionActionStatus] = useState("");
    const [fileNames, setFileNames] = useState<string[]>([]);
    const [fileError, setFileError] = useState("");
    const [importText, setImportText] = useState("");
    const [importStatus, setImportStatus] = useState("");
    const [isImporting, setIsImporting] = useState(false);
    const [importGrade, setImportGrade] = useState("");
    const [importDrafts, setImportDrafts] = useState<ImportQuestionDraft[]>([]);
    const [selectedImportBookId, setSelectedImportBookId] = useState("");
    const [newImportBookName, setNewImportBookName] = useState("");
    const [creatingImportBook, setCreatingImportBook] = useState(false);
    const [isImportDragging, setIsImportDragging] = useState(false);
    const [bankCode, setBankCode] = useState("");
    const [bankMetadataFilters, setBankMetadataFilters] = useState<Record<string, string[]>>({});
    const [bankView, setBankView] = useState<"create" | "history">("create");
    const [selectedImportId, setSelectedImportId] = useState("");
    const [importReviewQuestionId, setImportReviewQuestionId] = useState<number>();
    const [advancedPlanOpen, setAdvancedPlanOpen] = useState(false);
    const [scheduleDate, setScheduleDate] = useState(getTaipeiDate);
    const [scheduleTime, setScheduleTime] = useState("");
    const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [schedulePanelOpen, setSchedulePanelOpen] = useState(false);
    const [expandedScheduleId, setExpandedScheduleId] = useState("");
    const [editingScheduleId, setEditingScheduleId] = useState("");
    const [editingScheduleDate, setEditingScheduleDate] = useState("");
    const [editingScheduleTime, setEditingScheduleTime] = useState("");
    const [editingScheduleCheckMode, setEditingScheduleCheckMode] = useState<CheckMode>("instant");
    const [scheduleStatus, setScheduleStatus] = useState<"pending" | "completed">("pending");
    const [selectedPracticeRecordId, setSelectedPracticeRecordId] = useState("");
    const [isHydrated, setIsHydrated] = useState(false);
    const [storageError, setStorageError] = useState("");
    const [avatarError, setAvatarError] = useState("");
    const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
    const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
    const [roleDialogOpen, setRoleDialogOpen] = useState(false);
    const [requestedRole, setRequestedRole] = useState<AccountRole>(DEFAULT_ROLE_ACCESS.activeRole);
    const [rolePassword, setRolePassword] = useState("");
    const [roleStatus, setRoleStatus] = useState("");
    const [questionLimitOptionsDraft, setQuestionLimitOptionsDraft] = useState("");
    const [questionLimitOptionsError, setQuestionLimitOptionsError] = useState("");
    const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
    const [subjectChoice, setSubjectChoice] = useState("");
    const [subjectDraft, setSubjectDraft] = useState("");
    const [subjectError, setSubjectError] = useState("");
    const [learnerProfileDialogOpen, setLearnerProfileDialogOpen] = useState(false);
    const [learnerProfileDraft, setLearnerProfileDraft] = useState<LearnerProfileDraft>(EMPTY_LEARNER_PROFILE_DRAFT);
    const [learnerProfileStatus, setLearnerProfileStatus] = useState("");
    const [learnerProfileBusy, setLearnerProfileBusy] = useState(false);
    const [subjectSettingBusyCode, setSubjectSettingBusyCode] = useState("");
    const [subjectSettingStatus, setSubjectSettingStatus] = useState("");
    const [selectedSubjectSettingCode, setSelectedSubjectSettingCode] = useState("");
    const createLearnerRequestRef = useRef<{ fingerprint: string; clientRequestId: string } | undefined>(undefined);
    const [roleSwitchBusy, setRoleSwitchBusy] = useState(false);
    const [identityRole, setIdentityRole] = useState<PracticeAccountRole>("learner");
    const [identityPassword, setIdentityPassword] = useState("");
    const [identityStatus, setIdentityStatus] = useState("");
    const [identityBusy, setIdentityBusy] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
    const sessionHeadingRef = useRef<HTMLHeadingElement>(null);
    const shouldFocusSectionRef = useRef(false);
    const skipNextApiWriteRef = useRef(true);
    const questionOverviewScrollRef = useRef(0);
    const shouldRestoreQuestionScrollRef = useRef(false);
    const questionFilterBaselineRef = useRef<{
        learnerId: string;
        grade: string;
        filters: QuestionFilters;
    } | undefined>(undefined);

    const clearAuthenticatedWorkspace = useCallback((message: string) => {
        // Account, learner, questions, attempts, and the active session are one privacy boundary.
        // A 401 from any operation must purge all of them before redirecting a shared-device tab.
        setPracticeAccount(undefined);
        setPersistedQuestions(new Map());
        setPersistedLearnerId("");
        setLearners([]);
        setActiveLearnerId("");
        setQuestions([]);
        setAttemptsByLearner({});
        setPracticeSessionsByLearner({});
        setPlansByLearner({});
        setSchedulesByLearner({});
        setWrongReviewQueue([]);
        setRecommendationQueueRefreshing(false);
        setRecommendationPreviews({});
        setRecommendationNotice("");
        setQuestionCollectionsByLearner({});
        setRoleAccess(DEFAULT_ROLE_ACCESS);
        setImports([]);
        setImportBooks([]);
        setSession(undefined);
        setRecommendationSessionKind(null);
        setSessionPaused(false);
        setSessionExitOpen(false);
        setAnswer("");
        setHandwriting("");
        setSelectedQuestionIds([]);
        setSelectedQuestionId(undefined);
        setSelectedMistakes([]);
        setPracticeBusy(false);
        practiceRequestRef.current = false;
        sessionRequestRef.current = undefined;
        attemptRequestRef.current = undefined;
        recommendationRequestRef.current = undefined;
        setPracticeServiceError("");
        setStorageError(message);
        router.replace("/account");
    }, [router]);

    const activeLearner = learners.find((learner) => learner.id === activeLearnerId) ?? learners[0] ?? EMPTY_LEARNER;
    const accountLearners = practiceAccount?.learners?.length
        ? practiceAccount.learners
        : practiceAccount?.learner ? [practiceAccount.learner] : [];
    const activeAccountLearner = accountLearners.find((learner) => learner.id === activeLearnerId)
        ?? (practiceAccount?.learner?.id === activeLearnerId ? practiceAccount.learner : undefined);
    const canAccessSystemSettings = !practiceAccount || Boolean(
        (practiceAccount.activeRole === "parent" || practiceAccount.activeRole === "tutor")
        || (practiceAccount.accountRole === "learner"
            && practiceAccount.activeRole === "learner"
            && activeAccountLearner?.isSelf)
    );
    const canAccessLearnerSettings = !practiceAccount || Boolean(activeAccountLearner);
    const canManageCurrentLearner = !practiceAccount || Boolean(activeAccountLearner?.canManageSettings);
    const canCreateLearner = Boolean(practiceAccount
        && (practiceAccount.activeRole === "parent" || practiceAccount.activeRole === "tutor"));
    const grantedRoleOptions = (practiceAccount?.roles ?? [])
        .map((role) => ({ value: ACCOUNT_ROLE_LABELS[role], label: ACCOUNT_ROLE_LABELS[role] }));
    const storedPlan = plansByLearner[activeLearnerId];
    const activePlan: PracticePlan = {
        ...DEFAULT_PLAN,
        ...storedPlan,
        examSettings: storedPlan?.examSettings?.length ? storedPlan.examSettings : DEFAULT_PLAN.examSettings,
        activeExamId: storedPlan?.activeExamId ?? DEFAULT_PLAN.activeExamId,
        difficultyMix: { ...DEFAULT_DIFFICULTY_MIX, ...storedPlan?.difficultyMix },
        scopeFilters: [...(storedPlan?.scopeFilters ?? DEFAULT_PLAN.scopeFilters)],
        difficultyFilters: [...(storedPlan?.difficultyFilters ?? DEFAULT_PLAN.difficultyFilters)],
        sourceFilters: storedPlan?.sourceFilters
            ? [...new Set(storedPlan.sourceFilters.map(normalizeQuestionSourceCategory))]
            : [...DEFAULT_PLAN.sourceFilters],
        questionKinds: [...(storedPlan?.questionKinds ?? DEFAULT_PLAN.questionKinds)],
        knowledge: storedPlan?.knowledge ?? DEFAULT_PLAN.knowledge,
        metadataFilters: Object.fromEntries(Object.entries(storedPlan?.metadataFilters ?? DEFAULT_PLAN.metadataFilters)
            .map(([key, values]) => [key, [...values]])),
    };
    const activeExam = activePlan.examSettings.find((exam) => exam.id === activePlan.activeExamId)
        ?? activePlan.examSettings[0]
        ?? DEFAULT_EXAM_SETTING;
    const activeDifficultyMix = activePlan.difficultyMix;
    const difficultyTotal = activeDifficultyMix.easy + activeDifficultyMix.medium + activeDifficultyMix.hard;
    const difficultyMixValid = !activePlan.difficultyMixEnabled || difficultyTotal === 100;
    const activeAttempts = attemptsByLearner[activeLearnerId] ?? [];
    const recommendationLimit = Math.min(activeLearner.defaultQuestionLimit, LOCAL_PRACTICE_MAX_RECOMMENDATIONS);
    const practiceStreak = useMemo(() => getPracticeStreak(activeAttempts), [activeAttempts]);
    const activeSchedules = useMemo(() => [...(schedulesByLearner[activeLearnerId] ?? [])]
        .sort((left, right) => `${left.date}T${left.time ?? "23:59"}`.localeCompare(`${right.date}T${right.time ?? "23:59"}`)), [activeLearnerId, schedulesByLearner]);
    const isScheduleListPage = pathname === PRACTICE_SCHEDULES_PATH;
    const configurableSubjects = useMemo(() => [...new Set([
        ...(persistedLearnerId === activeLearner.id
            ? Object.keys(activeLearner.bookVersions)
            : SUBJECTS.filter((subject) => Boolean(activeLearner.bookVersions[subject]))),
        ...activeLearner.customSubjects,
    ])], [activeLearner.bookVersions, activeLearner.customSubjects, activeLearner.id, persistedLearnerId]);
    const unselectedCatalogSubjects = useMemo(
        () => SUBJECTS.filter((subject) => !configurableSubjects.includes(subject)),
        [configurableSubjects],
    );
    const availableSubjects = useMemo(() => persistedLearnerId === activeLearner.id
        ? configurableSubjects
        : configurableSubjects.filter((subject) => Boolean(activeLearner.bookVersions[subject])), [activeLearner.bookVersions, activeLearner.id, configurableSubjects, persistedLearnerId]);
    const baseQuestions = useMemo(() => questions.filter((question) => !question.generatedFrom), [questions]);
    const learnerQuestions = useMemo(() => baseQuestions.filter((question) => (!persistedQuestions.has(question.id) || activeLearnerId === persistedLearnerId)
        && (activeLearner.educationStatus !== "enrolled" || question.grade === activeLearner.grade)
        && availableSubjects.includes(question.subject)), [activeLearner.educationStatus, activeLearner.grade, activeLearnerId, persistedLearnerId, persistedQuestions, availableSubjects, baseQuestions]);

    useEffect(() => {
        let active = true;
        void loadEducationCatalog()
            .then((catalog) => {
                if (!active) return;
                setEducationCatalog(catalog);
                setEducationCatalogError("");
            })
            .catch((error) => {
                if (!active) return;
                setEducationCatalogError(error instanceof Error ? error.message : "目前無法讀取教育階段與年級。");
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        const handleAuthenticationExpired = () => clearAuthenticatedWorkspace(
            "登入狀態已失效，請重新登入。未保留或載入任何帳號資料。",
        );
        const handleAuthenticationStorage = (event: StorageEvent) => {
            if (isAuthSessionStorageEvent(event)) {
                handleAuthenticationExpired();
                return;
            }
            if (isAuthSessionContextStorageEvent(event)) window.location.reload();
        };
        window.addEventListener(PRACTICE_AUTH_EXPIRED_EVENT, handleAuthenticationExpired);
        window.addEventListener("storage", handleAuthenticationStorage);
        return () => {
            window.removeEventListener(PRACTICE_AUTH_EXPIRED_EVENT, handleAuthenticationExpired);
            window.removeEventListener("storage", handleAuthenticationStorage);
        };
    }, [clearAuthenticatedWorkspace]);

    useEffect(() => {
        const expiresAt = practiceAccount?.expiresAt;
        if (!expiresAt) return;
        let active = true;
        let revalidating = false;
        const expireIfNeeded = (): boolean => {
            if (!isPracticeSessionExpired(expiresAt)) return false;
            broadcastAuthSessionExpired();
            return true;
        };
        const revalidateAuthentication = async () => {
            if (expireIfNeeded() || revalidating) return;
            revalidating = true;
            try {
                const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
                if (!active) return;
                if (response.status === 401) {
                    broadcastAuthSessionExpired();
                    return;
                }
                if (response.ok) {
                    const payload = await response.json().catch(() => null) as {
                        data?: { account?: PracticeAccount };
                    } | null;
                    const currentAccount = payload?.data?.account;
                    if (!currentAccount
                        || currentAccount.activeRole !== practiceAccount.activeRole
                        || currentAccount.accountRole !== practiceAccount.accountRole
                        || currentAccount.learner?.id !== practiceAccount.learner?.id) {
                        clearAuthenticatedWorkspace("帳號的角色或學習者已在其他分頁變更；舊工作區資料已清除，請重新進入。");
                    }
                }
            }
            catch {
                // A transient network failure must not erase an otherwise valid local workspace.
            }
            finally {
                revalidating = false;
            }
        };
        const expiresAtMillis = new Date(expiresAt).getTime();
        const delay = Math.max(0, Math.min(expiresAtMillis - Date.now(), 2_147_483_647));
        const timer = window.setTimeout(expireIfNeeded, delay);
        const handleFocus = () => { void revalidateAuthentication(); };
        const handleVisibility = () => {
            if (document.visibilityState === "visible") void revalidateAuthentication();
        };
        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibility);
        expireIfNeeded();
        return () => {
            active = false;
            window.clearTimeout(timer);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [
        clearAuthenticatedWorkspace,
        practiceAccount?.accountRole,
        practiceAccount?.activeRole,
        practiceAccount?.expiresAt,
        practiceAccount?.learner?.id,
    ]);

    useEffect(() => {
        setQuestionLimitOptionsDraft(activeLearner.questionLimitOptions.join(", "));
        setQuestionLimitOptionsError("");
    }, [activeLearner.id, activeLearner.questionLimitOptions]);
    useEffect(() => {
        if (!practiceAccount?.accountRole) return;
        setIdentityRole(practiceAccount.accountRole);
        setIdentityPassword("");
        setIdentityStatus("");
    }, [practiceAccount?.accountRole]);
    const activeQuestionCollections = useMemo(
        () => questionCollectionsByLearner[activeLearnerId] ?? [],
        [activeLearnerId, questionCollectionsByLearner],
    );
    const practiceFilters = useMemo<QuestionFilters>(() => ({
        subject: activePlan.subject as Subject | "全部",
        semester: activePlan.semester,
        version: activePlan.subject === "全部"
            ? ALL_QUESTION_FILTERS
            : activePlan.bookVersion || activeLearner.bookVersions[activePlan.subject] || ALL_QUESTION_FILTERS,
        scope: activePlan.scopeFilters,
        topic: activePlan.topic,
        knowledge: activePlan.knowledge === ALL_KNOWLEDGE ? ALL_QUESTION_FILTERS : activePlan.knowledge,
        difficulty: activePlan.difficultyMixEnabled ? [] : activePlan.difficultyFilters,
        kind: activePlan.questionKinds,
        source: activePlan.sourceFilters,
        creator: activePlan.creatorFilter,
        metadata: Object.fromEntries(Object.entries(activePlan.metadataFilters).map(([key, values]) => [
            key,
            values[0] ?? ALL_QUESTION_FILTERS,
        ])),
        collection: activePlan.collection,
        search: activePlan.search,
    }), [activeLearner.bookVersions, activePlan]);
    const questionFilterBaseline = useMemo<QuestionFilters>(() => {
        const subject = availableSubjects.find((candidate) => learnerQuestions.some((question) => question.subject === candidate))
            ?? "全部";
        const semester = activeLearner.semester
            && learnerQuestions.some((question) => question.subject === subject && question.semester === activeLearner.semester)
            ? activeLearner.semester
            : ALL_QUESTION_FILTERS;
        const preferredVersion = subject === "全部" ? "" : activeLearner.bookVersions[subject];
        const version = preferredVersion
            && learnerQuestions.some((question) => question.subject === subject && question.bookVersion === preferredVersion)
            ? preferredVersion
            : ALL_QUESTION_FILTERS;
        return normalizeQuestionFilters({
            ...DEFAULT_QUESTION_FILTERS,
            subject,
            semester,
            version,
        }, learnerQuestions, activeQuestionCollections);
    }, [activeLearner.bookVersions, activeLearner.semester, activeQuestionCollections, availableSubjects, learnerQuestions]);
    const filteredOverviewQuestions = useMemo(
        () => filterQuestions(learnerQuestions, questionFilters, activeQuestionCollections),
        [activeQuestionCollections, learnerQuestions, questionFilters],
    );
    const questionPageCount = Math.max(1, Math.ceil(filteredOverviewQuestions.length / QUESTION_OVERVIEW_PAGE_SIZE));
    const activeQuestionPage = Math.min(questionPage, questionPageCount);
    const pagedOverviewQuestions = filteredOverviewQuestions.slice((activeQuestionPage - 1) * QUESTION_OVERVIEW_PAGE_SIZE, activeQuestionPage * QUESTION_OVERVIEW_PAGE_SIZE);
    const selectedOverviewQuestion = questions.find((question) => question.id === selectedQuestionId);
    const detailOverviewQuestions = selectedQuestionId && filteredOverviewQuestions.some((question) => question.id === selectedQuestionId)
        ? filteredOverviewQuestions
        : learnerQuestions;
    const selectedOverviewIndex = detailOverviewQuestions.findIndex((question) => question.id === selectedQuestionId);
    const questionActionIds = questionBatchScope === "filtered"
        ? filteredOverviewQuestions.map((question) => question.id)
        : selectedQuestionIds;
    const activeTargetCollectionId = activeQuestionCollections.some((collection) => collection.id === targetCollectionId)
        ? targetCollectionId
        : activeQuestionCollections[0]?.id ?? "";
    const activeSubject = availableSubjects.find((subject) => subject === activePlan.subject);
    const activeBookVersion = activeSubject
        ? activePlan.bookVersion ?? activeLearner.bookVersions[activeSubject]
        : "";
    const versionedLearnerQuestions = useMemo(() => learnerQuestions.filter((question) => {
        const configuredVersion = activePlan.subject === question.subject && activePlan.bookVersion
            ? activePlan.bookVersion
            : activeLearner.bookVersions[question.subject];
        return !questionUsesTextbookVersion(question) || !question.bookVersion || !configuredVersion || question.bookVersion === configuredVersion;
    }), [activeLearner.bookVersions, activePlan.bookVersion, activePlan.subject, learnerQuestions]);
    const scopeOptions = useMemo(() => {
        const filtered = activePlan.subject === "全部" ? versionedLearnerQuestions : versionedLearnerQuestions.filter((question) => question.subject === activePlan.subject);
        const unique = new Map(filtered.map((question) => [getUnitScopeValue(question), `${question.subject} · ${getUnitLabel(question.unit)}`]));
        return [{ value: ALL_UNITS, label: "全部單元" }, ...[...unique].map(([value, label]) => ({ value, label }))];
    }, [activePlan.subject, versionedLearnerQuestions]);
    const assessmentOptionsBySubject = useMemo(() => Object.fromEntries(availableSubjects.map((subject) => {
        const units = new Map(versionedLearnerQuestions
            .filter((question) => question.subject === subject)
            .map((question) => [getUnitScopeValue(question), getUnitLabel(question.unit)]));
        return [subject, [...units].map(([value, label]) => ({ value, label }))];
    })) as Partial<Record<Subject, { value: string; label: string }[]>>, [availableSubjects, versionedLearnerQuestions]);
    const recentImports = useMemo(() => [...imports]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, RECENT_IMPORT_LIMIT), [imports]);
    const availableImportBooks = useMemo(() => importBooks.filter((book) => book.ownerRole === roleAccess.activeRole
        && book.learnerIds.includes(activeLearnerId)), [activeLearnerId, importBooks, roleAccess.activeRole]);
    const selectedImport = useMemo(() => imports.find((batch) => batch.id === selectedImportId), [imports, selectedImportId]);
    const selectedImportQuestions = useMemo(() => selectedImport
        ? selectedImport.questionIds.map((id) => questions.find((question) => question.id === id)).filter((question): question is Question => Boolean(question))
        : [], [questions, selectedImport]);
    const bankMetadataCatalog = useMemo(() => getMetadataCatalog(selectedImportQuestions), [selectedImportQuestions]);
    const bankFilteredQuestions = useMemo(() => selectedImportQuestions.filter((question) => (!bankCode.trim() || question.code?.includes(bankCode.trim()))
        && Object.entries(bankMetadataFilters).every(([key, values]) => !values.length
            || question.metadata?.some((field) => field.key === key && field.values.some((value) => values.includes(value))))), [bankCode, bankMetadataFilters, selectedImportQuestions]);
    const importReviewQuestion = selectedImportQuestions.find((question) => question.id === importReviewQuestionId);
    const importReviewQuestions = importReviewQuestion && bankFilteredQuestions.some((question) => question.id === importReviewQuestion.id)
        ? bankFilteredQuestions
        : selectedImportQuestions;
    const importReviewIndex = importReviewQuestions.findIndex((question) => question.id === importReviewQuestionId);
    const practiceCandidateQuestions = learnerQuestions;
    const eligibleQuestions = useMemo(
        () => filterQuestions(practiceCandidateQuestions, practiceFilters, activeQuestionCollections),
        [activeQuestionCollections, practiceCandidateQuestions, practiceFilters],
    );
    const plannedQuestions = useMemo(() => activePlan.difficultyMixEnabled
        ? selectQuestionsByDifficulty(eligibleQuestions, activePlan.questionLimit, activeDifficultyMix)
        : eligibleQuestions.slice(0, activePlan.questionLimit), [activeDifficultyMix, activePlan.difficultyMixEnabled, activePlan.questionLimit, eligibleQuestions]);
    const latestAttempts = useMemo(() => getLatestAttempts(activeAttempts), [activeAttempts]);
    const recommendationQueueIdsByQuestion = useMemo(() => {
        const newestQueueByQuestionPart = new Map<string, LocalPracticeWrongQueueItem>();
        wrongReviewQueue
            .slice()
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .forEach((item) => {
                const routeId = practiceRouteId(item.questionId);
                const serverQuestion = persistedQuestions.get(routeId);
                if (
                    !serverQuestion
                    || serverQuestion.id !== item.questionId
                    || serverQuestion.revisionId !== item.revisionId
                ) return;
                const queueKey = `${routeId}:${item.partId ?? "whole-question"}`;
                if (!newestQueueByQuestionPart.has(queueKey)) newestQueueByQuestionPart.set(queueKey, item);
            });

        const idsByQuestion = new Map<number, string[]>();
        newestQueueByQuestionPart.forEach((item) => {
            const routeId = practiceRouteId(item.questionId);
            idsByQuestion.set(routeId, [...(idsByQuestion.get(routeId) ?? []), item.id]);
        });
        return idsByQuestion;
    }, [persistedQuestions, wrongReviewQueue]);
    const selectedLatestAttempts = useMemo(() => {
        const eligibleQuestionIds = new Set(eligibleQuestions.map((question) => question.id));
        return latestAttempts.filter((attempt) => eligibleQuestionIds.has(attempt.questionId));
    }, [eligibleQuestions, latestAttempts]);
    const selectedReviewedAttempts = useMemo(() => selectedLatestAttempts.filter((attempt) => attempt.correct !== null), [selectedLatestAttempts]);
    const selectedCorrectCount = selectedReviewedAttempts.filter((attempt) => attempt.correct === true).length;
    const practiceCoverage = eligibleQuestions.length
        ? Math.round((selectedLatestAttempts.length / eligibleQuestions.length) * 100)
        : 0;
    const selectedAccuracy = selectedReviewedAttempts.length
        ? Math.round((selectedCorrectCount / selectedReviewedAttempts.length) * 100)
        : null;
    const activePracticeSessions = practiceSessionsByLearner[activeLearnerId] ?? [];
    const practiceRecords = useMemo(
        () => getPracticeRecords(activeAttempts, activePracticeSessions),
        [activeAttempts, activePracticeSessions],
    );
    const mistakeQuestions = useMemo(() => {
        const wrongCounts = activeAttempts.reduce<Map<number, number>>((counts, attempt) => {
            if (!needsWrongReview(attempt)) return counts;
            counts.set(attempt.questionId, (counts.get(attempt.questionId) ?? 0) + 1);
            return counts;
        }, new Map());
        const wrongQuestionIds = new Set([
            ...latestAttempts.filter(needsWrongReview).map((attempt) => attempt.questionId),
            ...recommendationQueueIdsByQuestion.keys(),
        ]);
        return [...wrongQuestionIds]
            .map((questionId) => questions.find((question) => question.id === questionId))
            .filter((question): question is Question => Boolean(question))
            .sort((left, right) => (wrongCounts.get(right.id) ?? 0) - (wrongCounts.get(left.id) ?? 0));
    }, [activeAttempts, latestAttempts, questions, recommendationQueueIdsByQuestion]);
    const recommendableMistakeIds = mistakeQuestions
        .map((question) => question.id)
        .filter((questionId) => recommendationQueueIdsByQuestion.has(questionId));
    const communityMistakeRows = useMemo(() => {
        const learnerQuestionMap = new Map(learnerQuestions.map((question) => [question.id, question]));
        const stats = Object.values(attemptsByLearner).flat().reduce<Map<number, { total: number; wrong: number }>>((rows, attempt) => {
            if (attempt.correct === null || !learnerQuestionMap.has(attempt.questionId)) return rows;
            const current = rows.get(attempt.questionId) ?? { total: 0, wrong: 0 };
            current.total += 1;
            if (attempt.correct === false) current.wrong += 1;
            rows.set(attempt.questionId, current);
            return rows;
        }, new Map());
        return [...stats.entries()].flatMap(([questionId, stat]) => {
            const question = learnerQuestionMap.get(questionId);
            if (!question || !stat.wrong) return [];
            return [{ question, ...stat, wrongRate: Math.round((stat.wrong / stat.total) * 100) }];
        }).sort((left, right) => right.wrongRate - left.wrongRate || right.wrong - left.wrong || right.total - left.total);
    }, [attemptsByLearner, learnerQuestions]);
    const rankingQuestions = useMemo(() => mistakeRankingView === "personal"
        ? mistakeQuestions
        : communityMistakeRows.map((row) => row.question), [communityMistakeRows, mistakeQuestions, mistakeRankingView]);
    const filteredRankingQuestions = useMemo(
        () => filterQuestions(rankingQuestions, mistakeFilters, activeQuestionCollections),
        [activeQuestionCollections, mistakeFilters, rankingQuestions],
    );
    const filteredRankingIds = useMemo(
        () => new Set(filteredRankingQuestions.map((question) => question.id)),
        [filteredRankingQuestions],
    );
    const visibleMistakeQuestions = mistakeRankingView === "personal" ? filteredRankingQuestions : [];
    const visibleCommunityMistakeRows = useMemo(() => mistakeRankingView === "community"
        ? communityMistakeRows.filter(({ question }) => filteredRankingIds.has(question.id))
        : [], [communityMistakeRows, filteredRankingIds, mistakeRankingView]);
    const mistakeResultCount = mistakeRankingView === "personal" ? visibleMistakeQuestions.length : visibleCommunityMistakeRows.length;
    const mistakePageCount = Math.max(1, Math.ceil(mistakeResultCount / MISTAKE_PAGE_SIZE));
    const activeMistakePage = Math.min(mistakePage, mistakePageCount);
    const pagedMistakeQuestions = visibleMistakeQuestions.slice((activeMistakePage - 1) * MISTAKE_PAGE_SIZE, activeMistakePage * MISTAKE_PAGE_SIZE);
    const pagedCommunityMistakeRows = visibleCommunityMistakeRows.slice((activeMistakePage - 1) * MISTAKE_PAGE_SIZE, activeMistakePage * MISTAKE_PAGE_SIZE);
    const reviewedAttempts = activeAttempts.filter((attempt) => attempt.correct !== null);
    const correctCount = reviewedAttempts.filter((attempt) => attempt.correct === true).length;
    const scoreOnlySummaries = practiceRecords.flatMap((record) => record.scoreSummary ? [record.scoreSummary] : []);
    const scoreOnlyCorrectCount = scoreOnlySummaries.reduce((total, summary) => total + summary.correct, 0);
    const scoreOnlyWrongCount = scoreOnlySummaries.reduce((total, summary) => total + summary.wrong, 0);
    const reviewedCount = reviewedAttempts.length + scoreOnlyCorrectCount + scoreOnlyWrongCount;
    const totalCorrectCount = correctCount + scoreOnlyCorrectCount;
    const historyAttemptedCount = activeAttempts.length
        + practiceRecords.reduce((total, record) => total + (record.scoreSummary ? record.attemptedItemCount : 0), 0);
    const accuracy = reviewedCount ? Math.round((totalCorrectCount / reviewedCount) * 100) : 0;
    const currentQuestion = session ? questions.find((question) => question.id === session.questionIds[session.index]) : undefined;
    const currentPersistedItem = session?.persistedItems?.[session.index];
    const currentTargetPartIds = currentPersistedItem?.partId
        ? [currentPersistedItem.partId]
        : currentQuestion ? session?.partIdsByQuestion?.[currentQuestion.id] : undefined;
    const sessionQuestionLabel = getSessionQuestionLabel(currentQuestion, session, questions);
    const currentFeedback = currentQuestion && session?.checkMode === "instant"
        ? session.attempts.find((attempt) => currentPersistedItem
            ? attempt.sessionItemId === currentPersistedItem.id
            : attempt.questionId === currentQuestion.id)
        : undefined;
    const planSubjectLabel = activeSubject
        ? `${activeSubject} · ${activeBookVersion}版`
        : "全部科目";
    const subjectsWithoutPreferredVersion = availableSubjects.filter((subject) => !activeLearner.bookVersions[subject]);
    const learnerFilterSetupNotice = !activeLearner.semester
        ? "這位學習者尚未設定學期；目前不會自動限制學期。"
        : subjectsWithoutPreferredVersion.length
            ? `${subjectsWithoutPreferredVersion.join("、")}尚未設定教材版本；系統不會自行猜選版本。`
            : "";

    useEffect(() => {
        let active = true;

        async function loadBootstrap() {
            try {
                const persisted = await loadPersistedPractice();
                if (!active) return;
                const mapped = new Map(persisted.questions.map((question) => [practiceRouteId(question.id), question]));
                if (mapped.size !== persisted.questions.length) throw new Error("題目路徑識別碼重複，請聯絡管理者。");
                const accountLearner = persisted.account.learner;
                setPracticeAccount(persisted.account);
                if (!accountLearner) {
                    const accessibleLearners = (persisted.account.learners ?? []).map((profile) => mapPracticeAccountLearner(
                        profile,
                        readPracticePreferences(profile.id),
                    ));
                    setPersistedQuestions(new Map());
                    setPersistedLearnerId("");
                    setQuestions([]);
                    setLearners(accessibleLearners);
                    setActiveLearnerId("");
                    setAttemptsByLearner({});
                    setPracticeSessionsByLearner({});
                    setPlansByLearner({});
                    setSchedulesByLearner({});
                    setQuestionCollectionsByLearner({});
                    setWrongReviewQueue([]);
                    setRecommendationQueueRefreshing(false);
                    setRecommendationPreviews({});
                    setRecommendationNotice("");
                    setRoleAccess(roleAccessFromPracticeAccount(persisted.account));
                    setImports([]);
                    setImportBooks([]);
                    setSession(undefined);
                    setRecommendationSessionKind(null);
                    setStorageError("");
                    setPracticeServiceError("請先在系統設定建立或選擇學習者。");
                    return;
                }
                const preferences = readPracticePreferences(accountLearner.id);
                const learner = mapPracticeAccountLearner(accountLearner, preferences);
                const accessibleProfiles = persisted.account.learners?.length
                    ? persisted.account.learners
                    : [accountLearner];
                const accessibleLearners = accessibleProfiles.map((profile) => mapPracticeAccountLearner(
                    profile,
                    profile.id === accountLearner.id ? preferences : readPracticePreferences(profile.id),
                ));
                const adaptedQuestions = persisted.questions.map(adaptPracticeQuestion);
                const enabledSubjects = new Set([...Object.keys(learner.bookVersions), ...learner.customSubjects]);
                const learnerCatalog = adaptedQuestions.filter((question) => (
                    question.grade === learner.grade && enabledSubjects.has(question.subject)
                ));
                const collections = preferences?.collections ?? [];
                const initialPlan = preferences?.plan ?? createInitialPracticePlan(
                    learner,
                    learnerCatalog,
                    accountLearner.preferences?.defaultCheckMode,
                );
                const normalizedPlan = normalizeLoadedPracticePlan(initialPlan, learner, learnerCatalog, collections);
                setPersistedQuestions(mapped);
                setPersistedLearnerId(learner.id);
                setQuestions(adaptedQuestions);
                setLearners(accessibleLearners);
                setActiveLearnerId(learner.id);
                const adaptedAttempts = persisted.attempts.map((attempt) => adaptPracticeAttempt(attempt)).reverse();
                setAttemptsByLearner({ [learner.id]: adaptedAttempts });
                setPracticeSessionsByLearner({ [learner.id]: persisted.sessions });
                setPlansByLearner({ [learner.id]: normalizedPlan });
                setSchedulesByLearner({ [learner.id]: preferences?.schedules ?? [] });
                setQuestionCollectionsByLearner({ [learner.id]: collections });
                setWrongReviewQueue(persisted.wrongReviewQueue.items);
                setRecommendationQueueRefreshing(false);
                setRecommendationPreviews({});
                setRecommendationNotice("");
                setRoleAccess(roleAccessFromPracticeAccount(persisted.account));
                setImports([]);
                setImportBooks([]);
                setStorageError("");
                setRecommendationSessionKind(null);
                const resumeSessionId = readPracticeSessionHint(learner.id);
                if (resumeSessionId) {
                    try {
                        const restoredResult = await getPersistedPracticeSession(resumeSessionId);
                        const restored = restoredResult.session;
                        const restorable = restored.status === "active" || restored.status === "paused";
                        const restoredItems = "items" in restored ? restored.items : [];
                        const restoredQuestionIds = restoredItems.map((item) => practiceRouteId(item.questionId));
                        const currentRevisionsMatch = restoredItems.every((item, index) => (
                            mapped.get(restoredQuestionIds[index]!)?.revisionId === item.revisionId
                        ));
                        if (restorable && restoredQuestionIds.length && currentRevisionsMatch) {
                            const disclosedAttempts = restoredResult.disclosure === "detailed"
                                ? restoredResult.attempts.map((attempt) => adaptPracticeAttempt(attempt))
                                : adaptedAttempts.filter((attempt) => attempt.sessionId === restored.id);
                            const disclosedByItem = new Map(disclosedAttempts.flatMap((attempt) => (
                                attempt.sessionItemId ? [[attempt.sessionItemId, attempt] as const] : []
                            )));
                            const restoredAttempts = restoredItems.flatMap((item) => {
                                if (!item.answered) return [];
                                const questionId = practiceRouteId(item.questionId);
                                return [disclosedByItem.get(item.id) ?? {
                                    sessionId: restored.id,
                                    sessionItemId: item.id,
                                    sessionMode: restored.mode,
                                    questionId,
                                    revisionId: item.revisionId,
                                    ...(item.partId ? { partId: item.partId } : {}),
                                    answer: "已保存的作答",
                                    correct: null,
                                    date: restored.startedAt,
                                    durationSeconds: 0,
                                }];
                            });
                            const nextIndex = restoredItems.findIndex((item) => !item.answered);
                            if (nextIndex >= 0) {
                                setSession({
                                    id: restored.id,
                                    startedAt: restored.startedAt,
                                    learnerId: learner.id,
                                    mode: restored.mode,
                                    checkMode: restored.checkMode,
                                    phase: "answering",
                                    questionIds: restoredQuestionIds,
                                    persistedItems: restoredItems.map((item) => ({
                                        id: item.id,
                                        questionId: practiceRouteId(item.questionId),
                                        partId: item.partId,
                                    })),
                                    index: nextIndex,
                                    attempts: restoredAttempts,
                                    questionStartedAt: Date.now(),
                                });
                                setSessionPaused(true);
                                if (restored.status === "active") {
                                    await updatePersistedPracticeSessionStatus(restored.id, "paused");
                                }
                            }
                            else clearPracticeSessionHint(learner.id);
                        }
                        else if (!restorable) clearPracticeSessionHint(learner.id);
                        else {
                            await updatePersistedPracticeSessionStatus(restored.id, "abandoned");
                            clearPracticeSessionHint(learner.id);
                            setPracticeServiceError("這次練習使用的題目版本已更新；舊練習已安全關閉，請重新建立練習。");
                        }
                    }
                    catch {
                        setPracticeServiceError("尚未能確認先前練習的狀態；保留恢復識別碼，稍後可重新載入。");
                    }
                }
                else setPracticeServiceError("");
            }
            catch (error) {
                if (!active) return;
                // The authenticated API is the sole identity source for this workspace. Clearing every
                // account-scoped value prevents a previous user or the legacy fixture from surviving a
                // missing/expired session during refresh, tab restore, or account switching.
                if (error instanceof PracticeApiError && error.status === 401) {
                    clearAuthenticatedWorkspace("登入狀態已失效，請重新登入。未載入任何測試帳號或其他帳號資料。");
                }
                else {
                    setPracticeAccount(undefined);
                    setPersistedQuestions(new Map());
                    setPersistedLearnerId("");
                    setLearners([]);
                    setActiveLearnerId("");
                    setQuestions([]);
                    setAttemptsByLearner({});
                    setPracticeSessionsByLearner({});
                    setPlansByLearner({});
                    setSchedulesByLearner({});
                    setWrongReviewQueue([]);
                    setRecommendationQueueRefreshing(false);
                    setRecommendationPreviews({});
                    setRecommendationNotice("");
                    setQuestionCollectionsByLearner({});
                    setRoleAccess(DEFAULT_ROLE_ACCESS);
                    setImports([]);
                    setImportBooks([]);
                    setSession(undefined);
                    setRecommendationSessionKind(null);
                    setPracticeServiceError("");
                    const practiceFailure = error instanceof Error ? error.message : "目前無法讀取正式題庫。";
                    setStorageError(`${practiceFailure} 未載入任何帳號資料，請稍後重試。`);
                }
            }
            finally {
                if (active) setIsHydrated(true);
            }
        }

        loadBootstrap();
        return () => { active = false; };
    }, [clearAuthenticatedWorkspace, practiceReloadToken]);

    useEffect(() => {
        if (!isHydrated || pathname !== "/results") return;
        setSection("overview");
        router.replace(SECTION_PATHS.overview);
    }, [isHydrated, pathname, router]);
    useEffect(() => {
        if (!isHydrated) return;
        if (!persistedLearnerId || !learners.length) return;
        if (skipNextApiWriteRef.current) {
            skipNextApiWriteRef.current = false;
            return;
        }
        // Only non-identifying UI preferences remain browser-local. Account, learner,
        // question, session, and attempt data never fall back to the legacy JSON store.
        const learner = learners.find((item) => item.id === persistedLearnerId);
        if (learner) {
            try {
                writePracticePreferences(persistedLearnerId, {
                    plan: plansByLearner[persistedLearnerId] ?? null,
                    schedules: schedulesByLearner[persistedLearnerId] ?? [],
                    collections: questionCollectionsByLearner[persistedLearnerId] ?? [],
                    questionLimitOptions: learner.questionLimitOptions,
                    defaultQuestionLimit: learner.defaultQuestionLimit,
                });
                setStorageError("");
            }
            catch { setStorageError("此瀏覽器目前無法保存練習設定；已送出的作答仍保存在資料庫。"); }
        }
    }, [isHydrated, learners, persistedLearnerId, plansByLearner, questionCollectionsByLearner, schedulesByLearner]);

    useEffect(() => {
        setImportGrade(activeLearner.grade);
        setMistakeFilters(DEFAULT_QUESTION_FILTERS);
        setMistakePage(1);
        setSelectedMistakes([]);
        setSelectedQuestionIds([]);
        setSelectedQuestionId(undefined);
        setQuestionPage(1);
        setQuestionBatchScope("selected");
        setQuestionActionStatus("");
        setFileNames([]);
        setFileError("");
        setImportText("");
        setImportStatus("");
        setImportDrafts([]);
        setSelectedImportBookId("");
        setCreatingImportBook(false);
        setNewImportBookName("");
    }, [activeLearner.id, activeLearner.grade]);

    useEffect(() => {
        const previous = questionFilterBaselineRef.current;
        const mustReset = !previous
            || previous.learnerId !== activeLearner.id
            || previous.grade !== activeLearner.grade;
        setQuestionFilters((current) => {
            if (mustReset) return questionFilterBaseline;

            // A background reload may update saved learner defaults. Apply only fields that the
            // user has not overridden since the previous baseline; explicit filter choices win.
            if (current.subject !== previous.filters.subject) return current;
            const next = normalizeQuestionFilters({
                ...current,
                subject: questionFilterBaseline.subject,
                semester: current.semester === previous.filters.semester
                    ? questionFilterBaseline.semester
                    : current.semester,
                version: current.version === previous.filters.version
                    ? questionFilterBaseline.version
                    : current.version,
            }, learnerQuestions, activeQuestionCollections);
            return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        });
        if (mustReset) setMistakeFilters(questionFilterBaseline);
        questionFilterBaselineRef.current = {
            learnerId: activeLearner.id,
            grade: activeLearner.grade,
            filters: questionFilterBaseline,
        };
    }, [activeLearner.grade, activeLearner.id, activeQuestionCollections, learnerQuestions, questionFilterBaseline]);

    useEffect(() => {
        if (!targetCollectionId || activeQuestionCollections.some((collection) => collection.id === targetCollectionId)) return;
        setTargetCollectionId(activeQuestionCollections[0]?.id ?? "");
    }, [activeQuestionCollections, targetCollectionId]);

    useEffect(() => {
        const normalized = normalizeQuestionFilters(questionFilters, learnerQuestions, activeQuestionCollections);
        if (JSON.stringify(normalized) === JSON.stringify(questionFilters)) return;
        setQuestionFilters(normalized);
        setQuestionPage(1);
        setSelectedQuestionIds([]);
    }, [activeQuestionCollections, learnerQuestions, questionFilters]);

    useEffect(() => {
        if (!selectedImportBookId || availableImportBooks.some((book) => book.id === selectedImportBookId)) return;
        setSelectedImportBookId("");
    }, [availableImportBooks, selectedImportBookId]);
    useEffect(() => {
        const normalized = normalizeQuestionFilters(mistakeFilters, rankingQuestions, activeQuestionCollections);
        if (JSON.stringify(normalized) === JSON.stringify(mistakeFilters)) return;
        setMistakeFilters(normalized);
        setMistakePage(1);
        setSelectedMistakes([]);
    }, [activeQuestionCollections, mistakeFilters, rankingQuestions]);
    useEffect(() => {
        if (activePlan.subject === "全部" || availableSubjects.includes(activePlan.subject as Subject)) return;
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), subject: "全部", scopeFilters: [] },
        }));
    }, [activeLearnerId, activePlan.subject, availableSubjects]);
    useEffect(() => {
        if (!isHydrated) return;
        const browserPath = pathname;
        if (browserPath === SECTION_PATHS["system-settings"]) {
            if (canAccessSystemSettings) setSection("system-settings");
            else {
                setSection("overview");
                router.replace(SECTION_PATHS.overview);
            }
            return;
        }
        if (browserPath === SECTION_PATHS.settings || getSettingsExamId(browserPath)) {
            if (canAccessLearnerSettings) setSection("settings");
            else {
                setSection(canAccessSystemSettings ? "system-settings" : "overview");
                router.replace(canAccessSystemSettings ? SECTION_PATHS["system-settings"] : SECTION_PATHS.overview);
            }
            return;
        }
        if (browserPath === SECTION_PATHS.bank) {
            setSection("questions");
            router.replace(SECTION_PATHS.questions);
            return;
        }
        if (!learners.length || !questions.length) return;
        const routeQuestionId = getSessionQuestionId(browserPath);
        const overviewQuestionId = getOverviewQuestionId(browserPath);
        if (browserPath === "/") {
            router.replace(SECTION_PATHS.overview);
            return;
        }
        if (overviewQuestionId !== undefined) {
            const routeQuestion = learnerQuestions.find((question) => question.id === overviewQuestionId);
            if (!routeQuestion) {
                router.replace(SECTION_PATHS.questions);
                return;
            }
            setSection("questions");
            setSelectedQuestionId(overviewQuestionId);
            return;
        }
        if (browserPath === SESSION_PATH && !session) {
            router.replace(SECTION_PATHS.practice);
            return;
        }
        if (routeQuestionId !== undefined) {
            if (persistedQuestions.has(routeQuestionId) && (!session || !session.questionIds.includes(routeQuestionId))) {
                router.replace(SECTION_PATHS.practice);
                return;
            }
            const routeQuestion = questions.find((question) => question.id === routeQuestionId);
            if (!routeQuestion) {
                router.replace(SECTION_PATHS.practice);
                return;
            }
            const routeQuestionIds = getQuestionGroupIds(routeQuestion, questions);
            const routeQuestionIndex = routeQuestionIds.indexOf(routeQuestionId);
            setSection("practice");
            setSession((current) => {
                const hasCompleteGroup = routeQuestionIds.every((questionId) => current?.questionIds.includes(questionId));
                const requiresCompleteGroup = !current || current.mode === "practice";
                if (!current || !current.questionIds.includes(routeQuestionId) || (requiresCompleteGroup && !hasCompleteGroup)) {
                    const startedAt = new Date().toISOString();
                    return {
                        id: `session-${crypto.randomUUID()}`,
                        startedAt,
                        learnerId: activeLearnerId,
                        mode: "practice",
                        checkMode: activePlan.checkMode,
                        phase: "answering",
                        questionIds: routeQuestionIds,
                        index: routeQuestionIndex,
                        attempts: [],
                        questionStartedAt: Date.now(),
                    };
                }
                const nextIndex = current.questionIds.indexOf(routeQuestionId);
                return nextIndex === current.index ? current : { ...current, index: nextIndex, questionStartedAt: Date.now() };
            });
            setAnswer("");
            setHandwriting("");
            return;
        }
        setSection(getSectionFromPath(browserPath));
        if (session?.phase === "answering") setSessionPaused(browserPath !== SESSION_PATH);
    }, [activeLearnerId, canAccessLearnerSettings, canAccessSystemSettings, isHydrated, learnerQuestions, learners.length, pathname, questions, router]);
    useEffect(() => {
        if (pathname !== SECTION_PATHS.questions || !shouldRestoreQuestionScrollRef.current) return;
        shouldRestoreQuestionScrollRef.current = false;
        const frame = window.requestAnimationFrame(() => window.scrollTo({ top: questionOverviewScrollRef.current }));
        return () => window.cancelAnimationFrame(frame);
    }, [pathname]);
    useEffect(() => {
        if (!shouldFocusSectionRef.current) return;
        shouldFocusSectionRef.current = false;
        (section === "overview" ? overviewHeadingRef.current : headingRef.current)?.focus();
    }, [section]);
    useEffect(() => {
        if (!session || sessionPaused) return;
        const frame = window.requestAnimationFrame(() => sessionHeadingRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [session?.index, session?.mode, session?.phase, sessionPaused]);
    useEffect(() => {
        if (!session || session.phase !== "complete" || !PRACTICE_SESSION_UUID_PATTERN.test(session.id)) return;
        clearPracticeSessionHint(session.learnerId);
    }, [session]);

    /** 確認是否可以離開尚未完成的練習。 */
    function canLeaveSession() {
        if (!session || session.phase === "complete") return true;
        const hasProgress = Boolean(answer.trim() || handwriting || session.attempts.length);
        return !hasProgress || window.confirm("這一輪還沒完成，離開會遺失尚未送出的答案與手寫內容。確定要離開嗎？");
    }

    /** 清除目前練習與暫存輸入。 */
    function clearSession() {
        setSession(undefined);
        setRecommendationSessionKind(null);
        setSessionPaused(false);
        setSessionExitOpen(false);
        setAnswer("");
        setHandwriting("");
    }

    /** Marks a durable unfinished session as abandoned before removing it from the UI. */
    async function abandonCurrentSession(): Promise<boolean> {
        if (!session || session.phase !== "answering" || !PRACTICE_SESSION_UUID_PATTERN.test(session.id)) return true;
        setPracticeBusy(true);
        try {
            await updatePersistedPracticeSessionStatus(session.id, "abandoned");
            if (!clearPracticeSessionHint(session.learnerId)) {
                setStorageError("練習已結束，但瀏覽器未能清除恢復識別碼；重新載入時會再次核對伺服器狀態。");
            }
            setPracticeServiceError("");
            return true;
        }
        catch (error) {
            setPracticeServiceError(error instanceof Error ? error.message : "無法結束這次練習，請重試。");
            return false;
        }
        finally { setPracticeBusy(false); }
    }

    /** 切換主要工作區並保護進行中的作答。 */
    async function navigateToSection(nextSection: Section) {
        setMobileNavigationOpen(false);
        if (nextSection === "system-settings" && !canAccessSystemSettings) {
            setSection("overview");
            router.push(SECTION_PATHS.overview);
            return;
        }
        if (nextSection === "settings" && !canAccessLearnerSettings) {
            const fallback = canAccessSystemSettings ? "system-settings" : "overview";
            setSection(fallback);
            router.push(SECTION_PATHS[fallback]);
            return;
        }
        if (nextSection === section && pathname === SECTION_PATHS[nextSection]) return;
        if (session && sessionPaused) {
            shouldFocusSectionRef.current = true;
            setSection(nextSection);
            router.push(SECTION_PATHS[nextSection]);
            return;
        }
        if (!canLeaveSession()) return;
        if (!await abandonCurrentSession()) return;
        clearSession();
        shouldFocusSectionRef.current = true;
        setSection(nextSection);
        router.push(SECTION_PATHS[nextSection]);
    }

    /**
     * 依目前螢幕寬度開啟安排練習介面。
     * @returns 無回傳值。
     */
    function openScheduleComposer() {
        if (window.matchMedia("(min-width: 1400px)").matches && !isScheduleListPage) {
            setSchedulePanelOpen(true);
            return;
        }
        setScheduleDialogOpen(true);
    }

    /**
     * 前往完整練習計劃頁並關閉暫時顯示的安排介面。
     * @returns 無回傳值。
     */
    async function openScheduleList() {
        if (!sessionPaused && !canLeaveSession()) return;
        if (!sessionPaused && !await abandonCurrentSession()) return;
        if (!sessionPaused) clearSession();
        setScheduleDialogOpen(false);
        setSchedulePanelOpen(false);
        setMobileNavigationOpen(false);
        router.push(PRACTICE_SCHEDULES_PATH);
    }

    /** 切換學習者並保護進行中的作答。 */
    async function changeLearner(nextLearnerId: string) {
        if (nextLearnerId === activeLearnerId || !canLeaveSession()) return;
        if (!await abandonCurrentSession()) return;
        clearSession();
        setWrongReviewQueue([]);
        setRecommendationQueueRefreshing(false);
        setRecommendationPreviews({});
        setRecommendationNotice("");
        recommendationRequestRef.current = undefined;
        if (practiceAccount) {
            setPracticeBusy(true);
            try {
                const { account } = await selectPracticeLearner(nextLearnerId);
                setPracticeAccount(account);
                broadcastAuthSessionContextChanged();
                setPracticeServiceError("");
                setIsHydrated(false);
                setPracticeReloadToken((current) => current + 1);
            }
            catch (error) {
                setPracticeServiceError(error instanceof Error ? error.message : "無法切換學習者，請重試。");
            }
            finally { setPracticeBusy(false); }
            return;
        }
        setActiveLearnerId(nextLearnerId);
        setMobileNavigationOpen(false);
    }

    function openCreateLearner() {
        if (!canCreateLearner) return;
        const stage = findEducationStage(educationCatalog, activeAccountLearner?.gradeCode)
            ?? educationCatalog?.stages[0];
        setLearnerProfileDraft({
            displayName: "",
            educationStatus: "enrolled",
            educationStage: stage?.code ?? "",
            gradeCode: stage?.grades.some((grade) => grade.code === activeAccountLearner?.gradeCode)
                ? activeAccountLearner?.gradeCode ?? ""
                : stage?.grades[0]?.code ?? "",
            semesterCode: educationCatalog?.semesters.some((semester) => semester.code === activeAccountLearner?.semesterCode)
                ? activeAccountLearner?.semesterCode ?? ""
                : educationCatalog?.semesters[0]?.code ?? "",
        });
        setLearnerProfileStatus("");
        setLearnerProfileDialogOpen(true);
    }

    function openEditLearner(profile: PracticeAccountLearner) {
        if (!profile.canManageSettings) return;
        const stage = findEducationStage(educationCatalog, profile.gradeCode)
            ?? educationCatalog?.stages[0];
        setLearnerProfileDraft({
            learnerId: profile.id,
            displayName: profile.displayName,
            educationStatus: profile.educationStatus,
            educationStage: profile.educationStatus === "enrolled" ? stage?.code ?? "" : "",
            gradeCode: profile.gradeCode ?? "",
            semesterCode: profile.semesterCode ?? "",
        });
        setLearnerProfileStatus("");
        setLearnerProfileDialogOpen(true);
    }

    async function saveLearnerProfile() {
        const displayName = learnerProfileDraft.displayName.trim();
        const needsSchoolFields = learnerProfileDraft.educationStatus === "enrolled";
        if (!displayName || (needsSchoolFields && (!learnerProfileDraft.gradeCode || !learnerProfileDraft.semesterCode)) || learnerProfileBusy) {
            setLearnerProfileStatus(needsSchoolFields ? "請填寫稱呼、年級與學期。" : "請填寫稱呼。");
            return;
        }
        const educationFields = needsSchoolFields
            ? {
                educationStatus: learnerProfileDraft.educationStatus,
                gradeCode: learnerProfileDraft.gradeCode,
                semesterCode: learnerProfileDraft.semesterCode,
            }
            : { educationStatus: learnerProfileDraft.educationStatus, gradeCode: null, semesterCode: null };
        setLearnerProfileBusy(true);
        setLearnerProfileStatus("");
        try {
            let response: { account: PracticeAccount };
            if (learnerProfileDraft.learnerId) {
                response = await updatePracticeLearner({
                    learnerId: learnerProfileDraft.learnerId,
                    displayName,
                    ...educationFields,
                }, section === "settings" && practiceAccount?.activeRole === "learner"
                    ? "update-current"
                    : "update");
            }
            else {
                const fingerprint = JSON.stringify({ displayName, ...educationFields });
                const pending = createLearnerRequestRef.current?.fingerprint === fingerprint
                    ? createLearnerRequestRef.current
                    : { fingerprint, clientRequestId: crypto.randomUUID() };
                createLearnerRequestRef.current = pending;
                response = await createPracticeLearner({
                    clientRequestId: pending.clientRequestId,
                    displayName,
                    ...educationFields,
                });
                createLearnerRequestRef.current = undefined;
            }
            setPracticeAccount(response.account);
            broadcastAuthSessionContextChanged();
            setLearnerProfileDialogOpen(false);
            setLearnerProfileDraft(EMPTY_LEARNER_PROFILE_DRAFT);
            setPracticeServiceError("");
            setIsHydrated(false);
            setPracticeReloadToken((current) => current + 1);
        }
        catch (error) {
            if (!learnerProfileDraft.learnerId && isDeterministicPracticeApiError(error)) {
                createLearnerRequestRef.current = undefined;
            }
            setLearnerProfileStatus(error instanceof Error ? error.message : "學習者設定未能保存，請重試。");
        }
        finally { setLearnerProfileBusy(false); }
    }

    /** 保存目前學習者單一科目的教材版本，不改動其他科目設定。 */
    async function saveLearnerSubjectSetting(
        setting: PracticeAccountLearner["subjectSettings"][number],
        bookVersionId: string,
    ) {
        if (!activeAccountLearner?.canManageSettings || subjectSettingBusyCode) return;
        const currentBookVersionId = setting.bookVersion?.id ?? "";
        if (bookVersionId === currentBookVersionId) return;
        setSubjectSettingBusyCode(setting.subject.code);
        setSubjectSettingStatus("");
        try {
            const { account } = await updatePracticeLearnerSubjectSetting({
                learnerId: activeAccountLearner.id,
                subjectCode: setting.subject.code,
                bookVersionId: bookVersionId || null,
                lockVersion: setting.lockVersion,
            });
            setPracticeAccount(account);
            broadcastAuthSessionContextChanged();
            setSubjectSettingStatus(`${normalizeSubjectLabel(setting.subject.name)}的教材版本已保存。`);
            setPracticeServiceError("");
            setIsHydrated(false);
            setPracticeReloadToken((current) => current + 1);
        }
        catch (error) {
            setSubjectSettingStatus(error instanceof Error ? error.message : "教材版本未能保存，請重試。");
        }
        finally { setSubjectSettingBusyCode(""); }
    }

    /** 開啟角色切換並清除上一次輸入。 */
    function openRoleSwitch() {
        if (!practiceAccount) {
            router.push("/account");
            return;
        }
        setRequestedRole(roleAccess.activeRole);
        setRolePassword("");
        setRoleStatus("");
        setRoleDialogOpen(true);
    }

    /** 以目前帳號密碼重新確認後，切換已授權的操作角色。 */
    async function switchRole() {
        if (requestedRole === roleAccess.activeRole) {
            setRoleDialogOpen(false);
            return;
        }
        if (!practiceAccount) return;
        const targetRole = ACCOUNT_ROLE_CODES[requestedRole];
        if (targetRole !== "learner" && !rolePassword) {
            setRoleStatus("請輸入目前帳號密碼。");
            return;
        }
        setRoleSwitchBusy(true);
        setRoleStatus("");
        try {
            const { account } = await switchPracticeAccountRole(targetRole, rolePassword || undefined);
            setPracticeAccount(account);
            broadcastAuthSessionContextChanged();
            setRoleAccess((current) => ({ ...current, activeRole: ACCOUNT_ROLE_LABELS[account.activeRole] }));
            setRolePassword("");
            setRoleDialogOpen(false);
            setIsHydrated(false);
            setPracticeReloadToken((current) => current + 1);
        }
        catch (error) {
            setRoleStatus(error instanceof Error ? error.message : "無法切換角色，請重試。");
        }
        finally { setRoleSwitchBusy(false); }
    }

    async function saveAccountIdentity() {
        if (!practiceAccount || identityBusy || identityRole === practiceAccount.accountRole) return;
        if (identityRole !== "learner" && !identityPassword) {
            setIdentityStatus("切換為家長或家教本人身分時，請輸入目前帳號密碼。");
            return;
        }
        setIdentityBusy(true);
        setIdentityStatus("");
        try {
            const { account } = await updatePracticeAccountIdentity(identityRole, identityPassword || undefined);
            setPracticeAccount(account);
            broadcastAuthSessionContextChanged();
            setRoleAccess((current) => ({ ...current, activeRole: ACCOUNT_ROLE_LABELS[account.activeRole] }));
            setIdentityPassword("");
            setIsHydrated(false);
            setPracticeReloadToken((current) => current + 1);
        }
        catch (error) {
            setIdentityStatus(error instanceof Error ? error.message : "本人身分未能更新，請重試。");
        }
        finally { setIdentityBusy(false); }
    }

    /** 更新目前學習者資料。 */
    async function updateLearner<K extends keyof Omit<Learner, "id">>(field: K, value: Learner[K]) {
        if (field === "grade" && value !== activeLearner.grade) {
            if (!canLeaveSession()) return;
            if (!await abandonCurrentSession()) return;
            clearSession();
            const nextSubjects = getSubjectsForGrade(String(value), questions, activeLearner.customSubjects);
            const nextSubject = activePlan.subject === "全部" || nextSubjects.includes(activePlan.subject as Subject)
                ? activePlan.subject
                : "全部";
            setPlansByLearner((current) => ({
                ...current,
                [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), subject: nextSubject, scopeFilters: [] },
            }));
        }
        setLearners((current) => current.map((learner) => learner.id === activeLearnerId ? { ...learner, [field]: value } : learner));
    }

    /** 更新目前學習者指定科目的書籍版本。 */
    function updateBookVersion(subject: Subject, value: string) {
        setLearners((current) => current.map((learner) => learner.id === activeLearnerId
            ? { ...learner, bookVersions: { ...learner.bookVersions, [subject]: value } }
            : learner));
    }

    /** 新增目前學習者可使用的目錄科目或自訂科目。 */
    function addSubject() {
        const subject = normalizeSubjectLabel(subjectChoice === CUSTOM_SUBJECT_VALUE ? subjectDraft : subjectChoice);
        if (!subject) {
            setSubjectError(subjectChoice === CUSTOM_SUBJECT_VALUE ? "請輸入科目名稱。" : "請選擇科目或自訂新增。");
            return;
        }
        if (subject.length > 40) {
            setSubjectError("科目名稱不可超過 40 個字。");
            return;
        }
        if (configurableSubjects.includes(subject)) {
            setSubjectError("這個科目已存在。");
            return;
        }
        if (subjectChoice === CUSTOM_SUBJECT_VALUE && SUBJECTS.some((systemSubject) => systemSubject === subject)) {
            setSubjectError("目錄已有這個科目，請直接從清單選擇。");
            return;
        }
        if (activeLearner.customSubjects.length >= 20) {
            setSubjectError("最多新增 20 個自訂科目。");
            return;
        }
        setLearners((current) => current.map((learner) => learner.id === activeLearnerId
            ? {
                ...learner,
                customSubjects: [...learner.customSubjects, subject],
                bookVersions: { ...learner.bookVersions, [subject]: "" },
            }
            : learner));
        setPlansByLearner((current) => {
            const plan = current[activeLearnerId] ?? DEFAULT_PLAN;
            return {
                ...current,
                [activeLearnerId]: {
                    ...plan,
                    examSettings: plan.examSettings.map((exam) => ({
                        ...exam,
                        ranges: { ...exam.ranges, [subject]: { start: ALL_UNITS, end: ALL_UNITS } },
                    })),
                },
            };
        });
        setSubjectChoice("");
        setSubjectDraft("");
        setSubjectError("");
        setSubjectDialogOpen(false);
    }

    /** 移除目前學習者後續加入的科目設定。 */
    function removeAddedSubject(subject: Subject) {
        if (!activeLearner.customSubjects.includes(subject)) return;
        const isSystemSubject = SUBJECTS.some((systemSubject) => systemSubject === subject);
        setLearners((current) => current.map((learner) => {
            if (learner.id !== activeLearnerId) return learner;
            const { [subject]: _removedVersion, ...bookVersions } = learner.bookVersions;
            return {
                ...learner,
                customSubjects: learner.customSubjects.filter((item) => item !== subject),
                bookVersions: isSystemSubject ? { ...bookVersions, [subject]: "" } : bookVersions,
            };
        }));
        setPlansByLearner((current) => {
            const plan = current[activeLearnerId] ?? DEFAULT_PLAN;
            return {
                ...current,
                [activeLearnerId]: {
                    ...plan,
                    subject: plan.subject === subject ? "全部" : plan.subject,
                    scopeFilters: plan.subject === subject ? [] : plan.scopeFilters,
                    examSettings: plan.examSettings.map((exam) => {
                        const { [subject]: _removedRange, ...ranges } = exam.ranges;
                        const nextRanges = isSystemSubject
                            ? { ...ranges, [subject]: { start: ALL_UNITS, end: ALL_UNITS } }
                            : ranges;
                        return { ...exam, ranges: nextRanges };
                    }),
                },
            };
        });
    }

    /** 保存目前學習者可選的每輪題數，並確保預設值仍屬於清單。 */
    function saveQuestionLimitOptions() {
        const options = parseQuestionLimitOptions(questionLimitOptionsDraft);
        if (!options) {
            setQuestionLimitOptionsError("請用逗號分隔 1 至 500 的正整數，最多 20 個。");
            return;
        }
        const defaultQuestionLimit = options.includes(activeLearner.defaultQuestionLimit)
            ? activeLearner.defaultQuestionLimit
            : options[0];
        setLearners((current) => current.map((learner) => learner.id === activeLearnerId
            ? { ...learner, questionLimitOptions: options, defaultQuestionLimit }
            : learner));
        setQuestionLimitOptionsDraft(options.join(", "));
        setQuestionLimitOptionsError("");
    }

    /** 驗證並保存目前學習者的代表圖片。 */
    async function updateLearnerAvatar(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!AVATAR_FILE_TYPES.includes(file.type)) {
            setAvatarError("代表圖片只支援 JPG、PNG 或 WebP。");
            return;
        }
        if (file.size > AVATAR_FILE_SIZE_LIMIT) {
            setAvatarError("代表圖片需小於 1 MB。");
            return;
        }
        try {
            const image = await readImage(file);
            updateLearner("avatar", image.url);
            setAvatarError("");
        }
        catch {
            setAvatarError("無法讀取代表圖片，請重新選擇檔案。");
        }
    }

    /** 更新目前學習者的練習計畫。 */
    function updatePlan<K extends keyof PracticePlan>(field: K, value: PracticePlan[K]) {
        const dependentReset = field === "subject"
            ? {
                bookVersion: value === "全部" ? undefined : activeLearner.bookVersions[value as Subject],
                semester: getPreferredQuestionSemester(
                    learnerQuestions,
                    value as Subject | "全部",
                    activeLearner.semester,
                ),
                scopeFilters: [],
                sourceFilters: [],
                knowledge: ALL_KNOWLEDGE,
                metadataFilters: {},
            }
            : field === "bookVersion"
                ? { scopeFilters: [], sourceFilters: [], knowledge: ALL_KNOWLEDGE, metadataFilters: {} }
                : field === "scopeFilters" || field === "examSettings"
                ? { sourceFilters: [], knowledge: ALL_KNOWLEDGE, metadataFilters: {} }
                : {};
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), creatorRole: roleAccess.activeRole, [field]: value, ...dependentReset },
        }));
    }

    /** 取得目前練習設定在排程清單中使用的範圍摘要。 */
    function getCurrentPlanScopeLabel() {
        if (!activePlan.scopeFilters.length) return "全部單元";
        if (activePlan.scopeFilters.length > 1) return `已選 ${activePlan.scopeFilters.length} 個單元`;
        const selectedScope = activePlan.scopeFilters[0];
        return selectedScope.split("::")[1]
            ?? scopeOptions.find((option) => option.value === selectedScope)?.label
            ?? "全部單元";
    }

    /** 將目前出題設定保存為指定學習者的預約練習。 */
    function addScheduledPractice() {
        if (!scheduleDate || !plannedQuestions.length || !difficultyMixValid) return;
        const scheduledPractice: ScheduledPractice = {
            id: `schedule-${crypto.randomUUID()}`,
            creatorRole: roleAccess.activeRole,
            date: scheduleDate,
            ...(scheduleTime ? { time: scheduleTime } : {}),
            subjectLabel: planSubjectLabel,
            scopeLabel: getCurrentPlanScopeLabel(),
            checkMode: activePlan.checkMode,
            questionIds: plannedQuestions.map((question) => question.id),
            createdAt: new Date().toISOString(),
        };
        setSchedulesByLearner((current) => ({
            ...current,
            [activeLearnerId]: [...(current[activeLearnerId] ?? []), scheduledPractice],
        }));
    }

    /** 判斷目前角色能否變更指定排程。 */
    function isScheduledPracticeLocked(schedule: ScheduledPractice) {
        return roleAccess.activeRole === "學習者" && schedule.creatorRole !== "學習者";
    }

    /** 以目前出題設定更新既有排程，並保留日期與建立者。 */
    function replaceScheduledPractice(schedule: ScheduledPractice) {
        if (isScheduledPracticeLocked(schedule) || !plannedQuestions.length || !difficultyMixValid) return;
        setSchedulesByLearner((current) => ({
            ...current,
            [activeLearnerId]: (current[activeLearnerId] ?? []).map((item) => item.id === schedule.id ? {
                ...item,
                subjectLabel: planSubjectLabel,
                scopeLabel: getCurrentPlanScopeLabel(),
                checkMode: activePlan.checkMode,
                questionIds: plannedQuestions.map((question) => question.id),
                result: undefined,
            } : item),
        }));
    }

    /** 開啟尚未完成且目前角色有權管理的練習計劃編輯器。 */
    function openScheduleEditor(schedule: ScheduledPractice) {
        if (schedule.result || isScheduledPracticeLocked(schedule)) return;
        setEditingScheduleId(schedule.id);
        setEditingScheduleDate(schedule.date);
        setEditingScheduleTime(schedule.time ?? "");
        setEditingScheduleCheckMode(schedule.checkMode);
    }

    /** 保存練習計劃的日期、時間與練習方式。 */
    function saveScheduledPracticeEdits() {
        if (!editingScheduleId || !editingScheduleDate) return;
        setSchedulesByLearner((current) => ({
            ...current,
            [activeLearnerId]: (current[activeLearnerId] ?? []).map((schedule) => {
                if (schedule.id !== editingScheduleId || schedule.result || isScheduledPracticeLocked(schedule)) return schedule;
                return {
                    ...schedule,
                    date: editingScheduleDate,
                    ...(editingScheduleTime ? { time: editingScheduleTime } : { time: undefined }),
                    checkMode: editingScheduleCheckMode,
                };
            }),
        }));
        setEditingScheduleId("");
    }

    /** 刪除目前角色有權管理的排程。 */
    function removeScheduledPractice(schedule: ScheduledPractice) {
        if (isScheduledPracticeLocked(schedule)) return;
        setSchedulesByLearner((current) => ({
            ...current,
            [activeLearnerId]: (current[activeLearnerId] ?? []).filter((item) => item.id !== schedule.id),
        }));
    }

    /** 以排程保存的原始題目順序開始練習。 */
    function startScheduledPractice(schedule: ScheduledPractice) {
        const validQuestionIds = schedule.questionIds.filter((id) => questions.some((question) => question.id === id));
        if (!validQuestionIds.length) return;
        setScheduleDialogOpen(false);
        setSchedulePanelOpen(false);
        setExpandedScheduleId("");
        beginSession("practice", validQuestionIds, schedule.checkMode, schedule.id);
    }

    /** 取得可顯示且順序有效的科目考試範圍。 */
    function getAssessmentRange(exam: ExamSetting, subject: Subject): AssessmentRange {
        const options = assessmentOptionsBySubject[subject] ?? [];
        const storedRange = exam.ranges[subject] ?? { start: ALL_UNITS, end: ALL_UNITS };
        const start = options.some((option) => option.value === storedRange.start) ? storedRange.start : options[0]?.value ?? ALL_UNITS;
        const end = options.some((option) => option.value === storedRange.end) ? storedRange.end : options.at(-1)?.value ?? ALL_UNITS;
        return { start, end };
    }

    /** 更新指定科目的考試起訖範圍，並避免開始位置晚於結束位置。 */
    function updateAssessmentRange(examId: string, subject: Subject, boundary: keyof AssessmentRange, value: string) {
        const options = assessmentOptionsBySubject[subject] ?? [];
        const exam = activePlan.examSettings.find((item) => item.id === examId);
        if (!exam) return;
        const currentRange = getAssessmentRange(exam, subject);
        const nextRange = { ...currentRange, [boundary]: value };
        const startIndex = options.findIndex((option) => option.value === nextRange.start);
        const endIndex = options.findIndex((option) => option.value === nextRange.end);
        if (startIndex > endIndex) {
            if (boundary === "start") nextRange.end = value;
            else nextRange.start = value;
        }
        const examSettings = activePlan.examSettings.map((item) => item.id === examId
            ? { ...item, ranges: { ...item.ranges, [subject]: nextRange } }
            : item);
        updatePlan("examSettings", examSettings);
    }

    /** 更新指定考試的名稱或日期。 */
    function updateExamSetting(examId: string, field: "name" | "date", value: string) {
        const examSettings = activePlan.examSettings.map((exam) => exam.id === examId ? { ...exam, [field]: value } : exam);
        updatePlan("examSettings", examSettings);
    }

    /** 新增一筆考試設定並設為目前使用項目。 */
    function addExamSetting() {
        if (activePlan.examSettings.length >= 20) return;
        const usedNames = new Set(activePlan.examSettings.map((exam) => exam.name));
        const name = ASSESSMENT_OPTIONS.find((option) => !usedNames.has(option.value))?.value ?? "自訂練習";
        const exam: ExamSetting = {
            id: `exam-${Date.now()}`,
            name,
            date: "",
            ranges: Object.fromEntries(configurableSubjects.map((subject) => [
                subject,
                { ...(DEFAULT_ASSESSMENT_RANGES[subject as keyof typeof DEFAULT_ASSESSMENT_RANGES] ?? { start: ALL_UNITS, end: ALL_UNITS }) },
            ])) as Record<Subject, AssessmentRange>,
        };
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: {
                ...(current[activeLearnerId] ?? DEFAULT_PLAN),
                examSettings: [...activePlan.examSettings, exam],
                activeExamId: exam.id,
            },
        }));
        router.push(getSettingsExamPath(exam.id));
    }

    /** 刪除指定考試，並在需要時改用剩餘的第一筆設定。 */
    function removeExamSetting(examId: string) {
        if (activePlan.examSettings.length <= 1) return;
        const examSettings = activePlan.examSettings.filter((exam) => exam.id !== examId);
        const activeExamId = activePlan.activeExamId === examId ? examSettings[0].id : activePlan.activeExamId;
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), examSettings, activeExamId },
        }));
        if (getSettingsExamId(pathname) === examId) router.push(SECTION_PATHS.settings);
    }

    /** 更新目前學習者的題目難易度占比。 */
    function updateDifficulty(field: keyof DifficultyMix, value: string) {
        const percentage = Math.min(100, Math.max(0, Number(value) || 0));
        updatePlan("difficultyMix", { ...activeDifficultyMix, [field]: percentage });
    }

    /** 將共用篩選元件的值保存至目前練習計畫。 */
    function updatePracticeFilters(filters: QuestionFilters) {
        const metadataFilters = Object.fromEntries(Object.entries(filters.metadata)
            .filter(([, value]) => value !== ALL_QUESTION_FILTERS)
            .map(([key, value]) => [key, [value]]));
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: {
                ...(current[activeLearnerId] ?? DEFAULT_PLAN),
                creatorRole: roleAccess.activeRole,
                subject: filters.subject,
                bookVersion: filters.version === ALL_QUESTION_FILTERS ? undefined : filters.version,
                scopeFilters: filters.scope,
                semester: filters.semester,
                topic: filters.topic,
                difficultyFilters: activePlan.difficultyMixEnabled ? activePlan.difficultyFilters : filters.difficulty,
                creatorFilter: filters.creator,
                collection: filters.collection,
                search: filters.search,
                sourceFilters: filters.source,
                questionKinds: filters.kind,
                knowledge: filters.knowledge === ALL_QUESTION_FILTERS ? ALL_KNOWLEDGE : filters.knowledge,
                metadataFilters,
            },
        }));
    }

    /** 啟用或停用依比例出題，避免一般難易度和比例條件同時生效。 */
    function toggleDifficultyMix(enabled: boolean) {
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: {
                ...(current[activeLearnerId] ?? DEFAULT_PLAN),
                difficultyMixEnabled: enabled,
                difficultyFilters: activePlan.difficultyFilters,
            },
        }));
    }

    /** 切換題庫瀏覽中的來源文件欄位值。 */
    function toggleBankMetadataFilter(key: string, value: string, checked: boolean) {
        setBankMetadataFilters((current) => {
            const selected = current[key] ?? [];
            const values = checked ? [...new Set([...selected, value])] : selected.filter((item) => item !== value);
            return { ...current, [key]: values };
        });
    }

    /** 將低頻篩選與本輪題數恢復為學習者的預設值。 */
    function resetAdvancedPlan() {
        const normalizedDefaults = normalizeQuestionFilters({
            ...DEFAULT_QUESTION_FILTERS,
            subject: activePlan.subject as Subject | "全部",
            semester: activeLearner.semester || ALL_QUESTION_FILTERS,
            version: activeSubject && activeLearner.bookVersions[activeSubject]
                ? activeLearner.bookVersions[activeSubject]
                : ALL_QUESTION_FILTERS,
        }, learnerQuestions, activeQuestionCollections);
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: {
                ...(current[activeLearnerId] ?? DEFAULT_PLAN),
                difficultyMix: { ...DEFAULT_PLAN.difficultyMix },
                difficultyMixEnabled: DEFAULT_PLAN.difficultyMixEnabled,
                subject: normalizedDefaults.subject,
                sourceFilters: normalizedDefaults.source,
                metadataFilters: {},
                questionKinds: normalizedDefaults.kind,
                knowledge: ALL_KNOWLEDGE,
                semester: normalizedDefaults.semester,
                topic: normalizedDefaults.topic,
                difficultyFilters: normalizedDefaults.difficulty,
                creatorFilter: ALL_QUESTION_FILTERS,
                collection: ALL_QUESTION_FILTERS,
                search: "",
                scopeFilters: normalizedDefaults.scope,
                questionLimit: activeLearner.defaultQuestionLimit,
                bookVersion: normalizedDefaults.version === ALL_QUESTION_FILTERS
                    ? undefined
                    : normalizedDefaults.version,
            },
        }));
    }

    /** 清除題目總覽的所有篩選與勾選狀態。 */
    function resetQuestionFilters() {
        setQuestionFilters(questionFilterBaseline);
        setSelectedQuestionIds([]);
        setQuestionPage(1);
    }

    /** 切換題目總覽中的單題勾選狀態。 */
    function toggleOverviewQuestion(questionId: number, checked: boolean) {
        setSelectedQuestionIds((current) => checked
            ? [...new Set([...current, questionId])]
            : current.filter((id) => id !== questionId));
    }

    /** 建立目前學習者的新收藏清單。 */
    function createQuestionCollection() {
        const name = newCollectionName.trim();
        if (!name || activeQuestionCollections.some((collection) => collection.name === name)) {
            setQuestionActionStatus(name ? "已有相同名稱的收藏清單。" : "請輸入收藏清單名稱。");
            return;
        }
        const collection: QuestionCollection = {
            id: `collection-${crypto.randomUUID()}`,
            name,
            questionIds: [],
            createdAt: new Date().toISOString(),
        };
        setQuestionCollectionsByLearner((current) => ({
            ...current,
            [activeLearnerId]: [...(current[activeLearnerId] ?? []), collection],
        }));
        setTargetCollectionId(collection.id);
        setNewCollectionName("");
        setCollectionDialogOpen(false);
        setQuestionActionStatus(`已建立「${name}」。`);
    }

    /** 將指定題目加入或移動至收藏清單。 */
    function updateQuestionCollection(questionIds: number[], action: "add" | "move" = questionCollectionAction) {
        const targetId = activeTargetCollectionId;
        if (!questionIds.length || !targetId) return;
        const idSet = new Set(questionIds);
        const target = activeQuestionCollections.find((collection) => collection.id === targetId);
        setQuestionCollectionsByLearner((current) => ({
            ...current,
            [activeLearnerId]: (current[activeLearnerId] ?? []).map((collection) => {
                const remaining = action === "move" ? collection.questionIds.filter((id) => !idSet.has(id)) : collection.questionIds;
                return collection.id === targetId
                    ? { ...collection, questionIds: [...new Set([...remaining, ...questionIds])] }
                    : { ...collection, questionIds: remaining };
            }),
        }));
        setSelectedQuestionIds([]);
        setQuestionActionStatus(`已${action === "move" ? "移動" : "加入"} ${questionIds.length} 題至「${target?.name ?? "收藏清單"}」。`);
    }

    /** 開啟題目總覽的獨立詳情頁。 */
    function openQuestionDetail(questionId: number) {
        questionOverviewScrollRef.current = window.scrollY;
        setSelectedQuestionId(questionId);
        router.push(getOverviewQuestionPath(questionId));
    }

    /** 返回題目清單並回到開啟詳情前的位置。 */
    function closeQuestionDetail() {
        shouldRestoreQuestionScrollRef.current = true;
        setSelectedQuestionId(undefined);
        router.push(SECTION_PATHS.questions, { scroll: false });
    }

    /** 依目前題目總覽順序切換詳情。 */
    function navigateOverviewQuestion(index: number) {
        const question = detailOverviewQuestions[index];
        if (!question) return;
        setSelectedQuestionId(question.id);
        router.push(getOverviewQuestionPath(question.id));
    }

    /** 以指定題目開啟共用的建立練習計劃介面。 */
    function openQuestionPlan(questionIds: number[], source: "題目總覽" | "錯題") {
        if (!questionIds.length) return;
        setPendingQuestionIds([...questionIds]);
        setQuestionPlanSource(source);
        setQuestionPlanDate(getTaipeiDate());
        setQuestionPlanTime("");
        setQuestionPlanDialogOpen(true);
    }

    /** 將題目總覽目前的批次範圍固定為一筆練習計劃。 */
    function createQuestionPlan() {
        if (!questionPlanDate || !pendingQuestionIds.length) return;
        const actionQuestions = pendingQuestionIds
            .map((id) => questions.find((question) => question.id === id))
            .filter((question): question is Question => Boolean(question));
        const subjects = [...new Set(actionQuestions.map((question) => question.subject))];
        const subjectLabel = subjects.length === 1 ? `${subjects[0]} · 精選題目` : `${subjects.length} 科精選題目`;
        const schedule: ScheduledPractice = {
            id: `schedule-${crypto.randomUUID()}`,
            creatorRole: roleAccess.activeRole,
            date: questionPlanDate,
            ...(questionPlanTime ? { time: questionPlanTime } : {}),
            subjectLabel,
            scopeLabel: `${questionPlanSource} · ${actionQuestions.length} 題`,
            checkMode: activePlan.checkMode,
            questionIds: actionQuestions.map((question) => question.id),
            createdAt: new Date().toISOString(),
        };
        setSchedulesByLearner((current) => ({
            ...current,
            [activeLearnerId]: [...(current[activeLearnerId] ?? []), schedule],
        }));
        if (questionPlanSource === "錯題") setSelectedMistakes([]);
        else setSelectedQuestionIds([]);
        setPendingQuestionIds([]);
        setQuestionPlanDialogOpen(false);
        setQuestionActionStatus(`已建立 ${actionQuestions.length} 題的練習計劃。`);
    }

    /** 開始指定題目的練習。 */
    async function beginSession(mode: PracticeSession["mode"], ids: number[], checkMode: CheckMode = activePlan.checkMode, scheduleId?: string, partIdsByQuestion?: Record<number, string[]>) {
        if (!ids.length || practiceRequestRef.current) return;
        if (session?.phase === "answering" && sessionPaused) {
            await resumeSession();
            return;
        }
        let sessionId = `session-${crypto.randomUUID()}`;
        let startedAt = new Date().toISOString();
        let effectiveQuestionIds = [...ids];
        let persistedItems: PracticeSession["persistedItems"];
        const serverQuestions = ids.map((id) => persistedQuestions.get(id));
        if (serverQuestions.some(Boolean)) {
            if (activeLearnerId !== persistedLearnerId || serverQuestions.some((question) => !question)) {
                setPracticeServiceError("請使用登入帳號所屬的學習者開始正式題庫練習。");
                return;
            }
            if (ids.length > LOCAL_PRACTICE_MAX_QUESTIONS) {
                setPracticeServiceError(`每輪最多 ${LOCAL_PRACTICE_MAX_QUESTIONS} 題，請調整本輪題數。`);
                return;
            }
            practiceRequestRef.current = true;
            setPracticeBusy(true);
            try {
                const targets = serverQuestions.flatMap((question, index) => {
                    const routeId = ids[index];
                    const requestedPartIds = partIdsByQuestion?.[routeId] ?? [];
                    if (!requestedPartIds.length) return [{
                        questionId: question!.id,
                        revisionId: question!.revisionId,
                    }];
                    const validPartIds = question!.parts
                        .filter((part) => part.isIndependentlyGradable && requestedPartIds.includes(part.id))
                        .map((part) => part.id);
                    if (validPartIds.length !== new Set(requestedPartIds).size) {
                        throw new Error("錯題的小題版本已更新，請重新載入練習紀錄。");
                    }
                    return validPartIds.map((partId) => ({
                        questionId: question!.id,
                        revisionId: question!.revisionId,
                        partId,
                    }));
                });
                const fingerprint = JSON.stringify({ targets, mode, checkMode });
                const pending = sessionRequestRef.current?.fingerprint === fingerprint
                    ? sessionRequestRef.current
                    : { fingerprint, sessionId: crypto.randomUUID() };
                sessionRequestRef.current = pending;
                const response = await startPersistedPractice(targets, { mode, checkMode }, pending.sessionId);
                if (response.session.status !== "active" && response.session.status !== "paused") {
                    throw new Error("這次練習已結束，請重新建立練習。");
                }
                sessionId = response.session.id;
                startedAt = response.session.startedAt;
                effectiveQuestionIds = response.session.items.map((item) => practiceRouteId(item.questionId));
                persistedItems = response.session.items.map((item) => ({
                    id: item.id,
                    questionId: practiceRouteId(item.questionId),
                    partId: item.partId,
                }));
                sessionRequestRef.current = undefined;
                if (!writePracticeSessionHint(activeLearnerId, sessionId)) {
                    setStorageError("此瀏覽器無法保存練習恢復識別碼；請完成本輪後再關閉頁面。");
                }
                setPracticeServiceError("");
            }
            catch (error) {
                if (isDeterministicPracticeApiError(error)) sessionRequestRef.current = undefined;
                setPracticeServiceError(error instanceof Error ? error.message : "無法開始練習，請重試。");
                return;
            }
            finally {
                practiceRequestRef.current = false;
                setPracticeBusy(false);
            }
        }
        const validPartIdsByQuestion = effectiveQuestionIds.reduce<Record<number, string[]>>((targets, questionId) => {
            // Formal sessions carry the exact part target on each durable session item.
            if (persistedQuestions.has(questionId)) return targets;
            const question = questions.find((item) => item.id === questionId);
            const requestedIds = partIdsByQuestion?.[questionId] ?? [];
            const validIds = question?.parts?.filter((part) => requestedIds.includes(part.id)).map((part) => part.id) ?? [];
            if (validIds.length) targets[questionId] = validIds;
            return targets;
        }, {});
        attemptRequestRef.current = undefined;
        setRecommendationSessionKind(null);
        setSession({ id: sessionId, startedAt, learnerId: activeLearnerId, mode, ...(scheduleId ? { scheduleId } : {}), checkMode, phase: "answering", questionIds: effectiveQuestionIds, ...(persistedItems ? { persistedItems } : {}), ...(Object.keys(validPartIdsByQuestion).length ? { partIdsByQuestion: validPartIdsByQuestion } : {}), index: 0, attempts: [], questionStartedAt: Date.now() });
        setSessionPaused(false); setSessionExitOpen(false); setAnswer(""); setHandwriting(""); setSection(mode === "practice" ? "practice" : "mistakes");
        router.push(getSessionQuestionPath(effectiveQuestionIds[0]));
    }

    /** 將完整作答結果保存到原始練習計劃。 */
    function saveScheduledPracticeResult(currentSession: PracticeSession, attempts: Attempt[]) {
        if (!currentSession.scheduleId || attempts.length !== currentSession.questionIds.length) return;
        const wrongQuestions = currentSession.scoreSummary?.wrong
            ?? attempts.filter((attempt) => attempt.correct === false).length;
        const correctQuestions = currentSession.scoreSummary?.correct
            ?? attempts.filter((attempt) => attempt.correct === true).length;
        const accuracy = currentSession.scoreSummary?.accuracy
            ?? Math.round(correctQuestions / attempts.length * 100);
        setSchedulesByLearner((current) => ({
            ...current,
            [currentSession.learnerId]: (current[currentSession.learnerId] ?? []).map((schedule) => schedule.id === currentSession.scheduleId ? {
                ...schedule,
                result: {
                    sessionId: currentSession.id,
                    completedAt: new Date().toISOString(),
                    totalQuestions: attempts.length,
                    wrongQuestions,
                    accuracy,
                },
            } : schedule),
        }));
    }

    /** 暫時收起專注練習並保留目前頁面狀態。 */
    async function pauseSession() {
        if (!session || session.phase !== "answering") return;
        if (PRACTICE_SESSION_UUID_PATTERN.test(session.id)) {
            setPracticeBusy(true);
            try {
                await updatePersistedPracticeSessionStatus(session.id, "paused");
                if (!writePracticeSessionHint(session.learnerId, session.id)) {
                    setStorageError("練習已暫停，但瀏覽器無法保存恢復識別碼；請勿關閉頁面。");
                }
                setPracticeServiceError("");
            }
            catch (error) {
                setPracticeServiceError(error instanceof Error ? error.message : "無法暫停這次練習，請重試。");
                return;
            }
            finally { setPracticeBusy(false); }
        }
        setSessionPaused(true);
        setSessionExitOpen(false);
        shouldFocusSectionRef.current = true;
        setSection("overview");
        router.push(SECTION_PATHS.overview);
    }

    /** 返回尚未完成的專注練習。 */
    async function resumeSession() {
        if (!session || session.phase !== "answering") return;
        if (PRACTICE_SESSION_UUID_PATTERN.test(session.id)) {
            setPracticeBusy(true);
            try {
                await updatePersistedPracticeSessionStatus(session.id, "active");
                if (!writePracticeSessionHint(session.learnerId, session.id)) {
                    setStorageError("練習已恢復，但瀏覽器無法保存恢復識別碼；請完成本輪後再關閉頁面。");
                }
                setPracticeServiceError("");
            }
            catch (error) {
                setPracticeServiceError(error instanceof Error ? error.message : "無法恢復這次練習，請重試。");
                return;
            }
            finally { setPracticeBusy(false); }
        }
        setMobileNavigationOpen(false);
        setSessionPaused(false);
        setSessionExitOpen(false);
        setSection(session.mode === "practice" ? "practice" : "mistakes");
        router.push(getSessionQuestionPath(session.questionIds[session.index]));
    }

    /** 結束目前練習並保留已送出的作答。 */
    async function endSession() {
        if (!session) return;
        if (!await abandonCurrentSession()) return;
        setSessionExitOpen(false);
        setAnswer("");
        setHandwriting("");
        if (!session.attempts.length) {
            const nextSection = session.mode === "practice" ? "practice" : "mistakes";
            clearSession();
            setSection(nextSection);
            router.push(SECTION_PATHS[nextSection]);
            return;
        }
        saveScheduledPracticeResult(session, session.attempts);
        setSessionPaused(false);
        setSession((current) => current ? { ...current, phase: "complete" } : current);
    }

    /** 關閉結果並回到這一輪原本的工作區。 */
    function leaveSession() {
        const nextSection = session?.mode === "practice" ? "practice" : "mistakes";
        if (session && PRACTICE_SESSION_UUID_PATTERN.test(session.id)) clearPracticeSessionHint(session.learnerId);
        clearSession();
        setSection(nextSection);
        router.push(SECTION_PATHS[nextSection]);
    }

    /** 保存目前答案並依模式前進。 */
    async function submitAnswer() {
        if (!currentQuestion || !session || practiceRequestRef.current) return;
        const serverQuestion = persistedQuestions.get(currentQuestion.id);
        if (serverQuestion && session.attempts.some((attempt) => currentPersistedItem
            ? attempt.sessionItemId === currentPersistedItem.id
            : attempt.questionId === currentQuestion.id)) return;
        const hasWrittenResponse = Boolean(answer.trim() || handwriting);
        if (serverQuestion && session.checkMode === "score" && handwriting) {
            setPracticeServiceError("只顯示成績模式不保存作答內容；請改用逐題或全部作答後檢核。");
            return;
        }
        if (serverQuestion) {
            const values = new Map(parsePracticeAnswers(answer).map((entry) => [entry.partId, entry.value]));
            const targetParts = serverQuestion.parts.filter((part) => (
                !currentTargetPartIds
                || currentTargetPartIds.length === 0
                || currentTargetPartIds.includes(part.id)
            ));
            const incompleteParts = targetParts.filter((part) => {
                const value = values.get(part.id);
                return Array.isArray(value) ? value.length === 0 : !value?.trim();
            });
            const handwritingCompletesMissingText = session.checkMode !== "score"
                && Boolean(handwriting)
                && incompleteParts.length > 0
                && incompleteParts.every((part) => part.answerMode === "text");
            if (!targetParts.length || (incompleteParts.length > 0 && !handwritingCompletesMissingText)) return;
        }
        else {
            if (isCharacterHandwritingQuestion(currentQuestion) && !handwriting) return;
            if (currentQuestion.kind === "written" ? !hasWrittenResponse : !answer.trim()) return;
        }
        const targetPartIds = currentTargetPartIds;
        const partResults = !serverQuestion && currentQuestion.parts?.length ? getQuestionPartResults(currentQuestion, answer, targetPartIds) : [];
        let attempt: Attempt;
        let disclosedAttempts: Attempt[] | undefined;
        let scoreSummary: PracticeSession["scoreSummary"];
        let persistedCompletedAt: string | null = null;
        let persistedSessionStatus: LocalPracticeSessionHistory["status"] | undefined;
        if (serverQuestion) {
            practiceRequestRef.current = true;
            setPracticeBusy(true);
            try {
                // Keep the same payload and idempotency key after an uncertain network response.
                const snapshot = attemptRequestRef.current?.questionId === serverQuestion.id
                    && attemptRequestRef.current.sessionId === session.id
                    && attemptRequestRef.current.sessionItemId === currentPersistedItem?.id
                    ? attemptRequestRef.current
                    : {
                        sessionId: session.id,
                        questionId: serverQuestion.id,
                        ...(currentPersistedItem ? { sessionItemId: currentPersistedItem.id } : {}),
                        ...(currentPersistedItem?.partId ? { partId: currentPersistedItem.partId } : {}),
                        idempotencyKey: crypto.randomUUID(),
                        answers: parsePracticeAnswers(answer),
                        ...(handwriting ? { handwriting: { dataUrl: handwriting } } : {}),
                        durationSeconds: Math.min(86400, Math.max(1, Math.round((Date.now() - session.questionStartedAt) / 1000))),
                    };
                attemptRequestRef.current = snapshot;
                const result = await submitPersistedPracticeAttempt(snapshot);
                persistedCompletedAt = result.session.completedAt;
                persistedSessionStatus = result.session.status;
                const localAttempt: Attempt = {
                    sessionId: session.id,
                    ...(currentPersistedItem ? { sessionItemId: currentPersistedItem.id } : {}),
                    sessionMode: session.mode,
                    questionId: currentQuestion.id,
                    revisionId: serverQuestion.revisionId,
                    ...(currentPersistedItem?.partId ? { partId: currentPersistedItem.partId } : {}),
                    answer: formatPracticeResponse(serverQuestion, answer),
                    correct: null,
                    date: result.disclosure === "masked" ? result.receipt.submittedAt : new Date().toISOString(),
                    durationSeconds: snapshot.durationSeconds ?? 0,
                    ...(handwriting ? { handwriting } : {}),
                };
                if (result.disclosure === "detailed") {
                    const localAttempts = [...session.attempts, localAttempt];
                    const localByItem = new Map(localAttempts.flatMap((item) => (
                        item.sessionItemId ? [[item.sessionItemId, item] as const] : []
                    )));
                    disclosedAttempts = (result.attempts ?? [result.attempt]).map((storedAttempt) => {
                        const adapted = adaptPracticeAttempt(storedAttempt);
                        const local = adapted.sessionItemId
                            ? localByItem.get(adapted.sessionItemId)
                            : localAttempts.find((item) => item.questionId === adapted.questionId);
                        return {
                            ...adapted,
                            sessionMode: session.mode,
                            answer: local?.answer ?? adapted.answer,
                            ...(local?.handwriting ? { handwriting: local.handwriting } : {}),
                        };
                    });
                    attempt = disclosedAttempts.find((item) => currentPersistedItem
                        ? item.sessionItemId === currentPersistedItem.id
                        : item.questionId === currentQuestion.id)
                        ?? { ...adaptPracticeAttempt(result.attempt, localAttempt.answer), sessionMode: session.mode };
                }
                else {
                    attempt = localAttempt;
                    if (result.disclosure === "score") scoreSummary = result.summary;
                }
                attemptRequestRef.current = undefined;
                setPracticeServiceError("");
            }
            catch (error) {
                if (isDeterministicPracticeApiError(error)) attemptRequestRef.current = undefined;
                setPracticeServiceError(error instanceof Error ? error.message : "作答尚未確認保存，請重試。");
                return;
            }
            finally {
                practiceRequestRef.current = false;
                setPracticeBusy(false);
            }
        }
        else attempt = {
            sessionId: session.id,
            sessionMode: session.mode,
            questionId: currentQuestion.id,
            answer: answer.trim() || "手寫作答",
            correct: answer.trim() ? checkAnswer(currentQuestion, answer, targetPartIds) : null,
            ...(partResults.length ? { partResults } : {}),
            date: new Date().toISOString(),
            durationSeconds: Math.max(1, Math.round((Date.now() - session.questionStartedAt) / 1000)),
            ...(handwriting ? { handwriting } : {}),
        };
        const attempts = disclosedAttempts && session.checkMode === "complete"
            ? disclosedAttempts
            : [...session.attempts, attempt];
        const nextQuestionIndex = session.index + 1 < session.questionIds.length ? session.index + 1 : -1;
        const nextQuestionId = nextQuestionIndex >= 0 ? session.questionIds[nextQuestionIndex] : undefined;
        const allLocalQuestionsAnswered = nextQuestionId === undefined;
        const completesSession = session.checkMode !== "instant" && (serverQuestion
            ? persistedSessionStatus === "completed"
            : allLocalQuestionsAnswered);
        const completedSession = { ...session, attempts, ...(scoreSummary ? { scoreSummary } : {}) };
        if (completesSession) saveScheduledPracticeResult(completedSession, attempts);
        if (completesSession && scoreSummary) {
            const scoreHistory: LocalPracticeSessionHistory = {
                id: session.id,
                mode: session.mode,
                checkMode: "score",
                status: "completed",
                startedAt: session.startedAt,
                completedAt: persistedCompletedAt ?? new Date().toISOString(),
                itemCount: session.questionIds.length,
                attemptedItemCount: scoreSummary.total,
                disclosure: "score",
                summary: scoreSummary,
            };
            setPracticeSessionsByLearner((current) => ({
                ...current,
                [session.learnerId]: [
                    scoreHistory,
                    ...(current[session.learnerId] ?? []).filter((item) => item.id !== session.id),
                ],
            }));
        }
        if (!serverQuestion || disclosedAttempts) {
            setAttemptsByLearner((current) => ({
                ...current,
                [session.learnerId]: serverQuestion && session.checkMode === "complete"
                    ? [...(current[session.learnerId] ?? []).filter((item) => item.sessionId !== session.id), ...attempts]
                    : [...(current[session.learnerId] ?? []), attempt],
            }));
        }
        setSession((current) => {
            if (!current) return current;
            if (current.checkMode === "instant") return { ...current, attempts };
            return completesSession
                ? { ...current, attempts, ...(scoreSummary ? { scoreSummary } : {}), phase: "complete" }
                : { ...current, attempts, index: nextQuestionIndex, questionStartedAt: Date.now() };
        });
        if (shouldAdvanceAfterSubmit(session.checkMode)) {
            setAnswer("");
            setHandwriting("");
            if (nextQuestionId !== undefined) router.push(getSessionQuestionPath(nextQuestionId));
        }
    }

    /** 逐題檢核後前往下一題。 */
    function moveNext() {
        const nextIndex = session && session.index + 1 < session.questionIds.length ? session.index + 1 : -1;
        const nextQuestionId = session && nextIndex >= 0 ? session.questionIds[nextIndex] : undefined;
        const completesSession = Boolean(session && nextIndex < 0);
        if (session && completesSession) saveScheduledPracticeResult(session, session.attempts);
        setAnswer(""); setHandwriting("");
        setSession((current) => !current ? current : completesSession
            ? { ...current, phase: "complete" }
            : { ...current, index: nextIndex, questionStartedAt: Date.now() });
        if (nextQuestionId !== undefined) router.push(getSessionQuestionPath(nextQuestionId));
    }

    /** 取得目前最新錯題對應的正式 queue item；不可用畫面篩選條件推測推薦來源。 */
    function getRecommendationSourceQueueItemIds(questionId: number) {
        return [...new Set(recommendationQueueIdsByQuestion.get(questionId) ?? [])];
    }

    /** 將推薦 API 回傳的公開題目併入目前正式題庫，供既有作答介面直接使用。 */
    function mergeRecommendationQuestions(serverQuestions: LocalPracticeQuestion[]) {
        if (!serverQuestions.length) return;
        setPersistedQuestions((current) => {
            const merged = new Map(current);
            serverQuestions.forEach((question) => merged.set(practiceRouteId(question.id), question));
            return merged;
        });
        setQuestions((current) => {
            const merged = new Map(current.map((question) => [question.id, question]));
            serverQuestions.forEach((question) => merged.set(practiceRouteId(question.id), adaptPracticeQuestion(question)));
            return [...merged.values()];
        });
    }

    /** 讀取單一錯題的同題型／confirmed 相似題候選摘要。 */
    async function loadRecommendationPreview(questionId: number) {
        const sourceQueueItemIds = getRecommendationSourceQueueItemIds(questionId);
        if (!sourceQueueItemIds.length) return;
        const sourceKey = [...sourceQueueItemIds].sort().join(":");
        setRecommendationPreviews((current) => ({
            ...current,
            [questionId]: { sourceKey, status: "loading" },
        }));
        try {
            const result = await previewPersistedPracticeRecommendations({
                sourceQueueItemIds,
                limit: recommendationLimit,
            });
            setRecommendationPreviews((current) => current[questionId]?.sourceKey === sourceKey ? {
                ...current,
                [questionId]: { sourceKey, status: "ready", result },
            } : current);
        }
        catch (error) {
            setRecommendationPreviews((current) => current[questionId]?.sourceKey === sourceKey ? {
                ...current,
                [questionId]: {
                    sourceKey,
                    status: "error",
                    error: error instanceof Error ? error.message : "目前無法取得延伸題目。",
                },
            } : current);
        }
    }

    /** 由伺服器依嚴格層級建立同題型或 confirmed 相似題練習。 */
    async function startRecommendationSession(sourceQuestionId: number, checkMode: CheckMode = "instant"): Promise<boolean> {
        const sourceQueueItemIds = getRecommendationSourceQueueItemIds(sourceQuestionId);
        if (!sourceQueueItemIds.length || practiceRequestRef.current) {
            if (!sourceQueueItemIds.length) setRecommendationNotice("這筆錯題目前沒有可用的延伸練習來源。");
            return false;
        }
        const fingerprint = JSON.stringify({ sourceQueueItemIds: [...sourceQueueItemIds].sort(), checkMode });
        const pending = recommendationRequestRef.current?.fingerprint === fingerprint
            ? recommendationRequestRef.current
            : { fingerprint, sessionId: crypto.randomUUID() };
        recommendationRequestRef.current = pending;
        practiceRequestRef.current = true;
        setPracticeBusy(true);
        setRecommendationNotice("");
        try {
            const result = await startPersistedPracticeRecommendations({
                sourceQueueItemIds,
                limit: recommendationLimit,
                checkMode,
                sessionId: pending.sessionId,
            });
            if (result.recommendationKind === "none" || !result.session) {
                recommendationRequestRef.current = undefined;
                setRecommendationNotice(result.explanation || "目前沒有可練習的同題型或相似題型。");
                const queueIds = recommendationQueueIdsByQuestion.get(sourceQuestionId) ?? [];
                const sourceKey = [...queueIds].sort().join(":");
                if (sourceKey) setRecommendationPreviews((current) => ({
                    ...current,
                    [sourceQuestionId]: { sourceKey, status: "ready", result },
                }));
                return false;
            }
            if (result.session.status !== "active" && result.session.status !== "paused") {
                throw new Error("這次延伸練習已結束，請重新建立練習。");
            }
            const returnedQuestions = new Map(result.questions.map((question) => [question.id, question]));
            const sessionQuestions = result.session.items.map((item) => returnedQuestions.get(item.questionId));
            if (sessionQuestions.some((question, index) => !question || question.revisionId !== result.session!.items[index]?.revisionId)) {
                throw new Error("延伸練習的題目版本不完整，請重新取得候選題目。");
            }
            mergeRecommendationQuestions(result.questions);
            const questionIds = result.session.items.map((item) => practiceRouteId(item.questionId));
            const persistedItems = result.session.items.map((item) => ({
                id: item.id,
                questionId: practiceRouteId(item.questionId),
                partId: item.partId,
            }));
            recommendationRequestRef.current = undefined;
            if (!writePracticeSessionHint(activeLearnerId, result.session.id)) {
                setStorageError("此瀏覽器無法保存練習恢復識別碼；請完成本輪後再關閉頁面。");
            }
            attemptRequestRef.current = undefined;
            setRecommendationSessionKind(result.recommendationKind);
            setSession({
                id: result.session.id,
                startedAt: result.session.startedAt,
                learnerId: activeLearnerId,
                mode: result.session.mode,
                checkMode: result.session.checkMode,
                phase: "answering",
                questionIds,
                persistedItems,
                index: 0,
                attempts: [],
                questionStartedAt: Date.now(),
            });
            setSessionPaused(false);
            setSessionExitOpen(false);
            setAnswer("");
            setHandwriting("");
            setSection("mistakes");
            router.push(getSessionQuestionPath(questionIds[0]));
            return true;
        }
        catch (error) {
            if (isDeterministicPracticeApiError(error)) recommendationRequestRef.current = undefined;
            setRecommendationNotice(error instanceof Error ? error.message : "目前無法開始延伸練習，請重試。");
            return false;
        }
        finally {
            practiceRequestRef.current = false;
            setPracticeBusy(false);
        }
    }

    /** 依設定優先啟動尚未完成的相同／相近題，沒有候選時接續一般篩選題目。 */
    async function startPlannedPractice() {
        if (activePlan.prioritizeRelated) {
            for (const sourceQuestionId of recommendableMistakeIds) {
                if (await startRecommendationSession(sourceQuestionId, activePlan.checkMode)) return;
            }
            if (recommendableMistakeIds.length) {
                setRecommendationNotice("相同與相近題已全部練習完成，接著練習其他符合條件的題目。");
            }
        }
        await beginSession("practice", plannedQuestions.map((question) => question.id));
    }

    /** 顯示伺服器決定的單一推薦層級；空結果不以其他關聯補題。 */
    function renderRecommendationAction(questionId: number) {
        const sourceQueueItemIds = recommendationQueueIdsByQuestion.get(questionId) ?? [];
        if (!sourceQueueItemIds.length && recommendationQueueRefreshing) {
            return <Button appearance="ghost" tone="muted" size="sm" disabled><Sparkles />正在更新錯題來源…</Button>;
        }
        const preview = recommendationPreviews[questionId];
        if (!sourceQueueItemIds.length) {
            return <p className="text-xs font-semibold text-muted-foreground" role="status">目前沒有可用的同題型或相似題型。</p>;
        }
        if (!preview || preview.status === "loading") {
            return <Button appearance="ghost" tone="muted" size="sm" disabled><Sparkles />正在尋找延伸題目…</Button>;
        }
        if (preview.status === "error") {
            return <div className="grid gap-1">
                <p className="text-xs font-semibold text-danger" role="alert">{preview.error}</p>
                <Button appearance="ghost" tone="muted" size="sm" onClick={() => void loadRecommendationPreview(questionId)}>重新尋找</Button>
            </div>;
        }
        const result = preview.result;
        if (!result || result.recommendationKind === "none" || result.availableCount === 0) {
            return <p className="text-xs font-semibold text-muted-foreground" role="status">目前沒有可練習的同題型或相似題型。</p>;
        }
        const isSameType = result.recommendationKind === "same_type";
        const isTopicSimilar = result.recommendationKind === "topic_similar";
        const kindLabel = isSameType ? "同題型" : isTopicSimilar ? "相近內容" : "已確認相似題型";
        const actionLabel = isSameType ? "同題型練習" : isTopicSimilar ? "相近題練習" : "相似題型練習";
        const classification = isSameType && result.classificationLabel ? ` · ${result.classificationLabel}` : "";
        const sessionCount = Math.min(result.availableCount, recommendationLimit);
        return <div className="grid min-w-0 gap-1" title={result.explanation}>
            <Badge className="w-fit" tone={isSameType ? "primary" : "warning"}>{kindLabel}{classification} · 可用 {result.availableCount} 題</Badge>
            <p className="text-xs leading-relaxed text-muted-foreground">{result.explanation}</p>
            <Button appearance="ghost" tone="muted" size="sm" disabled={practiceBusy} onClick={() => void startRecommendationSession(questionId, "instant")}><Sparkles />{actionLabel}（{sessionCount}）</Button>
        </div>;
    }

    /** 驗證並載入要匯入的檔案。 */
    async function loadImportFiles(files: File[]) {
        if (files.some((file) => !ACCEPTED_FILE_TYPES.includes(file.type) || file.size > FILE_SIZE_LIMIT)) {
            setFileNames([]); setImportDrafts([]); setFileError("僅接受 JPG、PNG、PDF，單一檔案不可超過 10 MB。"); setImportStatus(""); return;
        }
        try {
            const imageFiles = files.filter((file) => file.type.startsWith("image/"));
            const images = await Promise.all(imageFiles.map(readImage));
            setFileNames(files.map((file) => file.name));
            setImportDrafts(files.length ? createImportDrafts(images) : []);
        }
        catch {
            setFileNames([]);
            setImportDrafts([]);
            setFileError("圖片預覽讀取失敗，請重新選擇檔案。");
            return;
        }
        setFileError("");
        setImportStatus("");
    }

    /** 從檔案選擇器載入題目文件。 */
    function handleFiles(event: ChangeEvent<HTMLInputElement>) {
        void loadImportFiles([...(event.target.files ?? [])]);
    }

    /** 接收拖放到上傳區的題目文件。 */
    function handleImportDrop(event: DragEvent<HTMLLabelElement>) {
        event.preventDefault();
        setIsImportDragging(false);
        void loadImportFiles([...event.dataTransfer.files]);
    }

    /** 建立目前角色與學習者使用的匯入本。 */
    function createImportBook() {
        const name = newImportBookName.trim();
        if (!name) {
            setFileError("請輸入題本名稱。");
            return;
        }
        if (availableImportBooks.some((book) => book.name === name)) {
            setFileError("目前角色已經有同名題本，請使用其他名稱。");
            return;
        }
        const book: ImportBook = {
            id: crypto.randomUUID(),
            name,
            ownerRole: roleAccess.activeRole,
            learnerIds: [activeLearnerId],
            createdAt: new Date().toISOString(),
        };
        setImportBooks((current) => [...current, book]);
        setSelectedImportBookId(book.id);
        setNewImportBookName("");
        setCreatingImportBook(false);
        setFileError("");
    }

    /** 將貼上的題目文字帶入多題校正流程。 */
    function analyzeImportText() {
        if (!importText.trim()) {
            setFileError("請先貼上題目文字。");
            return;
        }

        setFileNames(["貼上文字"]);
        setImportDrafts(createImportDrafts());
        setFileError("");
        setImportStatus("已建立模擬辨識結果；正式版本會由 AI 依原文拆分全部題目。");
    }

    /** 更新單筆待校正題目的欄位。 */
    function updateImportDraft<K extends keyof ImportQuestionDraft>(id: string, field: K, value: ImportQuestionDraft[K]) {
        setImportDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [field]: value } : draft));
        setImportStatus("");
    }

    /** 更新待校正題目的動態文件欄位。 */
    function updateImportMetadata(id: string, fieldIndex: number, field: "label" | "rawValue", value: string) {
        setImportDrafts((current) => current.map((draft) => {
            if (draft.id !== id) return draft;
            const metadata = draft.metadata.map((item, index) => {
                if (index !== fieldIndex) return item;
                const rawValue = field === "rawValue" ? value : item.rawValue;
                return { ...item, [field]: value, rawValue, values: rawValue.split(/[、,，;；]/).map((entry) => entry.trim()).filter(Boolean), valueSource: "user" as const, confidence: 1 };
            });
            return { ...draft, metadata };
        }));
        setImportStatus("");
    }

    /** 新增一個來源文件欄位，讓未預先定義的項目仍可保存與篩選。 */
    function addImportMetadata(id: string) {
        setImportDrafts((current) => current.map((draft) => draft.id === id ? {
            ...draft,
            metadata: [...draft.metadata, {
                key: `custom_${Date.now()}`,
                label: "",
                rawValue: "",
                values: [],
                valueSource: "user",
                confidence: 1,
            }],
        } : draft));
    }

    /** 移除錯誤辨識或不屬於題目的來源文件欄位。 */
    function removeImportMetadata(id: string, fieldIndex: number) {
        setImportDrafts((current) => current.map((draft) => draft.id === id
            ? { ...draft, metadata: draft.metadata.filter((_, index) => index !== fieldIndex) }
            : draft));
    }

    /** 更新待校正題目的科目並帶入該學習者使用的書籍版本。 */
    function changeImportSubject(id: string, subject: Subject | "") {
        setImportDrafts((current) => current.map((draft) => draft.id === id ? {
            ...draft,
            subject,
            version: subject ? activeLearner.bookVersions[subject] : "",
            customVersion: "",
            chapter: "",
            customChapter: "",
            unit: "",
            customUnit: "",
            topic: "",
            customTopic: "",
            source: "",
            customSource: "",
        } : draft));
        setImportStatus("");
    }

    /** 以另一張本機圖片取代指定題目的附圖。 */
    async function replaceImportImage(id: string, event: ChangeEvent<HTMLInputElement>, placement: "prompt" | "answer" = "prompt") {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/") || file.size > FILE_SIZE_LIMIT) {
            setFileError("題目附圖只接受 JPG 或 PNG，單一檔案不可超過 10 MB。");
            return;
        }

        try {
            const image = await readImage(file);
            setImportDrafts((current) => current.map((draft) => draft.id === id
                ? placement === "answer"
                    ? { ...draft, answerImageName: image.name, answerImageUrl: image.url }
                    : { ...draft, imageName: image.name, imageUrl: image.url }
                : draft));
            setFileError("");
            setImportStatus("");
        }
        catch {
            setFileError("圖片預覽讀取失敗，請重新選擇檔案。");
        }
    }

    /** 移除指定題目的附圖。 */
    function removeImportImage(id: string) {
        setImportDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, imageName: undefined, imageUrl: undefined } : draft));
        setImportStatus("");
    }

    /** 移除指定題目的答案附圖。 */
    function removeImportAnswerImage(id: string) {
        setImportDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, answerImageName: undefined, answerImageUrl: undefined } : draft));
        setImportStatus("");
    }

    /** 將指定題目的附圖移到下一題，供 AI 配對錯誤時人工修正。 */
    function moveImportImage(id: string) {
        setImportDrafts((current) => {
            const index = current.findIndex((draft) => draft.id === id);
            const image = current[index];
            if (!image?.imageUrl || index < 0 || index === current.length - 1) return current;
            return current.map((draft, draftIndex) => {
                if (draftIndex === index) return { ...draft, imageName: undefined, imageUrl: undefined };
                if (draftIndex === index + 1) return { ...draft, imageName: image.imageName, imageUrl: image.imageUrl };
                return draft;
            });
        });
        setImportStatus("");
    }

    /** 更新匯入年級並清除不再適用的科目與教材資訊。 */
    function changeImportGrade(value: string) {
        const subjects = getSubjectsForGrade(value, questions, activeLearner.customSubjects);
        setImportGrade(value);
        setImportDrafts((current) => current.map((draft) => ({
            ...draft,
            subject: draft.subject && subjects.includes(draft.subject) ? draft.subject : "",
            version: "",
            customVersion: "",
            chapter: "",
            customChapter: "",
            unit: "",
            customUnit: "",
            topic: "",
            customTopic: "",
            source: "",
            customSource: "",
        })));
        setImportStatus("");
    }

    /** 將全部已確認題目與圖片寫入 runtime JSON。 */
    async function finishImportDemo() {
        const missingMetadata = importDrafts.some((draft) => !draft.subject
            || !(draft.version === CUSTOM_IMPORT_VALUE ? draft.customVersion.trim() : draft.version)
            || !(draft.chapter === CUSTOM_IMPORT_VALUE ? draft.customChapter.trim() : draft.chapter)
            || !(draft.unit === CUSTOM_IMPORT_VALUE ? draft.customUnit.trim() : draft.unit)
            || !(draft.topic === CUSTOM_IMPORT_VALUE ? draft.customTopic.trim() : draft.topic)
            || !draft.difficulty
            || !(draft.source === CUSTOM_IMPORT_VALUE ? draft.customSource.trim() : draft.source));
        if (missingMetadata) {
            setFileError("目前尚未串接 AI，請先確認每題的科目、版本、章節、單元、主題、難易度與來源。");
            return;
        }

        setIsImporting(true);
        setFileError("");
        try {
            const selectedBook = availableImportBooks.find((book) => book.id === selectedImportBookId);
            const payload = {
                fileNames,
                book: {
                    id: selectedBook?.id ?? "system-default",
                    name: selectedBook?.name ?? "系統預設",
                    ownerRole: roleAccess.activeRole,
                    learnerId: activeLearnerId,
                },
                questions: importDrafts.map((draft, index) => ({
                    code: draft.code,
                    prompt: draft.prompt,
                    answer: draft.answer,
                    subject: draft.subject,
                    grade: importGrade,
                    semester: activeLearner.semester,
                    version: draft.version === CUSTOM_IMPORT_VALUE ? draft.customVersion : draft.version,
                    chapter: draft.chapter === CUSTOM_IMPORT_VALUE ? draft.customChapter : draft.chapter,
                    unit: draft.unit === CUSTOM_IMPORT_VALUE ? draft.customUnit : draft.unit,
                    topic: draft.topic === CUSTOM_IMPORT_VALUE ? draft.customTopic : draft.topic,
                    knowledge: draft.topic === CUSTOM_IMPORT_VALUE ? draft.customTopic : draft.topic,
                    difficulty: draft.difficulty,
                    source: draft.source === CUSTOM_IMPORT_VALUE ? draft.customSource : draft.source,
                    sourceCategory: normalizeQuestionSourceCategory(draft.source === CUSTOM_IMPORT_VALUE ? draft.customSource : draft.source),
                    questionNumber: draft.code || String(index + 1),
                    metadata: [
                        ...draft.metadata.filter((field) => field.key !== "source_category" && field.label.trim() && field.rawValue.trim()),
                        {
                            key: "source_category",
                            label: "來源",
                            rawValue: normalizeQuestionSourceCategory(draft.source === CUSTOM_IMPORT_VALUE ? draft.customSource : draft.source),
                            values: [normalizeQuestionSourceCategory(draft.source === CUSTOM_IMPORT_VALUE ? draft.customSource : draft.source)],
                            valueSource: "user" as const,
                            confidence: 1,
                        },
                    ],
                    blocks: [
                        { placement: "prompt", text: draft.prompt },
                        ...(draft.imageUrl ? [{ placement: "prompt", imageDataUrl: draft.imageUrl, alt: `${draft.prompt}的題目附圖` }] : []),
                        { placement: "answer", text: draft.answer },
                        ...(draft.answerImageUrl ? [{ placement: "answer", imageDataUrl: draft.answerImageUrl, alt: `${draft.prompt}的答案附圖` }] : []),
                    ],
                })),
            };
            const response = await fetch("/api/v1/imports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json() as { data?: { batch: ImportBatch; questions: Question[] }; error?: { message: string } };
            if (!response.ok || !result.data) throw new Error(result.error?.message ?? "題目寫入失敗。");
            setQuestions((current) => [...current, ...result.data!.questions]);
            setImports((current) => [...current, result.data!.batch]);
            setImportStatus(`已將 ${result.data.questions.length} 題加入「${result.data.batch.bookName ?? "系統預設"}」。`);
            setFileNames([]);
            setImportDrafts([]);
            setImportText("");
        }
        catch (error) {
            setFileError(error instanceof Error ? error.message : "題目寫入失敗，請稍後再試。");
        }
        finally {
            setIsImporting(false);
        }
    }

    const sessionCorrect = session?.attempts.filter((attempt) => attempt.correct === true).length ?? 0;
    const pendingCount = session?.attempts.filter((attempt) => attempt.correct === null).length ?? 0;
    const wrongIds = [...new Set(session?.attempts.filter(needsWrongReview).map((attempt) => attempt.questionId) ?? [])];
    const wrongPartIdsByQuestion = getWrongPartIdsByQuestion(session?.attempts.filter(needsWrongReview) ?? []);
    const expandedHistoryWrongIds = practiceRecords.find((record) => record.id === selectedPracticeRecordId)
        ?.attempts.filter(needsWrongReview).map((attempt) => attempt.questionId) ?? [];
    const recommendationPreviewQuestionIds = [...new Set([
        ...pagedMistakeQuestions.map((question) => question.id),
        ...expandedHistoryWrongIds,
        ...(session?.phase === "complete" ? wrongIds : []),
    ])];
    const recommendationPreviewKey = recommendationPreviewQuestionIds.join(":");
    const dayDifference = getDayDifference(activeExam.date);
    const examCountdownLabel = getExamCountdownLabel(dayDifference);
    const sessionModeLabel = recommendationSessionKind === "same_type"
        ? "同題型練習"
        : recommendationSessionKind === "topic_similar"
            ? "相近題練習"
        : recommendationSessionKind === "confirmed_similar"
            ? "相似題型練習"
            : session?.mode === "similar" ? "相關題目練習" : session?.mode === "review" ? "錯題複習" : "考前練習";

    useEffect(() => {
        let active = true;
        if (session?.phase !== "complete" || !persistedLearnerId) {
            setRecommendationQueueRefreshing(false);
            return;
        }
        setRecommendationQueueRefreshing(true);
        loadPersistedPractice().then((persisted) => {
            if (!active || persisted.account.learner?.id !== persistedLearnerId) return;
            setWrongReviewQueue(persisted.wrongReviewQueue.items);
        }).catch((error) => {
            if (active) setRecommendationNotice(error instanceof Error ? error.message : "目前無法更新錯題延伸來源。");
        }).finally(() => {
            if (active) setRecommendationQueueRefreshing(false);
        });
        return () => { active = false; };
    }, [persistedLearnerId, session?.id, session?.phase]);

    useEffect(() => {
        if (!persistedLearnerId) return;
        recommendationPreviewQuestionIds.forEach((questionId) => {
            const sourceQueueItemIds = recommendationQueueIdsByQuestion.get(questionId) ?? [];
            if (!sourceQueueItemIds.length) return;
            const sourceKey = [...sourceQueueItemIds].sort().join(":");
            const current = recommendationPreviews[questionId];
            if (current?.sourceKey === sourceKey) return;
            void loadRecommendationPreview(questionId);
        });
    // The key keeps preview requests scoped to cards currently rendered on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistedLearnerId, recommendationPreviewKey, recommendationQueueIdsByQuestion]);

    /** 顯示作答中或完成結果。 */
    function renderSession() {
        if (!session) return null;
        if (session.phase === "answering" && currentQuestion) {
            return (
                <>
                {practiceServiceError && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm" role="alert">{practiceServiceError}</p>}
                <QuestionFlow
                    question={currentQuestion}
                    serverQuestion={persistedQuestions.get(currentQuestion.id)}
                    busy={practiceBusy}
                    answerLocked={Boolean(attemptRequestRef.current)}
                    index={session.index}
                    total={session.questionIds.length}
                    partIds={currentTargetPartIds}
                    checkMode={session.checkMode}
                    answer={answer}
                    handwriting={handwriting}
                    feedback={currentFeedback}
                    onAnswer={setAnswer}
                    onHandwriting={setHandwriting}
                    onSubmit={submitAnswer}
                    onNext={moveNext}
                />
                </>
            );
        }
        const scoreOnly = session.checkMode === "score";
        const reviewedInSession = session.attempts.length - pendingCount;
        const sessionAccuracy = scoreOnly
            ? session.scoreSummary?.accuracy ?? null
            : reviewedInSession ? Math.round(sessionCorrect / reviewedInSession * 100) : null;
        const sessionWrong = scoreOnly
            ? session.scoreSummary?.wrong ?? 0
            : session.attempts.filter((attempt) => attempt.correct === false).length;
        const sessionPending = scoreOnly ? session.scoreSummary?.pending ?? session.attempts.length : pendingCount;
        const sessionTotal = scoreOnly ? session.scoreSummary?.total ?? session.attempts.length : session.attempts.length;
        return (
            <Card className="practice-result-card workspace-card border-border/80 shadow-sm">
                <CardHeader className="border-b border-border/80 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <Badge tone="success"><CheckCircle2 />本輪完成</Badge>
                        <h2 className="mt-3 text-2xl font-bold">練習結果</h2>
                        <CardDescription>{scoreOnly
                            ? session.scoreSummary
                                ? `共 ${sessionTotal} 題，答錯 ${sessionWrong} 題${sessionPending ? `，待檢視 ${sessionPending} 題` : ""}。本模式不顯示逐題結果。`
                                : "本輪尚未完成，因此不提供成績或逐題結果。"
                            : `共 ${session.attempts.length} 題，答對 ${sessionCorrect} 題${pendingCount ? `，待檢視 ${pendingCount} 題` : ""}。`}</CardDescription>
                    </div>
                    <div className="workspace-stat px-6 py-4 text-center">
                        <p className="text-3xl font-bold text-primary">{sessionAccuracy === null ? "—" : `${sessionAccuracy}%`}</p>
                        <p className="text-xs text-muted-foreground">已檢核題目正確率</p>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4 p-5 sm:p-7">
                    {recommendationNotice && <p className="rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="status">{recommendationNotice}</p>}
                    {scoreOnly && <div className="workspace-surface rounded-2xl p-5 text-center"><p className="text-lg font-bold">{session.scoreSummary ? `本輪答對 ${session.scoreSummary.correct} 題、答錯 ${sessionWrong} 題` : "本輪未產生成績"}</p><p className="mt-1 text-sm text-muted-foreground">為保留測驗效果，本模式只顯示整體統計，不顯示逐題結果、答案或解析。</p></div>}
                    {!scoreOnly && session.attempts.map((attempt, index) => {
                        const question = questions.find((item) => item.id === attempt.questionId);
                        const wrongPartLabels = question ? getWrongPartLabels(question, attempt) : [];
                        return question ? (
                            <div className={`workspace-surface grid gap-4 rounded-xl p-4 ${attempt.handwriting ? "md:grid-cols-[minmax(0,1fr)_minmax(15rem,38%)]" : ""}`} key={attempt.sessionItemId ?? `${attempt.questionId}-${index}`}>
                                <div className="flex min-w-0 items-start justify-between gap-3">
                                    <div>
                                        <p className="font-semibold">{index + 1}.</p>
                                        <QuestionPrompt question={question} className="whitespace-pre-line font-semibold" />
                                        <p className="mt-1 text-sm text-muted-foreground">你的答案：{formatAnswer(question, attempt.answer)}</p>
                                        {wrongPartLabels.length > 0 && <p className="text-sm text-rose-700">答錯小題：{wrongPartLabels.join("、")}</p>}
                                        <p className="text-sm text-muted-foreground">{persistedQuestions.has(question.id)
                                            ? attempt.referenceAnswers?.length ? `參考答案：${formatReferenceAnswers(attempt.referenceAnswers)}` : "這個題目版本尚無可顯示的參考答案。"
                                            : `參考答案：${formatAnswer(question, question.answer)}`}</p><ContentImages blocks={question.blocks} placement="answer" />
                                    </div>
                                    <Badge className="shrink-0" tone={attempt.correct === true ? "success" : attempt.correct === false ? "danger" : "warning"}>{attempt.correct === true ? "答對" : attempt.correct === false ? "待加強" : "待檢視"}</Badge>
                                </div>
                                {session.checkMode === "complete" && attempt.correct !== null && <p className="text-sm md:col-start-1">{question.explanation}</p>}
                                {attempt.handwriting && <div className="md:col-start-2 md:row-span-2 md:row-start-1"><p className="mb-2 text-xs font-semibold text-muted-foreground">原始手寫</p><img src={attempt.handwriting} alt={`第 ${index + 1} 題原始手寫內容`} className="max-h-56 w-full rounded-xl border border-border bg-white object-contain" /></div>}
                                {needsWrongReview(attempt) && <div className="col-span-full">{renderRecommendationAction(attempt.questionId)}</div>}
                                <time className="practice-result-time col-span-full justify-self-end" dateTime={attempt.date}>{formatAttemptDate(attempt.date)} · {formatDuration(attempt.durationSeconds)}</time>
                            </div>
                        ) : null;
                    })}
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button appearance="outline" tone="muted" onClick={leaveSession}>返回工作區</Button>
                        {!scoreOnly && wrongIds.length > 0 && <Button appearance="outline" onClick={() => beginSession("review", wrongIds, "instant", undefined, wrongPartIdsByQuestion)}>複習本輪錯題</Button>}
                    </div>
                </CardContent>
            </Card>
        );
    }

    /** 顯示目前導覽工作區。 */
    function renderSection() {
        if ((section === "practice" || section === "mistakes") && session && !sessionPaused) return renderSession();
        if (section === "overview") return renderOverview();
        if (section === "practice" && isScheduleListPage) return renderPracticeScheduleListPage();
        if (section === "practice") return renderPractice();
        if (section === "questions") return renderQuestionOverview();
        if (section === "bank") return renderBank();
        if (section === "mistakes") return renderMistakes();
        if (section === "settings") return renderSettings();
        if (section === "system-settings") return renderSystemSettings();
        return renderOverview();
    }

    /** 顯示考前總覽。 */
    function renderOverview() {
        const weakUnits = [...new Set(mistakeQuestions.map((question) => question.unit))];
        const unitProgress = [...new Set(learnerQuestions.map((question) => question.unit))].map((unit) => {
            const unitQuestions = learnerQuestions.filter((question) => question.unit === unit);
            const questionIds = new Set(unitQuestions.map((question) => question.id));
            const attempts = latestAttempts.filter((attempt) => questionIds.has(attempt.questionId));
            return {
                unit,
                answered: attempts.length,
                correct: attempts.filter((attempt) => attempt.correct === true).length,
                total: unitQuestions.length,
                value: unitQuestions.length ? Math.round(attempts.length / unitQuestions.length * 100) : 0,
            };
        });
        return (
            <div className="grid gap-5">
                <section className="learning-hero rounded-3xl bg-white p-6 sm:p-8">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm font-semibold text-primary">考前學習總覽</p>
                            <h2 ref={overviewHeadingRef} data-focus-heading tabIndex={-1} className="mt-2 text-3xl font-bold">準備開始今天的學習</h2>
                            <p className="mt-2 max-w-xl text-muted-foreground">{dayDifference === null
                                ? `${activeExam.name}尚未設定日期，今天接著完成已設定的考試範圍。`
                                : dayDifference > 0
                                    ? `距離${activeExam.name}還有 ${dayDifference} 天，今天接著完成已設定的考試範圍。`
                                    : dayDifference === 0
                                        ? `${activeExam.name}就是今天，先完成最後一輪練習。`
                                        : `${activeExam.name}已結束，可切換到其他考試繼續安排。`}</p>
                            <Button className="button-blue mt-5" disabled={!plannedQuestions.length} onClick={() => beginSession("practice", plannedQuestions.map((question) => question.id))}>
                                {sessionPaused ? "繼續目前練習" : "開始今日練習"}<ArrowRight />
                            </Button>
                        </div>
                        <LearningScene />
                    </div>
                </section>
                <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                    <Card className="workspace-card border-border/80 shadow-sm">
                        <CardHeader><WorkspaceHeading icon={BarChart3} title="題庫作答進度" description="依目前年級題庫與每題最新一次作答整理。" /></CardHeader>
                        <CardContent className="grid gap-5">
                            {unitProgress.map(({ unit, answered, correct, total, value }) => (
                                <div key={unit}>
                                    <div className="mb-2 flex justify-between gap-3 text-sm"><span className="font-semibold">{getUnitLabel(unit)}</span><span className="text-muted-foreground">已做 {answered}/{total} · 答對 {correct}</span></div>
                                    <Progress aria-label={`${unit}作答進度 ${value}%`} value={value} />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                    <div className="grid gap-5">
                        <Card className="workspace-card border-border/80 shadow-sm"><CardHeader><WorkspaceHeading icon={Target} title="目前弱點" description="依錯題紀錄整理需要加強的單元。" /></CardHeader><CardContent className="flex flex-wrap gap-2">{weakUnits.length ? weakUnits.map((unit) => <Badge key={unit} tone="danger">{getUnitLabel(unit)}</Badge>) : <p className="text-sm text-muted-foreground">目前沒有待加強單元。</p>}</CardContent></Card>
                        <Card className="workspace-card border-border/80 shadow-sm">
                            <CardHeader><WorkspaceHeading icon={Clock3} title="最近練習" description="查看最近三筆作答狀態。" /></CardHeader>
                            <CardContent className="grid gap-3">
                                {!activeAttempts.length && <p className="text-sm text-muted-foreground">尚未有作答紀錄。</p>}
                                {activeAttempts.slice(-3).reverse().map((attempt, index) => {
                                    const question = questions.find((item) => item.id === attempt.questionId);
                                    return <div className="workspace-surface flex items-center justify-between rounded-xl p-3" key={`${attempt.questionId}-${index}`}><div><p className="text-sm font-semibold">{question?.knowledge ?? "練習題"}</p><p className="text-xs text-muted-foreground">{formatAttemptDate(attempt.date)} · {formatDuration(attempt.durationSeconds)}</p></div><Badge tone={attempt.correct === true ? "success" : attempt.correct === false ? "danger" : "warning"}>{attempt.correct === true ? "答對" : attempt.correct === false ? "錯題" : "待檢視"}</Badge></div>;
                                })}
                            </CardContent>
                        </Card>
                    </div>
                </div>
                {renderLearningHistory()}
            </div>
        );
    }

    /** 顯示考試設定與練習方式。 */
    function renderPractice() {
        const modes = [
            { value: "complete" as const, title: "全部作答後檢核", description: "完成整份後一次查看答案與解析。" },
            { value: "instant" as const, title: "逐題檢核", description: "每題送出後立即知道結果與解析。" },
            { value: "score" as const, title: "只顯示成績", description: "完成後只顯示分數與答錯題數，不提供解答。" },
        ];
        const selectedLimit = activePlan.questionLimit;
        return (
            <Card className="workspace-card practice-card border-border/80 shadow-sm">
                <CardHeader className="practice-card-header">
                    <WorkspaceHeading icon={BookOpen} title="安排複習計畫" description="選擇本次練習內容與方式；考試日期和範圍由學習者設定管理。" />
                    <div className="practice-header-actions">
                        <div className="practice-streak" aria-label={`目前連續練習 ${practiceStreak} 天`}>
                            <span className="practice-streak-icon"><Flame aria-hidden="true" /></span>
                            <span><small>連續練習</small><strong>{practiceStreak} 天</strong></span>
                        </div>
                        <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                            <DialogContent className="practice-schedule-dialog" closeLabel="關閉安排練習">
                                <DialogHeader><DialogTitle>安排練習</DialogTitle><DialogDescription>設定日期與時間，也可查看本週行事曆與近期安排。</DialogDescription></DialogHeader>
                                <DialogBody><div className="practice-schedule-dialog-grid">{renderPracticeSchedules("dialog", { compactList: true, showListLink: true })}</div></DialogBody>
                            </DialogContent>
                        </Dialog>
                        <Button appearance="outline" aria-expanded={schedulePanelOpen || scheduleDialogOpen} onClick={openScheduleComposer}><CalendarDays />安排練習</Button>
                        <Button
                            className="practice-header-action"
                            disabled={practiceBusy || (!sessionPaused && (!plannedQuestions.length || !difficultyMixValid))}
                            onClick={sessionPaused ? resumeSession : startPlannedPractice}
                        >
                            {sessionPaused ? "繼續目前練習" : "開始練習"}<ArrowRight />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-8 p-5 sm:p-7">
                    {practiceServiceError && <p className="rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="alert">{practiceServiceError}</p>}
                    {persistedLearnerId && <p className="text-sm text-muted-foreground">作答與錯題紀錄保存在資料庫；篩選、練習計劃與個人顯示設定保存在目前瀏覽器。</p>}
                    {learnerFilterSetupNotice && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="status"><span>{learnerFilterSetupNotice}</span>{canAccessLearnerSettings && <Button appearance="outline" size="sm" onClick={() => navigateToSection("settings")}>前往學習者設定</Button>}</div>}
                    <div className="practice-plan-editor contents">
                    <QuestionFilterPanel
                        idPrefix="practice"
                        subjects={availableSubjects}
                        questions={learnerQuestions}
                        grade={activeLearner.grade}
                        preferredSemester={activeLearner.semester}
                        preferredVersions={activeLearner.bookVersions}
                        collections={activeQuestionCollections}
                        value={practiceFilters}
                        expanded={advancedPlanOpen}
                        disabledFields={{
                            difficulty: activePlan.difficultyMixEnabled,
                        }}
                        onChange={updatePracticeFilters}
                        onExpandedChange={setAdvancedPlanOpen}
                        onReset={resetAdvancedPlan}
                        resetLabel="還原學習者預設"
                    >
                        <section className="practice-difficulty-mix">
                            <label className="practice-difficulty-toggle">
                                <Checkbox checked={activePlan.prioritizeRelated} onChange={(event) => updatePlan("prioritizeRelated", event.target.checked)} />
                                <span><strong>優先練習相同／相近題</strong><small>先安排尚未完成的同學習目標、同題型與相似內容，再練習其他符合條件的題目。</small></span>
                            </label>
                            <label className="practice-difficulty-toggle">
                                <Checkbox checked={activePlan.difficultyMixEnabled} onChange={(event) => toggleDifficultyMix(event.target.checked)} />
                                <span><strong>按比例分配難易度</strong><small>啟用後，上方的一般難易度篩選不會生效。</small></span>
                            </label>
                            {activePlan.difficultyMixEnabled && <>
                                <div className="practice-difficulty-fields">
                                    <FormField label="基礎（%）"><Input type="number" min={0} max={100} value={activeDifficultyMix.easy} onChange={(event) => updateDifficulty("easy", event.target.value)} /></FormField>
                                    <FormField label="中等（%）"><Input type="number" min={0} max={100} value={activeDifficultyMix.medium} onChange={(event) => updateDifficulty("medium", event.target.value)} /></FormField>
                                    <FormField label="進階（%）"><Input type="number" min={0} max={100} value={activeDifficultyMix.hard} onChange={(event) => updateDifficulty("hard", event.target.value)} /></FormField>
                                </div>
                                <p className={`text-sm font-semibold ${difficultyMixValid ? "text-emerald-700" : "text-danger"}`} role="status">目前合計：{difficultyTotal}%{difficultyMixValid ? "" : "，請調整為 100%"}</p>
                            </>}
                            <FormField label={<PracticeFieldLabel className="field-dot-gold" icon={ClipboardCheck} label="本輪題數（可臨時調整）" />}>
                                <QuestionLimitControl
                                    disabled={!eligibleQuestions.length}
                                    options={activeLearner.questionLimitOptions}
                                    value={selectedLimit}
                                    onChange={(value) => updatePlan("questionLimit", value)}
                                />
                            </FormField>
                        </section>
                    </QuestionFilterPanel>
                    <section>
                        <fieldset className="grid gap-3">
                            <legend className="sr-only">答案檢核時機</legend>
                            <p className="text-sm text-muted-foreground">選擇答案何時顯示，練習中仍可保留手寫過程。</p>
                            <div className="grid gap-3 md:grid-cols-3">
                                {modes.map((mode) => (
                                    <button
                                        aria-pressed={activePlan.checkMode === mode.value}
                                        className="plan-choice items-start p-4"
                                        data-selected={activePlan.checkMode === mode.value}
                                        key={mode.value}
                                        onClick={() => updatePlan("checkMode", mode.value)}
                                        type="button"
                                    >
                                        <span><span className="block font-bold">{mode.title}</span><span className="plan-choice-description mt-1 block text-sm font-normal">{mode.description}</span></span>
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                    </section>
                    </div>
                    <section className="practice-footer">
                        <div className="practice-progress-summary" aria-label="目前選擇範圍的練習進度">
                            <div className="practice-progress-stat practice-progress-stat-primary">
                                <ClipboardCheck aria-hidden="true" />
                                <div><p>本輪題數</p><strong>{plannedQuestions.length} 題</strong></div>
                            </div>
                            <div className="practice-progress-stat practice-progress-stat-coverage">
                                <div className="practice-progress-copy"><div><p>練習進度</p><strong>{selectedLatestAttempts.length}／{eligibleQuestions.length} 題</strong></div><span>{practiceCoverage}%</span></div>
                                <Progress aria-label={`已練習 ${selectedLatestAttempts.length} 題，共 ${eligibleQuestions.length} 題，完成 ${practiceCoverage}%`} value={practiceCoverage} />
                            </div>
                            <div className="practice-progress-stat">
                                <div><p>已檢核正確率</p><strong>{selectedAccuracy === null ? "—" : `${selectedAccuracy}%`}</strong></div>
                                <span>{selectedReviewedAttempts.length ? `答對 ${selectedCorrectCount}／${selectedReviewedAttempts.length} 題` : "尚無紀錄"}</span>
                            </div>
                        </div>
                        {(!plannedQuestions.length || !difficultyMixValid) && <div className="practice-selection-context">{!plannedQuestions.length && <p className="practice-footer-error" role="status">目前設定尚無已匯入的可用題目，請調整科目、年級、版本或範圍。</p>}{!difficultyMixValid && <p className="practice-footer-error" role="status">難易度占比合計需為 100% 才能開始。</p>}</div>}
                    </section>
                </CardContent>
            </Card>
        );
    }

    /**
     * 顯示練習安排、單週行事曆與練習計劃。
     * @param idPrefix 區塊標題識別碼前綴。
     * @param options 控制建立表單、完整清單入口與關閉按鈕。
     * @returns 練習安排相關區塊。
     */
    function renderPracticeSchedules(idPrefix = "summary", options: { compactList?: boolean; showCreate?: boolean; showListLink?: boolean; showClose?: boolean } = {}) {
        const { compactList = false, showCreate = true, showListLink = false, showClose = false } = options;
        const week = getScheduleWeek(scheduleWeekOffset);
        const weekStart = week[0].value.slice(5).replace("-", "/");
        const weekEnd = week[6].value.slice(5).replace("-", "/");
        const today = getTaipeiDate();
        const todaySchedules = activeSchedules.filter((schedule) => schedule.date === today);
        const upcomingSchedules = activeSchedules.filter((schedule) => schedule.date > today);
        const previousSchedules = activeSchedules.filter((schedule) => schedule.date < today).reverse();
        const compactSchedules = todaySchedules.length ? todaySchedules : [...upcomingSchedules, ...previousSchedules].slice(0, 2);
        const pendingSchedules = activeSchedules.filter((schedule) => !schedule.result);
        const completedSchedules = activeSchedules.filter((schedule) => Boolean(schedule.result));
        const visibleSchedules = compactList
            ? compactSchedules
            : scheduleStatus === "completed" ? completedSchedules : pendingSchedules;
        const createTitleId = `${idPrefix}-schedule-create-title`;
        const calendarTitleId = `${idPrefix}-schedule-calendar-title`;
        const listTitleId = `${idPrefix}-schedule-list-title`;

        return <>
            {showCreate && <section className="summary-card practice-schedule-create" aria-labelledby={createTitleId}>
                <div className="summary-card-heading">
                    <div className="flex items-center gap-2"><Plus size={18} /><h2 id={createTitleId}>安排練習</h2></div>
                    <div className="practice-schedule-heading-actions">
                        <Badge tone="primary">{roleAccess.activeRole}</Badge>
                        {showClose && <Button appearance="ghost" tone="muted" size="sm" aria-label="關閉安排練習" onClick={() => setSchedulePanelOpen(false)}><X /></Button>}
                    </div>
                </div>
                <div className="practice-schedule-form">
                    <p>把左側目前設定加入清單。日期必填，時間可留白。</p>
                    <FormField label="練習日期"><Input min={getTaipeiDate()} type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></FormField>
                    <FormField label="時間（選填）"><Input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></FormField>
                    <Button className="w-full" disabled={!scheduleDate || !plannedQuestions.length || !difficultyMixValid} onClick={addScheduledPractice}><CalendarDays />加入練習計劃</Button>
                </div>
            </section>}
            <section className="summary-card" aria-labelledby={calendarTitleId}>
                <div className="summary-card-heading practice-calendar-heading">
                    <div className="flex items-center gap-2"><CalendarDays size={18} /><h2 id={calendarTitleId}>本週行事曆</h2></div>
                    <span>{weekStart}–{weekEnd}</span>
                </div>
                <div className="practice-calendar-controls">
                    <Button appearance="ghost" tone="muted" size="sm" aria-label="上一週" onClick={() => setScheduleWeekOffset((current) => current - 1)}><ArrowLeft /></Button>
                    <Button appearance="ghost" tone="muted" size="sm" onClick={() => setScheduleWeekOffset(0)}>本週</Button>
                    <Button appearance="ghost" tone="muted" size="sm" aria-label="下一週" onClick={() => setScheduleWeekOffset((current) => current + 1)}><ArrowRight /></Button>
                </div>
                <div className="practice-calendar-scroll" tabIndex={0} aria-label="單週練習行事曆，可左右捲動">
                    <div className="practice-calendar-grid">
                        {week.map((day) => {
                            const schedules = activeSchedules.filter((schedule) => schedule.date === day.value);
                            return <div className="practice-calendar-day" data-today={day.isToday} key={day.value}>
                                <div><span>週{day.weekday}</span><strong>{day.day}</strong></div>
                                <div className="practice-calendar-subjects">{schedules.length
                                    ? schedules.map((schedule) => {
                                        const subject = schedule.subjectLabel.split(" · ")[0];
                                        return <span data-subject={subject} key={schedule.id} title={`${schedule.subjectLabel}｜${schedule.scopeLabel}`}>{subject}</span>;
                                    })
                                    : <small>—</small>}
                                </div>
                            </div>;
                        })}
                    </div>
                </div>
            </section>
            <section className="summary-card" aria-labelledby={listTitleId}>
                <div className="summary-card-heading">
                    <div className="flex items-center gap-2"><ClipboardCheck size={18} /><h2 id={listTitleId}>練習計劃</h2></div>
                    <div className="practice-schedule-heading-actions">
                        <Badge tone="primary">{compactList && todaySchedules.length ? `今天 ${visibleSchedules.length} 筆` : compactList && visibleSchedules.length ? `近期 ${visibleSchedules.length} 筆` : `${visibleSchedules.length} 筆`}</Badge>
                        {showListLink && <Button appearance="ghost" size="sm" onClick={openScheduleList}>查看全部<ArrowRight /></Button>}
                    </div>
                </div>
                {!compactList && <div className="practice-schedule-tabs" role="tablist" aria-label="練習狀態">
                    <button type="button" role="tab" aria-selected={scheduleStatus === "pending"} data-active={scheduleStatus === "pending"} onClick={() => setScheduleStatus("pending")}>尚未練習 <span>{pendingSchedules.length}</span></button>
                    <button type="button" role="tab" aria-selected={scheduleStatus === "completed"} data-active={scheduleStatus === "completed"} onClick={() => setScheduleStatus("completed")}>已練習過 <span>{completedSchedules.length}</span></button>
                </div>}
                <div className="practice-schedule-list">
                    {compactList && !todaySchedules.length && activeSchedules.length > 0 && <p className="practice-schedule-list-note">今天沒有安排，顯示近期 {visibleSchedules.length} 筆。</p>}
                    {!visibleSchedules.length && <div className="practice-schedule-empty"><CalendarDays /><p>{compactList ? "尚未安排練習" : scheduleStatus === "completed" ? "尚無已完成練習" : "目前沒有待完成練習"}</p><span>{compactList ? "先在左側選好內容，再加入日期。" : scheduleStatus === "completed" ? "完成清單中的練習後，結果會顯示在這裡。" : "新增安排後會顯示在這裡。"}</span></div>}
                    {visibleSchedules.map((schedule) => {
                        const locked = isScheduledPracticeLocked(schedule);
                        const expanded = expandedScheduleId === schedule.id;
                        if (compactList) {
                            return <article className="practice-schedule-item practice-schedule-item-compact" key={schedule.id}>
                                <div className="practice-schedule-compact-row">
                                    <button
                                        className="practice-schedule-compact-toggle"
                                        type="button"
                                        aria-expanded={expanded}
                                        aria-controls={`${idPrefix}-${schedule.id}-detail`}
                                        onClick={() => setExpandedScheduleId(expanded ? "" : schedule.id)}
                                    >
                                        <span className="practice-schedule-date" data-has-time={Boolean(schedule.time)}><strong>{schedule.date === today ? "今天" : schedule.date.slice(5).replace("-", "/")}</strong>{schedule.time && <small>{schedule.time}</small>}</span>
                                        <span className="practice-schedule-copy"><strong>{schedule.subjectLabel}</strong><small>{schedule.scopeLabel}</small></span>
                                        <ChevronDown className={expanded ? "rotate-180" : ""} aria-hidden="true" />
                                    </button>
                                    <Button appearance="outline" size="sm" aria-label={`開始 ${schedule.subjectLabel} 練習`} onClick={() => startScheduledPractice(schedule)}>開始<ArrowRight /></Button>
                                </div>
                                {expanded && <div id={`${idPrefix}-${schedule.id}-detail`} className="practice-schedule-compact-detail">
                                    <p>{schedule.result
                                        ? `已練習過 · 總題數 ${schedule.result.totalQuestions} · 錯題 ${schedule.result.wrongQuestions} · 答對率 ${schedule.result.accuracy}%`
                                        : `尚未練習 · ${schedule.questionIds.length} 題 · ${getCheckModeLabel(schedule.checkMode)}`}</p>
                                    <div className="practice-schedule-meta">
                                        <Badge className="practice-schedule-role" tone="primary">{schedule.creatorRole}安排</Badge>
                                        {locked
                                            ? <span className="practice-schedule-locked">內容由{schedule.creatorRole}鎖定</span>
                                            : <div className="practice-schedule-actions">
                                                {!schedule.result && <Button appearance="outline" size="sm" onClick={() => openScheduleEditor(schedule)}><Pencil />編輯</Button>}
                                                <Button appearance="ghost" tone="muted" size="sm" aria-label={`套用目前設定到 ${schedule.subjectLabel}`} disabled={!plannedQuestions.length || !difficultyMixValid} onClick={() => replaceScheduledPractice(schedule)}>套用</Button>
                                                <Button appearance="ghost" tone="danger" size="sm" aria-label={`刪除 ${schedule.subjectLabel} 排程`} onClick={() => removeScheduledPractice(schedule)}><Trash2 /></Button>
                                            </div>}
                                    </div>
                                </div>}
                            </article>;
                        }
                        return <article className="practice-schedule-item" data-expanded={expanded} key={schedule.id}>
                            <button
                                className="practice-schedule-main"
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={`${idPrefix}-${schedule.id}-detail`}
                                onClick={() => setExpandedScheduleId(expanded ? "" : schedule.id)}
                            >
                                <span className="practice-schedule-date" data-has-time={Boolean(schedule.time)}><strong>{schedule.date.slice(5).replace("-", "/")}</strong>{schedule.time && <small>{schedule.time}</small>}</span>
                                <span className="practice-schedule-copy"><strong>{schedule.subjectLabel}</strong><small>{schedule.scopeLabel}</small></span>
                                <ChevronDown className={expanded ? "rotate-180" : ""} aria-hidden="true" />
                            </button>
                            {expanded && <div id={`${idPrefix}-${schedule.id}-detail`} className="practice-schedule-detail">
                                <div className="practice-schedule-detail-summary">
                                    <div className="practice-schedule-badges">
                                        <Badge className="practice-schedule-status" tone={schedule.result ? "success" : "muted"}>{schedule.result ? "已練習過" : "尚未練習"}</Badge>
                                        <Badge className="practice-schedule-role" tone="primary">{schedule.creatorRole}安排</Badge>
                                    </div>
                                    <p>{schedule.result
                                        ? `總題數 ${schedule.result.totalQuestions} · 錯題 ${schedule.result.wrongQuestions} · 答對率 ${schedule.result.accuracy}% · ${getCheckModeLabel(schedule.checkMode)}`
                                        : `${schedule.questionIds.length} 題 · ${getCheckModeLabel(schedule.checkMode)}`}</p>
                                </div>
                                <div className="practice-schedule-detail-actions">
                                    <Button appearance="outline" size="sm" onClick={() => startScheduledPractice(schedule)}>開始練習<ArrowRight /></Button>
                                    {locked
                                        ? <span className="practice-schedule-locked">內容由{schedule.creatorRole}鎖定</span>
                                        : <div className="practice-schedule-actions">
                                        {!schedule.result && <Button appearance="outline" size="sm" onClick={() => openScheduleEditor(schedule)}><Pencil />編輯</Button>}
                                        <Button appearance="ghost" tone="muted" size="sm" aria-label={`套用目前設定到 ${schedule.subjectLabel}`} disabled={!plannedQuestions.length || !difficultyMixValid} onClick={() => replaceScheduledPractice(schedule)}>套用</Button>
                                        <Button appearance="ghost" tone="danger" size="sm" aria-label={`刪除 ${schedule.subjectLabel} 排程`} onClick={() => removeScheduledPractice(schedule)}><Trash2 /></Button>
                                        </div>}
                                </div>
                            </div>}
                        </article>;
                    })}
                </div>
            </section>
        </>;
    }

    /**
     * 顯示可直接進入的完整練習計劃頁。
     * @returns 練習行事曆與全部安排清單。
     */
    function renderPracticeScheduleListPage() {
        return (
            <Card className="workspace-card practice-schedule-page border-border/80 shadow-sm">
                <CardHeader className="practice-card-header">
                    <WorkspaceHeading icon={ClipboardCheck} title="練習計劃" description="依日期排列全部練習，可直接選擇一筆開始。" />
                    <div className="practice-header-actions">
                        <Button appearance="outline" onClick={() => router.push(SECTION_PATHS.practice)}><ArrowLeft />返回</Button>
                        <Button onClick={() => navigateToSection("practice")}><CalendarDays />安排練習</Button>
                    </div>
                </CardHeader>
                <CardContent className="practice-schedule-page-grid p-5 sm:p-7">
                    {renderPracticeSchedules("schedule-page", { showCreate: false })}
                </CardContent>
                <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                    <DialogContent className="practice-schedule-dialog" closeLabel="關閉安排練習">
                        <DialogHeader><DialogTitle>安排練習</DialogTitle><DialogDescription>設定日期與時間，加入後會立即出現在清單。</DialogDescription></DialogHeader>
                        <DialogBody><div className="practice-schedule-dialog-grid">{renderPracticeSchedules("schedule-page-dialog", { compactList: true, showListLink: false })}</div></DialogBody>
                    </DialogContent>
                </Dialog>
            </Card>
        );
    }

    /** 顯示可篩選、批次整理與建立練習計劃的題目總覽。 */
    function renderQuestionOverview() {
        const targetOptions = activeQuestionCollections.length
            ? activeQuestionCollections.map((collection) => ({ value: collection.id, label: collection.name }))
            : [{ value: "", label: "請先建立收藏清單", disabled: true }];
        const currentPageIds = pagedOverviewQuestions.map((question) => question.id);
        const filteredQuestionIds = filteredOverviewQuestions.map((question) => question.id);
        const allCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedQuestionIds.includes(id));
        const selectedFilteredCount = filteredQuestionIds.filter((id) => selectedQuestionIds.includes(id)).length;
        const allFilteredSelected = filteredQuestionIds.length > 0 && selectedFilteredCount === filteredQuestionIds.length;
        const actionScopeOptions = [
            { value: "selected", label: `已勾選（${selectedQuestionIds.length} 題）` },
            { value: "filtered", label: `全部篩選結果（${filteredOverviewQuestions.length} 題）` },
        ];

        /** 切換指定範圍內的全部題目。 */
        function toggleQuestions(ids: number[], checked: boolean) {
            setSelectedQuestionIds((current) => checked
                ? [...new Set([...current, ...ids])]
                : current.filter((id) => !ids.includes(id)));
        }

        return (
            <Card className="workspace-card question-overview-card border-border/80 shadow-sm">
                <CardHeader><WorkspaceHeading icon={ListChecks} title="題目總覽" description="篩選全部題目、整理收藏清單，或將目前結果建立為練習計劃。" /></CardHeader>
                <CardContent className="question-overview-content">
                    {learnerFilterSetupNotice && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="status"><span>{learnerFilterSetupNotice}</span>{canAccessLearnerSettings && <Button appearance="outline" size="sm" onClick={() => navigateToSection("settings")}>前往學習者設定</Button>}</div>}
                    <QuestionFilterPanel
                        idPrefix="question-overview"
                        subjects={availableSubjects}
                        questions={learnerQuestions}
                        grade={activeLearner.grade}
                        preferredSemester={activeLearner.semester}
                        preferredVersions={activeLearner.bookVersions}
                        collections={activeQuestionCollections}
                        value={questionFilters}
                        expanded={questionFiltersOpen}
                        onChange={(filters) => { setQuestionFilters(filters); setQuestionPage(1); setSelectedQuestionIds([]); }}
                        onExpandedChange={setQuestionFiltersOpen}
                        onReset={resetQuestionFilters}
                        resetLabel="還原學習者預設"
                    />

                    <section className="question-list-section" aria-labelledby="question-list-title">
                        <div className="question-list-heading">
                            <div className="question-list-title"><h3 id="question-list-title">題目清單</h3><span>共 {filteredOverviewQuestions.length} 題</span></div>
                            <div className="question-list-heading-actions">
                                <label className="question-select-page"><Checkbox checked={allFilteredSelected} indeterminate={selectedFilteredCount > 0 && !allFilteredSelected} onChange={(event) => toggleQuestions(filteredQuestionIds, event.target.checked)} />選取全部頁面</label>
                                <Badge tone="muted">第 {activeQuestionPage}／{questionPageCount} 頁</Badge>
                                <Button appearance="outline" onClick={() => { setCollectionDialogOpen(true); setQuestionActionStatus(""); }}><Plus />新增收藏清單</Button>
                                <Button appearance="outline" onClick={() => { setQuestionActionStatus(""); setQuestionBatchOpen(true); }}><FolderInput />批次動作</Button>
                            </div>
                        </div>
                        <div className="question-overview-table-wrap">
                            <table className="question-overview-table">
                                <thead><tr><th scope="col"><label className="question-checkbox" aria-label="選取目前頁面全部題目"><Checkbox checked={allCurrentPageSelected} onChange={(event) => toggleQuestions(currentPageIds, event.target.checked)} /><span className="sr-only">選取目前頁面全部題目</span></label></th><th scope="col">編號</th><th scope="col">題目</th><th scope="col">科目／單元</th><th scope="col">題型</th><th scope="col">收藏</th></tr></thead>
                                <tbody>{pagedOverviewQuestions.map((question) => {
                                    const selected = selectedQuestionIds.includes(question.id);
                                    const collections = activeQuestionCollections.filter((collection) => collection.questionIds.includes(question.id));
                                    return <tr data-active={selectedQuestionId === question.id} key={question.id}>
                                        <td><label className="question-checkbox" aria-label={`選取${question.prompt}`}><Checkbox checked={selected} onChange={(event) => toggleOverviewQuestion(question.id, event.target.checked)} /><span className="sr-only">選取此題</span></label></td>
                                        <td data-label="編號">{question.code ?? question.sourceDetail?.questionNumber ?? question.id}</td>
                                        <td className="question-overview-title-cell" data-label="題目"><button className="question-overview-title" type="button" onClick={() => openQuestionDetail(question.id)}>{question.prompt}</button><small>{getQuestionSourceCategory(question)}</small></td>
                                        <td data-label="科目／單元"><strong>{question.subject}</strong><small>{getUnitLabel(question.unit)}</small></td>
                                        <td data-label="題型">{getQuestionKindLabel(question.kind)}</td>
                                        <td data-label="收藏">{collections.length ? <span className="question-collection-tags">{collections.slice(0, 2).map((collection) => <Badge tone="primary" key={collection.id}>{collection.name}</Badge>)}</span> : <span className="text-muted-foreground">—</span>}</td>
                                    </tr>;
                                })}</tbody>
                            </table>
                            {!pagedOverviewQuestions.length && <div className="question-empty"><Search /><p>目前條件沒有符合的題目。</p><Button appearance="outline" size="sm" onClick={resetQuestionFilters}>清除篩選</Button></div>}
                        </div>
                        <div className="question-pagination"><span>顯示 {(activeQuestionPage - 1) * QUESTION_OVERVIEW_PAGE_SIZE + (pagedOverviewQuestions.length ? 1 : 0)}–{(activeQuestionPage - 1) * QUESTION_OVERVIEW_PAGE_SIZE + pagedOverviewQuestions.length}，共 {filteredOverviewQuestions.length} 題</span><div><Button appearance="outline" size="sm" disabled={activeQuestionPage <= 1} onClick={() => setQuestionPage((page) => Math.max(1, page - 1))}><ArrowLeft />上一頁</Button><Button appearance="outline" size="sm" disabled={activeQuestionPage >= questionPageCount} onClick={() => setQuestionPage((page) => Math.min(questionPageCount, page + 1))}>下一頁<ArrowRight /></Button></div></div>
                    </section>
                </CardContent>

                <Dialog open={questionBatchOpen} onOpenChange={setQuestionBatchOpen}>
                    <DialogContent className="question-batch-dialog" closeLabel="關閉批次動作">
                        <DialogHeader><DialogTitle>批次動作</DialogTitle><DialogDescription>目前共 {filteredOverviewQuestions.length} 題，已勾選 {selectedQuestionIds.length} 題。</DialogDescription></DialogHeader>
                        <DialogBody>
                            <div className="question-batch-dialog-grid">
                                <FormField label="處理範圍"><NativeSelect options={actionScopeOptions} value={questionBatchScope} onChange={(event) => setQuestionBatchScope(event.target.value as "selected" | "filtered")} /></FormField>
                                <Button appearance="outline" disabled={!questionActionIds.length} onClick={() => { setQuestionBatchOpen(false); openQuestionPlan(questionActionIds, "題目總覽"); }}><CalendarDays />建立練習計劃</Button>
                                <FormField label="收藏異動"><NativeSelect options={[{ value: "add", label: "加入收藏" }, { value: "move", label: "移動收藏" }]} value={questionCollectionAction} onChange={(event) => setQuestionCollectionAction(event.target.value as "add" | "move")} /></FormField>
                                <FormField label="目標收藏清單"><NativeSelect disabled={!activeQuestionCollections.length} options={targetOptions} value={activeTargetCollectionId} onChange={(event) => setTargetCollectionId(event.target.value)} /></FormField>
                                <Button disabled={!questionActionIds.length || !activeTargetCollectionId} onClick={() => updateQuestionCollection(questionActionIds)}><FolderInput />套用收藏異動</Button>
                            </div>
                            {questionActionStatus && <p className="question-action-status" role="status">{questionActionStatus}</p>}
                        </DialogBody>
                        <DialogFooter><DialogClose asChild><Button appearance="ghost" tone="muted">關閉</Button></DialogClose></DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={collectionDialogOpen} onOpenChange={setCollectionDialogOpen}>
                    <DialogContent closeLabel="關閉新增收藏清單">
                        <DialogHeader><DialogTitle>新增收藏清單</DialogTitle><DialogDescription>收藏清單可用於篩選、加入或移動題目。</DialogDescription></DialogHeader>
                        <DialogBody><FormField label="清單名稱"><Input value={newCollectionName} maxLength={80} placeholder="例如：考前必練" onChange={(event) => setNewCollectionName(event.target.value)} /></FormField></DialogBody>
                        <DialogFooter><DialogClose asChild><Button appearance="outline">取消</Button></DialogClose><Button disabled={!newCollectionName.trim()} onClick={createQuestionCollection}>建立清單</Button></DialogFooter>
                    </DialogContent>
                </Dialog>

            </Card>
        );
    }

    /** 顯示題目總覽的獨立題目詳情頁。 */
    function renderQuestionOverviewDetail() {
        const targetOptions = activeQuestionCollections.length
            ? activeQuestionCollections.map((collection) => ({ value: collection.id, label: collection.name }))
            : [{ value: "", label: "請先建立收藏清單", disabled: true }];
        if (!selectedOverviewQuestion) return <main className="practice-focus-shell"><div className="practice-focus-frame"><section className="summary-card question-detail-empty"><ListChecks /><h2>正在讀取題目</h2></section></div></main>;
        const collections = activeQuestionCollections.filter((collection) => collection.questionIds.includes(selectedOverviewQuestion.id));
        const headerActions = <Dialog>
            <DialogTrigger asChild><Button appearance="outline"><Bookmark />收藏</Button></DialogTrigger>
            <DialogContent closeLabel="關閉收藏分類">
                <DialogHeader><DialogTitle>收藏題目</DialogTitle><DialogDescription>選擇要收藏此題的分類。</DialogDescription></DialogHeader>
                <DialogBody>
                    <FormField label="收藏分類"><NativeSelect disabled={!activeQuestionCollections.length} options={targetOptions} value={activeTargetCollectionId} onChange={(event) => setTargetCollectionId(event.target.value)} /></FormField>
                    {collections.length > 0 && <div className="question-collection-tags" aria-label="目前收藏分類">{collections.map((collection) => <Badge tone="primary" key={collection.id}>{collection.name}</Badge>)}</div>}
                </DialogBody>
                <DialogFooter>
                    <DialogClose asChild><Button appearance="outline">取消</Button></DialogClose>
                    <DialogClose asChild><Button disabled={!activeTargetCollectionId} onClick={() => updateQuestionCollection([selectedOverviewQuestion.id], "add")}><Bookmark />收藏</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>;
        return <QuestionReview
            headerActions={headerActions}
            index={selectedOverviewIndex}
            question={selectedOverviewQuestion}
            serverQuestion={persistedQuestions.get(selectedOverviewQuestion.id)}
            title="題目總覽"
            total={detailOverviewQuestions.length}
            onBack={closeQuestionDetail}
            onNext={() => navigateOverviewQuestion(selectedOverviewIndex + 1)}
            onPrevious={() => navigateOverviewQuestion(selectedOverviewIndex - 1)}
            onStartPractice={() => void beginSession("practice", [selectedOverviewQuestion.id])}
        />;
    }

    /** 顯示匯入紀錄中的滿版只讀題目內容。 */
    function renderImportQuestionReview() {
        if (!importReviewQuestion) return null;
        return <QuestionReview
            index={importReviewIndex}
            question={importReviewQuestion}
            serverQuestion={persistedQuestions.get(importReviewQuestion.id)}
            title="匯入題目"
            total={importReviewQuestions.length}
            onBack={() => setImportReviewQuestionId(undefined)}
            onNext={() => setImportReviewQuestionId(importReviewQuestions[importReviewIndex + 1]?.id)}
            onPrevious={() => setImportReviewQuestionId(importReviewQuestions[importReviewIndex - 1]?.id)}
        />;
    }

    /** 顯示題庫與匯入校正。 */
    function renderBank() {
        const importSubjects = getSubjectsForGrade(importGrade, questions, activeLearner.customSubjects);
        const importBookOptions = [
            { value: "", label: "系統預設" },
            ...availableImportBooks.map((book) => ({ value: book.id, label: book.name })),
        ];
        const importSubjectOptions = [
            { value: "", label: "交由 AI 分析" },
            ...importSubjects.map((subject) => ({ value: subject, label: `${subject} · ${activeLearner.bookVersions[subject]}版` })),
        ];

        /** 開啟或收合一筆匯入紀錄，並清除前一批次的題目篩選。 */
        function toggleImportBatch(id: string) {
            setSelectedImportId((current) => current === id ? "" : id);
            setImportReviewQuestionId(undefined);
            setBankCode("");
            setBankMetadataFilters({});
        }

        return (
            <Card className="workspace-card border-border/80 shadow-sm">
                <CardHeader><WorkspaceHeading icon={FileUp} title="題目匯入" description="選擇題本並加入檔案或文字；逐題確認後才會寫入題庫。" /></CardHeader>
                <CardContent>
                    <Tabs className="bank-view-tabs" appearance="line" value={bankView} onValueChange={(value) => setBankView(value as "create" | "history")}>
                        <TabsList className="bank-view-tab-list" aria-label="切換題目匯入功能">
                            <TabsTrigger value="create"><Plus />新增題目</TabsTrigger>
                            <TabsTrigger value="history"><Clock3 />最近匯入紀錄 <Badge tone="muted">{imports.length}</Badge></TabsTrigger>
                        </TabsList>
                        <TabsContent className="bank-view-content" value="create">
                    <p className="text-sm text-muted-foreground">上傳文件或貼上文字，逐題確認全部欄位後再寫入。</p>
                    <div className="import-start-panel">
                        <div className="import-book-picker">
                            <FormField label="匯入題本" description="沒有選擇題本時會加入系統預設。"><NativeSelect options={importBookOptions} value={selectedImportBookId} onChange={(event) => setSelectedImportBookId(event.target.value)} /></FormField>
                            <Button appearance="outline" onClick={() => { setCreatingImportBook((current) => !current); setFileError(""); }}><Plus />建立題本</Button>
                        </div>
                        {creatingImportBook && <div className="import-book-create">
                            <FormField label="題本名稱"><Input value={newImportBookName} maxLength={80} placeholder="例如：第一次段考複習" onChange={(event) => setNewImportBookName(event.target.value)} /></FormField>
                            <Button onClick={createImportBook}>加入題本</Button>
                        </div>}
                        <Tabs defaultValue="files" appearance="segmented">
                            <TabsList className="import-source-tabs" aria-label="選擇題目匯入方式">
                                <TabsTrigger value="files"><UploadCloud />上傳檔案</TabsTrigger>
                                <TabsTrigger value="text"><ClipboardCheck />貼上文字</TabsTrigger>
                            </TabsList>
                            <TabsContent value="files" className="mt-4">
                                <label
                                    className="import-dropzone"
                                    data-dragging={isImportDragging}
                                    htmlFor="exam-file-input"
                                    onDragEnter={(event) => { event.preventDefault(); setIsImportDragging(true); }}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDragLeave={() => setIsImportDragging(false)}
                                    onDrop={handleImportDrop}
                                >
                                    <span className="import-dropzone-icon"><UploadCloud /></span>
                                    <span><strong>拖曳檔案到這裡</strong><small>或點選檔案；支援 JPG、PNG、PDF，單檔上限 10 MB</small></span>
                                    {fileNames.length > 0 && <span className="import-dropzone-files">已選擇 {fileNames.length} 個檔案：{fileNames.join("、")}</span>}
                                    <Input className="sr-only" id="exam-file-input" type="file" accept=".jpg,.jpeg,.png,.pdf" multiple aria-invalid={Boolean(fileError)} aria-describedby={fileError ? "exam-file-error" : undefined} onChange={handleFiles} />
                                </label>
                            </TabsContent>
                            <TabsContent value="text" className="mt-4">
                                <FormField label="題目文字" description="可一次貼上多題；正式版本會依原文順序拆題。">
                                    <textarea className="keel-textarea" rows={7} value={importText} placeholder="貼上題目、選項與答案；沒有標示科目或章節也可以。" onChange={(event) => setImportText(event.target.value)} />
                                </FormField>
                                <div className="mt-3 flex justify-end"><Button appearance="outline" disabled={!importText.trim()} onClick={analyzeImportText}><Sparkles />解析文字</Button></div>
                            </TabsContent>
                        </Tabs>
                    </div>
                    {fileError && <p id="exam-file-error" className="text-sm font-semibold text-danger" role="alert">{fileError}</p>}
                    {importStatus && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{importStatus}</p>}
                    {fileNames.length > 0 && (
                        <div className="workspace-surface grid gap-4 rounded-2xl p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div><p className="font-bold">題目校正</p><p className="text-xs text-muted-foreground">{fileNames.join("、")}</p></div>
                                <div className="flex items-center gap-2"><Badge tone="warning">模擬辨識</Badge><Badge tone="primary">共 {importDrafts.length} 題</Badge></div>
                            </div>
                            <div className="rounded-xl border border-border bg-white p-4">
                                <FormField label="適用年級" description="自動帶入目前學習者年級，仍可在寫入前修改。"><NativeSelect options={educationCatalog?.stages.flatMap((stage) => stage.grades.map((grade) => ({ value: grade.name, label: `${stage.name} · ${grade.name}` }))) ?? GRADE_OPTIONS} value={importGrade} onChange={(event) => changeImportGrade(event.target.value)} /></FormField>
                            </div>
                            <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                                <Sparkles className="mt-0.5 shrink-0 text-primary" size={17} />
                                <p>目前先帶入模擬 AI 建議。科目、版本、章節、單元、主題、難易度與來源都必須確認後才可寫入；各分類選單底部都能新增項目。</p>
                            </div>
                            <div className="grid gap-4">
                                {importDrafts.map((draft, index) => {
                                    const matchingQuestions = baseQuestions.filter((question) => question.grade === importGrade && (!draft.subject || question.subject === draft.subject));
                                    const currentVersion = draft.subject ? activeLearner.bookVersions[draft.subject] : "";
                                    const versionItems = [currentVersion, ...BOOK_OPTIONS.map((option) => option.value)];
                                    const chapterItems = [draft.chapter, ...matchingQuestions.map((question) => question.chapter ?? "")];
                                    const unitItems = [draft.unit, ...matchingQuestions.map((question) => question.unit)];
                                    const topicItems = [draft.topic, ...matchingQuestions.map((question) => question.topic ?? question.knowledge)];
                                    const sourceItems = [draft.source, ...QUESTION_SOURCE_CATEGORIES];
                                    return (
                                        <section className="rounded-2xl border border-border bg-white p-4 sm:p-5" key={draft.id} aria-labelledby={`${draft.id}-title`}>
                                            <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
                                                <h3 className="font-bold" id={`${draft.id}-title`}>第 {index + 1} 題</h3>
                                                <Badge tone="primary">待確認</Badge>
                                            </div>
                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <FormField className="sm:col-span-2" label="辨識題幹"><Input value={draft.prompt} onChange={(event) => updateImportDraft(draft.id, "prompt", event.target.value)} /></FormField>
                                                <FormField className="sm:col-span-2" label="參考答案"><Input value={draft.answer} onChange={(event) => updateImportDraft(draft.id, "answer", event.target.value)} /></FormField>
                                                <FormField label="編號" description="保留來源文件中的原始題目編號。"><Input value={draft.code} placeholder="例如：05010001" onChange={(event) => updateImportDraft(draft.id, "code", event.target.value)} /></FormField>
                                                <FormField label="科目"><NativeSelect options={importSubjectOptions} value={draft.subject} onChange={(event) => changeImportSubject(draft.id, event.target.value as Subject | "")} /></FormField>
                                                <FormField label="難易度"><NativeSelect options={IMPORT_DIFFICULTY_OPTIONS} value={draft.difficulty} onChange={(event) => updateImportDraft(draft.id, "difficulty", event.target.value as ImportDifficulty)} /></FormField>
                                                <CreatableSelectField label="版本" items={versionItems} value={draft.version} customValue={draft.customVersion} placeholder="例如：翰林、康軒、自編教材" onChange={(value) => updateImportDraft(draft.id, "version", value)} onCustomChange={(value) => updateImportDraft(draft.id, "customVersion", value)} />
                                                <CreatableSelectField label="章節／課次" items={chapterItems} value={draft.chapter} customValue={draft.customChapter} placeholder="例如：第 3 章、第 5 課、Unit 2" onChange={(value) => updateImportDraft(draft.id, "chapter", value)} onCustomChange={(value) => updateImportDraft(draft.id, "customChapter", value)} />
                                                <CreatableSelectField label="單元" items={unitItems} value={draft.unit} customValue={draft.customUnit} placeholder="例如：角度、分數運算、閱讀理解" onChange={(value) => updateImportDraft(draft.id, "unit", value)} onCustomChange={(value) => updateImportDraft(draft.id, "customUnit", value)} />
                                                <CreatableSelectField label="主題" items={topicItems} value={draft.topic} customValue={draft.customTopic} placeholder="例如：分數加法、近義詞、過去式" onChange={(value) => updateImportDraft(draft.id, "topic", value)} onCustomChange={(value) => updateImportDraft(draft.id, "customTopic", value)} />
                                                <CreatableSelectField label="來源" items={sourceItems} value={draft.source} customValue={draft.customSource} placeholder="選擇來源分類" onChange={(value) => updateImportDraft(draft.id, "source", value)} onCustomChange={(value) => updateImportDraft(draft.id, "customSource", value)} />
                                                <div className="import-metadata-editor sm:col-span-2">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div><p className="font-semibold">文件欄位</p><p className="mt-1 text-xs text-muted-foreground">文件中出現的項目會原樣保存，並自動成為後續可複選的篩選條件。</p></div>
                                                        <Button appearance="outline" size="sm" onClick={() => addImportMetadata(draft.id)}><Plus />新增欄位</Button>
                                                    </div>
                                                    <div className="mt-3 grid gap-3">
                                                        {draft.metadata.map((field, fieldIndex) => (
                                                            <div className="import-metadata-row" key={`${field.key}-${fieldIndex}`}>
                                                                <FormField label="欄位名稱"><Input value={field.label} placeholder="例如：認知向度" onChange={(event) => updateImportMetadata(draft.id, fieldIndex, "label", event.target.value)} /></FormField>
                                                                <FormField label="欄位內容"><Input value={field.rawValue} placeholder="例如：基本語文知識" onChange={(event) => updateImportMetadata(draft.id, fieldIndex, "rawValue", event.target.value)} /></FormField>
                                                                <Button className="import-metadata-remove" appearance="ghost" tone="danger" size="sm" aria-label={`移除${field.label || "自訂"}欄位`} onClick={() => removeImportMetadata(draft.id, fieldIndex)}><Trash2 /></Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="sm:col-span-2">
                                                    {draft.imageUrl ? (
                                                        <div className="import-image-panel">
                                                            <figure>
                                                                <img src={draft.imageUrl} alt={`第 ${index + 1} 題附圖：${draft.imageName ?? "未命名圖片"}`} />
                                                                <figcaption><ImageIcon size={15} />{draft.imageName}</figcaption>
                                                            </figure>
                                                            <div className="flex flex-wrap gap-2">
                                                                <Button appearance="outline" size="sm" asChild><label>替換圖片<Input className="sr-only" type="file" accept=".jpg,.jpeg,.png" onChange={(event) => replaceImportImage(draft.id, event)} /></label></Button>
                                                                <Button appearance="ghost" tone="muted" size="sm" disabled={index === importDrafts.length - 1} onClick={() => moveImportImage(draft.id)}>移到下一題</Button>
                                                                <Button appearance="ghost" tone="danger" size="sm" onClick={() => removeImportImage(draft.id)}>移除圖片</Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <FormField label="題目附圖（選填）" description="若 AI 沒有配對圖片，可在這裡補上。"><Input type="file" accept=".jpg,.jpeg,.png" onChange={(event) => replaceImportImage(draft.id, event)} /></FormField>
                                                    )}
                                                </div>
                                                <div className="sm:col-span-2">
                                                    {draft.answerImageUrl ? (
                                                        <div className="import-image-panel">
                                                            <figure>
                                                                <img src={draft.answerImageUrl} alt={`第 ${index + 1} 題答案附圖：${draft.answerImageName ?? "未命名圖片"}`} />
                                                                <figcaption><ImageIcon size={15} />答案附圖 · {draft.answerImageName}</figcaption>
                                                            </figure>
                                                            <div className="flex flex-wrap gap-2">
                                                                <Button appearance="outline" size="sm" asChild><label>替換答案圖片<Input className="sr-only" type="file" accept=".jpg,.jpeg,.png" onChange={(event) => replaceImportImage(draft.id, event, "answer")} /></label></Button>
                                                                <Button appearance="ghost" tone="danger" size="sm" onClick={() => removeImportAnswerImage(draft.id)}>移除答案圖片</Button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <FormField label="答案附圖（選填）" description="答案或解析包含圖形時，可在這裡加入並保留編排。"><Input type="file" accept=".jpg,.jpeg,.png" onChange={(event) => replaceImportImage(draft.id, event, "answer")} /></FormField>
                                                    )}
                                                </div>
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                            <div className="border-t border-border pt-4">
                                <Button className="w-full" disabled title="正式匯入需先完成帳號授權與來源檔案管線">正式匯入尚未開放</Button>
                                <p className="text-sm text-muted-foreground">目前可校正預覽，但不會把題目寫入未隔離的 JSON。既有 PostgreSQL 題庫與作答不受影響。</p>
                                <p className="mt-2 text-center text-xs text-muted-foreground">這項匯入工具將資料寫入本機 JSON，尚未接入正式 PostgreSQL 題庫；OCR 與 AI 分析仍未連接。</p>
                            </div>
                        </div>
                    )}
                        </TabsContent>
                        <TabsContent className="bank-view-content" value="history">
                    <section className="recent-imports" aria-labelledby="recent-imports-title">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <p className="text-sm text-muted-foreground" id="recent-imports-title">只顯示最近 {RECENT_IMPORT_LIMIT} 筆；點選紀錄後才載入該批次的題目清單。</p>
                            <Badge tone="muted">共 {imports.length} 筆</Badge>
                        </div>
                        {!recentImports.length && <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">尚無已確認的匯入紀錄。</div>}
                        {recentImports.length > 0 && (
                            <div className="import-record-table-wrap">
                                <table className="import-record-table">
                                    <thead><tr><th scope="col">匯入檔案</th><th scope="col">題本</th><th scope="col">科目</th><th scope="col">題數</th><th scope="col">匯入時間</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
                                    <tbody>
                                        {recentImports.map((batch) => {
                                            const batchQuestions = batch.questionIds.map((id) => questions.find((question) => question.id === id)).filter((question): question is Question => Boolean(question));
                                            const subjects = [...new Set(batchQuestions.map((question) => question.subject))].join("、") || "—";
                                            const selected = batch.id === selectedImportId;
                                            return <tr data-selected={selected} key={batch.id}>
                                                <td data-label="匯入檔案"><button aria-expanded={selected} className="import-record-title" onClick={() => toggleImportBatch(batch.id)} type="button">{batch.fileNames.join("、")}</button></td>
                                                <td data-label="題本"><Badge tone="muted">{batch.bookName ?? "系統預設"}</Badge></td>
                                                <td data-label="科目">{subjects}</td>
                                                <td data-label="題數">{batchQuestions.length} 題</td>
                                                <td data-label="匯入時間"><time dateTime={batch.createdAt}>{formatAttemptDate(batch.createdAt)}</time></td>
                                                <td className="import-record-action"><Button appearance="outline" size="sm" aria-expanded={selected} onClick={() => toggleImportBatch(batch.id)}>{selected ? "收合" : "查看題目"}<ChevronDown className={selected ? "rotate-180" : ""} /></Button></td>
                                            </tr>;
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                    {selectedImport && (
                        <section className="import-batch-detail" aria-labelledby="import-batch-title">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold" id="import-batch-title">{selectedImport.fileNames.join("、")}</h3><Badge tone="muted">{selectedImport.bookName ?? "系統預設"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">共 {selectedImportQuestions.length} 題；點選題目標題進入滿版檢視。</p></div>
                                <Button appearance="ghost" tone="muted" size="sm" onClick={() => toggleImportBatch(selectedImport.id)}><X />關閉清單</Button>
                            </div>
                            <div className="import-batch-filters" aria-label="匯入題目篩選">
                                <FormField label="題目編號"><Input value={bankCode} placeholder="例如：05010001" onChange={(event) => setBankCode(event.target.value)} /></FormField>
                                {bankMetadataCatalog.map((facet) => {
                                    const selected = bankMetadataFilters[facet.key] ?? [];
                                    return <div className="grid content-start gap-2" key={facet.key}><p className="text-sm font-semibold">{facet.label}</p><Dropdown><DropdownTrigger asChild><Button className="source-filter-trigger" appearance="outline" tone="muted"><span className="truncate">{selected.length ? selected.length === 1 ? selected[0] : `已選 ${selected.length} 項` : `全部${facet.label}`}</span><ChevronDown /></Button></DropdownTrigger><DropdownContent align="start" className="source-filter-menu"><DropdownLabel>{facet.label}</DropdownLabel>{selected.length > 0 && <><DropdownItem onSelect={() => setBankMetadataFilters((current) => ({ ...current, [facet.key]: [] }))}>清除選取</DropdownItem><DropdownSeparator /></>}{facet.values.map((value) => <DropdownCheckboxItem checked={selected.includes(value)} key={value} onCheckedChange={(checked) => toggleBankMetadataFilter(facet.key, value, checked === true)} onSelect={(event) => event.preventDefault()}><DropdownIndicator>✓</DropdownIndicator><span className="truncate">{value}</span></DropdownCheckboxItem>)}</DropdownContent></Dropdown></div>;
                                })}
                            </div>
                            <div className="import-question-table-wrap">
                                <table className="import-question-table">
                                    <thead><tr><th scope="col">編號</th><th scope="col">題目</th><th scope="col">科目／單元</th><th scope="col">題型</th><th scope="col">難度</th></tr></thead>
                                    <tbody>
                                        {bankFilteredQuestions.map((question) => (
                                            <tr key={question.id}>
                                                <td data-label="編號">{question.code ?? question.sourceDetail?.questionNumber ?? question.id}</td>
                                                <td className="import-question-title-cell" data-label="題目"><button className="import-question-title" onClick={() => setImportReviewQuestionId(question.id)} type="button">{question.prompt}</button></td>
                                                <td data-label="科目／單元">{question.subject} · {getUnitLabel(question.unit)}</td>
                                                <td data-label="題型">{getQuestionKindLabel(question.kind)}</td>
                                                <td data-label="難度">{question.difficulty}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {!bankFilteredQuestions.length && <p className="p-8 text-center text-sm text-muted-foreground">目前條件沒有符合的題目。</p>}
                            </div>
                        </section>
                    )}
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        );
    }

    /** 顯示個人與社群錯題排行。 */
    function renderMistakes() {
        /** 套用錯題篩選並清除隱藏題目的勾選狀態。 */
        function changeMistakeFilters(filters: QuestionFilters) {
            setMistakeFilters(filters);
            setMistakePage(1);
            setSelectedMistakes([]);
        }

        /** 清除錯題英雄榜的所有篩選與勾選狀態。 */
        function resetMistakeFilters() {
            setMistakeFilters(normalizeQuestionFilters(questionFilterBaseline, rankingQuestions, activeQuestionCollections));
            setMistakePage(1);
            setSelectedMistakes([]);
        }

        /** 切換排行來源並重設只適用於上一個排行的範圍與勾選。 */
        function changeMistakeRanking(value: string) {
            if (value !== "personal" && value !== "community") return;
            const nextQuestions = value === "personal" ? mistakeQuestions : communityMistakeRows.map((row) => row.question);
            setMistakeRankingView(value);
            setMistakeFilters((current) => normalizeQuestionFilters(current, nextQuestions, activeQuestionCollections));
            setMistakePage(1);
            setSelectedMistakes([]);
        }

        const allVisibleMistakesSelected = visibleMistakeQuestions.length > 0
            && visibleMistakeQuestions.every((question) => selectedMistakes.includes(question.id));

        /** 選取或取消選取目前全部篩選結果。 */
        function toggleAllVisibleMistakes(checked: boolean) {
            const visibleIds = visibleMistakeQuestions.map((question) => question.id);
            setSelectedMistakes((current) => checked
                ? [...new Set([...current, ...visibleIds])]
                : current.filter((id) => !visibleIds.includes(id)));
        }

        return (
            <Card className="workspace-card border-border/80 shadow-sm">
                <CardHeader>
                    <WorkspaceHeading icon={Target} title="錯題英雄榜" description="查看目前學習者的累計錯題，或比較系統內全部學習者的社群錯題排行。" />
                </CardHeader>
                <CardContent className="mistake-content grid gap-5 p-5 sm:p-7">
                    {recommendationNotice && <p className="rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="status">{recommendationNotice}</p>}
                    <Tabs className="mistake-ranking-tabs" appearance="segmented" value={mistakeRankingView} onValueChange={changeMistakeRanking}>
                        <TabsList className="mistake-ranking-tab-list" aria-label="切換錯題排行">
                            <TabsTrigger value="personal"><UserCheck />個人錯題排行</TabsTrigger>
                            <TabsTrigger value="community"><Users />社群錯題排行</TabsTrigger>
                        </TabsList>
                        <QuestionFilterPanel
                            idPrefix="mistake-ranking"
                            subjects={availableSubjects}
                            questions={rankingQuestions}
                            grade={activeLearner.grade}
                            preferredSemester={activeLearner.semester}
                            preferredVersions={activeLearner.bookVersions}
                            collections={activeQuestionCollections}
                            value={mistakeFilters}
                            expanded={mistakeFiltersOpen}
                            onChange={changeMistakeFilters}
                            onExpandedChange={setMistakeFiltersOpen}
                            onReset={resetMistakeFilters}
                            resetLabel="還原學習者預設"
                        />
                        <div className="mistake-list-heading">
                            <div className="question-list-title"><h3>{mistakeRankingView === "personal" ? "個人錯題清單" : "社群錯題清單"}</h3><span>共 {mistakeResultCount} 題</span></div>
                            <div className="mistake-list-actions">
                                {mistakeRankingView === "personal" && <Button appearance="outline" size="sm" disabled={!selectedMistakes.length} onClick={() => openQuestionPlan(selectedMistakes, "錯題")}><CalendarDays />加入計劃</Button>}
                                {mistakeRankingView === "personal" && <Button size="sm" disabled={!selectedMistakes.length} onClick={() => beginSession("review", selectedMistakes, "instant", undefined, getWrongPartIdsByQuestion(latestAttempts.filter((attempt) => selectedMistakes.includes(attempt.questionId))))}>複習已選</Button>}
                            </div>
                        </div>
                        <TabsContent className="mistake-ranking-content" value="personal">
                            {!visibleMistakeQuestions.length && <div className="workspace-surface rounded-2xl p-8 text-center"><CheckCircle2 className="mx-auto text-primary" /><p className="mt-3 font-bold">目前條件沒有個人錯題</p><p className="mt-1 text-sm text-muted-foreground">完成一輪練習後，最新一次仍答錯的題目會依累計錯誤次數排列。</p><Button className="mt-4" appearance="outline" onClick={mistakeQuestions.length ? resetMistakeFilters : () => navigateToSection("practice")}>{mistakeQuestions.length ? "清除篩選" : "前往安排練習"}</Button></div>}
                            {visibleMistakeQuestions.length > 0 && <div className="mistake-table-wrap">
                                <table className="mistake-table mistake-personal-table">
                                    <thead><tr>
                                        <th className="mistake-select-column" scope="col"><label className="mistake-select" aria-label="選取全部篩選錯題"><Checkbox checked={allVisibleMistakesSelected} onChange={(event) => toggleAllVisibleMistakes(event.target.checked)} /><span className="sr-only">選取全部篩選錯題</span></label></th>
                                        <th className="mistake-rank-column" scope="col">排名</th><th scope="col">題目</th><th scope="col">科目／單元</th><th scope="col">最後測驗</th><th scope="col">錯誤次數</th><th scope="col"><span className="sr-only">操作</span></th>
                                    </tr></thead>
                                    <tbody>{pagedMistakeQuestions.map((question, index) => {
                                        const selected = selectedMistakes.includes(question.id);
                                        const questionAttempts = activeAttempts.filter((attempt) => attempt.questionId === question.id);
                                        const lastAttempt = questionAttempts.reduce<Attempt | undefined>((latest, attempt) => !latest || new Date(attempt.date).getTime() > new Date(latest.date).getTime() ? attempt : latest, undefined);
                                        const wrongCount = questionAttempts.filter((attempt) => attempt.correct === false).length;
                                        return <tr key={question.id}>
                                            <td className="mistake-select-cell"><label className="mistake-select" aria-label={`選取${question.prompt}`}><Checkbox checked={selected} onChange={(event) => setSelectedMistakes((current) => event.target.checked ? [...new Set([...current, question.id])] : current.filter((id) => id !== question.id))} /><span className="sr-only">選取此錯題</span></label></td>
                                            <td className="mistake-rank-cell" data-label="排名">{(activeMistakePage - 1) * MISTAKE_PAGE_SIZE + index + 1}</td>
                                            <td className="mistake-question-cell question-overview-title-cell" data-label="題目"><p className="mistake-question-title" title={question.prompt}>{question.prompt}</p><small>{getQuestionSourceCategory(question)}</small></td>
                                            <td className="mistake-question-scope" data-label="科目／單元"><strong>{question.subject}</strong><small>{getUnitLabel(question.unit)}</small></td>
                                            <td data-label="最後測驗"><time className="mistake-meta" dateTime={lastAttempt?.date}>{lastAttempt ? formatAttemptDate(lastAttempt.date) : "尚無紀錄"}</time></td>
                                            <td data-label="錯誤次數"><Badge tone={wrongCount > 1 ? "danger" : "muted"}>{wrongCount} 次</Badge></td>
                                            <td className="mistake-table-actions flex-wrap"><Button appearance="outline" size="sm" onClick={() => beginSession("review", [question.id], "instant", undefined, lastAttempt ? getWrongPartIdsByQuestion([lastAttempt]) : undefined)}><RotateCcw />練習</Button>{renderRecommendationAction(question.id)}</td>
                                        </tr>;
                                    })}</tbody>
                                </table>
                            </div>}
                        </TabsContent>
                        <TabsContent className="mistake-ranking-content" value="community">
                            {!visibleCommunityMistakeRows.length && <div className="workspace-surface rounded-2xl p-8 text-center"><Users className="mx-auto text-primary" /><p className="mt-3 font-bold">目前沒有社群錯題紀錄</p><p className="mt-1 text-sm text-muted-foreground">社群排行會彙整系統內同年級題目的全部已檢核作答。</p></div>}
                            {visibleCommunityMistakeRows.length > 0 && <div className="mistake-table-wrap">
                                <table className="mistake-table mistake-community-table">
                                    <thead><tr><th className="mistake-rank-column" scope="col">排名</th><th scope="col">題目</th><th scope="col">科目／單元</th><th scope="col">作答次數</th><th scope="col">錯誤次數</th><th scope="col">錯誤率</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
                                    <tbody>{pagedCommunityMistakeRows.map(({ question, total, wrong, wrongRate }, index) => <tr key={question.id}>
                                        <td className="mistake-rank-cell" data-label="排名">{(activeMistakePage - 1) * MISTAKE_PAGE_SIZE + index + 1}</td>
                                        <td className="mistake-question-cell question-overview-title-cell" data-label="題目"><p className="mistake-question-title" title={question.prompt}>{question.prompt}</p><small>{getQuestionSourceCategory(question)}</small></td>
                                        <td className="mistake-question-scope" data-label="科目／單元"><strong>{question.subject}</strong><small>{getUnitLabel(question.unit)}</small></td>
                                        <td data-label="作答次數"><span className="mistake-meta">{total} 次</span></td>
                                        <td data-label="錯誤次數"><Badge tone={wrong > 1 ? "danger" : "muted"}>{wrong} 次</Badge></td>
                                        <td data-label="錯誤率"><strong>{wrongRate}%</strong></td>
                                        <td className="mistake-table-actions"><Button appearance="outline" size="sm" onClick={() => beginSession("review", [question.id], "instant")}><RotateCcw />練習</Button></td>
                                    </tr>)}</tbody>
                                </table>
                            </div>}
                        </TabsContent>
                        {mistakeResultCount > 0 && <nav className="mistake-pagination" aria-label="錯題分頁">
                            <p>第 {activeMistakePage}／{mistakePageCount} 頁，共 {mistakeResultCount} 題</p>
                            <div className="flex items-center gap-2">
                                <Button appearance="outline" size="sm" disabled={activeMistakePage === 1} onClick={() => setMistakePage(activeMistakePage - 1)}>上一頁</Button>
                                <Button appearance="outline" size="sm" disabled={activeMistakePage === mistakePageCount} onClick={() => setMistakePage(activeMistakePage + 1)}>下一頁</Button>
                            </div>
                        </nav>}
                    </Tabs>
                </CardContent>
            </Card>
        );
    }

    /** 顯示建立或編輯學習者的共用資料庫表單。 */
    function renderLearnerProfileDialog() {
        const selectedStage = educationCatalog?.stages.find((stage) => stage.code === learnerProfileDraft.educationStage);
        const stageOptions = educationCatalog?.stages.map((stage) => ({ value: stage.code, label: stage.name })) ?? [];
        const gradeOptions = selectedStage?.grades.map((grade) => ({ value: grade.code, label: grade.name })) ?? [];
        const semesterOptions = educationCatalog?.semesters.map((semester) => ({ value: semester.code, label: semester.name })) ?? [];
        return (
            <Dialog open={learnerProfileDialogOpen} onOpenChange={(open) => {
                if (learnerProfileBusy) return;
                setLearnerProfileDialogOpen(open);
                if (!open) {
                    setLearnerProfileDraft(EMPTY_LEARNER_PROFILE_DRAFT);
                    setLearnerProfileStatus("");
                }
            }}>
                <DialogContent size="sm" closeLabel="關閉學習者設定">
                    <DialogHeader><DialogTitle>{learnerProfileDraft.learnerId ? "編輯學習者" : "新增學習者"}</DialogTitle><DialogDescription>先選擇學生或社會人士；學生的年級與學期會套用到題庫與練習。</DialogDescription></DialogHeader>
                    <DialogBody className="grid gap-4">
                        <FormField label="稱呼"><Input autoFocus maxLength={80} required value={learnerProfileDraft.displayName} onChange={(event) => { setLearnerProfileDraft((current) => ({ ...current, displayName: event.target.value })); setLearnerProfileStatus(""); }} /></FormField>
                        <FormField label="學習身分"><NativeSelect options={[{ value: "enrolled", label: "學生" }, { value: "not_enrolled", label: "社會人士" }]} required value={learnerProfileDraft.educationStatus} onChange={(event) => { const educationStatus = event.target.value as PracticeAccountLearner["educationStatus"]; const stage = educationCatalog?.stages.find((candidate) => candidate.code === learnerProfileDraft.educationStage) ?? educationCatalog?.stages[0]; setLearnerProfileDraft((current) => ({ ...current, educationStatus, educationStage: educationStatus === "enrolled" ? stage?.code ?? "" : "", gradeCode: educationStatus === "enrolled" ? current.gradeCode || stage?.grades[0]?.code || "" : "", semesterCode: educationStatus === "enrolled" ? current.semesterCode || educationCatalog?.semesters[0]?.code || "" : "" })); setLearnerProfileStatus(""); }} /></FormField>
                        {learnerProfileDraft.educationStatus === "enrolled" && <>
                            <FormField label="教育階段"><NativeSelect disabled={!stageOptions.length} options={stageOptions} required value={learnerProfileDraft.educationStage} onChange={(event) => { const educationStage = event.target.value as EducationStage; const stage = educationCatalog?.stages.find((candidate) => candidate.code === educationStage); setLearnerProfileDraft((current) => ({ ...current, educationStage, gradeCode: stage?.grades[0]?.code ?? "" })); setLearnerProfileStatus(""); }} /></FormField>
                            <FormField label="年級"><NativeSelect disabled={!gradeOptions.length} options={gradeOptions} required value={learnerProfileDraft.gradeCode} onChange={(event) => { setLearnerProfileDraft((current) => ({ ...current, gradeCode: event.target.value })); setLearnerProfileStatus(""); }} /></FormField>
                            <FormField label="學期"><NativeSelect disabled={!semesterOptions.length} options={semesterOptions} required value={learnerProfileDraft.semesterCode} onChange={(event) => { setLearnerProfileDraft((current) => ({ ...current, semesterCode: event.target.value })); setLearnerProfileStatus(""); }} /></FormField>
                        </>}
                        {educationCatalogError && <p className="text-sm font-semibold text-danger" role="alert">{educationCatalogError}</p>}
                        {learnerProfileStatus && <p className="text-sm font-semibold text-danger" role="alert">{learnerProfileStatus}</p>}
                    </DialogBody>
                    <DialogFooter><Button appearance="ghost" tone="muted" disabled={learnerProfileBusy} onClick={() => setLearnerProfileDialogOpen(false)}>取消</Button><Button disabled={learnerProfileBusy || !learnerProfileDraft.displayName.trim() || (learnerProfileDraft.educationStatus === "enrolled" && (!learnerProfileDraft.gradeCode || !learnerProfileDraft.semesterCode))} onClick={saveLearnerProfile}><Save />{learnerProfileBusy ? "正在保存…" : "保存"}</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    /** 顯示登入帳號、使用身分與可管理學習者；不混入目前學習者的個人偏好。 */
    function renderSystemSettings() {
        if (!practiceAccount) return null;
        return (
            <div className="grid gap-5">
                <Card className="workspace-card settings-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={Settings2} title="系統設定" description="管理登入帳號、本人身分與這個帳號可管理的學習者。" /></CardHeader>
                    <CardContent className="grid gap-8 p-5 sm:p-7">
                        <section className="settings-section">
                            <div className="settings-section-heading">
                                <div><h3>學習者管理</h3><p>切換、編輯或新增這個帳號可管理的學習者；個人的科目、考試與練習偏好請到「學習者設定」。</p></div>
                                {canCreateLearner && <Button appearance="outline" onClick={openCreateLearner}><UserPlus />新增學習者</Button>}
                            </div>
                            <div className="grid gap-3">
                                {!accountLearners.length && <div className="workspace-surface rounded-2xl p-5 text-sm text-muted-foreground">目前尚無學習者。{canCreateLearner ? "請新增第一位學習者。" : "目前身分沒有新增學習者的權限。"}</div>}
                                {accountLearners.map((profile) => (
                                    <article className="workspace-surface flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between" key={profile.id}>
                                        <div className="flex min-w-0 items-center gap-3">
                                            <div className="learner-avatar" aria-hidden="true">{profile.displayName.slice(0, 1)}</div>
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2"><strong className="truncate">{profile.displayName}</strong>{profile.id === practiceAccount.learner?.id && <Badge tone="primary">目前使用</Badge>}{profile.isSelf && <Badge tone="muted">本人</Badge>}</div>
                                                <p className="mt-1 text-sm text-muted-foreground">{profile.educationStatus === "enrolled" ? `${profile.gradeName ?? "未設定年級"} · ${profile.semesterName ?? "未設定學期"}` : "社會人士"}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {profile.id !== practiceAccount.learner?.id && <Button appearance="outline" size="sm" disabled={practiceBusy} onClick={() => changeLearner(profile.id)}>切換使用</Button>}
                                            {canCreateLearner && profile.canManageSettings && <Button size="sm" disabled={learnerProfileBusy} onClick={() => openEditLearner(profile)}><Pencil />編輯</Button>}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                        <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>帳號身分與使用角色</h3><p>本人身分是帳號層設定；目前模式只決定這次操作情境。系統管理員權限不在此清單，也不會由一般帳號自行取得。</p></div><Badge tone={practiceAccount.emailVerified ? "success" : "warning"}>{practiceAccount.emailVerified ? "信箱已驗證" : "信箱尚未驗證"}</Badge></div>
                            <div className="role-access-summary">
                                <div><span>帳號信箱</span><strong>{practiceAccount.email ?? "帳號資訊已隱藏"}</strong></div>
                                <div><span>本人身分</span><strong>{practiceAccount.accountRole ? ACCOUNT_ROLE_LABELS[practiceAccount.accountRole] : "尚未設定"}</strong></div>
                                <div><span>目前模式</span><strong>{ACCOUNT_ROLE_LABELS[practiceAccount.activeRole]}</strong></div>
                            </div>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <FormField label="本人身分"><NativeSelect options={ACCOUNT_IDENTITY_OPTIONS} value={identityRole} onChange={(event) => { setIdentityRole(event.target.value as PracticeAccountRole); setIdentityPassword(""); setIdentityStatus(""); }} /></FormField>
                                {identityRole !== "learner" && identityRole !== practiceAccount.accountRole && <FormField label="目前帳號密碼"><Input type="password" autoComplete="current-password" value={identityPassword} onChange={(event) => { setIdentityPassword(event.target.value); setIdentityStatus(""); }} /></FormField>}
                            </div>
                            {identityStatus && <p className="mt-3 text-sm font-semibold text-danger" role="alert">{identityStatus}</p>}
                            <div className="mt-4 flex justify-end"><Button disabled={identityBusy || identityRole === practiceAccount.accountRole || (identityRole !== "learner" && !identityPassword)} onClick={saveAccountIdentity}>{identityBusy ? "正在更新…" : "更新本人身分"}</Button></div>
                        </section>
                        {renderLearnerProfileDialog()}
                    </CardContent>
                </Card>
            </div>
        );
    }

    /** 顯示目前使用中學習者的個人、科目、考試與練習偏好。 */
    function renderSettings() {
        const selectedExamId = getSettingsExamId(pathname);
        const selectedExam = activePlan.examSettings.find((exam) => exam.id === selectedExamId);
        const selectedSubjectSetting = activeAccountLearner?.subjectSettings.find(
            (setting) => setting.subject.code === selectedSubjectSettingCode,
        ) ?? activeAccountLearner?.subjectSettings[0];

        if (selectedExam) {
            return (
                <Card className="workspace-card settings-card border-border/80 shadow-sm">
                    <CardHeader className="settings-detail-header">
                        <WorkspaceHeading icon={CalendarDays} title={selectedExam.name} description="設定考試日期，以及每個科目的開始與結束範圍。" />
                        <Button appearance="outline" onClick={() => router.push(SECTION_PATHS.settings)}><ArrowLeft />返回考試清單</Button>
                    </CardHeader>
                    <CardContent className="grid gap-6 p-5 sm:p-7">
                        {!canManageCurrentLearner && <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">目前只有檢視權限；需要學習者設定權限才能修改考試內容。</p>}
                        <fieldset className="contents" disabled={!canManageCurrentLearner}>
                        <div className="exam-detail-status">
                            <div><p className="text-sm font-semibold">考試狀態</p><p className="text-xs text-muted-foreground">目前套用的考試會帶入依考試練習與摘要。</p></div>
                            {selectedExam.id === activePlan.activeExamId
                                ? <Badge className="tag-purple" tone="primary">目前套用</Badge>
                                : <Button appearance="outline" size="sm" onClick={() => updatePlan("activeExamId", selectedExam.id)}>設為目前考試</Button>}
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FormField className="field-dot field-dot-violet" label="考試名稱"><NativeSelect options={ASSESSMENT_OPTIONS} value={selectedExam.name} onChange={(event) => updateExamSetting(selectedExam.id, "name", event.target.value)} /></FormField>
                            <FormField className="field-dot field-dot-coral" label="考試日期"><Input type="date" value={selectedExam.date} onChange={(event) => updateExamSetting(selectedExam.id, "date", event.target.value)} /></FormField>
                        </div>
                        <div className="assessment-ranges">
                            <div className="assessment-ranges-heading" aria-hidden="true"><span>科目</span><span>開始範圍</span><span></span><span>結束範圍</span></div>
                            {availableSubjects.map((subject) => {
                                const options = assessmentOptionsBySubject[subject] ?? [];
                                const range = getAssessmentRange(selectedExam, subject);
                                return (
                                    <div className="assessment-range-row" key={subject}>
                                        <div className="assessment-range-subject"><strong>{subject}</strong><span>{activeLearner.bookVersions[subject]}版</span></div>
                                        <FormField className="assessment-range-field" label={`${subject}開始範圍`}><NativeSelect options={options} value={range.start} onChange={(event) => updateAssessmentRange(selectedExam.id, subject, "start", event.target.value)} /></FormField>
                                        <ArrowRight className="assessment-range-arrow" aria-hidden="true" />
                                        <FormField className="assessment-range-field" label={`${subject}結束範圍`}><NativeSelect options={options} value={range.end} onChange={(event) => updateAssessmentRange(selectedExam.id, subject, "end", event.target.value)} /></FormField>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="exam-detail-actions">
                            <Button appearance="ghost" tone="danger" disabled={activePlan.examSettings.length <= 1} onClick={() => removeExamSetting(selectedExam.id)}><Trash2 />刪除此考試</Button>
                        </div>
                        </fieldset>
                    </CardContent>
                </Card>
            );
        }

        return (
            <div className="grid gap-5">
                <Card className="workspace-card settings-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={UserCheck} title="學習者設定" description="只調整目前使用中學習者的個人資料、各科版本與練習偏好。" /></CardHeader>
                    <CardContent className="grid gap-8 p-5 sm:p-7">
                        {!canManageCurrentLearner && <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">目前只有檢視權限；個人資料、考試與練習偏好不會被修改。</p>}
                        <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>基本資料</h3><p>稱呼會顯示在首頁；學生的年級與學期會自動帶入題庫與複習計畫。</p></div><Badge className="tag-purple" tone="primary">個人資料</Badge></div>
                            {practiceAccount && activeAccountLearner ? <div className="workspace-surface flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="learner-avatar" aria-hidden="true">{activeAccountLearner.displayName.slice(0, 1)}</div>
                                    <div className="min-w-0"><strong className="truncate">{activeAccountLearner.displayName}</strong><p className="mt-1 text-sm text-muted-foreground">{activeAccountLearner.educationStatus === "enrolled" ? `${activeAccountLearner.gradeName ?? "未設定年級"} · ${activeAccountLearner.semesterName ?? "未設定學期"}` : "社會人士"}</p></div>
                                </div>
                                {canManageCurrentLearner
                                    ? <Button disabled={learnerProfileBusy} onClick={() => openEditLearner(activeAccountLearner)}><Pencil />編輯自己的資料</Button>
                                    : <Badge tone="muted">僅供檢視</Badge>}
                            </div> : <div className="grid gap-4 sm:grid-cols-2">
                                <div className="workspace-surface flex items-center gap-4 rounded-2xl p-4 sm:col-span-2">
                                    <div className="learner-avatar overflow-hidden" aria-hidden="true">{activeLearner.avatar ? <img className="h-full w-full object-cover" src={activeLearner.avatar} alt="" /> : activeLearner.name.slice(0, 1)}</div>
                                    <div className="min-w-0 flex-1"><FormField label="代表圖片" description="支援 JPG、PNG、WebP，檔案需小於 1 MB。"><Input accept={AVATAR_FILE_TYPES.join(",")} type="file" onChange={updateLearnerAvatar} /></FormField>{avatarError && <p className="mt-2 text-sm font-semibold text-danger" role="alert">{avatarError}</p>}</div>
                                    {activeLearner.avatar && <Button appearance="ghost" tone="muted" size="sm" onClick={() => { updateLearner("avatar", ""); setAvatarError(""); }}>移除圖片</Button>}
                                </div>
                                <FormField className="field-dot field-dot-violet" label="稱呼"><Input value={activeLearner.name} onChange={(event) => updateLearner("name", event.target.value)} /></FormField>
                                <FormField className="field-dot field-dot-blue" label="學校"><Input value={activeLearner.school} onChange={(event) => updateLearner("school", event.target.value)} /></FormField>
                                <FormField className="field-dot field-dot-coral" label="年級"><NativeSelect options={GRADE_OPTIONS} value={activeLearner.grade} onChange={(event) => updateLearner("grade", event.target.value)} /></FormField>
                                <FormField className="field-dot field-dot-gold" label="學期"><NativeSelect options={SEMESTER_OPTIONS} value={activeLearner.semester} onChange={(event) => updateLearner("semester", event.target.value)} /></FormField>
                            </div>}
                            {renderLearnerProfileDialog()}
                        </section>
                        {practiceAccount ? <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>科目與版本</h3><p>先選科目，再設定該科已建立的版本。沒有版本的科目可直接使用。</p></div><Badge tone="muted">資料庫設定</Badge></div>
                            {!activeAccountLearner?.subjectSettings.length ? <div className="workspace-surface rounded-2xl p-4 text-sm text-muted-foreground"><p>目前尚未啟用科目。</p><p className="mt-1">請由有管理權限的帳號完成科目設定。</p></div> : <div className="workspace-surface grid gap-4 rounded-2xl p-4 sm:grid-cols-2">
                                <FormField label="科目">
                                    <NativeSelect
                                        options={activeAccountLearner.subjectSettings.map((setting) => ({ value: setting.subject.code, label: normalizeSubjectLabel(setting.subject.name) }))}
                                        value={selectedSubjectSetting?.subject.code ?? ""}
                                        onChange={(event) => { setSelectedSubjectSettingCode(event.target.value); setSubjectSettingStatus(""); }}
                                    />
                                </FormField>
                                {selectedSubjectSetting && selectedSubjectSetting.availableBookVersions.length > 0 ? <FormField label="版本" description="只更新目前選取的科目。">
                                    <NativeSelect
                                        disabled={!activeAccountLearner.canManageSettings || Boolean(subjectSettingBusyCode)}
                                        options={[
                                            { value: "", label: "不指定版本" },
                                            ...selectedSubjectSetting.availableBookVersions.map((bookVersion) => ({ value: bookVersion.id, label: [bookVersion.publisher?.name, bookVersion.name].filter(Boolean).join(" · ") })),
                                        ]}
                                        value={selectedSubjectSetting.bookVersion?.id ?? ""}
                                        onChange={(event) => void saveLearnerSubjectSetting(selectedSubjectSetting, event.target.value)}
                                    />
                                </FormField> : <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">這個科目沒有建立版本，可直接使用，不會套用版本篩選。</div>}
                                {selectedSubjectSetting && subjectSettingBusyCode === selectedSubjectSetting.subject.code && <p className="text-sm text-muted-foreground sm:col-span-2" role="status">正在保存…</p>}
                            </div>}
                            {subjectSettingStatus && <p className="mt-3 text-sm font-semibold" role="status">{subjectSettingStatus}</p>}
                        </section> : <section className="settings-section">
                            <div className="settings-section-heading">
                                <div><h3>各科書籍版本</h3><p>系統預設科目不可刪除；也可自行新增其他科目。版本選擇「無」時，該科不會出現在題目、練習與篩選介面。</p></div>
                                <Button appearance="outline" onClick={() => setSubjectDialogOpen(true)}><Plus />新增科目</Button>
                            </div>
                            <Dialog open={subjectDialogOpen} onOpenChange={(open) => {
                                setSubjectDialogOpen(open);
                                if (!open) {
                                    setSubjectChoice("");
                                    setSubjectDraft("");
                                    setSubjectError("");
                                }
                            }}>
                                <DialogContent size="sm" closeLabel="關閉新增科目">
                                    <DialogHeader><DialogTitle>新增科目</DialogTitle><DialogDescription>可加入目前尚未選擇的目錄科目，或自行建立其他科目。</DialogDescription></DialogHeader>
                                    <DialogBody className="grid gap-4">
                                        <FormField label="科目來源">
                                            <NativeSelect
                                                autoFocus
                                                options={[
                                                    { value: "", label: "請選擇科目" },
                                                    ...unselectedCatalogSubjects.map((subject) => ({ value: subject, label: subject })),
                                                    { value: CUSTOM_SUBJECT_VALUE, label: "自訂新增…" },
                                                ]}
                                                value={subjectChoice}
                                                onChange={(event) => {
                                                    setSubjectChoice(event.target.value);
                                                    setSubjectDraft("");
                                                    setSubjectError("");
                                                }}
                                            />
                                        </FormField>
                                        {subjectChoice === CUSTOM_SUBJECT_VALUE && <FormField label="自訂科目名稱"><Input maxLength={40} placeholder="例如：資訊科技" value={subjectDraft} onChange={(event) => { setSubjectDraft(event.target.value); setSubjectError(""); }} onKeyDown={(event) => { if (event.key === "Enter") addSubject(); }} /></FormField>}
                                        {subjectError && <p className="text-sm font-semibold text-danger" role="alert">{subjectError}</p>}
                                    </DialogBody>
                                    <DialogFooter><DialogClose asChild><Button appearance="ghost" tone="muted">取消</Button></DialogClose><Button onClick={addSubject}><Save />儲存</Button></DialogFooter>
                                </DialogContent>
                            </Dialog>
                            <div className="grid gap-4 sm:grid-cols-3">
                                {configurableSubjects.map((subject, index) => (
                                    <div className="subject-book-setting" key={subject}>
                                        <FormField className={`field-dot ${index === 0 ? "field-dot-violet" : index === 1 ? "field-dot-coral" : "field-dot-blue"}`} label={`${subject}版本`}>
                                            <NativeSelect options={BOOK_SETTING_OPTIONS} value={activeLearner.bookVersions[subject] ?? ""} onChange={(event) => updateBookVersion(subject, event.target.value)} />
                                        </FormField>
                                        {activeLearner.customSubjects.includes(subject) && <Button appearance="ghost" tone="danger" size="sm" onClick={() => removeAddedSubject(subject)}><Trash2 />刪除科目</Button>}
                                    </div>
                                ))}
                                {!configurableSubjects.length && <p className="text-sm text-muted-foreground">目前年級尚無可設定版本的科目。</p>}
                            </div>
                        </section>}
                        <fieldset className="contents" disabled={!canManageCurrentLearner}>
                        {(!practiceAccount || activeAccountLearner) && <><section className="settings-section" id="exam-settings">
                            <div className="settings-section-heading">
                                <div><h3>考試設定</h3><p>先選擇考試，再進入內頁設定日期與各科範圍。</p></div>
                                <Button appearance="outline" disabled={activePlan.examSettings.length >= 20} onClick={addExamSetting}><Plus />新增考試</Button>
                            </div>
                            <div className="exam-settings-list">
                                {activePlan.examSettings.map((exam, index) => (
                                    <article className="exam-setting-list-item" data-active={exam.id === activePlan.activeExamId} key={exam.id}>
                                        <button className="exam-setting-list-main" type="button" onClick={() => router.push(getSettingsExamPath(exam.id))}>
                                            <span className="exam-setting-index">{index + 1}</span>
                                            <span className="exam-setting-summary"><span className="exam-setting-name">{exam.name}</span><span>{exam.date || "尚未設定日期"} · {availableSubjects.length} 科範圍</span></span>
                                            {exam.id === activePlan.activeExamId && <Badge className="tag-purple" tone="primary">目前套用</Badge>}
                                            <ChevronRight aria-hidden="true" />
                                        </button>
                                        <div className="exam-setting-list-actions">
                                            {exam.id !== activePlan.activeExamId && <Button appearance="outline" size="sm" onClick={() => updatePlan("activeExamId", exam.id)}>設為目前考試</Button>}
                                            <Button appearance="ghost" tone="danger" size="sm" disabled={activePlan.examSettings.length <= 1} onClick={() => removeExamSetting(exam.id)}><Trash2 /><span className="sr-only">刪除{exam.name}</span></Button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section></>}
                        {(!practiceAccount || activeAccountLearner) && <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>練習偏好</h3><p>預設題數會用於新計畫；複習計畫中的「本輪題數」仍可臨時更改。</p></div><Badge className="tag-gold" tone="warning">預設值</Badge></div>
                            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                                <FormField className="field-dot field-dot-gold" label="可選題數" description="使用逗號分隔，例如：5, 10, 15。">
                                    <Input
                                        aria-invalid={Boolean(questionLimitOptionsError)}
                                        placeholder="5, 10, 15"
                                        value={questionLimitOptionsDraft}
                                        onBlur={saveQuestionLimitOptions}
                                        onChange={(event) => {
                                            setQuestionLimitOptionsDraft(event.target.value);
                                            setQuestionLimitOptionsError("");
                                        }}
                                    />
                                    {questionLimitOptionsError && <p className="text-sm font-semibold text-danger" role="alert">{questionLimitOptionsError}</p>}
                                </FormField>
                                <FormField className="field-dot field-dot-violet" label="預設題數" description="建立新計畫或重設進階條件時套用。">
                                    <NativeSelect
                                        options={activeLearner.questionLimitOptions.map((limit) => ({ value: String(limit), label: `${limit} 題` }))}
                                        value={String(activeLearner.defaultQuestionLimit)}
                                        onChange={(event) => updateLearner("defaultQuestionLimit", Number(event.target.value))}
                                    />
                                </FormField>
                            </div>
                        </section>}
                        </fieldset>
                    </CardContent>
                </Card>
            </div>
        );
    }

    /** 顯示每次練習紀錄，展開後可切換查看錯題或全部題目。 */
    function renderLearningHistory() {
        /**
         * 顯示單筆作答題目與答案。
         * @param record 練習紀錄。
         * @param attempt 單題作答紀錄。
         * @param index 題目在該次練習中的位置。
         * @returns 作答題目卡片；題目不存在時不顯示。
         */
        function renderResultAttempt(record: PracticeRecord, attempt: Attempt, index: number) {
            const resultLabel = attempt.correct === true ? "答對" : attempt.correct === false ? "錯題" : "待檢視";
            const resultTone = attempt.correct === true ? "success" : attempt.correct === false ? "danger" : "warning";
            const currentServerRevision = persistedQuestions.get(attempt.questionId)?.revisionId;
            const revisionUnavailable = Boolean(
                attempt.revisionId && currentServerRevision !== attempt.revisionId,
            );
            const question = revisionUnavailable
                ? undefined
                : questions.find((item) => item.id === attempt.questionId);
            if (!question) {
                return <article className="result-wrong-item" data-result={attempt.correct === true ? "correct" : attempt.correct === false ? "wrong" : "pending"} key={`${record.id}-${attempt.questionId}-${index}`}>
                    <div>
                        <div className="result-question-heading"><p className="result-wrong-number">第 {index + 1} 題</p><Badge tone={resultTone}>{resultLabel}</Badge></div>
                        <h5>作答當時的題目版本目前無法安全顯示</h5>
                        <p>已保留原始作答結果與時間；系統不會用目前題目版本冒充當時內容。</p>
                    </div>
                    <time dateTime={attempt.date}>{formatAttemptDate(attempt.date)} · {formatDuration(attempt.durationSeconds)}</time>
                </article>;
            }
            const wrongPartLabels = getWrongPartLabels(question, attempt);
            return <article className="result-wrong-item" data-result={attempt.correct === true ? "correct" : attempt.correct === false ? "wrong" : "pending"} key={`${record.id}-${attempt.questionId}-${index}`}>
                <div>
                    <div className="result-question-heading"><p className="result-wrong-number">第 {index + 1} 題</p><Badge tone={resultTone}>{resultLabel}</Badge></div>
                    <h5>{question.prompt}</h5>
                    <p>{question.subject} · {getUnitLabel(question.unit)} · {question.knowledge}</p>
                    {wrongPartLabels.length > 0 && <p>答錯小題：{wrongPartLabels.join("、")}</p>}
                    {attempt.correct === false && <div className="result-question-actions">
                        <Button appearance="outline" size="sm" onClick={() => beginSession("review", [question.id], "instant", undefined, getWrongPartIdsByQuestion([attempt]))}><RotateCcw />立即測驗</Button>
                        {renderRecommendationAction(question.id)}
                    </div>}
                </div>
                <div className="result-wrong-answer"><p><span>你的答案</span>{formatAnswer(question, attempt.answer)}</p><p><span>參考答案</span>{persistedQuestions.has(question.id)
                    ? attempt.referenceAnswers?.length ? formatReferenceAnswers(attempt.referenceAnswers) : "這個題目版本尚無可顯示的參考答案。"
                    : formatAnswer(question, question.answer)}</p></div>
            </article>;
        }

        return (
            <div className="grid gap-5">
                {recommendationNotice && <p className="rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="status">{recommendationNotice}</p>}
                <Card className="workspace-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={BarChart3} title="成果摘要" description="依每次練習累積的作答紀錄計算。" /></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
                        { label: "練習次數", value: practiceRecords.length },
                        { label: "已作答", value: historyAttemptedCount },
                        { label: "錯題", value: reviewedAttempts.length - correctCount + scoreOnlyWrongCount },
                        { label: "已檢核正確率", value: reviewedCount ? `${accuracy}%` : "—" },
                    ].map((stat) => <div className="workspace-stat rounded-xl p-4 text-center" key={stat.label}><p className="text-2xl font-bold">{stat.value}</p><p className="text-xs text-muted-foreground">{stat.label}</p></div>)}</CardContent>
                </Card>
                <Card className="workspace-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={ClipboardCheck} title="練習紀錄" description="依練習日期由新到舊排列；成績模式只保留整體統計，其他模式可展開查看題目。" /></CardHeader>
                    <CardContent>
                        {!practiceRecords.length && <div className="workspace-surface rounded-2xl p-8 text-center"><p className="font-bold">尚未有練習紀錄</p><p className="mt-1 text-sm text-muted-foreground">完成一輪練習後，練習項目與錯題數會顯示在這裡。</p></div>}
                        {practiceRecords.length > 0 && <div className="result-record-table-wrap">
                            <table className="result-record-table">
                                <thead><tr><th scope="col">練習項目</th><th scope="col">日期</th><th scope="col">題數</th><th scope="col">錯題</th><th scope="col">成績</th><th scope="col">操作</th></tr></thead>
                                <tbody>{practiceRecords.map((record) => {
                                    const recordQuestions = record.attempts.map((attempt) => questions.find((question) => question.id === attempt.questionId)).filter((question): question is Question => Boolean(question));
                                    const subjects = [...new Set(recordQuestions.map((question) => question.subject))];
                                    const units = [...new Set(recordQuestions.map((question) => question.unit))];
                                    const wrongAttempts = record.attempts.filter((attempt) => attempt.correct === false);
                                    const pendingAttempts = record.attempts.filter((attempt) => attempt.correct === null);
                                    const reviewed = record.attempts.filter((attempt) => attempt.correct !== null);
                                    const correct = reviewed.filter((attempt) => attempt.correct === true).length;
                                    const scoreOnly = Boolean(record.scoreSummary);
                                    const wrongCount = record.scoreSummary?.wrong ?? wrongAttempts.length;
                                    const score = record.scoreSummary
                                        ? `${record.scoreSummary.accuracy} 分`
                                        : reviewed.length ? `${Math.round(correct / reviewed.length * 100)} 分` : "待檢視";
                                    const modeLabel = record.mode === "review" ? "錯題複習" : record.mode === "similar" ? "相關題目練習" : "考前練習";
                                    const subjectLabel = scoreOnly ? "成績模式" : subjects.length === 1 ? subjects[0] : subjects.length ? subjects.join("、") : "練習";
                                    const unitLabels = units.map(getUnitLabel);
                                    const unitLabel = unitLabels.length > 2 ? `${unitLabels.slice(0, 2).join("、")}等 ${unitLabels.length} 個單元` : unitLabels.join("、");
                                    const title = `${modeLabel} · ${subjectLabel}${unitLabel ? ` · ${unitLabel}` : ""}`;
                                    const expanded = !scoreOnly && selectedPracticeRecordId === record.id;
                                    return <Fragment key={record.id}>
                                        <tr>
                                            <td data-label="練習項目">{scoreOnly
                                                ? <span className="result-record-title">{title}</span>
                                                : <button className="result-record-title" type="button" aria-expanded={expanded} onClick={() => setSelectedPracticeRecordId(expanded ? "" : record.id)}>{title}</button>}</td>
                                            <td data-label="日期"><time dateTime={record.completedAt}>{formatAttemptDate(record.completedAt)}</time></td>
                                            <td data-label="題數">{record.itemCount} 題</td>
                                            <td data-label="錯題"><Badge tone={wrongCount ? "danger" : "success"}>{wrongCount} 題</Badge></td>
                                            <td data-label="成績">{score}</td>
                                            <td className="result-record-action">{scoreOnly
                                                ? <Badge>僅顯示成績</Badge>
                                                : <Button appearance="outline" size="sm" aria-expanded={expanded} onClick={() => setSelectedPracticeRecordId(expanded ? "" : record.id)}>{expanded ? "收起" : "查看題目"}<ChevronDown className={expanded ? "rotate-180" : ""} /></Button>}</td>
                                        </tr>
                                        {expanded && <tr className="result-record-detail-row"><td colSpan={6}>
                                            <section className="result-record-detail" aria-label={`${title}題目明細`}>
                                                <div className="result-record-detail-heading"><div><h4>本次作答題目</h4><p>{record.attempts.length} 題中答錯 {wrongAttempts.length} 題，作答時間共 {formatDuration(record.attempts.reduce((total, attempt) => total + attempt.durationSeconds, 0))}。</p></div>{pendingAttempts.length > 0 && <Badge tone="warning">{pendingAttempts.length} 題待檢視</Badge>}</div>
                                                <Tabs defaultValue="wrong" appearance="segmented">
                                                    <TabsList className="result-question-tabs" aria-label="切換本次練習題目範圍">
                                                        <TabsTrigger value="all">全部題目 {record.attempts.length}</TabsTrigger>
                                                        <TabsTrigger value="wrong">錯題 {wrongAttempts.length}</TabsTrigger>
                                                    </TabsList>
                                                    <TabsContent value="all" className="result-question-list">
                                                        {record.attempts.map((attempt, index) => renderResultAttempt(record, attempt, index))}
                                                    </TabsContent>
                                                    <TabsContent value="wrong" className="result-question-list">
                                                        {!wrongAttempts.length && <div className="result-record-empty"><CheckCircle2 /><p>本次沒有錯題。</p></div>}
                                                        {wrongAttempts.map((attempt) => renderResultAttempt(record, attempt, record.attempts.indexOf(attempt)))}
                                                    </TabsContent>
                                                </Tabs>
                                            </section>
                                        </td></tr>}
                                    </Fragment>;
                                })}</tbody>
                            </table>
                        </div>}
                    </CardContent>
                </Card>
            </div>
        );
    }

    const authMode = getAuthMode(pathname);
    if (authMode) return <AuthScreen mode={authMode} />;

    if (!isHydrated) return <main className="grid min-h-screen place-items-center p-6"><Card className="w-full max-w-md border-border/80 shadow-sm"><CardContent className="p-8 text-center"><p className="font-bold">正在讀取學習資料</p><p className="mt-2 text-sm text-muted-foreground">正在載入學習設定、正式題庫與已保存的作答紀錄。</p></CardContent></Card></main>;
    if (!learners.length && !practiceAccount) return <main className="grid min-h-screen place-items-center p-6"><Card className="w-full max-w-md border-border/80 shadow-sm"><CardContent className="p-8 text-center"><p className="font-bold">無法顯示學習資料</p><p className="mt-2 text-sm text-muted-foreground">{storageError || "尚無可用的學習者資料。"}</p></CardContent></Card></main>;

    if (section === "questions" && getOverviewQuestionId(pathname) !== undefined) return renderQuestionOverviewDetail();
    if (section === "bank" && importReviewQuestion) return renderImportQuestionReview();

    if (session && !sessionPaused) {
        return (
            <main className="practice-focus-shell">
                <div className="practice-focus-frame">
                    <header className="practice-focus-header">
                        <div className="practice-focus-title flex min-w-0 items-center gap-3">
                            <div className="practice-focus-mark"><LerniqaMark className="h-6 w-6" /></div>
                            <h1 ref={sessionHeadingRef} data-focus-heading tabIndex={-1} className="truncate text-base font-bold sm:text-lg">
                                {session.phase === "answering"
                                    ? `${sessionModeLabel} · ${sessionQuestionLabel}，共 ${session.questionIds.length} 題`
                                    : `${sessionModeLabel} · 本輪練習結果`}
                            </h1>
                        </div>
                        <div className="practice-focus-actions">
                            {session.phase === "answering" ? (
                            <Dialog open={sessionExitOpen} onOpenChange={setSessionExitOpen}>
                                <DialogTrigger asChild>
                                    <Button appearance="outline" tone="muted" aria-label="關閉練習"><X />關閉練習</Button>
                                </DialogTrigger>
                                <DialogContent size="sm" closeLabel="關閉選項">
                                    <DialogHeader>
                                        <DialogTitle>要怎麼離開這次練習？</DialogTitle>
                                        <DialogDescription>暫時關閉會保留目前題號與尚未送出的手寫；結束練習會捨棄本題尚未送出的內容，已完成的作答仍會保留。</DialogDescription>
                                    </DialogHeader>
                                    <DialogBody className="grid gap-3">
                                        <div className="rounded-2xl bg-[#f5f5f9] p-4 text-sm text-muted-foreground">目前進度：第 {session.index + 1} 題，共 {session.questionIds.length} 題</div>
                                    </DialogBody>
                                    <DialogFooter>
                                        <DialogClose asChild><Button appearance="ghost" tone="muted">繼續作答</Button></DialogClose>
                                        <Button appearance="outline" onClick={pauseSession}><Pause />暫時關閉</Button>
                                        <Button tone="danger" onClick={endSession}><LogOut />結束練習</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                            ) : <Button appearance="outline" tone="muted" onClick={leaveSession}><X />關閉結果</Button>}
                        </div>
                        {session.phase === "answering" && <Progress className="practice-focus-progress" aria-label={`練習進度：第 ${session.index + 1} 題，共 ${session.questionIds.length} 題`} value={((session.index + 1) / session.questionIds.length) * 100} />}
                    </header>
                    <section className="practice-focus-content">{renderSession()}</section>
                </div>
            </main>
        );
    }

    return <main className="min-h-screen p-3 sm:p-6 lg:p-8">
        <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
            <DialogContent size="sm" closeLabel="關閉角色切換">
                <DialogHeader>
                    <DialogTitle>切換角色</DialogTitle>
                </DialogHeader>
                <DialogBody className="grid gap-4">
                    {roleStatus && <p className="role-status" role="status">{roleStatus}</p>}
                    <FormField label="目前模式"><NativeSelect options={grantedRoleOptions} value={requestedRole} onChange={(event) => { setRequestedRole(event.target.value as AccountRole); setRoleStatus(""); setRolePassword(""); }} /></FormField>
                    {requestedRole !== "學習者" && requestedRole !== roleAccess.activeRole && <FormField label="目前帳號密碼" description="切換到家長或家教模式前，需要重新確認目前帳號密碼。"><Input type="password" autoComplete="current-password" value={rolePassword} onChange={(event) => { setRolePassword(event.target.value); setRoleStatus(""); }} /></FormField>}
                </DialogBody>
                <DialogFooter>
                    <DialogClose asChild><Button appearance="ghost" tone="muted">取消</Button></DialogClose>
                    <Button disabled={roleSwitchBusy || requestedRole === roleAccess.activeRole || (requestedRole !== "學習者" && !rolePassword)} onClick={switchRole}><ShieldCheck />{roleSwitchBusy ? "正在切換…" : "切換模式"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={questionPlanDialogOpen} onOpenChange={setQuestionPlanDialogOpen}>
            <DialogContent closeLabel="關閉建立練習計劃">
                <DialogHeader><DialogTitle>建立練習計劃</DialogTitle><DialogDescription>將已選的 {pendingQuestionIds.length} 題固定為一筆練習計劃。</DialogDescription></DialogHeader>
                <DialogBody><div className="grid gap-4 sm:grid-cols-2"><FormField label="練習日期"><Input type="date" value={questionPlanDate} onChange={(event) => setQuestionPlanDate(event.target.value)} /></FormField><FormField label="時間（選填）"><Input type="time" value={questionPlanTime} onChange={(event) => setQuestionPlanTime(event.target.value)} /></FormField></div></DialogBody>
                <DialogFooter><DialogClose asChild><Button appearance="outline">取消</Button></DialogClose><Button disabled={!questionPlanDate || !pendingQuestionIds.length} onClick={createQuestionPlan}>加入練習計劃</Button></DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={Boolean(editingScheduleId)} onOpenChange={(open) => { if (!open) setEditingScheduleId(""); }}>
            <DialogContent closeLabel="關閉編輯練習計劃">
                <DialogHeader><DialogTitle>編輯練習計劃</DialogTitle><DialogDescription>調整日期、時間與練習方式；題目內容請使用「套用」。</DialogDescription></DialogHeader>
                <DialogBody><div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="練習日期"><Input type="date" value={editingScheduleDate} onChange={(event) => setEditingScheduleDate(event.target.value)} /></FormField>
                    <FormField label="時間（選填）"><Input type="time" value={editingScheduleTime} onChange={(event) => setEditingScheduleTime(event.target.value)} /></FormField>
                    <div className="sm:col-span-2"><FormField label="練習方式"><NativeSelect options={(["complete", "instant", "score"] as CheckMode[]).map((value) => ({ value, label: getCheckModeLabel(value) }))} value={editingScheduleCheckMode} onChange={(event) => setEditingScheduleCheckMode(event.target.value as CheckMode)} /></FormField></div>
                </div></DialogBody>
                <DialogFooter><DialogClose asChild><Button appearance="outline">取消</Button></DialogClose><Button disabled={!editingScheduleDate} onClick={saveScheduledPracticeEdits}>儲存</Button></DialogFooter>
            </DialogContent>
        </Dialog>
        <div
            className="lerniqa-shell mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1500px] overflow-hidden rounded-[2rem] border border-white/70 bg-[#fbfcfc] shadow-[0_28px_80px_rgba(25,59,53,0.16)]"
            data-section={section}
            data-practice-list-page={isScheduleListPage}
        >
        <aside className="sidebar-panel flex flex-col border-b border-border bg-white p-5 lg:border-b-0 lg:border-r lg:p-6" data-mobile-open={mobileNavigationOpen}>
            <Button
                className="mobile-panel-toggle"
                appearance="ghost"
                tone="muted"
                aria-expanded={mobileNavigationOpen}
                aria-controls="mobile-navigation-panel"
                onClick={() => {
                    setMobileNavigationOpen((current) => !current);
                    setMobileSummaryOpen(false);
                }}
            >
                <Menu />
                <span className="mobile-panel-toggle-copy"><strong>選單與學習者</strong><small>{activeLearner.name} · {NAV_ITEMS.find((item) => item.id === section)?.label}</small></span>
                <ChevronDown className="mobile-panel-chevron" />
            </Button>
            <div id="mobile-navigation-panel" className="sidebar-panel-content">
            <div className="sidebar-identity-row">
                <div className="sidebar-brand">
                    <LerniqaLogo />
                    <div className="sidebar-brand-meta">
                        <p className="sidebar-brand-caption text-xs text-muted-foreground">智慧題庫學習平台</p>
                        <Badge className="sidebar-learning-badge" tone="primary">題庫</Badge>
                    </div>
                </div>
                <div className="learner-card mt-6">
                    <div className="flex items-center gap-3">
                        <div className="learner-avatar overflow-hidden" aria-hidden="true">{activeLearner.avatar ? <img className="h-full w-full object-cover" src={activeLearner.avatar} alt="" /> : activeLearner.name.slice(0, 1)}</div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold">{activeLearner.name}</p>
                            <p className="mt-1 truncate text-xs font-semibold text-primary">{activeLearner.school} · {roleAccess.activeRole}</p>
                        </div>
                        <Dropdown>
                            <DropdownTrigger asChild><Button className="learner-settings-button" appearance="outline" tone="primary" size="sm" aria-label="開啟個人與帳號設定" title="個人與帳號設定"><Settings2 /></Button></DropdownTrigger>
                            <DropdownContent align="end" className="w-60">
                                <DropdownLabel>{activeLearner.name}</DropdownLabel>
                                {canAccessLearnerSettings && <DropdownItem onSelect={() => navigateToSection("settings")}><UserCheck />學習者設定</DropdownItem>}
                                {canAccessSystemSettings && <DropdownItem onSelect={() => navigateToSection("system-settings")}><Settings2 />系統設定</DropdownItem>}
                                <DropdownItem onSelect={openRoleSwitch}><ShieldCheck />切換角色</DropdownItem>
                                {practiceAccount?.activeRole !== "learner" && <DropdownSub>
                                    <DropdownSubTrigger><GraduationCap />切換學習者</DropdownSubTrigger>
                                    <DropdownSubContent className="w-48">
                                        <DropdownRadioGroup value={activeLearnerId} onValueChange={changeLearner}>
                                            {learners.map((learner) => <DropdownRadioItem value={learner.id} key={learner.id}><DropdownIndicator>✓</DropdownIndicator>{learner.name}</DropdownRadioItem>)}
                                        </DropdownRadioGroup>
                                    </DropdownSubContent>
                                </DropdownSub>}
                                <DropdownSeparator />
                                <DropdownItem onSelect={() => router.push(AUTH_PATHS["account-link"])}><Link2 />帳號綁定</DropdownItem>
                                <DropdownItem onSelect={() => router.push(AUTH_PATHS.login)}><LogIn />切換帳號</DropdownItem>
                                <DropdownItem tone="danger" onSelect={() => router.push(AUTH_PATHS.logout)}><LogOut />登出</DropdownItem>
                            </DropdownContent>
                        </Dropdown>
                    </div>
                </div>
            </div>
            <div className="sidebar-action-scroll" tabIndex={0} aria-label="主要功能選單，可左右捲動">
                <Button className="sidebar-practice-button mt-6 w-full" data-section="practice" aria-current={section === "practice" && !isScheduleListPage ? "page" : undefined} onClick={sessionPaused ? resumeSession : () => navigateToSection("practice")}><BookOpen />{sessionPaused ? "繼續練習" : "開始練習"}</Button>
                <nav className="sidebar-nav mt-4 grid gap-1" aria-label="主要導覽">
                    <Button data-section="practice-schedules" appearance="ghost" tone="muted" aria-current={isScheduleListPage ? "page" : undefined} onClick={openScheduleList}><span className="sidebar-nav-icon sidebar-nav-icon-schedules"><ClipboardCheck /></span>練習計劃</Button>
                    {NAV_ITEMS.filter((item) => item.id !== "practice" && item.id !== "settings" && item.id !== "system-settings").map((item) => {
                        const Icon = item.icon;
                        const sidebarLabel = item.id === "overview" ? "學習總覽" : item.id === "questions" ? "題目總覽" : item.id === "mistakes" ? "錯題英雄榜" : "學習成果";
                        return <Button key={item.id} data-section={item.id} appearance="ghost" tone="muted" aria-current={section === item.id ? "page" : undefined} onClick={() => navigateToSection(item.id)}><span className={`sidebar-nav-icon sidebar-nav-icon-${item.id}`}><Icon /></span>{sidebarLabel}</Button>;
                    })}
                </nav>
                {canAccessLearnerSettings && <Button className="sidebar-settings mt-1 w-full" data-section="settings" appearance="ghost" tone="muted" aria-current={section === "settings" ? "page" : undefined} onClick={() => navigateToSection("settings")}><span className="sidebar-nav-icon sidebar-nav-icon-settings"><UserCheck /></span>學習者設定</Button>}
                {canAccessSystemSettings && <Button className="sidebar-settings mt-1 w-full" data-section="system-settings" appearance="ghost" tone="muted" aria-current={section === "system-settings" ? "page" : undefined} onClick={() => navigateToSection("system-settings")}><span className="sidebar-nav-icon sidebar-nav-icon-settings"><Settings2 /></span>系統設定</Button>}
            </div>
            <div className="sidebar-tip mt-6"><Sparkles size={18} /><p>每天 15 分鐘，穩定累積練習進度。</p></div>
            </div>
        </aside>
        <section className="workspace min-w-0 p-5 sm:p-7 lg:p-9" data-workspace={section}>{section !== "practice" && <header className="mb-7 flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.15em] text-primary">{activeLearner.school}</p><h1 ref={headingRef} data-focus-heading tabIndex={-1} className="mt-1 text-2xl font-bold">{NAV_ITEMS.find((item) => item.id === section)?.label}</h1></div><div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><CalendarDays size={17} /><span>{activeExam.name}</span>{examCountdownLabel && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{examCountdownLabel}</span>}</div></header>}{storageError && <p className="mb-5 rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="alert">{storageError}</p>}{renderSection()}</section>
        {section !== "questions" && <aside className="summary-panel" data-mobile-open={mobileSummaryOpen} data-practice-list-page={isScheduleListPage} data-section={section}>
            <Button
                className="mobile-panel-toggle"
                appearance="ghost"
                tone="muted"
                aria-expanded={mobileSummaryOpen}
                aria-controls="mobile-summary-panel"
                onClick={() => {
                    setMobileSummaryOpen((current) => !current);
                    setMobileNavigationOpen(false);
                }}
            >
                {section === "practice" ? <CalendarDays /> : <BarChart3 />}
                <span className="mobile-panel-toggle-copy"><strong>{section === "practice" ? "練習計劃與日曆" : "練習摘要"}</strong><small>{section === "practice" ? `${activeSchedules.length} 筆已安排練習` : `${historyAttemptedCount} 題 · 正確率 ${reviewedCount ? `${accuracy}%` : "—"}`}</small></span>
                <ChevronDown className="mobile-panel-chevron" />
            </Button>
            <div id="mobile-summary-panel" className={`summary-panel-content sticky top-6 grid gap-5 ${section === "practice" ? "practice-schedule-panel" : ""}`}>
                {section === "practice" ? renderPracticeSchedules("summary", { compactList: true, showCreate: schedulePanelOpen, showListLink: true, showClose: true }) : <>
                <section className="summary-card" aria-labelledby="summary-title">
                    <div className="summary-card-heading">
                        <div className="flex items-center gap-2"><BarChart3 size={18} /><h2 id="summary-title">練習摘要</h2></div>
                        <Badge className="tag-purple" tone="primary">即時同步</Badge>
                    </div>
                    <div className="summary-plan">
                        <div><span>目前年級</span><strong>{activeLearner.grade}</strong></div>
                        <div><span>目前考試</span><strong>{activeExam.name}</strong></div>
                        <div><span>目標日期</span><strong>{activeExam.date || "尚未設定"}</strong></div>
                        <div><span>剩餘時間</span><strong>{examCountdownLabel || "—"}</strong></div>
                    </div>
                </section>
                <section className="summary-card" aria-labelledby="metrics-title">
                    <div className="summary-card-heading">
                        <div className="flex items-center gap-2"><Target size={18} /><h2 id="metrics-title">學習成果指標</h2></div>
                    </div>
                    <div className="summary-metrics">
                        <div className="summary-metric summary-metric-violet">
                            <div className="summary-metric-icon"><BookOpen size={19} /></div>
                            <div className="min-w-0 flex-1"><p>累計作答</p><strong>{activeAttempts.length} 題</strong></div>
                            <Badge className="tag-purple" tone="primary">總題數</Badge>
                        </div>
                        <div className="summary-metric summary-metric-pink">
                            <div className="summary-metric-icon"><CheckCircle2 size={19} /></div>
                            <div className="min-w-0 flex-1"><p>已檢核正確率</p><strong>{reviewedCount ? `${accuracy}%` : "—"}</strong></div>
                            <Badge className="tag-pink" tone="danger">正確率</Badge>
                        </div>
                        <div className="summary-metric summary-metric-gold">
                            <div className="summary-metric-icon"><Sparkles size={19} /></div>
                            <div className="min-w-0 flex-1"><p>可延伸錯題</p><strong>{recommendableMistakeIds.length} 題</strong></div>
                            <Badge className="tag-gold" tone="warning">依題型</Badge>
                        </div>
                    </div>
                </section>
                <div className="summary-note">
                    <div className="flex items-center gap-2 font-semibold text-foreground"><UserCheck size={16} />資料說明</div>
                    <p>{persistedLearnerId
                        ? "帳號、正式匯入題庫、作答與錯題已連接本機 PostgreSQL；OCR、AI 題目生成與跨帳號分享仍未開放。"
                        : "登入後可讀取正式匯入題庫並保存作答；OCR、AI 題目生成與跨帳號分享仍未開放。"}</p>
                    <div className="flex items-center gap-2"><Clock3 size={15} />{persistedLearnerId ? "作答紀錄保存於 PostgreSQL" : "登入後可讀取正式題庫與作答紀錄"}</div>
                </div>
                </>}
            </div>
        </aside>}
    </div></main>;
}
