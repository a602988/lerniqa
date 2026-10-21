import type {
    ImportContentBlock,
    ImportOptionDraft,
    ImportPartDraft,
    ImportQuestionDraft,
    QuestionDraftPackage,
} from "./question-import-contract.ts";
import { parseQuestionDraftPackage } from "./question-import-contract.ts";
import {
    createQuestionFromTemplate,
    inferQuestionTemplate,
    QUESTION_TEMPLATE_IDS,
    type QuestionTemplateId,
} from "./question-authoring-templates.ts";

export const QUESTION_EXCHANGE_SCHEMA_VERSION = 1;

const PLACEHOLDER_ASSET_ID = "00000000-0000-4000-8000-000000000001";
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const TEMPLATE_IDS = new Set<string>(QUESTION_TEMPLATE_IDS);
const QUESTION_TEMPLATE_PROMPT_RULES: Record<QuestionTemplateId, string> = {
    "single-choice": "至少兩個文字選項，只能選一個答案；answerMode 使用 single_choice",
    "image-choice": "至少兩個圖片選項，只能選一個答案；answerMode 使用 single_choice",
    "multiple-choice": "至少兩個選項，而且可選多個答案；answerMode 使用 multiple_choice",
    "true-false": "來源明確要求判斷正誤；answerMode 使用 boolean",
    "fill-blank": "只有一個文字作答欄位，而且來源提供可自動比對的確定答案",
    "multi-field": "同一小題需要依序填寫兩個以上欄位；answerFieldCount 大於 1",
    "short-answer": "需要一段文字回答，或來源沒有足夠答案可自動判分；gradingPolicy 使用 manual_review",
    "question-group": "有一段必要的共用材料，而且包含兩個以上相依小題；共用材料放 sharedPrompt，小題放 parts",
};

export type QuestionExchangeBlock =
    | Exclude<ImportContentBlock, { kind: "image" | "page_crop" }>
    | { kind: "image_ref"; ref: string; alt: string }
    | {
        kind: "crop_ref";
        ref: string;
        sourceRef: string;
        page: number;
        rect: { x: number; y: number; width: number; height: number };
        alt: string;
    };

export interface QuestionExchangeOption extends Omit<ImportOptionDraft, "blocks"> {
    blocks: QuestionExchangeBlock[];
}

export interface QuestionExchangePart extends Omit<ImportPartDraft, "prompt" | "options" | "hints" | "explanation"> {
    prompt: QuestionExchangeBlock[];
    options: QuestionExchangeOption[];
    hints: QuestionExchangeBlock[][];
    explanation: QuestionExchangeBlock[];
}

export interface QuestionExchangeQuestion {
    questionKey: string;
    templateId: QuestionTemplateId;
    sourceQuestionNumber: string | null;
    sourcePage: number | null;
    sharedPrompt: QuestionExchangeBlock[];
    parts: QuestionExchangePart[];
}

export interface QuestionExchangePackage {
    schemaVersion: 1;
    sourceTitle: string;
    questions: QuestionExchangeQuestion[];
}

export type QuestionExchangeAsset =
    | { kind: "image"; ref: string; alt: string }
    | {
        kind: "crop";
        ref: string;
        sourceRef: string;
        page: number;
        rect: { x: number; y: number; width: number; height: number };
        alt: string;
    };

export type QuestionExchangeResult =
    | { ok: true; value: QuestionExchangePackage }
    | { ok: false; errors: Array<{ path: string; message: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const expected = new Set(keys);
    return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function cleanReference(value: unknown): string | null {
    return typeof value === "string" && REFERENCE_PATTERN.test(value) ? value : null;
}

function cleanAlt(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const alt = value.normalize("NFC").trim();
    return alt && alt.length <= 300 && !CONTROL_PATTERN.test(alt) ? alt : null;
}

function parseRect(value: unknown): { x: number; y: number; width: number; height: number } | null {
    if (!isRecord(value) || !exactKeys(value, ["x", "y", "width", "height"])) return null;
    const entries = [value.x, value.y, value.width, value.height];
    if (!entries.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const width = Number(value.width);
    const height = Number(value.height);
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
    return { x, y, width, height };
}

function substituteBlocks(
    value: unknown,
    path: string,
    references: Map<string, QuestionExchangeAsset>,
    errors: Array<{ path: string; message: string }>,
): unknown {
    if (!Array.isArray(value)) return value;
    return value.map((block, index) => {
        const blockPath = `${path}[${index}]`;
        if (!isRecord(block) || typeof block.kind !== "string") return block;
        if (block.kind === "image_ref") {
            if (!exactKeys(block, ["kind", "ref", "alt"])) {
                errors.push({ path: blockPath, message: "圖片參照格式不正確或含有未知欄位。" });
                return block;
            }
            const ref = cleanReference(block.ref);
            const alt = cleanAlt(block.alt);
            if (!ref) errors.push({ path: `${blockPath}.ref`, message: "圖片參照只能使用英數字、句點、底線與連字號。" });
            if (!alt) errors.push({ path: `${blockPath}.alt`, message: "圖片替代文字不可為空或超過 300 字元。" });
            if (!ref || !alt) return block;
            const reference = { kind: "image", ref, alt } satisfies QuestionExchangeAsset;
            const existing = references.get(ref);
            if (existing && JSON.stringify(existing) !== JSON.stringify(reference)) {
                errors.push({ path: `${blockPath}.ref`, message: "同一圖片參照不可指向不同內容。" });
            }
            references.set(ref, reference);
            return { kind: "image", assetId: PLACEHOLDER_ASSET_ID, alt };
        }
        if (block.kind === "crop_ref") {
            if (!exactKeys(block, ["kind", "ref", "sourceRef", "page", "rect", "alt"])) {
                errors.push({ path: blockPath, message: "裁切參照格式不正確或含有未知欄位。" });
                return block;
            }
            const ref = cleanReference(block.ref);
            const sourceRef = cleanReference(block.sourceRef);
            const page = Number.isInteger(block.page) && Number(block.page) >= 1 && Number(block.page) <= 20
                ? Number(block.page)
                : null;
            const rect = parseRect(block.rect);
            const alt = cleanAlt(block.alt);
            if (!ref) errors.push({ path: `${blockPath}.ref`, message: "裁切參照只能使用英數字、句點、底線與連字號。" });
            if (!sourceRef) errors.push({ path: `${blockPath}.sourceRef`, message: "原稿參照只能使用英數字、句點、底線與連字號。" });
            if (!page) errors.push({ path: `${blockPath}.page`, message: "裁切頁碼必須介於 1 至 20。" });
            if (!rect) errors.push({ path: `${blockPath}.rect`, message: "裁切座標必須是 0 至 1 之間且不可超出頁面。" });
            if (!alt) errors.push({ path: `${blockPath}.alt`, message: "圖片替代文字不可為空或超過 300 字元。" });
            if (!ref || !sourceRef || !page || !rect || !alt) return block;
            const reference = { kind: "crop", ref, sourceRef, page, rect, alt } satisfies QuestionExchangeAsset;
            const existing = references.get(ref);
            if (existing && JSON.stringify(existing) !== JSON.stringify(reference)) {
                errors.push({ path: `${blockPath}.ref`, message: "同一裁切參照不可指向不同範圍。" });
            }
            references.set(ref, reference);
            return { kind: "page_crop", assetId: PLACEHOLDER_ASSET_ID, alt };
        }
        if (block.kind === "image" || block.kind === "page_crop") {
            errors.push({ path: blockPath, message: "AI 題目格式不能直接使用內部圖片資產識別碼，請改用 image_ref 或 crop_ref。" });
        }
        return block;
    });
}

function substituteQuestion(
    value: unknown,
    index: number,
    references: Map<string, QuestionExchangeAsset>,
    errors: Array<{ path: string; message: string }>,
): { question: unknown; templateId: QuestionTemplateId | null; questionKey: string | null } {
    const path = `$.questions[${index}]`;
    const keys = ["questionKey", "templateId", "sourceQuestionNumber", "sourcePage", "sharedPrompt", "parts"];
    if (!isRecord(value) || !exactKeys(value, keys)) {
        errors.push({ path, message: "題目格式不正確或含有未知欄位。" });
        return { question: value, templateId: null, questionKey: null };
    }
    const questionKey = cleanReference(value.questionKey);
    const templateId = typeof value.templateId === "string" && TEMPLATE_IDS.has(value.templateId)
        ? value.templateId as QuestionTemplateId
        : null;
    if (!questionKey) errors.push({ path: `${path}.questionKey`, message: "題目參照格式不正確。" });
    if (!templateId) errors.push({ path: `${path}.templateId`, message: "題目範本不受支援。" });
    const parts = Array.isArray(value.parts) ? value.parts.map((part, partIndex) => {
        if (!isRecord(part)) return part;
        return {
            ...part,
            prompt: substituteBlocks(part.prompt, `${path}.parts[${partIndex}].prompt`, references, errors),
            options: Array.isArray(part.options) ? part.options.map((option, optionIndex) => {
                if (!isRecord(option)) return option;
                return {
                    ...option,
                    blocks: substituteBlocks(option.blocks, `${path}.parts[${partIndex}].options[${optionIndex}].blocks`, references, errors),
                };
            }) : part.options,
            hints: Array.isArray(part.hints) ? part.hints.map((hint, hintIndex) => substituteBlocks(
                hint,
                `${path}.parts[${partIndex}].hints[${hintIndex}]`,
                references,
                errors,
            )) : part.hints,
            explanation: substituteBlocks(part.explanation, `${path}.parts[${partIndex}].explanation`, references, errors),
        };
    }) : value.parts;
    return {
        questionKey,
        templateId,
        question: {
            draftKey: globalThis.crypto.randomUUID(),
            classifications: [],
            sourceQuestionNumber: value.sourceQuestionNumber,
            sourcePage: value.sourcePage,
            sharedPrompt: substituteBlocks(value.sharedPrompt, `${path}.sharedPrompt`, references, errors),
            parts,
        },
    };
}

function restoreBlocks(blocks: ImportContentBlock[], source: unknown): QuestionExchangeBlock[] {
    if (!Array.isArray(source)) return [];
    return blocks.map((block, index) => {
        const sourceBlock = source[index];
        if (isRecord(sourceBlock) && sourceBlock.kind === "image_ref") {
            return { kind: "image_ref", ref: String(sourceBlock.ref), alt: block.kind === "image" ? block.alt : "" };
        }
        if (isRecord(sourceBlock) && sourceBlock.kind === "crop_ref") {
            return {
                kind: "crop_ref",
                ref: String(sourceBlock.ref),
                sourceRef: String(sourceBlock.sourceRef),
                page: Number(sourceBlock.page),
                rect: parseRect(sourceBlock.rect)!,
                alt: block.kind === "page_crop" ? block.alt : "",
            };
        }
        if (block.kind === "image" || block.kind === "page_crop") throw new Error("QUESTION_EXCHANGE_ASSET_RESTORE_FAILED");
        return block;
    });
}

export function parseQuestionExchangePackage(value: unknown): QuestionExchangeResult {
    const errors: Array<{ path: string; message: string }> = [];
    const keys = ["schemaVersion", "sourceTitle", "questions"];
    if (!isRecord(value) || !exactKeys(value, keys)) {
        return { ok: false, errors: [{ path: "$", message: "AI 題目格式不正確或含有未知欄位。" }] };
    }
    if (value.schemaVersion !== QUESTION_EXCHANGE_SCHEMA_VERSION) {
        errors.push({ path: "$.schemaVersion", message: "不支援這個 AI 題目格式版本。" });
    }
    if (!Array.isArray(value.questions)) {
        errors.push({ path: "$.questions", message: "題目清單格式不正確。" });
        return { ok: false, errors };
    }
    const references = new Map<string, QuestionExchangeAsset>();
    const sourceQuestions = value.questions;
    const substituted = sourceQuestions.map((question, index) => substituteQuestion(question, index, references, errors));
    const canonical: QuestionDraftPackage = {
        schemaVersion: 2,
        sourceTitle: typeof value.sourceTitle === "string" ? value.sourceTitle : "",
        questions: substituted.map((item) => item.question) as ImportQuestionDraft[],
    };
    const parsed = parseQuestionDraftPackage(canonical);
    if (!parsed.ok) errors.push(...parsed.errors);
    const sourceRefs = new Set([...references.values()].flatMap((reference) => reference.kind === "crop" ? [reference.sourceRef] : []));
    if (sourceRefs.size > 1) {
        errors.push({ path: "$.questions", message: "同一份格式目前只能引用一個原始照片或 PDF。" });
    }
    if (errors.length || !parsed.ok) return { ok: false, errors };

    const questions = parsed.value.questions.map((question, index): QuestionExchangeQuestion => {
        const source = sourceQuestions[index];
        const item = substituted[index]!;
        if (!isRecord(source) || !Array.isArray(source.parts) || !item.templateId || !item.questionKey) {
            throw new Error("QUESTION_EXCHANGE_NORMALIZATION_FAILED");
        }
        const sourceParts = source.parts;
        const parts = question.parts.map((part, partIndex): QuestionExchangePart => {
            const sourcePart = sourceParts[partIndex];
            if (!isRecord(sourcePart)) throw new Error("QUESTION_EXCHANGE_PART_NORMALIZATION_FAILED");
            return {
                ...part,
                prompt: restoreBlocks(part.prompt, sourcePart.prompt),
                options: part.options.map((option, optionIndex) => {
                    const sourceOption = Array.isArray(sourcePart.options) ? sourcePart.options[optionIndex] : null;
                    return { ...option, blocks: restoreBlocks(option.blocks, isRecord(sourceOption) ? sourceOption.blocks : []) };
                }),
                hints: part.hints.map((hint, hintIndex) => {
                    const sourceHint = Array.isArray(sourcePart.hints) ? sourcePart.hints[hintIndex] : [];
                    return restoreBlocks(hint, sourceHint);
                }),
                explanation: restoreBlocks(part.explanation, sourcePart.explanation),
            };
        });
        const normalized = {
            questionKey: item.questionKey,
            templateId: item.templateId,
            sourceQuestionNumber: question.sourceQuestionNumber,
            sourcePage: question.sourcePage,
            sharedPrompt: restoreBlocks(question.sharedPrompt, source.sharedPrompt),
            parts,
        };
        const resolved = resolveQuestionExchangePackage({
            schemaVersion: 1,
            sourceTitle: parsed.value.sourceTitle,
            questions: [normalized],
        }, Object.fromEntries([...references.keys()].map((ref) => [ref, PLACEHOLDER_ASSET_ID])), () => question.draftKey);
        if (!resolved.ok || inferQuestionTemplate(resolved.value.questions[0]!) !== item.templateId) {
            errors.push({ path: `$.questions[${index}].templateId`, message: "題目內容與所選範本不一致。" });
        }
        return normalized;
    });
    return errors.length
        ? { ok: false, errors }
        : { ok: true, value: { schemaVersion: 1, sourceTitle: parsed.value.sourceTitle, questions } };
}

function visitBlocks(blocks: QuestionExchangeBlock[], assets: Map<string, QuestionExchangeAsset>): void {
    for (const block of blocks) {
        if (block.kind === "image_ref") assets.set(block.ref, { kind: "image", ref: block.ref, alt: block.alt });
        if (block.kind === "crop_ref") assets.set(block.ref, {
            kind: "crop",
            ref: block.ref,
            sourceRef: block.sourceRef,
            page: block.page,
            rect: block.rect,
            alt: block.alt,
        });
    }
}

export function listQuestionExchangeAssets(value: QuestionExchangePackage): QuestionExchangeAsset[] {
    const assets = new Map<string, QuestionExchangeAsset>();
    for (const question of value.questions) {
        visitBlocks(question.sharedPrompt, assets);
        for (const part of question.parts) {
            visitBlocks(part.prompt, assets);
            for (const option of part.options) visitBlocks(option.blocks, assets);
            for (const hint of part.hints) visitBlocks(hint, assets);
            visitBlocks(part.explanation, assets);
        }
    }
    return [...assets.values()];
}

function resolveBlocks(blocks: QuestionExchangeBlock[], assets: Readonly<Record<string, string>>): ImportContentBlock[] | null {
    const resolved = blocks.map((block): ImportContentBlock | null => {
        if (block.kind === "image_ref" || block.kind === "crop_ref") {
            const assetId = assets[block.ref];
            if (!assetId) return null;
            return { kind: block.kind === "image_ref" ? "image" : "page_crop", assetId, alt: block.alt };
        }
        return block;
    });
    return resolved.some((block) => block === null) ? null : resolved as ImportContentBlock[];
}

export function resolveQuestionExchangePackage(
    value: QuestionExchangePackage,
    assets: Readonly<Record<string, string>>,
    createId: () => string = () => globalThis.crypto.randomUUID(),
): { ok: true; value: QuestionDraftPackage } | { ok: false; missingRefs: string[] } {
    const missingRefs = listQuestionExchangeAssets(value).map((asset) => asset.ref).filter((ref) => !assets[ref]);
    if (missingRefs.length) return { ok: false, missingRefs };
    const questions = value.questions.map((question): ImportQuestionDraft => ({
        draftKey: createId(),
        classifications: [],
        sourceQuestionNumber: question.sourceQuestionNumber,
        sourcePage: question.sourcePage,
        sharedPrompt: resolveBlocks(question.sharedPrompt, assets)!,
        parts: question.parts.map((part) => ({
            ...part,
            prompt: resolveBlocks(part.prompt, assets)!,
            options: part.options.map((option) => ({ ...option, blocks: resolveBlocks(option.blocks, assets)! })),
            hints: part.hints.map((hint) => resolveBlocks(hint, assets)!),
            explanation: resolveBlocks(part.explanation, assets)!,
        })),
    }));
    return { ok: true, value: { schemaVersion: 2, sourceTitle: value.sourceTitle, questions } };
}

function exchangeBlocks(blocks: ImportContentBlock[]): QuestionExchangeBlock[] {
    return blocks.map((block) => block.kind === "image" || block.kind === "page_crop"
        ? { kind: "image_ref", ref: `replace-${block.assetId}`, alt: block.alt }
        : block);
}

/**
 * 依選取的題型建立可交給外部 AI 參考的多題交換格式。
 *
 * @param selectedTemplateIds 要包含的題型；陣列順序同時決定範例順序。
 * @param count 每種題型建立的範例題數。
 * @returns 可再次通過交換格式驗證的題目範例。
 */
export function createQuestionExchangeTemplate(
    selectedTemplateIds: QuestionTemplateId | readonly QuestionTemplateId[],
    count = 2,
): QuestionExchangePackage {
    const templateIds = typeof selectedTemplateIds === "string" ? [selectedTemplateIds] : selectedTemplateIds;
    if (templateIds.length === 0) throw new Error("QUESTION_EXCHANGE_TEMPLATE_REQUIRED");
    const questions = templateIds.flatMap((templateId, templateIndex) => Array.from({ length: count }, (_, index): QuestionExchangeQuestion => {
        const questionIndex = templateIndex * count + index;
        const question = createQuestionFromTemplate(templateId, () => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
        const parts = question.parts.map((part): QuestionExchangePart => ({
            ...part,
            prompt: exchangeBlocks(part.prompt),
            options: part.options.map((option) => ({ ...option, blocks: exchangeBlocks(option.blocks) })),
            hints: part.hints.map(exchangeBlocks),
            explanation: exchangeBlocks(part.explanation),
        }));
        if (templateId === "image-choice") {
            parts[0]!.options = parts[0]!.options.map((option) => ({
                ...option,
                blocks: [{ kind: "image_ref", ref: `q${questionIndex + 1}-option-${option.key.toLowerCase()}`, alt: `第 ${questionIndex + 1} 題選項 ${option.key}` }],
            }));
        }
        return {
            questionKey: `q${questionIndex + 1}`,
            templateId,
            sourceQuestionNumber: String(questionIndex + 1),
            sourcePage: null,
            sharedPrompt: exchangeBlocks(question.sharedPrompt),
            parts,
        };
    }));
    return { schemaVersion: 1, sourceTitle: "AI 匯入題目", questions };
}

/**
 * 建立只允許使用已選題型的外部 AI 指令。
 *
 * @param selectedTemplateIds AI 可以輸出的題型。
 * @returns 包含格式規則及有效 JSON 範例的完整指令。
 */
export function createQuestionExchangePrompt(selectedTemplateIds: QuestionTemplateId | readonly QuestionTemplateId[]): string {
    const template = createQuestionExchangeTemplate(selectedTemplateIds);
    const templateIds = typeof selectedTemplateIds === "string" ? [selectedTemplateIds] : selectedTemplateIds;
    const templateRules = templateIds.map((templateId) => `${templateId}：${QUESTION_TEMPLATE_PROMPT_RULES[templateId]}`).join("\n");
    return [
        "請分析我提供的照片或文件，並只回傳 JSON，不要加 Markdown 程式碼區塊或其他說明。",
        "輸出必須完全符合下列 Lerniqa 格式，可以在 questions 中放入多題。下方 JSON 只是結構範例，不可複製範例題目、答案、解析或題數。",
        "逐題保留原文、選項、題組關係、表格、公式、提示、答案與解析。無法確認的文字不可猜測，也不可補造來源中不存在的題目。",
        "題號及其標點不得寫入 sharedPrompt、part.prompt 或選項文字。原稿有題號時只填入 sourceQuestionNumber；原稿沒有題號時填 null。sourcePage 也只填原稿可確認的頁碼，否則填 null。questionKey 在整份 JSON 中必須唯一；stableKey 在同一題內必須唯一。這些識別都不是題目內容。",
        "「一、選擇題」、「簡答題」、「每題 2 分」等章節序號、題型名稱與計分文字不得寫入 sharedPrompt 或 part.prompt。只有作答不可缺少的指示才保留。",
        `每題先依作答結構自動判斷 templateId，只能使用以下允許題型：${templateIds.join("、")}。不要只依原稿印出的題型名稱判斷。適合的題型不在允許清單時，不得改寫或硬套成其他題型，也不要輸出該題。\n${templateRules}`,
        "來源沒有明確答案或解析時，不得自行解題；answers、hints 與 explanation 使用空陣列，gradingPolicy 使用 manual_review。來源有明確答案時才可填入，並確保答案符合選項 key、作答欄位數與 answerMode。",
        "圖片本體不要轉成 Base64。一般附圖使用 image_ref；若圖片位於原始照片或 PDF，使用 crop_ref，rect 採 0 至 1 的頁面比例座標。每個 image_ref 或 crop_ref 的 ref 在整份 JSON 中都必須唯一，不可讓同一 ref 指向不同圖片或不同裁切範圍。",
        "輸出前檢查每題的 templateId、parts、answerMode、answerFieldCount、options、answers 與 gradingPolicy 是否一致，並確認 JSON 沒有格式以外的欄位或文字。",
        JSON.stringify(template, null, 2),
    ].join("\n\n");
}
