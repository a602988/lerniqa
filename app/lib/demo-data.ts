export type Section = "overview" | "practice" | "questions" | "bank" | "mistakes" | "results" | "settings";
export type CheckMode = "complete" | "instant" | "score";
export type PlanBasis = "chapter" | "assessment";
export type SessionMode = "practice" | "review" | "similar";
export type QuestionKind = "choice" | "boolean" | "written" | "multi-choice";
export type PlanQuestionKind = "all" | QuestionKind;
export type Subject = "數學" | "國語" | "英文" | "理化" | "生物" | "歷史" | "地理" | "公民";
export type AccountRole = "家長" | "學習者" | "家教";
export type ContentPlacement = "prompt" | "option" | "answer" | "explanation";
export type ContentType = "text" | "image" | "formula" | "table" | "page_crop";

export interface QuestionAsset {
    /** runtime asset 目錄中的檔案鍵值。 */
    storageKey: string;
    /** 檔案的 MIME type。 */
    mimeType: string;
    /** 圖片無法顯示時使用的替代文字。 */
    alt: string;
    /** 圖片原始寬度。 */
    width?: number;
    /** 圖片原始高度。 */
    height?: number;
}

export interface QuestionBlock {
    /** 區塊識別碼。 */
    id: string;
    /** 區塊在題目中的用途。 */
    placement: ContentPlacement;
    /** 區塊內容格式。 */
    type: ContentType;
    /** 同一用途內的顯示順序。 */
    order: number;
    /** 文字、公式或表格內容。 */
    text?: string;
    /** 圖片或原頁裁切圖。 */
    asset?: QuestionAsset;
    /** 選項區塊對應的選項位置。 */
    optionIndex?: number;
}

export interface QuestionSourceDetail {
    /** 原始來源檔名。 */
    documentName: string;
    /** 原始文件頁碼。 */
    page?: number;
    /** 原始文件中的題號。 */
    questionNumber?: string;
    /** 欄位資訊的判定來源。 */
    valueSource: "fixture" | "document" | "path" | "ai" | "user";
    /** 自動判定信心值，人工輸入與 fixture 使用 1。 */
    confidence: number;
}

export interface QuestionMetadataField {
    /** 可供 API 與前端穩定使用的欄位鍵值。 */
    key: string;
    /** 來源文件中的欄位名稱。 */
    label: string;
    /** 來源文件中的原始值，不改寫內容。 */
    rawValue: string;
    /** 正規化後可供複選篩選的值。 */
    values: string[];
    /** 欄位資訊的判定來源。 */
    valueSource: "fixture" | "document" | "path" | "ai" | "user";
    /** 自動判定信心值，人工輸入與 fixture 使用 1。 */
    confidence: number;
}

export interface RoleAccess {
    /** 目前操作介面使用的角色。 */
    activeRole: AccountRole;
    /** 忘記角色密碼時接收驗證信的註冊信箱。 */
    registrationEmail: string;
    /** 受保護角色的六位數密碼雜湊。 */
    pinHashes: Partial<Record<AccountRole, string>>;
    /** 各角色可以管理的學習者。 */
    learnerIdsByRole: Record<AccountRole, string[]>;
}

export interface ImportBook {
    /** 匯入本識別碼。 */
    id: string;
    /** 匯入本名稱。 */
    name: string;
    /** 建立匯入本的角色。 */
    ownerRole: AccountRole;
    /** 可以使用這本匯入本的學習者。 */
    learnerIds: string[];
    /** 建立時間。 */
    createdAt: string;
}

export interface QuestionPart {
    /** 題組內的小題識別碼。 */
    id: string;
    /** 小題題幹。 */
    prompt: string;
    /** 小題可選答案。 */
    options?: string[];
    /** 小題正確答案。 */
    answer: string;
}

export interface QuestionGroup {
    /** 同一大題共用的穩定識別碼。 */
    id: string;
    /** 目前題目在大題中的小題序號。 */
    part: number;
    /** 同一大題包含的小題總數。 */
    total: number;
}

export interface Learner {
    /** 學習者識別碼。 */
    id: string;
    /** 畫面顯示稱呼。 */
    name: string;
    /** 學習者目前年級。 */
    grade: string;
    /** 目前學期。 */
    semester: string;
    /** 各科目使用的書籍版本。 */
    bookVersions: Record<Subject, string>;
    /** 學校名稱。 */
    school: string;
    /** 學習者自行設定的代表圖片。 */
    avatar?: string;
    /** 每輪練習的預設題數。 */
    defaultQuestionLimit: number;
}

export interface AssessmentRange {
    /** 考試範圍的起始單元。 */
    start: string;
    /** 考試範圍的結束單元。 */
    end: string;
}

export interface ExamSetting {
    /** 考試設定識別碼。 */
    id: string;
    /** 考試名稱。 */
    name: string;
    /** 預定考試日期。 */
    date: string;
    /** 各科目套用的起訖範圍。 */
    ranges: Record<Subject, AssessmentRange>;
}

export interface PracticePlan {
    /** 建立計畫的角色。 */
    creatorRole: string;
    /** 科目篩選。 */
    subject: string;
    /** 本次練習暫時使用的書籍版本；未設定時沿用學習者設定。 */
    bookVersion?: string;
    /** 單元篩選。 */
    scope: string;
    /** 可重複建立的考試設定。 */
    examSettings: ExamSetting[];
    /** 目前練習與摘要套用的考試設定。 */
    activeExamId: string;
    /** 作答完成後的檢核方式。 */
    checkMode: CheckMode;
    /** 本輪最多題數。 */
    questionLimit: number;
    /** 練習範圍依章節或考試設定。 */
    basis: PlanBasis;
    /** 易、中、難題目占比。 */
    difficultyMix: { easy: number; medium: number; hard: number };
    /** 指定題目來源；空陣列代表全部來源。 */
    sourceFilters: string[];
    /** 指定題型；all 代表全部題型。 */
    questionKind: PlanQuestionKind;
    /** 指定知識點；all-knowledge 代表全部知識點。 */
    knowledge: string;
    /** 依來源文件動態欄位篩選；空陣列代表不限制該欄位。 */
    metadataFilters: Record<string, string[]>;
}

export interface ScheduledPractice {
    /** 排程識別碼。 */
    id: string;
    /** 建立排程的角色。 */
    creatorRole: AccountRole;
    /** 預定練習日期，格式為 YYYY-MM-DD。 */
    date: string;
    /** 選填的預定練習時間，格式為 HH:mm。 */
    time?: string;
    /** 清單顯示的科目名稱。 */
    subjectLabel: string;
    /** 清單顯示的練習範圍。 */
    scopeLabel: string;
    /** 排程固定的檢核方式。 */
    checkMode: CheckMode;
    /** 安排當下固定的題目順序。 */
    questionIds: number[];
    /** 排程建立時間。 */
    createdAt: string;
    /** 最近一次完整完成排程的結果。 */
    result?: ScheduledPracticeResult;
}

export interface ScheduledPracticeResult {
    /** 產生結果的練習識別碼。 */
    sessionId: string;
    /** 完成整輪練習的時間。 */
    completedAt: string;
    /** 本輪實際作答總題數。 */
    totalQuestions: number;
    /** 本輪答錯題數。 */
    wrongQuestions: number;
    /** 答對題數占總題數的百分比。 */
    accuracy: number;
}

export interface QuestionCollection {
    /** 收藏清單識別碼。 */
    id: string;
    /** 收藏清單名稱。 */
    name: string;
    /** 收藏題目識別碼。 */
    questionIds: number[];
    /** 清單建立時間。 */
    createdAt: string;
}

export interface Question {
    /** 題目識別碼。 */
    id: number;
    /** 來源文件中的穩定題目編號。 */
    code?: string;
    /** 題目科目。 */
    subject: Subject;
    /** 適用年級。 */
    grade: string;
    /** 適用學期。 */
    semester?: string;
    /** 題目使用的書籍版本。 */
    bookVersion?: string;
    /** 題目所在章或課次。 */
    chapter?: string;
    /** 教學單元。 */
    unit: string;
    /** 跨版本共用的學習主題。 */
    topic?: string;
    /** 知識點。 */
    knowledge: string;
    /** 題目難度。 */
    difficulty: "基礎" | "中等" | "進階";
    /** 作答形式。 */
    kind: QuestionKind;
    /** 原始文件中的題型名稱。 */
    typeLabel?: string;
    /** 題目拆分後所屬的大題與小題位置。 */
    group?: QuestionGroup;
    /** 題幹。 */
    prompt: string;
    /** 選項式題目的答案選項。 */
    options?: string[];
    /** 配合題、選詞測驗與題組中的多個選擇小題。 */
    parts?: QuestionPart[];
    /** 可比較的文字正解。 */
    answer: string;
    /** 來源文件中原樣呈現的參考答案。 */
    sourceAnswer?: string;
    /** 作答解析。 */
    explanation: string;
    /** 題目來源。 */
    source: string;
    /** 可追溯到原始文件的來源資訊。 */
    sourceDetail?: QuestionSourceDetail;
    /** 來源文件的完整原始欄位與可篩選值。 */
    metadata?: QuestionMetadataField[];
    /** 題幹、選項、答案與解析的有序內容區塊。 */
    blocks?: QuestionBlock[];
    /** 相近題所對應的原始錯題。 */
    generatedFrom?: number;
}

export interface AttemptPartResult {
    /** 題組內的小題識別碼。 */
    partId: string;
    /** 學習者輸入的小題答案。 */
    answer: string;
    /** 小題答案是否正確。 */
    correct: boolean;
}

export interface Attempt {
    /** 所屬練習的識別碼；舊資料可能沒有此欄位。 */
    sessionId?: string;
    /** 所屬練習用途；舊資料可能沒有此欄位。 */
    sessionMode?: SessionMode;
    /** 題目識別碼。 */
    questionId: number;
    /** 學習者輸入的答案。 */
    answer: string;
    /** 是否答對；純手寫且未輸入文字時為待檢視。 */
    correct: boolean | null;
    /** 複合題各小題的作答結果；舊資料可能沒有此欄位。 */
    partResults?: AttemptPartResult[];
    /** 作答完成時間。 */
    date: string;
    /** 作答耗時秒數。 */
    durationSeconds: number;
    /** 手寫板原始影像。 */
    handwriting?: string;
    /** 鍵盤輸入的計算或書寫筆記。 */
    handwritingNote?: string;
}

export interface PracticeSession {
    /** 本輪練習識別碼。 */
    id: string;
    /** 本輪開始時間。 */
    startedAt: string;
    /** 本輪所屬學習者，避免切換後寫入錯誤資料桶。 */
    learnerId: string;
    /** 本輪用途。 */
    mode: SessionMode;
    /** 從練習計劃開始時對應的排程識別碼。 */
    scheduleId?: string;
    /** 作答檢核方式。 */
    checkMode: CheckMode;
    /** 本輪所處階段。 */
    phase: "answering" | "complete";
    /** 開始時固定的題目順序。 */
    questionIds: number[];
    /** 錯題複習時，各題只需再次作答的小題識別碼。 */
    partIdsByQuestion?: Record<number, string[]>;
    /** 目前題號。 */
    index: number;
    /** 本輪作答結果。 */
    attempts: Attempt[];
    /** 目前題目開始作答時間。 */
    questionStartedAt: number;
}

export interface StoredState {
    /** 所有學習者設定。 */
    learners: Learner[];
    /** 目前學習者識別碼。 */
    activeLearnerId: string;
    /** 各學習者的作答紀錄。 */
    attemptsByLearner: Record<string, Attempt[]>;
    /** 各學習者自己的練習計畫。 */
    plansByLearner: Record<string, PracticePlan>;
    /** 各學習者依日期安排的練習計劃。 */
    schedulesByLearner: Record<string, ScheduledPractice[]>;
    /** 已加入後續練習的相近題。 */
    queuedSimilarByLearner: Record<string, number[]>;
    /** 各學習者建立的題目收藏清單。 */
    questionCollectionsByLearner: Record<string, QuestionCollection[]>;
    /** 帳號角色與角色密碼設定。 */
    roleAccess: RoleAccess;
    /** 使用者自行建立的匯入本。 */
    importBooks: ImportBook[];
}

export interface ImportBatch {
    /** 匯入批次識別碼。 */
    id: string;
    /** 匯入批次建立時間。 */
    createdAt: string;
    /** 匯入時使用的原始檔名。 */
    fileNames: string[];
    /** 這個批次寫入的題目識別碼。 */
    questionIds: number[];
    /** 匯入資料的確認狀態。 */
    status: "confirmed";
    /** 題目寫入的匯入本識別碼；舊資料未設定時使用系統預設。 */
    bookId?: string;
    /** 匯入當下的題本名稱。 */
    bookName?: string;
    /** 執行匯入的角色。 */
    ownerRole?: AccountRole;
    /** 匯入內容所屬的學習者。 */
    learnerId?: string;
}

export interface MockDatabase {
    /** JSON 資料契約版本。 */
    version: number;
    /** 可由 API 修改的學習與練習狀態。 */
    state: StoredState;
    /** 題庫中的完整題目資料。 */
    questions: Question[];
    /** 已確認寫入的匯入批次。 */
    imports: ImportBatch[];
}

export const ALL_UNITS = "all-units";
export const ALL_KNOWLEDGE = "all-knowledge";
export const FILE_SIZE_LIMIT = 10 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES = ["image/jpeg", "image/png", "application/pdf"];

export const GRADE_OPTIONS = ["小四", "小五", "國一", "國二", "國三"].map((value) => ({ value, label: value }));
export const SEMESTER_OPTIONS = ["上學期", "下學期"].map((value) => ({ value, label: value }));
export const BOOK_OPTIONS = ["康軒", "南一", "翰林"].map((value) => ({ value, label: value }));
export const SUBJECTS: Subject[] = ["數學", "國語", "英文", "理化", "生物", "歷史", "地理", "公民"];
export const ASSESSMENT_OPTIONS = ["第一次定期評量", "第二次定期評量", "第三次定期評量", "自訂練習"]
    .map((value) => ({ value, label: value }));
export const ROLE_OPTIONS = (["家長", "學習者", "家教"] satisfies AccountRole[]).map((value) => ({ value, label: value }));
export const REVIEWER_OPTIONS = ["家長 · 林小姐", "家教 · 陳老師", "自訂 · 課後陪讀"]
    .map((value) => ({ value, label: value }));

export const DEFAULT_ROLE_ACCESS: RoleAccess = {
    activeRole: "家長",
    registrationEmail: "parent@example.com",
    pinHashes: {
        家長: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
        家教: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
    },
    learnerIdsByRole: {
        家長: [],
        學習者: [],
        家教: [],
    },
};

export const DEFAULT_ASSESSMENT_RANGES: Record<Subject, AssessmentRange> = {
    數學: { start: ALL_UNITS, end: ALL_UNITS },
    國語: { start: ALL_UNITS, end: ALL_UNITS },
    英文: { start: ALL_UNITS, end: ALL_UNITS },
    理化: { start: ALL_UNITS, end: ALL_UNITS },
    生物: { start: ALL_UNITS, end: ALL_UNITS },
    歷史: { start: ALL_UNITS, end: ALL_UNITS },
    地理: { start: ALL_UNITS, end: ALL_UNITS },
    公民: { start: ALL_UNITS, end: ALL_UNITS },
};

export const DEFAULT_EXAM_SETTING: ExamSetting = {
    id: "exam-1",
    name: "第一次定期評量",
    date: "2026-11-05",
    ranges: DEFAULT_ASSESSMENT_RANGES,
};

export const DEFAULT_PLAN: PracticePlan = {
    creatorRole: "家長",
    subject: "數學",
    scope: ALL_UNITS,
    examSettings: [DEFAULT_EXAM_SETTING],
    activeExamId: DEFAULT_EXAM_SETTING.id,
    checkMode: "complete",
    questionLimit: 10,
    basis: "chapter",
    difficultyMix: { easy: 40, medium: 40, hard: 20 },
    sourceFilters: [],
    questionKind: "all",
    knowledge: ALL_KNOWLEDGE,
    metadataFilters: {},
};

/**
 * 以題目科目與單元建立穩定篩選值。
 *
 * @param question 題目資料。
 * @returns 可保存的單元範圍識別碼。
 */
export function getUnitScopeValue(question: Pick<Question, "subject" | "unit">) {
    return `${question.subject}::${question.unit}`;
}

/**
 * 將來源檔名保存的單元值整理成畫面標籤。
 *
 * @param unit 來源文件檔名去除副檔名後的單元值。
 * @returns 保留原始編號並整理分隔符號的單元標籤。
 */
export function getUnitLabel(unit: string) {
    return unit
        .replace(/_/g, " ")
        .replace(/^(\d+(?:-\d+)+)(?=[^\s0-9-])/, "$1 ")
        .replace(/[\s　]+/g, " ")
        .trim();
}

/**
 * 比對輸入答案，不讓空白或英文大小寫影響示範結果。
 *
 * @param question 目前題目。
 * @param answer 學習者輸入答案。
 * @returns 答案是否正確。
 */
export function checkAnswer(question: Question, answer: string, partIds?: string[]) {
    if (question.parts?.length) {
        const results = getQuestionPartResults(question, answer, partIds);
        return results.length > 0 && results.every((result) => result.correct);
    }
    return answersMatch(answer, question.answer);
}

/**
 * 逐一比對複合題的小題答案。
 *
 * @param question 目前題目。
 * @param answer 學習者輸入的結構化答案。
 * @param partIds 只需檢核的小題識別碼；省略時檢核全部小題。
 * @returns 依題目原始順序排列的小題結果。
 */
export function getQuestionPartResults(question: Question, answer: string, partIds?: string[]) {
    const targetIds = partIds?.length ? new Set(partIds) : undefined;
    const parts = question.parts?.filter((part) => !targetIds || targetIds.has(part.id)) ?? [];
    let selected: unknown[] = [];
    try {
        const parsed = JSON.parse(answer) as unknown;
        if (Array.isArray(parsed)) selected = parsed;
    }
    catch {
        selected = [];
    }

    return parts.map((part) => {
        const sourceIndex = question.parts?.findIndex((candidate) => candidate.id === part.id) ?? -1;
        const partAnswer = sourceIndex >= 0 ? String(selected[sourceIndex] ?? "") : "";
        const correct = question.kind === "written"
            ? answersMatch(partAnswer, part.answer)
            : partAnswer === part.answer;
        return { partId: part.id, answer: partAnswer, correct };
    });
}

/** 將正負號簡寫展開，讓集合答案不受輸入順序與標點影響。 */
function getAnswerTokens(value: string) {
    const normalized = value.normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[−–—]/g, "-")
        .replace(/±\s*(\d+(?:\.\d+)?)/g, "-$1,$1")
        .replace(/^[（(]\d+[）)]\s*/, "")
        .replace(/[。．]/g, "")
        .trim();
    const tokens = normalized.split(/[、,，;；\s]+/).filter(Boolean);
    return tokens.length > 1 ? tokens.sort() : [normalized.replace(/\s+/g, "")];
}

/** 比對單一文字或不計順序的集合型答案。 */
function answersMatch(input: string, expected: string) {
    const inputTokens = getAnswerTokens(input);
    const expectedTokens = getAnswerTokens(expected);
    return inputTokens.length === expectedTokens.length
        && inputTokens.every((value, index) => value === expectedTokens[index]);
}

/**
 * 將系統保存的作答值轉成成果頁可讀文字。
 *
 * @param question 作答所屬題目。
 * @param answer 系統保存的答案字串。
 * @returns 顯示給學習者的答案。
 */
export function formatAnswer(question: Question, answer: string) {
    if (answer === question.answer && question.sourceAnswer) return question.sourceAnswer;
    if (!question.parts?.length) return answer;
    try {
        const selected = JSON.parse(answer) as unknown;
        if (!Array.isArray(selected)) return answer;
        return selected.map((item, index) => `(${index + 1})${String(item)}`).join("；");
    }
    catch {
        return answer;
    }
}

/**
 * 取得題目類型的顯示名稱。
 *
 * @param kind 題目作答形式。
 * @returns 繁體中文類型名稱。
 */
export function getQuestionKindLabel(kind: QuestionKind) {
    if (kind === "boolean") return "是非題";
    if (kind === "written") return "書寫題";
    if (kind === "multi-choice") return "複合選擇題";
    return "選擇題";
}
