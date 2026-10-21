export const QUESTION_IMPORT_SCHEMA_VERSION = 2;
export const MAX_IMPORT_QUESTIONS = 100;
export const MAX_IMPORT_PARTS = 50;
export const MAX_IMPORT_HINTS = 10;

export type ImportAnswerMode = "single_choice" | "multiple_choice" | "boolean" | "text";
export type ImportGradingPolicy = "automatic" | "manual_review" | "ai_assisted_review";

export type ImportContentBlock =
    | { kind: "text"; text: string }
    | { kind: "formula"; tex: string }
    | { kind: "table"; rows: string[][] }
    | { kind: "image"; assetId: string; alt: string }
    | { kind: "page_crop"; assetId: string; alt: string };

export interface ImportOptionDraft {
    key: string;
    blocks: ImportContentBlock[];
}

export interface ImportPartDraft {
    stableKey: string;
    parentStableKey: string | null;
    prompt: ImportContentBlock[];
    answerMode: ImportAnswerMode;
    answerFieldCount: number;
    gradingPolicy: ImportGradingPolicy;
    options: ImportOptionDraft[];
    answers: string[];
    hints: ImportContentBlock[][];
    explanation: ImportContentBlock[];
}

export interface ImportQuestionClassification {
    fieldId: string;
    optionIds: string[];
}

export interface ImportQuestionDraft {
    draftKey: string;
    classifications: ImportQuestionClassification[];
    sourceQuestionNumber: string | null;
    sourcePage: number | null;
    sharedPrompt: ImportContentBlock[];
    parts: ImportPartDraft[];
}

export interface QuestionImportPackage {
    schemaVersion: 2;
    learnerId: string;
    idempotencyKey: string;
    sourceBatchId: string | null;
    sourceTitle: string;
    catalog: {
        subjectId: string;
        gradeId: string | null;
        semesterId: string | null;
        bookVersionId: string | null;
        curriculumUnitId: string | null;
        difficultyLevelId: string | null;
        sourceCategoryId: string | null;
        questionTypeId: string | null;
    };
    questions: ImportQuestionDraft[];
}

export interface QuestionDraftPackage {
    schemaVersion: 2;
    sourceTitle: string;
    questions: ImportQuestionDraft[];
}

export interface ImportContractError {
    path: string;
    message: string;
}

export type ImportContractResult =
    | { ok: true; value: QuestionImportPackage }
    | { ok: false; errors: ImportContractError[] };

export type QuestionDraftContractResult =
    | { ok: true; value: QuestionDraftPackage }
    | { ok: false; errors: ImportContractError[] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const ANSWER_MODES = new Set<ImportAnswerMode>(["single_choice", "multiple_choice", "boolean", "text"]);
const GRADING_POLICIES = new Set<ImportGradingPolicy>(["automatic", "manual_review", "ai_assisted_review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const expected = new Set(keys);
    return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function cleanText(value: unknown, maximum: number, allowEmpty = false): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.normalize("NFC").trim();
    if ((!allowEmpty && !normalized) || normalized.length > maximum || CONTROL_PATTERN.test(normalized)) return null;
    return normalized;
}

function parseUuid(value: unknown): string | null {
    return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function parseNullableUuid(value: unknown): string | null | undefined {
    if (value === null) return null;
    return parseUuid(value) ?? undefined;
}

function push(errors: ImportContractError[], path: string, message: string): null {
    errors.push({ path, message });
    return null;
}

function parseBlock(value: unknown, path: string, errors: ImportContractError[]): ImportContentBlock | null {
    if (!isRecord(value) || typeof value.kind !== "string") return push(errors, path, "內容區塊格式不正確。");
    if (value.kind === "text" && exactKeys(value, ["kind", "text"])) {
        const text = cleanText(value.text, 20_000);
        return text ? { kind: "text", text } : push(errors, `${path}.text`, "文字不可為空或超過 20,000 字元。");
    }
    if (value.kind === "formula" && exactKeys(value, ["kind", "tex"])) {
        const tex = cleanText(value.tex, 5_000);
        return tex ? { kind: "formula", tex } : push(errors, `${path}.tex`, "公式不可為空或超過 5,000 字元。");
    }
    if (value.kind === "table" && exactKeys(value, ["kind", "rows"])) {
        if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 100) {
            return push(errors, `${path}.rows`, "表格必須有 1 至 100 列。");
        }
        const rows = value.rows.flatMap((row, rowIndex): string[][] => {
            if (!Array.isArray(row) || row.length < 1 || row.length > 30) {
                push(errors, `${path}.rows[${rowIndex}]`, "每列表格必須有 1 至 30 欄。");
                return [];
            }
            const cells = row.map((cell, cellIndex) => cleanText(cell, 2_000, true)
                ?? push(errors, `${path}.rows[${rowIndex}][${cellIndex}]`, "儲存格格式不正確或超過 2,000 字元。"));
            return cells.every((cell): cell is string => cell !== null) ? [cells] : [];
        });
        const columnCount = rows[0]?.length;
        if (rows.length !== value.rows.length || !columnCount || rows.some((row) => row.length !== columnCount)) {
            if (rows.length === value.rows.length) push(errors, `${path}.rows`, "表格每列的欄數必須一致。");
            return null;
        }
        return { kind: "table", rows };
    }
    if ((value.kind === "image" || value.kind === "page_crop") && exactKeys(value, ["kind", "assetId", "alt"])) {
        const assetId = parseUuid(value.assetId);
        const alt = cleanText(value.alt, 300);
        if (!assetId) return push(errors, `${path}.assetId`, "圖片資產識別碼格式不正確。");
        if (!alt) return push(errors, `${path}.alt`, "圖片替代文字不可為空或超過 300 字元。");
        return { kind: value.kind, assetId, alt };
    }
    return push(errors, path, "內容區塊含有未知欄位或不支援的類型。");
}

function parseBlocks(value: unknown, path: string, errors: ImportContractError[], allowEmpty: boolean): ImportContentBlock[] | null {
    if (!Array.isArray(value) || value.length > 100 || (!allowEmpty && value.length === 0)) {
        return push(errors, path, allowEmpty ? "內容區塊最多 100 筆。" : "至少需要一個內容區塊，且最多 100 筆。");
    }
    const blocks = value.map((block, index) => parseBlock(block, `${path}[${index}]`, errors));
    return blocks.every((block): block is ImportContentBlock => block !== null) ? blocks : null;
}

function parseOption(value: unknown, path: string, errors: ImportContractError[]): ImportOptionDraft | null {
    if (!isRecord(value) || !exactKeys(value, ["key", "blocks"])) return push(errors, path, "選項格式不正確或含有未知欄位。");
    const key = cleanText(value.key, 30);
    const blocks = parseBlocks(value.blocks, `${path}.blocks`, errors, false);
    return key && blocks ? { key, blocks } : key ? null : push(errors, `${path}.key`, "選項鍵值不可為空或超過 30 字元。");
}

function parsePart(value: unknown, path: string, errors: ImportContractError[]): ImportPartDraft | null {
    const keys = ["stableKey", "parentStableKey", "prompt", "answerMode", "answerFieldCount", "gradingPolicy", "options", "answers", "explanation"];
    const keysWithHints = [...keys, "hints"];
    if (!isRecord(value) || (!exactKeys(value, keys) && !exactKeys(value, keysWithHints))) {
        return push(errors, path, "小題格式不正確或含有未知欄位。");
    }
    const stableKey = typeof value.stableKey === "string" && KEY_PATTERN.test(value.stableKey) ? value.stableKey : null;
    const parentStableKey = value.parentStableKey === null
        ? null
        : typeof value.parentStableKey === "string" && KEY_PATTERN.test(value.parentStableKey) ? value.parentStableKey : undefined;
    const prompt = parseBlocks(value.prompt, `${path}.prompt`, errors, true);
    const explanation = parseBlocks(value.explanation, `${path}.explanation`, errors, true);
    const hintValues = value.hints ?? [];
    if (!Array.isArray(hintValues) || hintValues.length > MAX_IMPORT_HINTS) {
        push(errors, `${path}.hints`, `作答前提示最多 ${MAX_IMPORT_HINTS} 組。`);
    }
    const hints = Array.isArray(hintValues)
        ? hintValues.map((hint, index) => parseBlocks(hint, `${path}.hints[${index}]`, errors, false))
        : [];
    const answerMode = ANSWER_MODES.has(value.answerMode as ImportAnswerMode) ? value.answerMode as ImportAnswerMode : null;
    const gradingPolicy = GRADING_POLICIES.has(value.gradingPolicy as ImportGradingPolicy) ? value.gradingPolicy as ImportGradingPolicy : null;
    const answerFieldCount = Number.isInteger(value.answerFieldCount) && Number(value.answerFieldCount) >= 1 && Number(value.answerFieldCount) <= 8
        ? Number(value.answerFieldCount)
        : null;
    if (!Array.isArray(value.options) || value.options.length > 20) push(errors, `${path}.options`, "選項最多 20 筆。");
    if (!Array.isArray(value.answers) || value.answers.length > 20) push(errors, `${path}.answers`, "答案最多 20 筆。");
    const options = Array.isArray(value.options)
        ? value.options.map((option, index) => parseOption(option, `${path}.options[${index}]`, errors))
        : [];
    const answers = Array.isArray(value.answers)
        ? value.answers.map((answer, index) => cleanText(answer, 10_000)
            ?? push(errors, `${path}.answers[${index}]`, "答案不可為空或超過 10,000 字元。"))
        : [];

    if (!stableKey) push(errors, `${path}.stableKey`, "小題穩定鍵值格式不正確。");
    if (parentStableKey === undefined) push(errors, `${path}.parentStableKey`, "上層小題鍵值格式不正確。");
    if (!answerMode) push(errors, `${path}.answerMode`, "作答方式不受支援。");
    if (!gradingPolicy) push(errors, `${path}.gradingPolicy`, "判分方式不受支援。");
    if (!answerFieldCount) push(errors, `${path}.answerFieldCount`, "答案欄位數必須介於 1 至 8。");
    if (answerMode && answerMode !== "text" && answerFieldCount !== 1) push(errors, `${path}.answerFieldCount`, "只有文字題可以使用多個答案欄位。");
    if (answerFieldCount && answerFieldCount > 1 && gradingPolicy !== "manual_review") push(errors, `${path}.gradingPolicy`, "多欄文字題必須使用人工檢視。");
    if (answerMode && ["single_choice", "multiple_choice", "boolean"].includes(answerMode) && options.length < 2) {
        push(errors, `${path}.options`, "選擇類題目至少需要兩個選項。");
    }
    if (answerMode === "text" && options.length > 0) push(errors, `${path}.options`, "文字題不能建立選項。");
    if (gradingPolicy === "automatic" && answers.length === 0) push(errors, `${path}.answers`, "自動判分題目必須提供答案。");
    const optionKeys = options.flatMap((option) => option ? [option.key] : []);
    if (new Set(optionKeys).size !== optionKeys.length) push(errors, `${path}.options`, "同一小題的選項鍵值不可重複。");
    if (answerMode && ["single_choice", "multiple_choice", "boolean"].includes(answerMode)
        && answers.some((answer) => typeof answer === "string" && !optionKeys.includes(answer))) {
        push(errors, `${path}.answers`, "選擇類答案必須指向同一小題的選項鍵值。");
    }
    if (answerMode === "single_choice" || answerMode === "boolean") {
        if (answers.length > 1) push(errors, `${path}.answers`, "單選與是非題只能有一個答案鍵值。");
    }
    if (!stableKey || parentStableKey === undefined || !prompt || !explanation || !answerMode || !gradingPolicy || !answerFieldCount
        || hints.some((hint) => hint === null)
        || options.some((option) => option === null) || answers.some((answer) => answer === null)) return null;
    return {
        stableKey,
        parentStableKey,
        prompt,
        answerMode,
        answerFieldCount,
        gradingPolicy,
        options: options as ImportOptionDraft[],
        answers: answers as string[],
        hints: hints as ImportContentBlock[][],
        explanation,
    };
}

function parseClassification(value: unknown, path: string, errors: ImportContractError[]): ImportQuestionClassification | null {
    if (!isRecord(value) || !exactKeys(value, ["fieldId", "optionIds"])) {
        return push(errors, path, "題目分類格式不正確或含有未知欄位。");
    }
    const fieldId = parseUuid(value.fieldId);
    const optionIds = Array.isArray(value.optionIds) ? value.optionIds.map(parseUuid) : [];
    if (!fieldId) push(errors, `${path}.fieldId`, "分類欄位識別碼格式不正確。");
    if (!Array.isArray(value.optionIds) || value.optionIds.length < 1 || value.optionIds.length > 20
        || optionIds.some((optionId) => optionId === null)) {
        push(errors, `${path}.optionIds`, "分類選項必須包含 1 至 20 個有效識別碼。");
    }
    if (new Set(optionIds).size !== optionIds.length) push(errors, `${path}.optionIds`, "同一分類的選項不可重複。");
    if (!fieldId || optionIds.some((optionId) => optionId === null)) return null;
    return { fieldId, optionIds: optionIds as string[] };
}

function parseQuestion(value: unknown, path: string, errors: ImportContractError[], legacy = false): ImportQuestionDraft | null {
    const keys = legacy
        ? ["sourceQuestionNumber", "sourcePage", "sharedPrompt", "parts"]
        : ["draftKey", "classifications", "sourceQuestionNumber", "sourcePage", "sharedPrompt", "parts"];
    if (!isRecord(value) || !exactKeys(value, keys)) {
        return push(errors, path, "題目格式不正確或含有未知欄位。");
    }
    const draftKey = legacy ? globalThis.crypto.randomUUID() : parseUuid(value.draftKey);
    if (!draftKey) push(errors, `${path}.draftKey`, "題目草稿識別碼格式不正確。");
    const classifications = legacy
        ? []
        : Array.isArray(value.classifications)
            ? value.classifications.map((item, index) => parseClassification(item, `${path}.classifications[${index}]`, errors))
            : [];
    if (!legacy && (!Array.isArray(value.classifications) || value.classifications.length > 30)) {
        push(errors, `${path}.classifications`, "題目分類最多 30 組。");
    }
    const fieldIds = classifications.flatMap((item) => item ? [item.fieldId] : []);
    if (new Set(fieldIds).size !== fieldIds.length) push(errors, `${path}.classifications`, "同一題的分類欄位不可重複。");
    const sourceQuestionNumber = value.sourceQuestionNumber === null ? null : cleanText(value.sourceQuestionNumber, 80);
    if (sourceQuestionNumber === null && value.sourceQuestionNumber !== null) push(errors, `${path}.sourceQuestionNumber`, "來源題號格式不正確。");
    const sourcePage = value.sourcePage === null
        ? null
        : Number.isInteger(value.sourcePage) && Number(value.sourcePage) >= 1 ? Number(value.sourcePage) : undefined;
    if (sourcePage === undefined) push(errors, `${path}.sourcePage`, "來源頁碼必須是正整數或 null。");
    const sharedPrompt = parseBlocks(value.sharedPrompt, `${path}.sharedPrompt`, errors, true);
    if (!Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > MAX_IMPORT_PARTS) {
        push(errors, `${path}.parts`, `每題必須有 1 至 ${MAX_IMPORT_PARTS} 個小題。`);
        return null;
    }
    const parts = value.parts.map((part, index) => parsePart(part, `${path}.parts[${index}]`, errors));
    const validParts = parts.flatMap((part) => part ? [part] : []);
    const stableKeys = validParts.map((part) => part.stableKey);
    if (new Set(stableKeys).size !== stableKeys.length) push(errors, `${path}.parts`, "同一題的小題穩定鍵值不可重複。");
    for (const [index, part] of validParts.entries()) {
        if (part.parentStableKey && (!stableKeys.includes(part.parentStableKey) || part.parentStableKey === part.stableKey)) {
            push(errors, `${path}.parts[${index}].parentStableKey`, "上層小題必須指向同一題的其他小題。");
        }
    }
    if (!draftKey || !sharedPrompt || parts.some((part) => part === null) || classifications.some((item) => item === null)) return null;
    const hasPrompt = sharedPrompt.length > 0 || validParts.some((part) => part.prompt.length > 0);
    if (!hasPrompt) {
        push(errors, path, "題目必須有共用題幹或小題題幹。");
        return null;
    }
    return {
        draftKey,
        classifications: classifications as ImportQuestionClassification[],
        sourceQuestionNumber,
        sourcePage: sourcePage ?? null,
        sharedPrompt,
        parts: validParts,
    };
}

export function parseQuestionImportPackage(value: unknown): ImportContractResult {
    const errors: ImportContractError[] = [];
    const keys = ["schemaVersion", "learnerId", "idempotencyKey", "sourceBatchId", "sourceTitle", "catalog", "questions"];
    if (!isRecord(value) || !exactKeys(value, keys)) return { ok: false, errors: [{ path: "$", message: "匯入封裝格式不正確或含有未知欄位。" }] };
    if (value.schemaVersion !== QUESTION_IMPORT_SCHEMA_VERSION) push(errors, "$.schemaVersion", "不支援這個匯入格式版本。");
    const learnerId = parseUuid(value.learnerId);
    const idempotencyKey = cleanText(value.idempotencyKey, 120);
    const sourceBatchId = parseNullableUuid(value.sourceBatchId);
    const sourceTitle = cleanText(value.sourceTitle, 300);
    if (!learnerId) push(errors, "$.learnerId", "學習者識別碼格式不正確。");
    if (!idempotencyKey) push(errors, "$.idempotencyKey", "冪等鍵不可為空或超過 120 字元。");
    if (sourceBatchId === undefined) push(errors, "$.sourceBatchId", "來源批次識別碼格式不正確。");
    if (!sourceTitle) push(errors, "$.sourceTitle", "來源名稱不可為空或超過 300 字元。");

    const catalogKeys = ["subjectId", "gradeId", "semesterId", "bookVersionId", "curriculumUnitId", "difficultyLevelId", "sourceCategoryId", "questionTypeId"];
    if (!isRecord(value.catalog) || !exactKeys(value.catalog, catalogKeys)) push(errors, "$.catalog", "題目分類格式不正確或含有未知欄位。");
    const catalog = isRecord(value.catalog) ? {
        subjectId: parseUuid(value.catalog.subjectId),
        gradeId: parseNullableUuid(value.catalog.gradeId),
        semesterId: parseNullableUuid(value.catalog.semesterId),
        bookVersionId: parseNullableUuid(value.catalog.bookVersionId),
        curriculumUnitId: parseNullableUuid(value.catalog.curriculumUnitId),
        difficultyLevelId: parseNullableUuid(value.catalog.difficultyLevelId),
        sourceCategoryId: parseNullableUuid(value.catalog.sourceCategoryId),
        questionTypeId: parseNullableUuid(value.catalog.questionTypeId),
    } : null;
    if (catalog) {
        for (const [key, item] of Object.entries(catalog)) {
            if (item === undefined || (item === null && key === "subjectId")) {
                push(errors, `$.catalog.${key}`, "分類識別碼格式不正確。");
            }
        }
    }

    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > MAX_IMPORT_QUESTIONS) {
        push(errors, "$.questions", `每次必須匯入 1 至 ${MAX_IMPORT_QUESTIONS} 題。`);
    }
    const questions = Array.isArray(value.questions)
        ? value.questions.map((question, index) => parseQuestion(question, `$.questions[${index}]`, errors))
        : [];
    if (errors.length || !learnerId || !idempotencyKey || sourceBatchId === undefined || !sourceTitle || !catalog || questions.some((question) => question === null)) {
        return { ok: false, errors };
    }
    return {
        ok: true,
        value: {
            schemaVersion: 2,
            learnerId,
            idempotencyKey,
            sourceBatchId,
            sourceTitle,
            catalog: catalog as QuestionImportPackage["catalog"],
            questions: questions as ImportQuestionDraft[],
        },
    };
}

export function parseQuestionDraftPackage(value: unknown): QuestionDraftContractResult {
    const errors: ImportContractError[] = [];
    const keys = ["schemaVersion", "sourceTitle", "questions"];
    if (!isRecord(value) || !exactKeys(value, keys)) {
        return { ok: false, errors: [{ path: "$", message: "題目草稿格式不正確或含有未知欄位。" }] };
    }
    const legacy = value.schemaVersion === 1;
    if (!legacy && value.schemaVersion !== QUESTION_IMPORT_SCHEMA_VERSION) push(errors, "$.schemaVersion", "不支援這個草稿格式版本。");
    const sourceTitle = cleanText(value.sourceTitle, 300);
    if (!sourceTitle) push(errors, "$.sourceTitle", "草稿名稱不可為空或超過 300 字元。");
    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > MAX_IMPORT_QUESTIONS) {
        push(errors, "$.questions", `每份草稿必須包含 1 至 ${MAX_IMPORT_QUESTIONS} 題。`);
    }
    const questions = Array.isArray(value.questions)
        ? value.questions.map((question, index) => parseQuestion(question, `$.questions[${index}]`, errors, legacy))
        : [];
    if (errors.length || !sourceTitle || questions.some((question) => question === null)) return { ok: false, errors };
    return {
        ok: true,
        value: {
            schemaVersion: 2,
            sourceTitle,
            questions: questions as ImportQuestionDraft[],
        },
    };
}

export function createBlankImportQuestion(): ImportQuestionDraft {
    return {
        draftKey: globalThis.crypto.randomUUID(),
        classifications: [],
        sourceQuestionNumber: null,
        sourcePage: null,
        sharedPrompt: [{ kind: "text", text: "" }],
        parts: [{
            stableKey: "main",
            parentStableKey: null,
            prompt: [],
            answerMode: "text",
            answerFieldCount: 1,
            gradingPolicy: "manual_review",
            options: [],
            answers: [],
            hints: [],
            explanation: [],
        }],
    };
}
