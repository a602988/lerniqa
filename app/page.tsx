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
    ChevronDown, ChevronRight, Clock3, FileUp, Flame, GraduationCap, Image as ImageIcon, Library, Link2, LogIn, LogOut, Mail,
    FolderInput, KeyRound, ListChecks, Menu, Pause, Pencil, Plus, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Target, Trash2, UploadCloud, UserCheck, UserPlus, Users, X, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { HandwritingPad } from "./components/handwriting-pad";
import { LerniqaLogo, LerniqaMark } from "./components/lerniqa-mark";
import {
    ACCEPTED_FILE_TYPES, AccountRole, ALL_KNOWLEDGE, ALL_UNITS, ASSESSMENT_OPTIONS, AssessmentRange, Attempt, BOOK_OPTIONS, CheckMode,
    DEFAULT_ASSESSMENT_RANGES, DEFAULT_EXAM_SETTING, DEFAULT_PLAN, ExamSetting, FILE_SIZE_LIMIT, formatAnswer,
    GRADE_OPTIONS, getQuestionKindLabel, getUnitLabel, getUnitScopeValue, ImportBatch, ImportBook, Learner, PlanBasis, PracticePlan, PracticeSession, Question, QuestionBlock, QuestionCollection,
    PlanQuestionKind, QuestionMetadataField, ROLE_OPTIONS, RoleAccess, ScheduledPractice, Section,
    SEMESTER_OPTIONS, StoredState, Subject, SUBJECTS, checkAnswer, DEFAULT_ROLE_ACCESS,
} from "./lib/demo-data";

interface QuestionFlowProps {
    /** 目前題目。 */
    question: Question;
    /** 目前題號。 */
    index: number;
    /** 題目總數。 */
    total: number;
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

interface QuestionLimitControlProps {
    /** 目前題數。 */
    value: number;
    /** 可輸入的最大題數。 */
    maximum?: number;
    /** 是否禁止操作。 */
    disabled?: boolean;
    /** 題數更新事件。 */
    onChange: (value: number) => void;
}

interface QuestionReviewProps {
    /** 目前檢視的題目。 */
    question: Question;
    /** 目前題目在清單中的索引。 */
    index: number;
    /** 清單題目總數。 */
    total: number;
    /** 檢視來源名稱。 */
    title: string;
    /** 答案區下方的來源頁專屬操作。 */
    actions?: ReactNode;
    /** 返回來源頁。 */
    onBack: () => void;
    /** 切換到上一題。 */
    onPrevious: () => void;
    /** 切換到下一題。 */
    onNext: () => void;
}

const CHARACTER_HANDWRITING_LABEL = "寫出國字、注音";
const ANSWER_GRID_FOUR_COLUMN_BYTES = 48;
const ANSWER_GRID_TWO_COLUMN_BYTES = 144;
const AVATAR_FILE_SIZE_LIMIT = 1024 * 1024;
const AVATAR_FILE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MISTAKE_PAGE_SIZE = 10;
const RECENT_IMPORT_LIMIT = 10;
const QUESTION_OVERVIEW_PAGE_SIZE = 12;
const ALL_QUESTION_FILTERS = "all";

/** 顯示練習設定欄位共用的圖示與標題。 */
function PracticeFieldLabel({ icon: Icon, label, className = "" }: PracticeFieldLabelProps) {
    return <span className={`practice-field-label ${className}`}><Icon aria-hidden="true" />{label}</span>;
}

/** 顯示各頁共用的科目篩選按鈕。 */
function SubjectFilter({ subjects, value, className = "", onChange }: SubjectFilterProps) {
    const options: { value: Subject | "全部"; label: string }[] = [
        { value: "全部", label: "全部" },
        ...subjects.map((subject) => ({ value: subject, label: subject })),
    ];

    return (
        <fieldset className={`subject-filter grid gap-2 ${className}`.trim()}>
            <legend><PracticeFieldLabel className="field-dot-violet" icon={Library} label="科目" /></legend>
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

/** 判斷題目是否必須以手寫方式作答並交由 AI 辨識。 */
function isCharacterHandwritingQuestion(question: Question) {
    return question.kind === "written" && question.typeLabel === CHARACTER_HANDWRITING_LABEL;
}

/** 依整題選項的 UTF-8 位元組總長度決定一致的答案欄數。 */
function getAnswerColumnCount(question: Question) {
    const options = question.options ?? [];
    const hasOptionMedia = question.blocks?.some((block) => block.placement === "option" && block.type !== "text");
    if (hasOptionMedia || options.length < 2) return 1;
    const totalBytes = options.reduce((total, option) => total + new TextEncoder().encode(option).length, 0);
    if (options.length >= 4 && totalBytes <= ANSWER_GRID_FOUR_COLUMN_BYTES) return 4;
    if (totalBytes <= ANSWER_GRID_TWO_COLUMN_BYTES) return 2;
    return 1;
}

/** 整理題目可供辨識與篩選的條件，避免來源欄位重複顯示同一單元。 */
function getQuestionConditions(question: Question) {
    const unit = getUnitLabel(question.unit);
    const sourcePath = question.metadata?.find((field) => field.key === "source_path")?.rawValue;
    const sourceType = (question.metadata?.find((field) => field.key === "source_type")?.rawValue
        ?? sourcePath?.split(/[\\/]/)[0]
        ?? question.source.split(" · ").at(-1)
        ?? question.source).replace(/^\d+[\s_-]*/, "");
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
        { label: "來源", value: sourceType },
    ];
    const hiddenMetadata = new Set(["source", "knowledge_point", "source_type", "source_path"]);
    const importedConditions = question.metadata
        ?.filter((field) => !hiddenMetadata.has(field.key))
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

interface BootstrapResponse {
    /** 前端可修改的學習狀態。 */
    state: StoredState;
    /** JSON 題庫資料。 */
    questions: Question[];
    /** 已確認寫入的匯入批次。 */
    imports: ImportBatch[];
}

interface PracticeRecord {
    /** 練習紀錄識別碼。 */
    id: string;
    /** 練習用途。 */
    mode: PracticeSession["mode"];
    /** 該次練習的所有作答。 */
    attempts: Attempt[];
    /** 練習開始時間。 */
    startedAt: string;
    /** 練習結束時間。 */
    completedAt: string;
}

const EMPTY_LEARNER: Learner = {
    id: "",
    name: "",
    grade: "",
    semester: "",
    bookVersions: { 數學: "", 國語: "", 英文: "", 理化: "", 生物: "", 歷史: "", 地理: "", 公民: "" },
    school: "",
    defaultQuestionLimit: 10,
};

const NAV_ITEMS = [
    { id: "overview" as const, label: "總覽", icon: BarChart3 },
    { id: "practice" as const, label: "練習", icon: BookOpen },
    { id: "questions" as const, label: "題目總覽", icon: ListChecks },
    { id: "bank" as const, label: "題庫", icon: Library },
    { id: "mistakes" as const, label: "錯題", icon: Target },
    { id: "results" as const, label: "成果", icon: ClipboardCheck },
    { id: "settings" as const, label: "學習者設定", icon: Settings2 },
];

const SECTION_PATHS: Record<Section, string> = {
    overview: "/overview",
    practice: "/practice",
    questions: "/questions",
    bank: "/bank",
    mistakes: "/mistakes",
    results: "/results",
    settings: "/settings",
};

const SESSION_PATH = "/practice/session";
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
const QUICK_LIMIT_OPTIONS = [5, 10, 15].map((value) => ({ value: String(value), label: `${value} 題` }));
const CUSTOM_IMPORT_VALUE = "__custom__";
const IMPORT_DIFFICULTY_OPTIONS = [
    { value: "", label: "交由 AI 分析" },
    { value: "易", label: "易" },
    { value: "中", label: "中" },
    { value: "難", label: "難" },
];
const PLAN_BASIS_OPTIONS = [
    { value: "chapter", label: "依章節練習" },
    { value: "assessment", label: "依考試練習" },
];
const DEFAULT_DIFFICULTY_MIX: DifficultyMix = DEFAULT_PLAN.difficultyMix;
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
        source: question.source,
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

/** 將作答紀錄依每次練習分組；舊資料以相鄰三十分鐘視為同一次。 */
function getPracticeRecords(attempts: Attempt[]) {
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
            existing.completedAt = attempt.date;
        }
        else {
            records.set(id, { id, mode, attempts: [attempt], startedAt: attempt.date, completedAt: attempt.date });
        }
        if (!attempt.sessionId) previousLegacyTime = attemptTime;
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

/** 將六位數角色密碼轉成不直接保存原文的 SHA-256 雜湊。 */
async function hashRolePin(pin: string) {
    const bytes = new TextEncoder().encode(pin);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** 由目前題目建立可擴充的文件欄位篩選目錄。 */
function getMetadataCatalog(questions: Question[]) {
    const catalog = new Map<string, { key: string; label: string; values: string[] }>();
    questions.forEach((question) => question.metadata?.forEach((field) => {
        const current = catalog.get(field.key) ?? { key: field.key, label: field.label, values: [] };
        current.values = [...new Set([...current.values, ...field.values])].sort((left, right) => left.localeCompare(right, "zh-Hant"));
        catalog.set(field.key, current);
    }));
    return [...catalog.values()];
}

/** 依台北日期計算距離考試的完整天數。 */
function getDayDifference(examDate: string) {
    if (!examDate) return null;
    const today = new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
    const examTimestamp = Date.parse(`${examDate}T00:00:00Z`);
    const todayTimestamp = Date.parse(`${today}T00:00:00Z`);
    return Number.isNaN(examTimestamp) ? null : Math.max(0, Math.ceil((examTimestamp - todayTimestamp) / 86400000));
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

/** 提供常用題數快速選擇與自訂整數輸入。 */
function QuestionLimitControl({ value, maximum, disabled = false, onChange }: QuestionLimitControlProps) {
    const quickValue = QUICK_LIMIT_OPTIONS.some((option) => Number(option.value) === value) ? String(value) : "";
    const options = quickValue
        ? QUICK_LIMIT_OPTIONS
        : [{ value: "", label: `自訂：${value} 題` }, ...QUICK_LIMIT_OPTIONS];

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
function getSubjectsForGrade(grade: string, questions: Question[]) {
    const subjects = new Set(questions
        .filter((question) => !question.generatedFrom && question.grade === grade)
        .map((question) => question.subject));
    if (grade.startsWith("國")) SUBJECTS.forEach((subject) => subjects.add(subject));
    return SUBJECTS.filter((subject) => subjects.has(subject));
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

/** 依題目區塊順序呈現文字與圖片，沒有穿插資料時沿用完整題幹。 */
function QuestionPrompt({ question, className, id, title = false }: { question: Question; className?: string; id?: string; title?: boolean }) {
    const blocks = question.blocks?.filter((block) => block.placement === "prompt")
        .sort((first, second) => first.order - second.order) ?? [];
    const hasInterleavedContent = blocks.filter((block) => block.type === "text" && block.text).length > 1;
    if (!hasInterleavedContent) {
        return <>{title
            ? <CardTitle className={className} id={id}>{question.prompt}</CardTitle>
            : <p className={className} id={id}>{question.prompt}</p>}<ContentImages blocks={question.blocks} placement="prompt" /></>;
    }

    let textIndex = 0;
    return <div className="grid gap-4">{blocks.map((block) => {
        if (block.type === "image" && block.asset) return <ContentImage block={block} key={block.id} />;
        if (block.type !== "text" || !block.text) return null;

        const isFirstText = textIndex === 0;
        textIndex += 1;
        return title && isFirstText
            ? <CardTitle className={className} id={id} key={block.id}>{block.text}</CardTitle>
            : <p className={className} key={block.id}>{block.text}</p>;
    })}</div>;
}

/** 顯示題目總覽與匯入紀錄共用的滿版只讀題目內容。 */
function QuestionReview({ question, index, total, title, actions, onBack, onPrevious, onNext }: QuestionReviewProps) {
    const questionNumber = index >= 0 ? index + 1 : 1;
    const progress = total ? (questionNumber / total) * 100 : 0;
    const conditions = getQuestionConditions(question);
    const answerColumnCount = getAnswerColumnCount(question);

    return <main className="practice-focus-shell question-review-shell">
        <div className="practice-focus-frame">
            <header className="practice-focus-header question-review-header">
                <div className="practice-focus-title flex min-w-0 items-center gap-3">
                    <div className="practice-focus-mark"><LerniqaMark className="h-6 w-6" /></div>
                    <h1 className="truncate text-base font-bold sm:text-lg">{title} · 第 {questionNumber} 題，共 {total} 題</h1>
                </div>
                <div className="practice-focus-actions">
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
                                <dl className="practice-question-conditions" aria-label="題目條件">
                                    {conditions.map((condition) => (
                                        <div className="practice-question-condition" data-wide={condition.label === "來源" || condition.label === "來源文件"} key={`${condition.label}-${condition.value}`}>
                                            <dt>{condition.label}</dt><dd>{condition.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <QuestionPrompt question={question} id={`question-${question.id}-title`} className="mt-3 whitespace-pre-line text-xl leading-relaxed sm:text-2xl" title />
                            </div>
                            {question.kind === "multi-choice" && question.parts?.length ? (
                                <div className="multi-choice-parts">{question.parts.map((part) => (
                                    <div className="multi-choice-part question-review-part" key={part.id}>
                                        <p className="multi-choice-part-prompt">{part.prompt}</p>
                                        <p className="question-review-part-options">{part.options?.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${option}`).join("　")}</p>
                                    </div>
                                ))}</div>
                            ) : question.options?.length ? (
                                <ol className={`question-review-options answer-grid-${answerColumnCount}`} data-answer-columns={answerColumnCount}>
                                    {question.options.map((option, optionIndex) => <li key={`${option}-${optionIndex}`}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</li>)}
                                </ol>
                            ) : null}
                        </section>
                        <aside className="question-review-answer-pane">
                            <div><p className="question-detail-label">參考答案</p><strong>{formatAnswer(question, question.sourceAnswer ?? question.answer)}</strong><ContentImages blocks={question.blocks} placement="answer" /></div>
                            <div><p className="question-detail-label">解析</p><p className="text-sm leading-6 text-muted-foreground">{question.explanation || "尚未提供解析。"}</p></div>
                            <div><p className="question-detail-label">分類與來源</p><p className="text-sm text-muted-foreground">{getUnitLabel(question.unit)} · {question.knowledge}</p><p className="mt-1 text-sm text-muted-foreground">{question.source}</p></div>
                            {actions}
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

/** 顯示尚未連接後端的帳號流程介面。 */
function AuthScreen({ mode }: { mode: AuthMode }) {
    const router = useRouter();
    const [status, setStatus] = useState("");
    const providers = ["LINE", "Facebook", "Google"];
    const titles: Record<AuthMode, { title: string; description: string }> = {
        login: { title: "登入 Lerniqa", description: "使用電子郵件與密碼登入，繼續目前的學習進度。" },
        register: { title: "建立帳號", description: "註冊後可在同一帳號下管理多位學習者。" },
        logout: { title: "登出帳號", description: "登出後，此裝置將回到登入頁。" },
        "forgot-password": { title: "重設密碼", description: "輸入註冊信箱，正式版本會寄送重設連結。" },
        "quick-register": { title: "快速註冊", description: "使用 LINE、Facebook 或 Google 建立帳號。" },
        "account-link": { title: "帳號綁定", description: "將多種登入方式連到同一份帳號與學習資料。" },
    };
    const current = titles[mode];

    /** 顯示介面階段不會送出資料的狀態。 */
    function showDemoStatus(action: string) {
        setStatus(`${action}介面已完成；正式帳號服務尚未連接，不會送出或保存資料。`);
    }

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
                    {status && <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm font-semibold text-primary" role="status">{status}</p>}
                    {mode === "login" && <>
                        <FormField label="電子郵件"><Input type="email" autoComplete="email" placeholder="name@example.com" /></FormField>
                        <FormField label="密碼"><Input type="password" autoComplete="current-password" /></FormField>
                        <Button onClick={() => showDemoStatus("登入")}>登入<LogIn /></Button>
                        <Button appearance="ghost" tone="muted" onClick={() => router.push(AUTH_PATHS["forgot-password"])}>忘記密碼</Button>
                        <div className="auth-divider"><span>或快速註冊</span></div>
                        <div className="grid gap-2 sm:grid-cols-3">{providers.map((provider) => <Button appearance="outline" key={provider} onClick={() => showDemoStatus(`${provider} 快速註冊`)}>{provider} 快速註冊</Button>)}</div>
                    </>}
                    {mode === "register" && <>
                        <FormField label="稱呼"><Input autoComplete="name" placeholder="例如：林小姐" /></FormField>
                        <FormField label="電子郵件"><Input type="email" autoComplete="email" placeholder="name@example.com" /></FormField>
                        <FormField label="密碼" description="至少 8 個字元；正式版本會在後端再次驗證。"><Input type="password" autoComplete="new-password" minLength={8} /></FormField>
                        <Button onClick={() => showDemoStatus("註冊")}>建立帳號<UserPlus /></Button>
                    </>}
                    {mode === "forgot-password" && <>
                        <FormField label="註冊信箱"><Input type="email" autoComplete="email" placeholder="name@example.com" /></FormField>
                        <Button onClick={() => showDemoStatus("寄送重設密碼連結")}>寄送重設連結<Mail /></Button>
                    </>}
                    {mode === "quick-register" && <>
                        <FormField label="使用身份"><NativeSelect options={ROLE_OPTIONS} defaultValue="家長" /></FormField>
                        <div className="grid gap-3">{providers.map((provider) => <Button appearance="outline" className="justify-between" key={provider} onClick={() => showDemoStatus(`${provider} 快速註冊`)}><span>{provider}</span><ArrowRight /></Button>)}</div>
                        <p className="text-sm text-muted-foreground">若服務提供的電子郵件已存在，正式版本會引導登入並綁定，避免建立重複帳號。</p>
                    </>}
                    {mode === "account-link" && <>
                        <div className="workspace-surface rounded-2xl p-4"><p className="text-xs text-muted-foreground">目前帳號</p><p className="mt-1 font-bold">林小姐</p><p className="text-sm text-muted-foreground">parent@example.com</p></div>
                        <div className="grid gap-3">
                            <div className="auth-provider"><div><strong>電子郵件與密碼</strong><p>parent@example.com</p></div><Badge tone="success">已綁定</Badge></div>
                            {providers.map((provider) => <div className="auth-provider" key={provider}><div><strong>{provider}</strong><p>綁定後可使用同一份學習資料登入</p></div><Button appearance="outline" size="sm" onClick={() => showDemoStatus(`綁定 ${provider}`)}><Link2 />綁定</Button></div>)}
                        </div>
                        <Button appearance="outline" tone="danger" onClick={() => router.push(AUTH_PATHS.logout)}><LogOut />登出目前帳號</Button>
                    </>}
                    {mode === "logout" && <div className="grid gap-5 text-center"><div className="auth-logout-icon"><LogOut /></div><div><p className="font-bold">要登出目前帳號嗎？</p><p className="mt-1 text-sm text-muted-foreground">本機示範資料不會被刪除。</p></div><Button onClick={() => router.push(AUTH_PATHS.login)}>登出並返回登入</Button></div>}
                    <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-5 text-sm">
                        {mode !== "login" && <Button appearance="ghost" tone="muted" size="sm" onClick={() => router.push(AUTH_PATHS.login)}>登入</Button>}
                        {mode !== "register" && <Button appearance="ghost" tone="muted" size="sm" onClick={() => router.push(AUTH_PATHS.register)}>註冊</Button>}
                        {mode !== "quick-register" && <Button appearance="ghost" tone="muted" size="sm" onClick={() => router.push(AUTH_PATHS["quick-register"])}>快速註冊</Button>}
                    </div>
                </CardContent>
            </Card>
        </main>
    );
}

/** 顯示單題作答及手寫區。 */
function QuestionFlow(props: QuestionFlowProps) {
    const { question, index, total, checkMode, answer, handwriting, feedback } = props;
    const needsCharacterRecognition = isCharacterHandwritingQuestion(question);
    const answerColumnCount = getAnswerColumnCount(question);
    const questionConditions = getQuestionConditions(question);
    const isLast = index === total - 1;
    let selectedAnswers: string[] = [];
    if (question.parts?.length) {
        try {
            const parsed = JSON.parse(answer) as unknown;
            if (Array.isArray(parsed)) selectedAnswers = parsed.map(String);
        }
        catch {
            selectedAnswers = [];
        }
    }
    const canSubmit = question.kind === "written"
        ? needsCharacterRecognition
            ? Boolean(handwriting)
            : question.parts?.length
                ? selectedAnswers.length === question.parts.length && selectedAnswers.every(Boolean) || Boolean(handwriting)
                : Boolean(answer.trim() || handwriting)
        : question.kind === "multi-choice"
            ? Boolean(question.parts?.length && selectedAnswers.length === question.parts.length && selectedAnswers.every(Boolean))
            : Boolean(answer.trim());
    return (
        <Card className="practice-question-card overflow-hidden border-border/80 shadow-sm">
            <CardContent className="practice-question-layout bg-white p-4">
                <section className="practice-question-pane" aria-labelledby={`question-${question.id}-title`}>
                    <div className="practice-prompt">
                        <dl className="practice-question-conditions" aria-label="題目條件">
                            {questionConditions.map((condition) => (
                                <div className="practice-question-condition" data-wide={condition.label === "來源" || condition.label === "來源文件"} key={`${condition.label}-${condition.value}`}>
                                    <dt>{condition.label}</dt><dd>{condition.value}</dd>
                                </div>
                            ))}
                        </dl>
                        <QuestionPrompt question={question} id={`question-${question.id}-title`} className="mt-3 whitespace-pre-line text-xl leading-relaxed sm:text-2xl" title />
                    </div>
                    {question.kind === "written" ? needsCharacterRecognition ? null : question.parts?.length ? (
                        <div className="written-answer-parts">
                            {question.parts.map((part, partIndex) => {
                                const isNamedPoint = /^[A-Z]$/i.test(part.id);
                                return (
                                    <FormField
                                        key={part.id}
                                        label={isNamedPoint ? part.id.toUpperCase() : `第 ${partIndex + 1} 空`}
                                        description={isNamedPoint ? undefined : part.prompt}
                                    >
                                        <Input
                                            value={selectedAnswers[partIndex] ?? ""}
                                            disabled={Boolean(feedback)}
                                            placeholder="輸入答案"
                                            autoComplete="off"
                                            autoCorrect="off"
                                            autoCapitalize="none"
                                            spellCheck={false}
                                            onChange={(event) => {
                                                const nextAnswers = Array.from({ length: question.parts?.length ?? 0 }, (_, answerIndex) => selectedAnswers[answerIndex] ?? "");
                                                nextAnswers[partIndex] = event.target.value;
                                                props.onAnswer(JSON.stringify(nextAnswers));
                                            }}
                                        />
                                    </FormField>
                                );
                            })}
                        </div>
                    ) : (
                        <FormField label="文字答案（選填）" description="可以直接手寫；目前尚未連接 AI 辨識，只有文字答案會立即檢核。">
                            <Input value={answer} disabled={Boolean(feedback)} placeholder="也可以只使用右側手寫板作答" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} onChange={(event) => props.onAnswer(event.target.value)} />
                        </FormField>
                    ) : question.kind === "multi-choice" ? (
                        <div className="multi-choice-parts">
                            {question.parts?.map((part, partIndex) => (
                                <div className="multi-choice-part" key={part.id}>
                                    <p className="multi-choice-part-prompt">{part.prompt}</p>
                                    <NativeSelect
                                        aria-label={`第 ${partIndex + 1} 小題答案`}
                                        disabled={Boolean(feedback)}
                                        options={[
                                            { value: "", label: "選擇答案" },
                                            ...(part.options ?? []).map((option) => ({ value: option, label: option })),
                                        ]}
                                        value={selectedAnswers[partIndex] ?? ""}
                                        onChange={(event) => {
                                            const answerCount = question.parts?.length ?? 0;
                                            const nextAnswers = Array.from({ length: answerCount }, (_, answerIndex) => selectedAnswers[answerIndex] ?? "");
                                            nextAnswers[partIndex] = event.target.value;
                                            props.onAnswer(JSON.stringify(nextAnswers));
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <fieldset className={`answer-grid answer-grid-${answerColumnCount}`} data-answer-columns={answerColumnCount} disabled={Boolean(feedback)}><legend className="mb-1 text-sm font-semibold">選擇答案</legend>
                            {question.options?.map((option) => <label className="answer-option" key={option}><Radio name={`question-${question.id}`} value={option} checked={answer === option} onChange={() => props.onAnswer(option)} /><span>{option}</span></label>)}
                        </fieldset>
                    )}
                    {feedback && <div className={`rounded-2xl border p-4 ${feedback.correct === true ? "border-emerald-200 bg-emerald-50" : feedback.correct === false ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`} role="status">
                        <div className="flex items-center gap-2 font-bold">{feedback.correct === true ? <CheckCircle2 className="text-emerald-700" /> : feedback.correct === false ? <XCircle className="text-rose-700" /> : <Clock3 className="text-amber-700" />}{feedback.correct === true ? "答對了" : feedback.correct === false ? `答錯了。正確答案：${formatAnswer(question, question.answer)}` : needsCharacterRecognition ? "手寫內容已保存，等待 AI 辨識" : "手寫內容已保存，等待檢視"}</div>
                        {feedback.correct !== null && <ContentImages blocks={question.blocks} placement="answer" />}
                        {feedback.correct !== null && <p className="mt-2 text-sm text-muted-foreground">{question.explanation}</p>}
                    </div>}
                </section>
                <aside className="practice-handwriting-pane">
                    <HandwritingPad value={handwriting} disabled={Boolean(feedback)} recognitionStatus={needsCharacterRecognition ? "尚未連接" : undefined} onChange={props.onHandwriting} />
                </aside>
                <div className="practice-question-actions">{feedback
                    ? <Button onClick={props.onNext}>{isLast ? "查看結果" : "下一題"}<ArrowRight /></Button>
                    : <Button disabled={!canSubmit} onClick={props.onSubmit}>{checkMode === "instant" ? "檢查答案" : isLast ? checkMode === "score" ? "完成並看成績" : "完成並檢核" : "儲存並到下一題"}<ArrowRight /></Button>}
                </div>
            </CardContent>
        </Card>
    );
}

/** Lerniqa 完整前端模擬首頁。 */
export default function Home() {
    const pathname = usePathname();
    const router = useRouter();
    const [learners, setLearners] = useState<Learner[]>([]);
    const [activeLearnerId, setActiveLearnerId] = useState("");
    const [attemptsByLearner, setAttemptsByLearner] = useState<Record<string, Attempt[]>>({});
    const [plansByLearner, setPlansByLearner] = useState<Record<string, PracticePlan>>({});
    const [schedulesByLearner, setSchedulesByLearner] = useState<Record<string, ScheduledPractice[]>>({});
    const [queuedSimilarByLearner, setQueuedSimilarByLearner] = useState<Record<string, number[]>>({});
    const [questionCollectionsByLearner, setQuestionCollectionsByLearner] = useState<Record<string, QuestionCollection[]>>({});
    const [roleAccess, setRoleAccess] = useState<RoleAccess>(DEFAULT_ROLE_ACCESS);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [imports, setImports] = useState<ImportBatch[]>([]);
    const [importBooks, setImportBooks] = useState<ImportBook[]>([]);
    const [section, setSection] = useState<Section>("overview");
    const [session, setSession] = useState<PracticeSession>();
    const [sessionPaused, setSessionPaused] = useState(false);
    const [sessionExitOpen, setSessionExitOpen] = useState(false);
    const [answer, setAnswer] = useState("");
    const [handwriting, setHandwriting] = useState("");
    const [mistakeSubject, setMistakeSubject] = useState<Subject | "全部">("全部");
    const [mistakeScope, setMistakeScope] = useState(ALL_UNITS);
    const [mistakePage, setMistakePage] = useState(1);
    const [mistakeRankingView, setMistakeRankingView] = useState<"personal" | "community">("personal");
    const [selectedMistakes, setSelectedMistakes] = useState<number[]>([]);
    const [questionSubject, setQuestionSubject] = useState<Subject | "全部">("全部");
    const [questionVersion, setQuestionVersion] = useState(ALL_QUESTION_FILTERS);
    const [questionScope, setQuestionScope] = useState(ALL_UNITS);
    const [questionKind, setQuestionKind] = useState(ALL_QUESTION_FILTERS);
    const [questionSource, setQuestionSource] = useState(ALL_QUESTION_FILTERS);
    const [questionCollection, setQuestionCollection] = useState(ALL_QUESTION_FILTERS);
    const [questionSearch, setQuestionSearch] = useState("");
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
    const [resetArmed, setResetArmed] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const [storageError, setStorageError] = useState("");
    const [avatarError, setAvatarError] = useState("");
    const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
    const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
    const [roleDialogOpen, setRoleDialogOpen] = useState(false);
    const [requestedRole, setRequestedRole] = useState<AccountRole>(DEFAULT_ROLE_ACCESS.activeRole);
    const [rolePin, setRolePin] = useState("");
    const [roleStatus, setRoleStatus] = useState("");
    const [roleResetOpen, setRoleResetOpen] = useState(false);
    const [roleEmail, setRoleEmail] = useState("");
    const [roleCode, setRoleCode] = useState("");
    const [newRolePin, setNewRolePin] = useState("");
    const [roleCodeSent, setRoleCodeSent] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
    const sessionHeadingRef = useRef<HTMLHeadingElement>(null);
    const shouldFocusSectionRef = useRef(false);
    const skipNextApiWriteRef = useRef(true);
    const questionOverviewScrollRef = useRef(0);
    const shouldRestoreQuestionScrollRef = useRef(false);

    const activeLearner = learners.find((learner) => learner.id === activeLearnerId) ?? learners[0] ?? EMPTY_LEARNER;
    const storedPlan = plansByLearner[activeLearnerId];
    const activePlan: PracticePlan = {
        ...DEFAULT_PLAN,
        ...storedPlan,
        examSettings: storedPlan?.examSettings?.length ? storedPlan.examSettings : DEFAULT_PLAN.examSettings,
        activeExamId: storedPlan?.activeExamId ?? DEFAULT_PLAN.activeExamId,
        difficultyMix: { ...DEFAULT_DIFFICULTY_MIX, ...storedPlan?.difficultyMix },
        sourceFilters: storedPlan?.sourceFilters ?? DEFAULT_PLAN.sourceFilters,
        questionKind: storedPlan?.questionKind ?? DEFAULT_PLAN.questionKind,
        knowledge: storedPlan?.knowledge ?? DEFAULT_PLAN.knowledge,
        metadataFilters: storedPlan?.metadataFilters ?? DEFAULT_PLAN.metadataFilters,
    };
    const activeExam = activePlan.examSettings.find((exam) => exam.id === activePlan.activeExamId)
        ?? activePlan.examSettings[0]
        ?? DEFAULT_EXAM_SETTING;
    const activePlanBasis = activePlan.basis;
    const activeDifficultyMix = activePlan.difficultyMix;
    const difficultyTotal = activeDifficultyMix.easy + activeDifficultyMix.medium + activeDifficultyMix.hard;
    const activeAttempts = attemptsByLearner[activeLearnerId] ?? [];
    const practiceStreak = useMemo(() => getPracticeStreak(activeAttempts), [activeAttempts]);
    const activeQueue = queuedSimilarByLearner[activeLearnerId] ?? [];
    const activeSchedules = useMemo(() => [...(schedulesByLearner[activeLearnerId] ?? [])]
        .sort((left, right) => `${left.date}T${left.time ?? "23:59"}`.localeCompare(`${right.date}T${right.time ?? "23:59"}`)), [activeLearnerId, schedulesByLearner]);
    const isScheduleListPage = pathname === PRACTICE_SCHEDULES_PATH;
    const baseQuestions = useMemo(() => questions.filter((question) => !question.generatedFrom), [questions]);
    const learnerQuestions = useMemo(() => baseQuestions.filter((question) => question.grade === activeLearner.grade), [activeLearner.grade, baseQuestions]);
    const availableSubjects = useMemo(() => getSubjectsForGrade(activeLearner.grade, questions), [activeLearner.grade, questions]);
    const activeQuestionCollections = useMemo(
        () => questionCollectionsByLearner[activeLearnerId] ?? [],
        [activeLearnerId, questionCollectionsByLearner],
    );
    const questionVersionOptions = useMemo(() => [
        { value: ALL_QUESTION_FILTERS, label: "全部版本" },
        ...[...new Set(learnerQuestions.map((question) => question.bookVersion).filter((version): version is string => Boolean(version)))]
            .map((version) => ({ value: version, label: version })),
    ], [learnerQuestions]);
    const questionScopeOptions = useMemo(() => {
        const candidates = learnerQuestions
            .filter((question) => questionSubject === "全部" || question.subject === questionSubject)
            .filter((question) => questionVersion === ALL_QUESTION_FILTERS || question.bookVersion === questionVersion);
        const scopes = new Map(candidates.map((question) => [
            getUnitScopeValue(question),
            questionSubject === "全部" ? `${question.subject} · ${getUnitLabel(question.unit)}` : getUnitLabel(question.unit),
        ]));
        return [{ value: ALL_UNITS, label: "全部單元" }, ...[...scopes].map(([value, label]) => ({ value, label }))];
    }, [learnerQuestions, questionSubject, questionVersion]);
    const questionSourceOptions = useMemo(() => [
        { value: ALL_QUESTION_FILTERS, label: "全部來源" },
        ...[...new Set(learnerQuestions.map((question) => question.source))].map((source) => ({ value: source, label: source })),
    ], [learnerQuestions]);
    const questionCollectionOptions = useMemo(() => [
        { value: ALL_QUESTION_FILTERS, label: "全部題目" },
        ...activeQuestionCollections.map((collection) => ({ value: collection.id, label: `${collection.name}（${collection.questionIds.length}）` })),
    ], [activeQuestionCollections]);
    const filteredOverviewQuestions = useMemo(() => {
        const collectionIds = activeQuestionCollections.find((collection) => collection.id === questionCollection)?.questionIds;
        const keyword = questionSearch.trim().toLocaleLowerCase();
        return learnerQuestions
            .filter((question) => questionSubject === "全部" || question.subject === questionSubject)
            .filter((question) => questionVersion === ALL_QUESTION_FILTERS || question.bookVersion === questionVersion)
            .filter((question) => questionScope === ALL_UNITS || getUnitScopeValue(question) === questionScope)
            .filter((question) => questionKind === ALL_QUESTION_FILTERS || question.kind === questionKind)
            .filter((question) => questionSource === ALL_QUESTION_FILTERS || question.source === questionSource)
            .filter((question) => !collectionIds || collectionIds.includes(question.id))
            .filter((question) => !keyword || [question.code, question.prompt, question.knowledge, question.topic, question.source]
                .some((value) => value?.toLocaleLowerCase().includes(keyword)));
    }, [activeQuestionCollections, learnerQuestions, questionCollection, questionKind, questionScope, questionSearch, questionSource, questionSubject, questionVersion]);
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
    const activeSubject = SUBJECTS.find((subject) => subject === activePlan.subject);
    const activeBookVersion = activeSubject
        ? activePlan.bookVersion ?? activeLearner.bookVersions[activeSubject]
        : "";
    const bookVersionOptions = useMemo(() => {
        if (!activeSubject) return [{ value: "", label: "依各科學習者設定" }];
        const versions = new Set([
            ...BOOK_OPTIONS.map((option) => option.value),
            ...learnerQuestions
            .filter((question) => question.subject === activeSubject)
            .map((question) => question.bookVersion)
            .filter((version): version is string => Boolean(version)),
        ]);
        versions.add(activeLearner.bookVersions[activeSubject]);
        return [...versions].map((version) => ({ value: version, label: version }));
    }, [activeLearner.bookVersions, activeSubject, learnerQuestions]);
    const versionedLearnerQuestions = useMemo(() => learnerQuestions.filter((question) => {
        const configuredVersion = activePlan.subject === question.subject && activePlan.bookVersion
            ? activePlan.bookVersion
            : activeLearner.bookVersions[question.subject];
        return !question.bookVersion || question.bookVersion === configuredVersion;
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
    const scopedQuestions = useMemo(() => versionedLearnerQuestions
        .filter((question) => activePlan.subject === "全部" || question.subject === activePlan.subject)
        .filter((question) => {
            if (activePlanBasis === "chapter") return activePlan.scope === ALL_UNITS || getUnitScopeValue(question) === activePlan.scope;
            const options = assessmentOptionsBySubject[question.subject] ?? [];
            const storedRange = activeExam.ranges[question.subject] ?? DEFAULT_ASSESSMENT_RANGES[question.subject];
            const start = options.some((option) => option.value === storedRange.start) ? storedRange.start : options[0]?.value;
            const end = options.some((option) => option.value === storedRange.end) ? storedRange.end : options.at(-1)?.value;
            const questionIndex = options.findIndex((option) => option.value === getUnitScopeValue(question));
            const startIndex = options.findIndex((option) => option.value === start);
            const endIndex = options.findIndex((option) => option.value === end);
            return questionIndex >= Math.min(startIndex, endIndex) && questionIndex <= Math.max(startIndex, endIndex);
        }), [activeExam.ranges, activePlan.scope, activePlan.subject, activePlanBasis, assessmentOptionsBySubject, versionedLearnerQuestions]);
    const sourceOptions = useMemo(() => [...new Set(scopedQuestions.map((question) => question.source))], [scopedQuestions]);
    const metadataCatalog = useMemo(() => getMetadataCatalog(scopedQuestions), [scopedQuestions]);
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
    const knowledgeOptions = useMemo(() => [
        { value: ALL_KNOWLEDGE, label: "全部知識點" },
        ...[...new Set(scopedQuestions.map((question) => question.knowledge))].map((value) => ({ value, label: value })),
    ], [scopedQuestions]);
    const eligibleQuestions = useMemo(() => scopedQuestions
        .filter((question) => !activePlan.sourceFilters.length || activePlan.sourceFilters.includes(question.source))
        .filter((question) => activePlan.questionKind === "all" || question.kind === activePlan.questionKind)
        .filter((question) => activePlan.knowledge === ALL_KNOWLEDGE || question.knowledge === activePlan.knowledge)
        .filter((question) => Object.entries(activePlan.metadataFilters).every(([key, values]) => !values.length
            || question.metadata?.some((field) => field.key === key && field.values.some((value) => values.includes(value))))), [activePlan.knowledge, activePlan.metadataFilters, activePlan.questionKind, activePlan.sourceFilters, scopedQuestions]);
    const plannedQuestions = useMemo(() => eligibleQuestions.slice(0, activePlan.questionLimit), [activePlan.questionLimit, eligibleQuestions]);
    const latestAttempts = useMemo(() => getLatestAttempts(activeAttempts), [activeAttempts]);
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
    const practiceRecords = useMemo(() => getPracticeRecords(activeAttempts), [activeAttempts]);
    const mistakeQuestions = useMemo(() => {
        const wrongCounts = activeAttempts.reduce<Map<number, number>>((counts, attempt) => {
            if (attempt.correct !== false) return counts;
            counts.set(attempt.questionId, (counts.get(attempt.questionId) ?? 0) + 1);
            return counts;
        }, new Map());
        return latestAttempts.filter((attempt) => attempt.correct === false)
            .map((attempt) => questions.find((question) => question.id === attempt.questionId))
            .filter((question): question is Question => Boolean(question))
            .sort((left, right) => (wrongCounts.get(right.id) ?? 0) - (wrongCounts.get(left.id) ?? 0));
    }, [activeAttempts, latestAttempts, questions]);
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
    const mistakeScopeOptions = useMemo(() => {
        const subjectQuestions = mistakeSubject === "全部"
            ? rankingQuestions
            : rankingQuestions.filter((question) => question.subject === mistakeSubject);
        const scopes = new Map(subjectQuestions.map((question) => [
            getUnitScopeValue(question),
            mistakeSubject === "全部" ? `${question.subject} · ${getUnitLabel(question.unit)}` : getUnitLabel(question.unit),
        ]));
        return [{ value: ALL_UNITS, label: "全部單元" }, ...[...scopes].map(([value, label]) => ({ value, label }))];
    }, [mistakeSubject, rankingQuestions]);
    const visibleMistakeQuestions = useMemo(() => mistakeQuestions
        .filter((question) => mistakeSubject === "全部" || question.subject === mistakeSubject)
        .filter((question) => mistakeScope === ALL_UNITS || getUnitScopeValue(question) === mistakeScope), [mistakeQuestions, mistakeScope, mistakeSubject]);
    const visibleCommunityMistakeRows = useMemo(() => communityMistakeRows
        .filter(({ question }) => mistakeSubject === "全部" || question.subject === mistakeSubject)
        .filter(({ question }) => mistakeScope === ALL_UNITS || getUnitScopeValue(question) === mistakeScope), [communityMistakeRows, mistakeScope, mistakeSubject]);
    const mistakeResultCount = mistakeRankingView === "personal" ? visibleMistakeQuestions.length : visibleCommunityMistakeRows.length;
    const mistakePageCount = Math.max(1, Math.ceil(mistakeResultCount / MISTAKE_PAGE_SIZE));
    const activeMistakePage = Math.min(mistakePage, mistakePageCount);
    const pagedMistakeQuestions = visibleMistakeQuestions.slice((activeMistakePage - 1) * MISTAKE_PAGE_SIZE, activeMistakePage * MISTAKE_PAGE_SIZE);
    const pagedCommunityMistakeRows = visibleCommunityMistakeRows.slice((activeMistakePage - 1) * MISTAKE_PAGE_SIZE, activeMistakePage * MISTAKE_PAGE_SIZE);
    const reviewedAttempts = activeAttempts.filter((attempt) => attempt.correct !== null);
    const correctCount = reviewedAttempts.filter((attempt) => attempt.correct === true).length;
    const accuracy = reviewedAttempts.length ? Math.round((correctCount / reviewedAttempts.length) * 100) : 0;
    const usableQueue = activeQueue.filter((id) => questions.some((question) => question.id === id && question.generatedFrom && question.grade === activeLearner.grade));
    const currentQuestion = session ? questions.find((question) => question.id === session.questionIds[session.index]) : undefined;
    const sessionQuestionLabel = getSessionQuestionLabel(currentQuestion, session, questions);
    const currentFeedback = currentQuestion && session?.checkMode === "instant" ? session.attempts.find((attempt) => attempt.questionId === currentQuestion.id) : undefined;
    const planSubjectLabel = activeSubject
        ? `${activeSubject} · ${activeBookVersion}版`
        : "全部科目";

    useEffect(() => {
        let active = true;

        async function loadBootstrap() {
            try {
                const response = await fetch("/api/v1/bootstrap", { cache: "no-store" });
                if (!response.ok) throw new Error("BOOTSTRAP_FAILED");
                const payload = await response.json() as { data: BootstrapResponse };
                if (!active) return;
                const { state, questions: loadedQuestions, imports: loadedImports } = payload.data;
                setLearners(state.learners);
                setActiveLearnerId(state.activeLearnerId);
                setAttemptsByLearner(state.attemptsByLearner);
                setPlansByLearner(state.plansByLearner);
                setSchedulesByLearner(state.schedulesByLearner);
                setQueuedSimilarByLearner(state.queuedSimilarByLearner);
                setQuestionCollectionsByLearner(state.questionCollectionsByLearner);
                setRoleAccess(state.roleAccess);
                setImportBooks(state.importBooks);
                setQuestions(loadedQuestions);
                setImports(loadedImports);
                setStorageError("");
            }
            catch {
                if (active) setStorageError("無法讀取 JSON 模擬 API，請確認本機開發服務仍在運作。");
            }
            finally {
                if (active) setIsHydrated(true);
            }
        }

        loadBootstrap();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!isHydrated || !learners.length || !questions.length) return;
        if (skipNextApiWriteRef.current) {
            skipNextApiWriteRef.current = false;
            return;
        }
        const state: StoredState = { learners, activeLearnerId, attemptsByLearner, plansByLearner, schedulesByLearner, queuedSimilarByLearner, questionCollectionsByLearner, roleAccess, importBooks };
        const timeout = window.setTimeout(async () => {
            try {
                const response = await fetch("/api/v1/state", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(state),
                });
                if (!response.ok) throw new Error("STATE_WRITE_FAILED");
                setStorageError("");
            }
            catch {
                setStorageError("JSON 模擬 API 無法保存最新資料；請先不要重新整理頁面。");
            }
        }, 250);
        return () => window.clearTimeout(timeout);
    }, [activeLearnerId, attemptsByLearner, importBooks, isHydrated, learners, plansByLearner, questionCollectionsByLearner, questions.length, queuedSimilarByLearner, roleAccess, schedulesByLearner]);

    useEffect(() => {
        setImportGrade(activeLearner.grade);
        setMistakeSubject("全部");
        setMistakeScope(ALL_UNITS);
        setMistakePage(1);
        setSelectedMistakes([]);
        setQuestionSubject("全部");
        setQuestionVersion(ALL_QUESTION_FILTERS);
        setQuestionScope(ALL_UNITS);
        setQuestionKind(ALL_QUESTION_FILTERS);
        setQuestionSource(ALL_QUESTION_FILTERS);
        setQuestionCollection(ALL_QUESTION_FILTERS);
        setQuestionSearch("");
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
        if (!targetCollectionId || activeQuestionCollections.some((collection) => collection.id === targetCollectionId)) return;
        setTargetCollectionId(activeQuestionCollections[0]?.id ?? "");
    }, [activeQuestionCollections, targetCollectionId]);

    useEffect(() => {
        if (questionScope === ALL_UNITS || questionScopeOptions.some((option) => option.value === questionScope)) return;
        setQuestionScope(ALL_UNITS);
        setQuestionPage(1);
        setSelectedQuestionIds([]);
    }, [questionScope, questionScopeOptions]);

    useEffect(() => {
        if (!selectedImportBookId || availableImportBooks.some((book) => book.id === selectedImportBookId)) return;
        setSelectedImportBookId("");
    }, [availableImportBooks, selectedImportBookId]);
    useEffect(() => {
        if (mistakeScope === ALL_UNITS || mistakeScopeOptions.some((option) => option.value === mistakeScope)) return;
        setMistakeScope(ALL_UNITS);
        setMistakePage(1);
    }, [mistakeScope, mistakeScopeOptions]);
    useEffect(() => {
        if (activePlan.subject === "全部" || availableSubjects.includes(activePlan.subject as Subject)) return;
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), subject: "全部", scope: ALL_UNITS },
        }));
    }, [activeLearnerId, activePlan.subject, availableSubjects]);
    useEffect(() => {
        if (!isHydrated || !learners.length || !questions.length) return;
        const browserPath = pathname;
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
            const routeQuestion = questions.find((question) => question.id === routeQuestionId);
            if (!routeQuestion) {
                router.replace(SECTION_PATHS.practice);
                return;
            }
            const routeQuestionIds = getQuestionGroupIds(routeQuestion, questions);
            const routeQuestionIndex = routeQuestionIds.indexOf(routeQuestionId);
            setSection("practice");
            setSessionPaused(false);
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
    }, [activeLearnerId, isHydrated, learnerQuestions, learners.length, pathname, questions, router]);
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

    /** 確認是否可以離開尚未完成的練習。 */
    function canLeaveSession() {
        if (!session || session.phase === "complete") return true;
        const hasProgress = Boolean(answer.trim() || handwriting || session.attempts.length);
        return !hasProgress || window.confirm("這一輪還沒完成，離開會遺失尚未送出的答案與手寫內容。確定要離開嗎？");
    }

    /** 清除目前練習與暫存輸入。 */
    function clearSession() {
        setSession(undefined);
        setSessionPaused(false);
        setSessionExitOpen(false);
        setAnswer("");
        setHandwriting("");
    }

    /** 切換主要工作區並保護進行中的作答。 */
    function navigateToSection(nextSection: Section) {
        setMobileNavigationOpen(false);
        if (nextSection === section && pathname === SECTION_PATHS[nextSection]) return;
        if (session && sessionPaused) {
            shouldFocusSectionRef.current = true;
            setSection(nextSection);
            router.push(SECTION_PATHS[nextSection]);
            return;
        }
        if (!canLeaveSession()) return;
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
    function openScheduleList() {
        setScheduleDialogOpen(false);
        setSchedulePanelOpen(false);
        setMobileNavigationOpen(false);
        router.push(PRACTICE_SCHEDULES_PATH);
    }

    /** 切換學習者並保護進行中的作答。 */
    function changeLearner(nextLearnerId: string) {
        if (nextLearnerId === activeLearnerId || !canLeaveSession()) return;
        clearSession();
        setActiveLearnerId(nextLearnerId);
        setMobileNavigationOpen(false);
    }

    /** 開啟角色切換並清除上一次輸入。 */
    function openRoleSwitch() {
        setRequestedRole(roleAccess.activeRole);
        setRolePin("");
        setRoleStatus("");
        setRoleResetOpen(false);
        setRoleEmail(roleAccess.registrationEmail);
        setRoleCode("");
        setNewRolePin("");
        setRoleCodeSent(false);
        setRoleDialogOpen(true);
    }

    /** 驗證角色密碼後切換目前操作角色。 */
    async function switchRole() {
        if (requestedRole === roleAccess.activeRole) {
            setRoleDialogOpen(false);
            return;
        }
        if (!roleAccess.learnerIdsByRole[requestedRole].includes(activeLearnerId)) {
            setRoleStatus(`「${requestedRole}」尚未被設定為可管理${activeLearner.name}。`);
            return;
        }
        if (requestedRole !== "學習者") {
            if (!/^\d{6}$/.test(rolePin)) {
                setRoleStatus("角色密碼必須是 6 位數字。");
                return;
            }
            const expected = roleAccess.pinHashes[requestedRole];
            if (!expected || await hashRolePin(rolePin) !== expected) {
                setRoleStatus("角色密碼不正確。");
                return;
            }
        }
        setRoleAccess((current) => ({ ...current, activeRole: requestedRole }));
        setRoleDialogOpen(false);
    }

    /** 更新角色可以管理的學習者，不改變目前選取的學習者。 */
    function updateRoleLearner(role: AccountRole, learnerId: string, checked: boolean) {
        setRoleAccess((current) => {
            const assigned = current.learnerIdsByRole[role];
            const learnerIds = checked ? [...new Set([...assigned, learnerId])] : assigned.filter((id) => id !== learnerId);
            return { ...current, learnerIdsByRole: { ...current.learnerIdsByRole, [role]: learnerIds } };
        });
    }

    /** 模擬向註冊信箱寄送角色密碼驗證碼。 */
    function sendRoleCode() {
        if (roleEmail.trim().toLocaleLowerCase() !== roleAccess.registrationEmail.toLocaleLowerCase()) {
            setRoleStatus("輸入的信箱與註冊信箱不符。");
            return;
        }
        setRoleCodeSent(true);
        setRoleStatus("示範驗證碼為 246810；目前尚未連接郵件服務。");
    }

    /** 驗證信箱代碼並更新指定角色的六位數密碼。 */
    async function resetRolePin() {
        if (roleCode !== "246810") {
            setRoleStatus("驗證碼不正確。");
            return;
        }
        if (!/^\d{6}$/.test(newRolePin)) {
            setRoleStatus("新角色密碼必須是 6 位數字。");
            return;
        }
        const pinHash = await hashRolePin(newRolePin);
        setRoleAccess((current) => ({ ...current, pinHashes: { ...current.pinHashes, [requestedRole]: pinHash } }));
        setRolePin("");
        setRoleCode("");
        setNewRolePin("");
        setRoleCodeSent(false);
        setRoleResetOpen(false);
        setRoleStatus("角色密碼已更新，請使用新密碼切換角色。");
    }

    /** 更新目前學習者資料。 */
    function updateLearner<K extends keyof Omit<Learner, "id">>(field: K, value: Learner[K]) {
        if (field === "grade" && value !== activeLearner.grade) {
            if (!canLeaveSession()) return;
            clearSession();
            const nextSubjects = getSubjectsForGrade(String(value), questions);
            const nextSubject = activePlan.subject === "全部" || nextSubjects.includes(activePlan.subject as Subject)
                ? activePlan.subject
                : "全部";
            setPlansByLearner((current) => ({
                ...current,
                [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), subject: nextSubject, scope: ALL_UNITS },
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
                scope: ALL_UNITS,
                sourceFilters: [],
                knowledge: ALL_KNOWLEDGE,
                metadataFilters: {},
            }
            : field === "bookVersion"
                ? { scope: ALL_UNITS, sourceFilters: [], knowledge: ALL_KNOWLEDGE, metadataFilters: {} }
                : field === "scope" || field === "examSettings"
                ? { sourceFilters: [], knowledge: ALL_KNOWLEDGE, metadataFilters: {} }
                : {};
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: { ...(current[activeLearnerId] ?? DEFAULT_PLAN), creatorRole: roleAccess.activeRole, [field]: value, ...dependentReset },
        }));
    }

    /** 取得目前練習設定在排程清單中使用的範圍摘要。 */
    function getCurrentPlanScopeLabel() {
        if (activePlanBasis === "chapter") {
            if (activePlan.scope === ALL_UNITS) return "全部單元";
            return activePlan.scope.split("::")[1] ?? scopeOptions.find((option) => option.value === activePlan.scope)?.label ?? "全部單元";
        }
        if (activePlan.subject === "全部") return `${activeExam.name} · ${availableSubjects.length} 科範圍`;
        const subject = activePlan.subject as Subject;
        const options = assessmentOptionsBySubject[subject] ?? [];
        const range = getAssessmentRange(activeExam, subject);
        const start = options.find((option) => option.value === range.start)?.label ?? "尚未設定";
        const end = options.find((option) => option.value === range.end)?.label ?? "尚未設定";
        const rangeLabel = start === end ? start : `${start}～${end}`;
        return `${activeExam.name} · ${rangeLabel}`;
    }

    /** 將目前出題設定保存為指定學習者的預約練習。 */
    function addScheduledPractice() {
        if (!scheduleDate || !plannedQuestions.length || difficultyTotal !== 100) return;
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
        if (isScheduledPracticeLocked(schedule) || !plannedQuestions.length || difficultyTotal !== 100) return;
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
        const storedRange = exam.ranges[subject] ?? DEFAULT_ASSESSMENT_RANGES[subject];
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
            ranges: Object.fromEntries(SUBJECTS.map((subject) => [subject, { ...DEFAULT_ASSESSMENT_RANGES[subject] }])) as Record<Subject, AssessmentRange>,
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

    /** 切換進階設定中的指定題目來源。 */
    function togglePlanSource(source: string, checked: boolean) {
        const nextSources = checked
            ? [...new Set([...activePlan.sourceFilters, source])]
            : activePlan.sourceFilters.filter((item) => item !== source);
        updatePlan("sourceFilters", nextSources);
    }

    /** 切換進階設定中的來源文件欄位值。 */
    function toggleMetadataFilter(key: string, value: string, checked: boolean) {
        const selected = activePlan.metadataFilters[key] ?? [];
        const values = checked ? [...new Set([...selected, value])] : selected.filter((item) => item !== value);
        updatePlan("metadataFilters", { ...activePlan.metadataFilters, [key]: values });
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
        setPlansByLearner((current) => ({
            ...current,
            [activeLearnerId]: {
                ...(current[activeLearnerId] ?? DEFAULT_PLAN),
                difficultyMix: { ...DEFAULT_PLAN.difficultyMix },
                sourceFilters: [],
                metadataFilters: {},
                questionKind: "all",
                knowledge: ALL_KNOWLEDGE,
                questionLimit: activeLearner.defaultQuestionLimit,
                bookVersion: activeSubject ? activeLearner.bookVersions[activeSubject] : undefined,
            },
        }));
    }

    /** 清除題目總覽的所有篩選與勾選狀態。 */
    function resetQuestionFilters() {
        setQuestionSubject("全部");
        setQuestionVersion(ALL_QUESTION_FILTERS);
        setQuestionScope(ALL_UNITS);
        setQuestionKind(ALL_QUESTION_FILTERS);
        setQuestionSource(ALL_QUESTION_FILTERS);
        setQuestionCollection(ALL_QUESTION_FILTERS);
        setQuestionSearch("");
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
    function beginSession(mode: PracticeSession["mode"], ids: number[], checkMode: CheckMode = activePlan.checkMode, scheduleId?: string) {
        if (!ids.length) return;
        if (session?.phase === "answering" && sessionPaused) {
            setSessionPaused(false);
            setSection(session.mode === "practice" ? "practice" : "mistakes");
            router.push(getSessionQuestionPath(session.questionIds[session.index]));
            return;
        }
        const startedAt = new Date().toISOString();
        setSession({ id: `session-${crypto.randomUUID()}`, startedAt, learnerId: activeLearnerId, mode, ...(scheduleId ? { scheduleId } : {}), checkMode, phase: "answering", questionIds: ids, index: 0, attempts: [], questionStartedAt: Date.now() });
        setSessionPaused(false); setSessionExitOpen(false); setAnswer(""); setHandwriting(""); setSection(mode === "practice" ? "practice" : "mistakes");
        router.push(getSessionQuestionPath(ids[0]));
    }

    /** 將完整作答結果保存到原始練習計劃。 */
    function saveScheduledPracticeResult(currentSession: PracticeSession, attempts: Attempt[]) {
        if (!currentSession.scheduleId || attempts.length !== currentSession.questionIds.length) return;
        const wrongQuestions = attempts.filter((attempt) => attempt.correct === false).length;
        const correctQuestions = attempts.filter((attempt) => attempt.correct === true).length;
        setSchedulesByLearner((current) => ({
            ...current,
            [currentSession.learnerId]: (current[currentSession.learnerId] ?? []).map((schedule) => schedule.id === currentSession.scheduleId ? {
                ...schedule,
                result: {
                    sessionId: currentSession.id,
                    completedAt: new Date().toISOString(),
                    totalQuestions: attempts.length,
                    wrongQuestions,
                    accuracy: Math.round(correctQuestions / attempts.length * 100),
                },
            } : schedule),
        }));
    }

    /** 暫時收起專注練習並保留目前頁面狀態。 */
    function pauseSession() {
        if (!session || session.phase !== "answering") return;
        setSessionPaused(true);
        setSessionExitOpen(false);
        shouldFocusSectionRef.current = true;
        setSection("overview");
        router.push(SECTION_PATHS.overview);
    }

    /** 返回尚未完成的專注練習。 */
    function resumeSession() {
        if (!session || session.phase !== "answering") return;
        setMobileNavigationOpen(false);
        setSessionPaused(false);
        setSessionExitOpen(false);
        setSection(session.mode === "practice" ? "practice" : "mistakes");
        router.push(getSessionQuestionPath(session.questionIds[session.index]));
    }

    /** 結束目前練習並保留已送出的作答。 */
    function endSession() {
        if (!session) return;
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
        clearSession();
        setSection(nextSection);
        router.push(SECTION_PATHS[nextSection]);
    }

    /** 保存目前答案並依模式前進。 */
    function submitAnswer() {
        if (!currentQuestion || !session) return;
        const hasWrittenResponse = Boolean(answer.trim() || handwriting);
        if (isCharacterHandwritingQuestion(currentQuestion) && !handwriting) return;
        if (currentQuestion.kind === "written" ? !hasWrittenResponse : !answer.trim()) return;
        const attempt: Attempt = {
            sessionId: session.id,
            sessionMode: session.mode,
            questionId: currentQuestion.id,
            answer: answer.trim() || "手寫作答",
            correct: answer.trim() ? checkAnswer(currentQuestion, answer) : null,
            date: new Date().toISOString(),
            durationSeconds: Math.max(1, Math.round((Date.now() - session.questionStartedAt) / 1000)),
            ...(handwriting ? { handwriting } : {}),
        };
        const attempts = [...session.attempts, attempt];
        const completesSession = session.checkMode !== "instant" && session.index === session.questionIds.length - 1;
        if (completesSession) saveScheduledPracticeResult(session, attempts);
        setAttemptsByLearner((current) => ({ ...current, [session.learnerId]: [...(current[session.learnerId] ?? []), attempt] }));
        setSession((current) => {
            if (!current) return current;
            const nextAttempts = [...current.attempts, attempt];
            if (current.checkMode === "instant") return { ...current, attempts: nextAttempts };
            return current.index === current.questionIds.length - 1
                ? { ...current, attempts: nextAttempts, phase: "complete" }
                : { ...current, attempts: nextAttempts, index: current.index + 1, questionStartedAt: Date.now() };
        });
        if (session.checkMode === "complete") {
            const nextQuestionId = session.questionIds[session.index + 1];
            setAnswer("");
            setHandwriting("");
            if (nextQuestionId !== undefined) router.push(getSessionQuestionPath(nextQuestionId));
        }
    }

    /** 逐題檢核後前往下一題。 */
    function moveNext() {
        const nextQuestionId = session?.questionIds[(session?.index ?? 0) + 1];
        if (session && session.index === session.questionIds.length - 1) saveScheduledPracticeResult(session, session.attempts);
        setAnswer(""); setHandwriting("");
        setSession((current) => !current ? current : current.index === current.questionIds.length - 1
            ? { ...current, phase: "complete" }
            : { ...current, index: current.index + 1, questionStartedAt: Date.now() });
        if (nextQuestionId !== undefined) router.push(getSessionQuestionPath(nextQuestionId));
    }

    /** 加入原始錯題所對應的相近題。 */
    function queueSimilar(sourceIds: number[]) {
        const ids = questions.filter((question) => question.generatedFrom && sourceIds.includes(question.generatedFrom) && question.grade === activeLearner.grade).map((question) => question.id);
        setQueuedSimilarByLearner((current) => ({ ...current, [activeLearnerId]: [...new Set([...(current[activeLearnerId] ?? []), ...ids])] }));
    }

    /**
     * 取得指定錯題可立即練習的相關題目。
     * @param sourceId 原始錯題識別碼。
     * @returns 依明確關聯、主題、知識點及單元排序的題目識別碼。
     */
    function getRelatedQuestionIds(sourceId: number) {
        const source = questions.find((question) => question.id === sourceId);
        if (!source) return [];
        return questions
            .filter((question) => question.id !== source.id && question.grade === activeLearner.grade)
            .map((question) => ({
                id: question.id,
                relevance: question.generatedFrom === source.id
                    ? 0
                    : source.topic && question.topic === source.topic
                        ? 1
                        : question.knowledge === source.knowledge
                            ? 2
                            : question.subject === source.subject && question.unit === source.unit
                                ? 3
                                : question.subject === source.subject
                                    ? 4
                                    : 5,
            }))
            .filter(({ relevance }) => relevance < 5)
            .sort((left, right) => left.relevance - right.relevance)
            .slice(0, activeLearner.defaultQuestionLimit)
            .map(({ id }) => id);
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
        const subjects = getSubjectsForGrade(value, questions);
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
                    questionNumber: draft.code || String(index + 1),
                    metadata: draft.metadata.filter((field) => field.label.trim() && field.rawValue.trim()),
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

    /** 透過 API 將 runtime JSON 還原為 fixture。 */
    async function resetDemo() {
        if (!resetArmed) { setResetArmed(true); return; }
        if (!canLeaveSession()) { setResetArmed(false); return; }
        try {
            const response = await fetch("/api/v1/reset", { method: "POST" });
            if (!response.ok) throw new Error("RESET_FAILED");
            const payload = await response.json() as { data: BootstrapResponse };
            skipNextApiWriteRef.current = true;
            setLearners(payload.data.state.learners);
            setActiveLearnerId(payload.data.state.activeLearnerId);
            setAttemptsByLearner(payload.data.state.attemptsByLearner);
            setPlansByLearner(payload.data.state.plansByLearner);
            setSchedulesByLearner(payload.data.state.schedulesByLearner);
            setQueuedSimilarByLearner(payload.data.state.queuedSimilarByLearner);
            setRoleAccess(payload.data.state.roleAccess);
            setImportBooks(payload.data.state.importBooks);
            setQuestions(payload.data.questions);
            setImports(payload.data.imports);
            clearSession(); setSelectedMistakes([]); setFileNames([]); setImportDrafts([]); setFileError(""); setImportStatus(""); setStorageError(""); setResetArmed(false);
        }
        catch {
            setStorageError("JSON 模擬 API 無法重設資料，請稍後再試。");
            setResetArmed(false);
        }
    }

    const sessionCorrect = session?.attempts.filter((attempt) => attempt.correct === true).length ?? 0;
    const pendingCount = session?.attempts.filter((attempt) => attempt.correct === null).length ?? 0;
    const wrongIds = session?.attempts.filter((attempt) => attempt.correct === false).map((attempt) => attempt.questionId) ?? [];
    const similarIds = questions.filter((question) => question.generatedFrom && wrongIds.includes(question.generatedFrom)).map((question) => question.id);
    const dayDifference = getDayDifference(activeExam.date);
    const sessionModeLabel = session?.mode === "similar" ? "相關題目練習" : session?.mode === "review" ? "錯題複習" : "考前練習";

    /** 顯示作答中或完成結果。 */
    function renderSession() {
        if (!session) return null;
        if (session.phase === "answering" && currentQuestion) {
            return (
                <QuestionFlow
                    question={currentQuestion}
                    index={session.index}
                    total={session.questionIds.length}
                    checkMode={session.checkMode}
                    answer={answer}
                    handwriting={handwriting}
                    feedback={currentFeedback}
                    onAnswer={setAnswer}
                    onHandwriting={setHandwriting}
                    onSubmit={submitAnswer}
                    onNext={moveNext}
                />
            );
        }
        const reviewedInSession = session.attempts.length - pendingCount;
        const sessionAccuracy = reviewedInSession ? Math.round(sessionCorrect / reviewedInSession * 100) : null;
        const sessionWrong = session.attempts.filter((attempt) => attempt.correct === false).length;
        const scoreOnly = session.checkMode === "score";
        return (
            <Card className="practice-result-card workspace-card border-border/80 shadow-sm">
                <CardHeader className="border-b border-border/80 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <Badge tone="success"><CheckCircle2 />本輪完成</Badge>
                        <h2 className="mt-3 text-2xl font-bold">練習結果</h2>
                        <CardDescription>{scoreOnly
                            ? `共 ${session.attempts.length} 題，答錯 ${sessionWrong} 題${pendingCount ? `，待檢視 ${pendingCount} 題` : ""}。本模式不顯示解答。`
                            : `共 ${session.attempts.length} 題，答對 ${sessionCorrect} 題${pendingCount ? `，待檢視 ${pendingCount} 題` : ""}。`}</CardDescription>
                    </div>
                    <div className="workspace-stat px-6 py-4 text-center">
                        <p className="text-3xl font-bold text-primary">{sessionAccuracy === null ? "—" : `${sessionAccuracy}%`}</p>
                        <p className="text-xs text-muted-foreground">已檢核題目正確率</p>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-4 p-5 sm:p-7">
                    {scoreOnly && <div className="workspace-surface rounded-2xl p-5 text-center"><p className="text-lg font-bold">本輪答錯 {sessionWrong} 題</p><p className="mt-1 text-sm text-muted-foreground">為保留測驗效果，本模式不顯示逐題結果、答案或解析。</p></div>}
                    {!scoreOnly && session.attempts.map((attempt, index) => {
                        const question = questions.find((item) => item.id === attempt.questionId);
                        return question ? (
                            <div className={`workspace-surface grid gap-4 rounded-xl p-4 ${attempt.handwriting ? "md:grid-cols-[minmax(0,1fr)_minmax(15rem,38%)]" : ""}`} key={`${attempt.questionId}-${index}`}>
                                <div className="flex min-w-0 items-start justify-between gap-3">
                                    <div>
                                        <p className="font-semibold">{index + 1}.</p>
                                        <QuestionPrompt question={question} className="whitespace-pre-line font-semibold" />
                                        <p className="mt-1 text-sm text-muted-foreground">你的答案：{formatAnswer(question, attempt.answer)}</p>
                                        {session.checkMode === "complete" && <><p className="text-sm text-muted-foreground">參考答案：{formatAnswer(question, question.answer)}</p><ContentImages blocks={question.blocks} placement="answer" /></>}
                                    </div>
                                    <Badge className="shrink-0" tone={attempt.correct === true ? "success" : attempt.correct === false ? "danger" : "warning"}>{attempt.correct === true ? "答對" : attempt.correct === false ? "待加強" : "待檢視"}</Badge>
                                </div>
                                {session.checkMode === "complete" && attempt.correct !== null && <p className="text-sm md:col-start-1">{question.explanation}</p>}
                                {attempt.handwriting && <div className="md:col-start-2 md:row-span-2 md:row-start-1"><p className="mb-2 text-xs font-semibold text-muted-foreground">原始手寫</p><img src={attempt.handwriting} alt={`第 ${index + 1} 題原始手寫內容`} className="max-h-56 w-full rounded-xl border border-border bg-white object-contain" /></div>}
                                <time className="practice-result-time col-span-full justify-self-end" dateTime={attempt.date}>{formatAttemptDate(attempt.date)} · {formatDuration(attempt.durationSeconds)}</time>
                            </div>
                        ) : null;
                    })}
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button appearance="outline" tone="muted" onClick={leaveSession}>返回工作區</Button>
                        {!scoreOnly && wrongIds.length > 0 && <Button appearance="outline" onClick={() => beginSession("review", wrongIds, "instant")}>複習本輪錯題</Button>}
                        {!scoreOnly && similarIds.length > 0 && <Button onClick={() => beginSession("similar", similarIds, "instant")}><Sparkles />練習相近題目</Button>}
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
        return renderResults();
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
                            <h2 ref={overviewHeadingRef} data-focus-heading tabIndex={-1} className="mt-2 text-3xl font-bold">嗨，{activeLearner.name}</h2>
                            <p className="mt-2 max-w-xl text-muted-foreground">{dayDifference === null ? `${activeExam.name}尚未設定日期` : `距離${activeExam.name}還有 ${dayDifference} 天`}，今天接著完成已設定的考試範圍。</p>
                            <Button className="button-blue mt-5" disabled={!plannedQuestions.length} onClick={() => beginSession("practice", plannedQuestions.map((question) => question.id))}>{sessionPaused ? "繼續目前練習" : "開始今日練習"}<ArrowRight /></Button>
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
        const questionKindOptions = [
            { value: "all", label: "全部題型" },
            { value: "choice", label: getQuestionKindLabel("choice") },
            { value: "boolean", label: getQuestionKindLabel("boolean") },
            { value: "written", label: getQuestionKindLabel("written") },
            { value: "multi-choice", label: getQuestionKindLabel("multi-choice") },
        ];
        const selectedLimit = activePlan.questionLimit;
        const scopeLabel = activePlan.scope === ALL_UNITS
            ? "全部單元"
            : activePlan.scope.split("::")[1] ?? scopeOptions.find((option) => option.value === activePlan.scope)?.label ?? "全部單元";
        const assessmentScopeLabel = activePlan.subject === "全部"
            ? `${availableSubjects.length} 科範圍`
            : (() => {
                const subject = activePlan.subject as Subject;
                const options = assessmentOptionsBySubject[subject] ?? [];
                const range = getAssessmentRange(activeExam, subject);
                const start = options.find((option) => option.value === range.start)?.label ?? "尚未設定";
                const end = options.find((option) => option.value === range.end)?.label ?? "尚未設定";
                return start === end ? start : `${start}～${end}`;
            })();
        return (
            <Card className="workspace-card practice-card border-border/80 shadow-sm">
                <CardHeader className="practice-card-header">
                    <WorkspaceHeading icon={BookOpen} title={`安排${activeLearner.name}的複習計畫`} description="選擇本次練習內容與方式；考試日期和範圍由學習者設定管理。" />
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
                            disabled={!sessionPaused && (!plannedQuestions.length || difficultyTotal !== 100)}
                            onClick={sessionPaused ? resumeSession : () => beginSession("practice", plannedQuestions.map((question) => question.id))}
                        >
                            {sessionPaused ? "繼續目前練習" : "開始練習"}<ArrowRight />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="grid gap-8 p-5 sm:p-7">
                    <div className="practice-plan-editor contents">
                    <section className="grid gap-4">
                        <h3 className="font-bold">練習篩選</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <SubjectFilter className="col-span-2" subjects={availableSubjects} value={activePlan.subject as Subject | "全部"} onChange={(value) => updatePlan("subject", value)} />
                            <FormField label={<PracticeFieldLabel className="field-dot-blue" icon={Target} label="篩選方式" />}><NativeSelect options={PLAN_BASIS_OPTIONS} value={activePlanBasis} onChange={(event) => updatePlan("basis", event.target.value as PlanBasis)} /></FormField>
                            {activePlanBasis === "chapter" ? (
                                <FormField label={<PracticeFieldLabel className="field-dot-coral" icon={BookOpen} label="章節／單元" />}><NativeSelect options={scopeOptions} value={activePlan.scope} onChange={(event) => updatePlan("scope", event.target.value)} /></FormField>
                            ) : <div className="workspace-surface col-span-2 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                                <div><p className="font-semibold">{activeExam.name}</p><p className="mt-1 text-sm text-muted-foreground">{activeExam.date || "尚未設定日期"} · {assessmentScopeLabel}</p></div>
                                <Button appearance="outline" tone="muted" onClick={() => navigateToSection("settings")}><Settings2 />前往學習者設定</Button>
                            </div>}
                        </div>
                    </section>
                    <section className="grid gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="font-bold">進階設定</h3>
                            <Button appearance="outline" tone="muted" aria-expanded={advancedPlanOpen} onClick={() => setAdvancedPlanOpen((current) => !current)}><Settings2 />{advancedPlanOpen ? "收合設定" : "展開設定"}</Button>
                        </div>
                        {!advancedPlanOpen && <p className="advanced-plan-summary rounded-xl px-4 py-3 text-sm">{activeSubject ? `${activeBookVersion}版` : "依各科版本"} · 易 {activeDifficultyMix.easy}% · 中 {activeDifficultyMix.medium}% · 難 {activeDifficultyMix.hard}% · {activePlan.sourceFilters.length ? `${activePlan.sourceFilters.length} 個來源` : "全部來源"} · {activePlan.questionKind === "all" ? "全部題型" : getQuestionKindLabel(activePlan.questionKind)} · {selectedLimit} 題</p>}
                        {advancedPlanOpen && <div className="workspace-surface grid gap-5 rounded-2xl p-4 sm:p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <p className="text-sm font-semibold">出題條件</p>
                                <Button appearance="ghost" tone="muted" onClick={resetAdvancedPlan}><RotateCcw />恢復進階預設</Button>
                            </div>
                            <div className="advanced-filter-grid border-t border-border pt-4">
                                <FormField label={<PracticeFieldLabel className="field-dot-violet" icon={BookOpen} label="版本" />}>
                                    <NativeSelect disabled={!activeSubject} options={bookVersionOptions} value={activeBookVersion} onChange={(event) => updatePlan("bookVersion", event.target.value)} />
                                </FormField>
                                <div className="grid content-start gap-2">
                                    <p><PracticeFieldLabel className="field-dot-violet" icon={FileUp} label="題目來源" /></p>
                                    {sourceOptions.length ? (
                                        <Dropdown>
                                            <DropdownTrigger asChild>
                                                <Button className="source-filter-trigger" appearance="outline" tone="muted" aria-label="選擇題目來源">
                                                    <span className="truncate">{activePlan.sourceFilters.length === 0 ? "全部來源" : activePlan.sourceFilters.length === 1 ? activePlan.sourceFilters[0] : `已選 ${activePlan.sourceFilters.length} 個來源`}</span>
                                                    <ChevronDown />
                                                </Button>
                                            </DropdownTrigger>
                                            <DropdownContent align="start" className="source-filter-menu">
                                                <DropdownLabel>選擇題目來源</DropdownLabel>
                                                {activePlan.sourceFilters.length > 0 && <><DropdownItem onSelect={() => updatePlan("sourceFilters", [])}>清除選取，使用全部來源</DropdownItem><DropdownSeparator /></>}
                                                {sourceOptions.map((source) => (
                                                    <DropdownCheckboxItem
                                                        checked={activePlan.sourceFilters.includes(source)}
                                                        key={source}
                                                        onCheckedChange={(checked) => togglePlanSource(source, checked === true)}
                                                        onSelect={(event) => event.preventDefault()}
                                                    >
                                                        <DropdownIndicator>✓</DropdownIndicator>
                                                        <span className="truncate">{source}</span>
                                                    </DropdownCheckboxItem>
                                                ))}
                                            </DropdownContent>
                                        </Dropdown>
                                    ) : <p className="text-sm text-muted-foreground">目前科目與範圍沒有可選來源。</p>}
                                </div>
                                <FormField label={<PracticeFieldLabel className="field-dot-blue" icon={Library} label="題型" />}><NativeSelect options={questionKindOptions} value={activePlan.questionKind} onChange={(event) => updatePlan("questionKind", event.target.value as PlanQuestionKind)} /></FormField>
                                <FormField label={<PracticeFieldLabel className="field-dot-coral" icon={Sparkles} label="知識點" />}><NativeSelect options={knowledgeOptions} value={activePlan.knowledge} onChange={(event) => updatePlan("knowledge", event.target.value)} /></FormField>
                                <div className="grid content-start gap-2"><p><PracticeFieldLabel className="field-dot-violet" icon={UserCheck} label="建立者" /></p><div className="plan-creator-value"><Badge tone="primary">{roleAccess.activeRole}</Badge></div></div>
                                {metadataCatalog.map((facet) => {
                                    const selected = activePlan.metadataFilters[facet.key] ?? [];
                                    return (
                                        <div className="grid content-start gap-2" key={facet.key}>
                                            <p><PracticeFieldLabel className="field-dot-blue" icon={Target} label={facet.label} /></p>
                                            <Dropdown>
                                                <DropdownTrigger asChild><Button className="source-filter-trigger" appearance="outline" tone="muted"><span className="truncate">{selected.length ? selected.length === 1 ? selected[0] : `已選 ${selected.length} 項` : `全部${facet.label}`}</span><ChevronDown /></Button></DropdownTrigger>
                                                <DropdownContent align="start" className="source-filter-menu">
                                                    <DropdownLabel>{facet.label}</DropdownLabel>
                                                    {selected.length > 0 && <><DropdownItem onSelect={() => updatePlan("metadataFilters", { ...activePlan.metadataFilters, [facet.key]: [] })}>清除選取</DropdownItem><DropdownSeparator /></>}
                                                    {facet.values.map((value) => <DropdownCheckboxItem checked={selected.includes(value)} key={value} onCheckedChange={(checked) => toggleMetadataFilter(facet.key, value, checked === true)} onSelect={(event) => event.preventDefault()}><DropdownIndicator>✓</DropdownIndicator><span className="truncate">{value}</span></DropdownCheckboxItem>)}
                                                </DropdownContent>
                                            </Dropdown>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="border-t border-border pt-4">
                                <p><PracticeFieldLabel className="field-dot-gold" icon={BarChart3} label="難易度占比" /></p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-3">
                                <FormField label={<PracticeFieldLabel className="field-dot-blue" icon={Target} label="易（%）" />}><Input type="number" min={0} max={100} value={activeDifficultyMix.easy} onChange={(event) => updateDifficulty("easy", event.target.value)} /></FormField>
                                <FormField label={<PracticeFieldLabel className="field-dot-violet" icon={Target} label="中（%）" />}><Input type="number" min={0} max={100} value={activeDifficultyMix.medium} onChange={(event) => updateDifficulty("medium", event.target.value)} /></FormField>
                                <FormField label={<PracticeFieldLabel className="field-dot-coral" icon={Target} label="難（%）" />}><Input type="number" min={0} max={100} value={activeDifficultyMix.hard} onChange={(event) => updateDifficulty("hard", event.target.value)} /></FormField>
                            </div>
                            <p className={`text-sm font-semibold ${difficultyTotal === 100 ? "text-emerald-700" : "text-danger"}`} role="status">目前合計：{difficultyTotal}%{difficultyTotal === 100 ? "" : "，請調整為 100%"}</p>
                            <FormField className="border-t border-border pt-4" label={<PracticeFieldLabel className="field-dot-gold" icon={ClipboardCheck} label="本輪題數（可臨時調整）" />}>
                                <QuestionLimitControl
                                    disabled={!eligibleQuestions.length}
                                    value={selectedLimit}
                                    onChange={(value) => updatePlan("questionLimit", value)}
                                />
                            </FormField>
                        </div>}
                    </section>
                    <section className="grid gap-4 border-t border-border pt-7">
                        <fieldset className="grid gap-4">
                            <legend><PracticeFieldLabel className="field-dot-gold" icon={ClipboardCheck} label="練習方式" /></legend>
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
                        <div className="practice-selection-context"><p>{activeLearner.grade} · {planSubjectLabel} · {activePlanBasis === "chapter" ? scopeLabel : `${activeExam.name} · ${assessmentScopeLabel}`} · {activePlan.checkMode === "instant" ? "逐題檢核" : activePlan.checkMode === "score" ? "只顯示成績" : "全部作答後檢核"}</p>{!plannedQuestions.length && <p className="practice-footer-error" role="status">目前設定沒有可用的示範題，請調整科目、範圍或進階篩選。</p>}{difficultyTotal !== 100 && <p className="practice-footer-error" role="status">難易度占比合計需為 100% 才能開始。</p>}</div>
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
                    <Button className="w-full" disabled={!scheduleDate || !plannedQuestions.length || difficultyTotal !== 100} onClick={addScheduledPractice}><CalendarDays />加入練習計劃</Button>
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
                                                <Button appearance="ghost" tone="muted" size="sm" aria-label={`套用目前設定到 ${schedule.subjectLabel}`} disabled={!plannedQuestions.length || difficultyTotal !== 100} onClick={() => replaceScheduledPractice(schedule)}>套用</Button>
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
                                        <Button appearance="ghost" tone="muted" size="sm" aria-label={`套用目前設定到 ${schedule.subjectLabel}`} disabled={!plannedQuestions.length || difficultyTotal !== 100} onClick={() => replaceScheduledPractice(schedule)}>套用</Button>
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
                    <WorkspaceHeading icon={ClipboardCheck} title="練習計劃" description={`依日期排列${activeLearner.name}的全部練習，可直接選擇一筆開始。`} />
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
        const kindOptions = [
            { value: ALL_QUESTION_FILTERS, label: "全部題型" },
            { value: "choice", label: "選擇題" },
            { value: "multi-choice", label: "複合選擇題" },
            { value: "boolean", label: "是非題" },
            { value: "written", label: "書寫題" },
        ];
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
                    <section className="question-filter-panel" aria-labelledby="question-filter-title">
                        <div className="question-filter-heading"><div><h3 id="question-filter-title">篩選題目</h3><p>條件會同時套用到列表與「全部篩選結果」批次範圍。</p></div><Button appearance="ghost" tone="muted" size="sm" onClick={resetQuestionFilters}><RotateCcw />清除篩選</Button></div>
                        <div className="question-filter-grid">
                            <SubjectFilter className="question-filter-subject" subjects={availableSubjects} value={questionSubject} onChange={(value) => { setQuestionSubject(value); setQuestionScope(ALL_UNITS); setQuestionPage(1); setSelectedQuestionIds([]); }} />
                            <FormField label="版本"><NativeSelect options={questionVersionOptions} value={questionVersion} onChange={(event) => { setQuestionVersion(event.target.value); setQuestionScope(ALL_UNITS); setQuestionPage(1); setSelectedQuestionIds([]); }} /></FormField>
                            <FormField label="單元"><NativeSelect options={questionScopeOptions} value={questionScope} onChange={(event) => { setQuestionScope(event.target.value); setQuestionPage(1); setSelectedQuestionIds([]); }} /></FormField>
                            <FormField label="題型"><NativeSelect options={kindOptions} value={questionKind} onChange={(event) => { setQuestionKind(event.target.value); setQuestionPage(1); setSelectedQuestionIds([]); }} /></FormField>
                            <FormField label="來源"><NativeSelect options={questionSourceOptions} value={questionSource} onChange={(event) => { setQuestionSource(event.target.value); setQuestionPage(1); setSelectedQuestionIds([]); }} /></FormField>
                            <FormField label="收藏清單"><NativeSelect options={questionCollectionOptions} value={questionCollection} onChange={(event) => { setQuestionCollection(event.target.value); setQuestionPage(1); setSelectedQuestionIds([]); }} /></FormField>
                            <div className="question-filter-create"><Button appearance="outline" onClick={() => { setCollectionDialogOpen(true); setQuestionActionStatus(""); }}><Plus />新增收藏清單</Button></div>
                        </div>
                    </section>

                    <section className="question-list-section" aria-labelledby="question-list-title">
                        <div className="question-list-heading">
                            <div className="question-list-title"><h3 id="question-list-title">題目清單</h3><span>共 {filteredOverviewQuestions.length} 題</span></div>
                            <div className="question-list-heading-actions">
                                <div className="question-search question-list-search"><Search aria-hidden="true" /><Input aria-label="搜尋題目" value={questionSearch} placeholder="搜尋題目、編號或來源" onChange={(event) => { setQuestionSearch(event.target.value); setQuestionPage(1); setSelectedQuestionIds([]); }} /></div>
                                <label className="question-select-page"><Checkbox checked={allFilteredSelected} indeterminate={selectedFilteredCount > 0 && !allFilteredSelected} onChange={(event) => toggleQuestions(filteredQuestionIds, event.target.checked)} />選取全部頁面</label>
                                <Badge tone="muted">第 {activeQuestionPage}／{questionPageCount} 頁</Badge>
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
                                        <td className="question-overview-title-cell" data-label="題目"><button className="question-overview-title" type="button" onClick={() => openQuestionDetail(question.id)}>{question.prompt}</button><small>{question.source}</small></td>
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
        const actions = <>
            {collections.length > 0 && <div className="question-collection-tags">{collections.map((collection) => <Badge tone="primary" key={collection.id}>{collection.name}</Badge>)}</div>}
            <div className="question-detail-collection"><NativeSelect aria-label="選擇收藏清單" disabled={!activeQuestionCollections.length} options={targetOptions} value={activeTargetCollectionId} onChange={(event) => setTargetCollectionId(event.target.value)} /><Button disabled={!activeTargetCollectionId} onClick={() => updateQuestionCollection([selectedOverviewQuestion.id], "add")}><Bookmark />加入收藏</Button></div>
        </>;
        return <QuestionReview
            actions={actions}
            index={selectedOverviewIndex}
            question={selectedOverviewQuestion}
            title="題目總覽"
            total={detailOverviewQuestions.length}
            onBack={closeQuestionDetail}
            onNext={() => navigateOverviewQuestion(selectedOverviewIndex + 1)}
            onPrevious={() => navigateOverviewQuestion(selectedOverviewIndex - 1)}
        />;
    }

    /** 顯示匯入紀錄中的滿版只讀題目內容。 */
    function renderImportQuestionReview() {
        if (!importReviewQuestion) return null;
        return <QuestionReview
            index={importReviewIndex}
            question={importReviewQuestion}
            title="匯入題目"
            total={importReviewQuestions.length}
            onBack={() => setImportReviewQuestionId(undefined)}
            onNext={() => setImportReviewQuestionId(importReviewQuestions[importReviewIndex + 1]?.id)}
            onPrevious={() => setImportReviewQuestionId(importReviewQuestions[importReviewIndex - 1]?.id)}
        />;
    }

    /** 顯示題庫與匯入校正。 */
    function renderBank() {
        const importSubjects = getSubjectsForGrade(importGrade, questions);
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
                                <FormField label="適用年級" description="自動帶入目前學習者年級，仍可在寫入前修改。"><NativeSelect options={GRADE_OPTIONS} value={importGrade} onChange={(event) => changeImportGrade(event.target.value)} /></FormField>
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
                                    const sourceItems = [draft.source, ...matchingQuestions.map((question) => question.source)];
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
                                                <CreatableSelectField label="來源" items={sourceItems} value={draft.source} customValue={draft.customSource} placeholder="例如：學校段考、課本第 42 頁、家教講義" onChange={(value) => updateImportDraft(draft.id, "source", value)} onCustomChange={(value) => updateImportDraft(draft.id, "customSource", value)} />
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
                                <Button className="w-full" disabled={!importDrafts.length || isImporting} onClick={finishImportDemo}>{isImporting ? "正在寫入…" : `確認全部 ${importDrafts.length} 題並寫入 JSON`}</Button>
                                <p className="mt-2 text-center text-xs text-muted-foreground">資料會由模擬 API 寫入本機 runtime JSON；OCR 與 AI 分析仍未連接。</p>
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
        const visibleQueue = usableQueue.filter((id) => {
            const question = questions.find((item) => item.id === id);
            return (mistakeSubject === "全部" || question?.subject === mistakeSubject)
                && (mistakeScope === ALL_UNITS || (question && getUnitScopeValue(question) === mistakeScope));
        });

        /** 切換錯題科目時清除跨科勾選，避免批次複習混入隱藏題目。 */
        function changeMistakeSubject(value: string) {
            if (value !== "全部" && !availableSubjects.includes(value as Subject)) return;
            setMistakeSubject(value as Subject | "全部");
            setMistakeScope(ALL_UNITS);
            setMistakePage(1);
            setSelectedMistakes([]);
        }

        /** 切換錯題章節範圍時清除隱藏題目的勾選狀態。 */
        function changeMistakeScope(value: string) {
            if (!mistakeScopeOptions.some((option) => option.value === value)) return;
            setMistakeScope(value);
            setMistakePage(1);
            setSelectedMistakes([]);
        }

        /** 切換排行來源並重設只適用於上一個排行的範圍與勾選。 */
        function changeMistakeRanking(value: string) {
            if (value !== "personal" && value !== "community") return;
            setMistakeRankingView(value);
            setMistakeScope(ALL_UNITS);
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
                    <Tabs className="mistake-ranking-tabs" appearance="segmented" value={mistakeRankingView} onValueChange={changeMistakeRanking}>
                        <TabsList className="mistake-ranking-tab-list" aria-label="切換錯題排行">
                            <TabsTrigger value="personal"><UserCheck />個人錯題排行</TabsTrigger>
                            <TabsTrigger value="community"><Users />社群錯題排行</TabsTrigger>
                        </TabsList>
                        <div className="mistake-toolbar">
                            <SubjectFilter subjects={availableSubjects} value={mistakeSubject} onChange={changeMistakeSubject} />
                            <div className="mistake-filter-row">
                                <div className="min-w-0 flex-1 sm:max-w-sm">
                                    <FormField label={<PracticeFieldLabel className="field-dot-blue" icon={BookOpen} label="章節／單元" />}>
                                        <NativeSelect aria-label="篩選錯題範圍" options={mistakeScopeOptions} value={mistakeScope} onChange={(event) => changeMistakeScope(event.target.value)} />
                                    </FormField>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone="muted">目前顯示 {mistakeResultCount} 題</Badge>
                                    {mistakeRankingView === "personal" && visibleQueue.length > 0 && <Button appearance="outline" onClick={() => beginSession("similar", visibleQueue, "instant")}><Sparkles />開始後續練習（{visibleQueue.length}）</Button>}
                                    {mistakeRankingView === "personal" && <Button appearance="outline" disabled={!selectedMistakes.length} onClick={() => openQuestionPlan(selectedMistakes, "錯題")}><CalendarDays />加入練習計劃</Button>}
                                    {mistakeRankingView === "personal" && <Button disabled={!selectedMistakes.length} onClick={() => beginSession("review", selectedMistakes, "instant")}>複習已選錯題</Button>}
                                </div>
                            </div>
                        </div>
                        <TabsContent className="mistake-ranking-content" value="personal">
                            {!visibleMistakeQuestions.length && <div className="workspace-surface rounded-2xl p-8 text-center"><CheckCircle2 className="mx-auto text-primary" /><p className="mt-3 font-bold">{mistakeSubject === "全部" ? "目前沒有個人錯題" : `${mistakeSubject}目前沒有個人錯題`}</p><p className="mt-1 text-sm text-muted-foreground">完成一輪練習後，最新一次仍答錯的題目會依累計錯誤次數排列。</p>{mistakeSubject === "全部" ? <Button className="mt-4" appearance="outline" onClick={() => navigateToSection("practice")}>前往安排練習</Button> : <Button className="mt-4" appearance="outline" onClick={() => changeMistakeSubject("全部")}>查看全部錯題</Button>}</div>}
                            {visibleMistakeQuestions.length > 0 && <div className="mistake-table-wrap">
                                <table className="mistake-table mistake-personal-table">
                                    <thead><tr>
                                        <th className="mistake-select-column" scope="col"><label className="mistake-select" aria-label="選取全部篩選錯題"><Checkbox checked={allVisibleMistakesSelected} onChange={(event) => toggleAllVisibleMistakes(event.target.checked)} /><span className="sr-only">選取全部篩選錯題</span></label></th>
                                        <th className="mistake-rank-column" scope="col">排名</th><th scope="col">題目</th><th scope="col">最後測驗</th><th scope="col">錯誤次數</th><th scope="col"><span className="sr-only">操作</span></th>
                                    </tr></thead>
                                    <tbody>{pagedMistakeQuestions.map((question, index) => {
                                        const similar = questions.find((item) => item.generatedFrom === question.id && item.grade === activeLearner.grade);
                                        const selected = selectedMistakes.includes(question.id);
                                        const questionAttempts = activeAttempts.filter((attempt) => attempt.questionId === question.id);
                                        const lastAttempt = questionAttempts.reduce<Attempt | undefined>((latest, attempt) => !latest || new Date(attempt.date).getTime() > new Date(latest.date).getTime() ? attempt : latest, undefined);
                                        const wrongCount = questionAttempts.filter((attempt) => attempt.correct === false).length;
                                        return <tr key={question.id}>
                                            <td className="mistake-select-cell"><label className="mistake-select" aria-label={`選取${question.prompt}`}><Checkbox checked={selected} onChange={(event) => setSelectedMistakes((current) => event.target.checked ? [...new Set([...current, question.id])] : current.filter((id) => id !== question.id))} /><span className="sr-only">選取此錯題</span></label></td>
                                            <td className="mistake-rank-cell" data-label="排名">{(activeMistakePage - 1) * MISTAKE_PAGE_SIZE + index + 1}</td>
                                            <td className="mistake-question-cell" data-label="題目"><p className="mistake-question-title" title={question.prompt}>{question.prompt}</p></td>
                                            <td data-label="最後測驗"><time className="mistake-meta" dateTime={lastAttempt?.date}>{lastAttempt ? formatAttemptDate(lastAttempt.date) : "尚無紀錄"}</time></td>
                                            <td data-label="錯誤次數"><Badge tone={wrongCount > 1 ? "danger" : "muted"}>{wrongCount} 次</Badge></td>
                                            <td className="mistake-table-actions"><Button appearance="outline" size="sm" onClick={() => beginSession("review", [question.id], "instant")}><RotateCcw />練習</Button><Button appearance="ghost" tone="muted" size="sm" disabled={!similar || usableQueue.includes(similar.id)} onClick={() => queueSimilar([question.id])}>{usableQueue.includes(similar?.id ?? -1) ? "已加入" : "加入後續"}</Button></td>
                                        </tr>;
                                    })}</tbody>
                                </table>
                            </div>}
                        </TabsContent>
                        <TabsContent className="mistake-ranking-content" value="community">
                            {!visibleCommunityMistakeRows.length && <div className="workspace-surface rounded-2xl p-8 text-center"><Users className="mx-auto text-primary" /><p className="mt-3 font-bold">目前沒有社群錯題紀錄</p><p className="mt-1 text-sm text-muted-foreground">社群排行會彙整系統內同年級題目的全部已檢核作答。</p></div>}
                            {visibleCommunityMistakeRows.length > 0 && <div className="mistake-table-wrap">
                                <table className="mistake-table mistake-community-table">
                                    <thead><tr><th className="mistake-rank-column" scope="col">排名</th><th scope="col">題目</th><th scope="col">作答次數</th><th scope="col">錯誤次數</th><th scope="col">錯誤率</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
                                    <tbody>{pagedCommunityMistakeRows.map(({ question, total, wrong, wrongRate }, index) => <tr key={question.id}>
                                        <td className="mistake-rank-cell" data-label="排名">{(activeMistakePage - 1) * MISTAKE_PAGE_SIZE + index + 1}</td>
                                        <td className="mistake-question-cell" data-label="題目"><p className="mistake-question-title" title={question.prompt}>{question.prompt}</p></td>
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

    /** 顯示目前學習者的完整設定頁。 */
    function renderSettings() {
        const selectedExamId = getSettingsExamId(pathname);
        const selectedExam = activePlan.examSettings.find((exam) => exam.id === selectedExamId);

        if (selectedExam) {
            return (
                <Card className="workspace-card settings-card border-border/80 shadow-sm">
                    <CardHeader className="settings-detail-header">
                        <WorkspaceHeading icon={CalendarDays} title={selectedExam.name} description="設定考試日期，以及每個科目的開始與結束範圍。" />
                        <Button appearance="outline" onClick={() => router.push(SECTION_PATHS.settings)}><ArrowLeft />返回考試清單</Button>
                    </CardHeader>
                    <CardContent className="grid gap-6 p-5 sm:p-7">
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
                    </CardContent>
                </Card>
            );
        }

        return (
            <div className="grid gap-5">
                <Card className="workspace-card settings-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={UserCheck} title={`${activeLearner.name}的基本設定`} description="切換學習者後，每位學習者的資料、各科版本與練習偏好會分開保存。" /></CardHeader>
                    <CardContent className="grid gap-8 p-5 sm:p-7">
                        <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>基本資料</h3><p>稱呼會顯示在首頁，年級會自動帶入題庫與複習計畫。</p></div><Badge className="tag-purple" tone="primary">個人資料</Badge></div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="workspace-surface flex items-center gap-4 rounded-2xl p-4 sm:col-span-2">
                                    <div className="learner-avatar overflow-hidden" aria-hidden="true">{activeLearner.avatar ? <img className="h-full w-full object-cover" src={activeLearner.avatar} alt="" /> : activeLearner.name.slice(0, 1)}</div>
                                    <div className="min-w-0 flex-1">
                                        <FormField label="代表圖片" description="支援 JPG、PNG、WebP，檔案需小於 1 MB。"><Input accept={AVATAR_FILE_TYPES.join(",")} type="file" onChange={updateLearnerAvatar} /></FormField>
                                        {avatarError && <p className="mt-2 text-sm font-semibold text-danger" role="alert">{avatarError}</p>}
                                    </div>
                                    {activeLearner.avatar && <Button appearance="ghost" tone="muted" size="sm" onClick={() => { updateLearner("avatar", ""); setAvatarError(""); }}>移除圖片</Button>}
                                </div>
                                <FormField className="field-dot field-dot-violet" label="稱呼"><Input value={activeLearner.name} onChange={(event) => updateLearner("name", event.target.value)} /></FormField>
                                <FormField className="field-dot field-dot-blue" label="學校"><Input value={activeLearner.school} onChange={(event) => updateLearner("school", event.target.value)} /></FormField>
                                <FormField className="field-dot field-dot-coral" label="年級"><NativeSelect options={GRADE_OPTIONS} value={activeLearner.grade} onChange={(event) => updateLearner("grade", event.target.value)} /></FormField>
                                <FormField className="field-dot field-dot-gold" label="學期"><NativeSelect options={SEMESTER_OPTIONS} value={activeLearner.semester} onChange={(event) => updateLearner("semester", event.target.value)} /></FormField>
                            </div>
                        </section>
                        <section className="settings-section">
                            <div className="settings-section-heading">
                                <div><h3>帳號與角色</h3><p>切換角色時會保留目前學習者；可在這裡設定每個角色能管理哪些學習者。</p></div>
                                <Button appearance="outline" onClick={() => router.push(AUTH_PATHS["account-link"])}><Link2 />帳號綁定</Button>
                            </div>
                            <div className="role-access-summary">
                                <div><span>註冊信箱</span><strong>{roleAccess.registrationEmail}</strong></div>
                                <div><span>目前角色</span><strong>{roleAccess.activeRole}</strong></div>
                                <div><span>目前學習者</span><strong>{activeLearner.name}</strong></div>
                            </div>
                            <div className="role-access-grid">
                                {ROLE_OPTIONS.map(({ value: role }) => (
                                    <article className="role-access-card" key={role}>
                                        <div><h4>{role}</h4><p>{role === "學習者" ? "可使用自己的練習與成果" : "可替指定學習者建立資料與安排練習"}</p></div>
                                        <div className="role-access-learners">
                                            {learners.map((learner) => <label key={learner.id}><Checkbox checked={roleAccess.learnerIdsByRole[role].includes(learner.id)} onChange={(event) => updateRoleLearner(role, learner.id, event.target.checked)} />{learner.name}</label>)}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                        <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>各科書籍版本</h3><p>國中自然分為理化、生物；社會分為歷史、地理、公民，每一科可分別設定版本。</p></div><Badge className="tag-pink" tone="danger">依科設定</Badge></div>
                            <div className="grid gap-4 sm:grid-cols-3">
                                {availableSubjects.map((subject, index) => (
                                    <FormField className={`field-dot ${index === 0 ? "field-dot-violet" : index === 1 ? "field-dot-coral" : "field-dot-blue"}`} label={`${subject}版本`} key={subject}>
                                        <NativeSelect options={BOOK_OPTIONS} value={activeLearner.bookVersions[subject]} onChange={(event) => updateBookVersion(subject, event.target.value)} />
                                    </FormField>
                                ))}
                                {!availableSubjects.length && <p className="text-sm text-muted-foreground">目前年級尚無可設定版本的科目。</p>}
                            </div>
                        </section>
                        <section className="settings-section" id="exam-settings">
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
                        </section>
                        <section className="settings-section">
                            <div className="settings-section-heading"><div><h3>練習偏好</h3><p>預設題數會用於新計畫；複習計畫中的「本輪題數」仍可臨時更改。</p></div><Badge className="tag-gold" tone="warning">預設值</Badge></div>
                            <div className="max-w-sm">
                                <FormField className="field-dot field-dot-gold" label="每輪預設題數" description="若目前範圍題目不足，實際練習會以可用題數為準。">
                                    <QuestionLimitControl
                                        value={activeLearner.defaultQuestionLimit}
                                        onChange={(value) => updateLearner("defaultQuestionLimit", value)}
                                    />
                                </FormField>
                            </div>
                        </section>
                    </CardContent>
                </Card>
                <Card className="workspace-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={RotateCcw} title="示範資料" description="重設會清除 runtime JSON 中的學習者設定、作答紀錄、複習計畫與新增題目。" /></CardHeader>
                    <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                        <p className="text-sm text-muted-foreground">此操作只影響本機示範資料，不會影響任何外部帳號。</p>
                        <Button appearance="outline" tone="danger" onClick={resetDemo}><RotateCcw />{resetArmed ? "再次點擊確認重設" : "重設示範資料"}</Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    /** 顯示每次練習紀錄，展開後可切換查看錯題或全部題目。 */
    function renderResults() {
        /**
         * 顯示單筆作答題目與答案。
         * @param record 練習紀錄。
         * @param attempt 單題作答紀錄。
         * @param index 題目在該次練習中的位置。
         * @returns 作答題目卡片；題目不存在時不顯示。
         */
        function renderResultAttempt(record: PracticeRecord, attempt: Attempt, index: number) {
            const question = questions.find((item) => item.id === attempt.questionId);
            if (!question) return null;
            const resultLabel = attempt.correct === true ? "答對" : attempt.correct === false ? "錯題" : "待檢視";
            const resultTone = attempt.correct === true ? "success" : attempt.correct === false ? "danger" : "warning";
            const relatedIds = attempt.correct === false ? getRelatedQuestionIds(question.id) : [];
            return <article className="result-wrong-item" data-result={attempt.correct === true ? "correct" : attempt.correct === false ? "wrong" : "pending"} key={`${record.id}-${attempt.questionId}-${index}`}>
                <div>
                    <div className="result-question-heading"><p className="result-wrong-number">第 {index + 1} 題</p><Badge tone={resultTone}>{resultLabel}</Badge></div>
                    <h5>{question.prompt}</h5>
                    <p>{question.subject} · {getUnitLabel(question.unit)} · {question.knowledge}</p>
                    {attempt.correct === false && <div className="result-question-actions">
                        <Button appearance="outline" size="sm" onClick={() => beginSession("review", [question.id], "instant")}><RotateCcw />立即測驗</Button>
                        <Button size="sm" disabled={!relatedIds.length} onClick={() => beginSession("similar", relatedIds, "instant")}><Sparkles />相關題目練習{relatedIds.length ? `（${relatedIds.length}）` : ""}</Button>
                    </div>}
                </div>
                <div className="result-wrong-answer"><p><span>你的答案</span>{formatAnswer(question, attempt.answer)}</p><p><span>參考答案</span>{formatAnswer(question, question.answer)}</p></div>
            </article>;
        }

        return (
            <div className="grid gap-5">
                <Card className="workspace-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={BarChart3} title="成果摘要" description="依每次練習累積的作答紀錄計算。" /></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[
                        { label: "練習次數", value: practiceRecords.length },
                        { label: "已作答", value: activeAttempts.length },
                        { label: "錯題", value: reviewedAttempts.length - correctCount },
                        { label: "已檢核正確率", value: reviewedAttempts.length ? `${accuracy}%` : "—" },
                    ].map((stat) => <div className="workspace-stat rounded-xl p-4 text-center" key={stat.label}><p className="text-2xl font-bold">{stat.value}</p><p className="text-xs text-muted-foreground">{stat.label}</p></div>)}</CardContent>
                </Card>
                <Card className="workspace-card border-border/80 shadow-sm">
                    <CardHeader><WorkspaceHeading icon={ClipboardCheck} title="練習紀錄" description="依練習日期由新到舊排列；展開後可切換查看錯題或全部題目。" /></CardHeader>
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
                                    const score = reviewed.length ? `${Math.round(correct / reviewed.length * 100)} 分` : "待檢視";
                                    const modeLabel = record.mode === "review" ? "錯題複習" : record.mode === "similar" ? "相關題目練習" : "考前練習";
                                    const subjectLabel = subjects.length === 1 ? subjects[0] : subjects.length ? subjects.join("、") : "練習";
                                    const unitLabels = units.map(getUnitLabel);
                                    const unitLabel = unitLabels.length > 2 ? `${unitLabels.slice(0, 2).join("、")}等 ${unitLabels.length} 個單元` : unitLabels.join("、");
                                    const title = `${modeLabel} · ${subjectLabel}${unitLabel ? ` · ${unitLabel}` : ""}`;
                                    const expanded = selectedPracticeRecordId === record.id;
                                    return <Fragment key={record.id}>
                                        <tr>
                                            <td data-label="練習項目"><button className="result-record-title" type="button" aria-expanded={expanded} onClick={() => setSelectedPracticeRecordId(expanded ? "" : record.id)}>{title}</button></td>
                                            <td data-label="日期"><time dateTime={record.completedAt}>{formatAttemptDate(record.completedAt)}</time></td>
                                            <td data-label="題數">{record.attempts.length} 題</td>
                                            <td data-label="錯題"><Badge tone={wrongAttempts.length ? "danger" : "success"}>{wrongAttempts.length} 題</Badge></td>
                                            <td data-label="成績">{score}</td>
                                            <td className="result-record-action"><Button appearance="outline" size="sm" aria-expanded={expanded} onClick={() => setSelectedPracticeRecordId(expanded ? "" : record.id)}>{expanded ? "收起" : "查看題目"}<ChevronDown className={expanded ? "rotate-180" : ""} /></Button></td>
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

    if (!isHydrated) return <main className="grid min-h-screen place-items-center p-6"><Card className="w-full max-w-md border-border/80 shadow-sm"><CardContent className="p-8 text-center"><p className="font-bold">正在讀取模擬資料</p><p className="mt-2 text-sm text-muted-foreground">前端正在透過 API 載入 runtime JSON。</p></CardContent></Card></main>;
    if (!learners.length || !questions.length) return <main className="grid min-h-screen place-items-center p-6"><Card className="w-full max-w-md border-border/80 shadow-sm"><CardContent className="p-8 text-center"><p className="font-bold">無法顯示學習資料</p><p className="mt-2 text-sm text-muted-foreground">{storageError || "模擬 API 沒有回傳可用資料。"}</p></CardContent></Card></main>;

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
                                    ? `${sessionModeLabel} · ${activeLearner.name} · ${sessionQuestionLabel}，共 ${session.questionIds.length} 題`
                                    : `${sessionModeLabel} · ${activeLearner.name} · 本輪練習結果`}
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
                    <DialogDescription>目前使用「{roleAccess.activeRole}」身份。家長與家教需輸入六位數角色密碼。</DialogDescription>
                </DialogHeader>
                <DialogBody className="grid gap-4">
                    {roleStatus && <p className="role-status" role="status">{roleStatus}</p>}
                    <FormField label="要切換的角色"><NativeSelect options={ROLE_OPTIONS} value={requestedRole} onChange={(event) => { setRequestedRole(event.target.value as AccountRole); setRoleStatus(""); setRoleResetOpen(false); setRolePin(""); }} /></FormField>
                    {requestedRole !== "學習者" && requestedRole !== roleAccess.activeRole && !roleResetOpen && <>
                        <FormField label="六位數角色密碼" description="本機示範預設密碼為 123456。"><Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={rolePin} onChange={(event) => setRolePin(event.target.value.replace(/\D/g, "").slice(0, 6))} /></FormField>
                        <Button appearance="ghost" tone="muted" onClick={() => { setRoleResetOpen(true); setRoleStatus(""); }}>忘記角色密碼</Button>
                    </>}
                    {requestedRole !== "學習者" && roleResetOpen && <div className="role-reset-panel">
                        <div className="flex items-center gap-2 font-semibold"><Mail size={18} />註冊信箱驗證</div>
                        <FormField label="註冊信箱"><Input type="email" autoComplete="email" value={roleEmail} onChange={(event) => setRoleEmail(event.target.value)} /></FormField>
                        <Button appearance="outline" onClick={sendRoleCode}>寄送驗證碼</Button>
                        {roleCodeSent && <>
                            <FormField label="六位數驗證碼"><Input inputMode="numeric" maxLength={6} value={roleCode} onChange={(event) => setRoleCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></FormField>
                            <FormField label="新六位數角色密碼"><Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={newRolePin} onChange={(event) => setNewRolePin(event.target.value.replace(/\D/g, "").slice(0, 6))} /></FormField>
                            <Button onClick={resetRolePin}><ShieldCheck />驗證並更新密碼</Button>
                        </>}
                    </div>}
                </DialogBody>
                <DialogFooter>
                    <DialogClose asChild><Button appearance="ghost" tone="muted">取消</Button></DialogClose>
                    {!roleResetOpen && <Button onClick={switchRole}><KeyRound />切換角色</Button>}
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
                    <div className="flex min-w-0 items-center gap-2"><LerniqaLogo /><Badge tone="primary">學習卡</Badge></div>
                    <p className="sidebar-brand-caption mt-1 text-xs text-muted-foreground">智慧卡牌學習平台</p>
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
                                <DropdownItem onSelect={() => navigateToSection("settings")}><UserCheck />個人設定</DropdownItem>
                                <DropdownItem onSelect={openRoleSwitch}><ShieldCheck />切換角色</DropdownItem>
                                <DropdownSub>
                                    <DropdownSubTrigger><GraduationCap />切換學習者</DropdownSubTrigger>
                                    <DropdownSubContent className="w-48">
                                        <DropdownRadioGroup value={activeLearnerId} onValueChange={changeLearner}>
                                            {learners.map((learner) => <DropdownRadioItem value={learner.id} key={learner.id}><DropdownIndicator>✓</DropdownIndicator>{learner.name}</DropdownRadioItem>)}
                                        </DropdownRadioGroup>
                                    </DropdownSubContent>
                                </DropdownSub>
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
                    {NAV_ITEMS.filter((item) => item.id !== "practice" && item.id !== "settings").map((item) => {
                        const Icon = item.icon;
                        const sidebarLabel = item.id === "overview" ? "學習總覽" : item.id === "questions" ? "題目總覽" : item.id === "bank" ? "題目匯入" : item.id === "mistakes" ? "錯題英雄榜" : "學習成果";
                        return <Button key={item.id} data-section={item.id} appearance="ghost" tone="muted" aria-current={section === item.id ? "page" : undefined} onClick={() => navigateToSection(item.id)}><span className={`sidebar-nav-icon sidebar-nav-icon-${item.id}`}><Icon /></span>{sidebarLabel}</Button>;
                    })}
                </nav>
                <Button className="sidebar-settings mt-1 w-full" data-section="settings" appearance="ghost" tone="muted" aria-current={section === "settings" ? "page" : undefined} onClick={() => navigateToSection("settings")}><span className="sidebar-nav-icon sidebar-nav-icon-settings"><Settings2 /></span>學習者設定</Button>
            </div>
            <div className="sidebar-tip mt-6"><Sparkles size={18} /><p>每天 15 分鐘，穩定累積練習進度。</p></div>
            </div>
        </aside>
        <section className="workspace min-w-0 p-5 sm:p-7 lg:p-9" data-workspace={section}>{section !== "practice" && <header className="mb-7 flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.15em] text-primary">{activeLearner.school}</p><h1 ref={headingRef} data-focus-heading tabIndex={-1} className="mt-1 text-2xl font-bold">{NAV_ITEMS.find((item) => item.id === section)?.label}</h1></div><div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays size={17} />{activeExam.name}</div></header>}{storageError && <p className="mb-5 rounded-xl border border-warning/30 bg-amber-50 p-3 text-sm" role="alert">{storageError}</p>}{renderSection()}</section>
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
                <span className="mobile-panel-toggle-copy"><strong>{section === "practice" ? "練習計劃與日曆" : "練習摘要"}</strong><small>{section === "practice" ? `${activeSchedules.length} 筆已安排練習` : `${activeAttempts.length} 題 · 正確率 ${reviewedAttempts.length ? `${accuracy}%` : "—"}`}</small></span>
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
                        <div><span>目前學習者</span><strong>{activeLearner.name}</strong></div>
                        <div><span>目前考試</span><strong>{activeExam.name}</strong></div>
                        <div><span>目標日期</span><strong>{activeExam.date || "尚未設定"}</strong></div>
                        <div><span>剩餘時間</span><strong>{dayDifference === null ? "—" : `${dayDifference} 天`}</strong></div>
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
                            <div className="min-w-0 flex-1"><p>已檢核正確率</p><strong>{reviewedAttempts.length ? `${accuracy}%` : "—"}</strong></div>
                            <Badge className="tag-pink" tone="danger">正確率</Badge>
                        </div>
                        <div className="summary-metric summary-metric-gold">
                            <div className="summary-metric-icon"><Sparkles size={19} /></div>
                            <div className="min-w-0 flex-1"><p>後續相近題</p><strong>{usableQueue.length} 題</strong></div>
                            <Badge className="tag-gold" tone="warning">待練習</Badge>
                            {usableQueue.length > 0 && <Button className="col-span-full mt-1 w-full" appearance="outline" onClick={() => beginSession("similar", usableQueue, "instant")}>開始後續練習</Button>}
                        </div>
                    </div>
                </section>
                <div className="summary-note">
                    <div className="flex items-center gap-2 font-semibold text-foreground"><UserCheck size={16} />資料說明</div>
                    <p>目前為前端示範。帳號、OCR、AI 題目與分享權限尚未連接正式服務。</p>
                    <div className="flex items-center gap-2"><Clock3 size={15} />資料由模擬 API 寫入本機 JSON</div>
                </div>
                </>}
            </div>
        </aside>}
    </div></main>;
}
