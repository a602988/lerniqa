import { NextResponse } from "next/server";
import { SUBJECTS } from "@/app/lib/demo-data";
import type { AccountRole, ContentPlacement, Question, QuestionBlock, QuestionKind, QuestionMetadataField, Subject } from "@/app/lib/demo-data";
import { removeAssets, updateDatabase, writeDataImage } from "@/app/lib/mock-store";
import { normalizeQuestionText } from "@/app/lib/question-text";

export const runtime = "nodejs";

interface ImportBlockInput {
    /** 區塊在題目中的用途。 */
    placement: ContentPlacement;
    /** 區塊文字。 */
    text?: string;
    /** 圖片 data URL。 */
    imageDataUrl?: string;
    /** 圖片替代文字。 */
    alt?: string;
}

interface ImportQuestionInput {
    /** 來源文件中的題目編號。 */
    code?: string;
    /** 題幹。 */
    prompt: string;
    /** 參考答案。 */
    answer: string;
    /** 科目。 */
    subject: Subject;
    /** 年級。 */
    grade: string;
    /** 學期。 */
    semester: string;
    /** 書籍版本。 */
    version: string;
    /** 章或課次。 */
    chapter: string;
    /** 教材單元。 */
    unit: string;
    /** 跨版本主題。 */
    topic: string;
    /** 知識點。 */
    knowledge: string;
    /** 題目難易度。 */
    difficulty: "易" | "中" | "難";
    /** 題型。 */
    kind?: QuestionKind;
    /** 選項。 */
    options?: string[];
    /** 解題說明。 */
    explanation?: string;
    /** 題目來源。 */
    source: string;
    /** 可供篩選的來源分類。 */
    sourceCategory: string;
    /** 原始題號。 */
    questionNumber: string;
    /** 來源文件中需要完整保留的動態欄位。 */
    metadata?: QuestionMetadataField[];
    /** 題幹、選項、答案及解析的有序內容。 */
    blocks?: ImportBlockInput[];
}

interface ImportRequest {
    /** 原始檔名。 */
    fileNames: string[];
    /** 已由使用者確認的題目。 */
    questions: ImportQuestionInput[];
    /** 匯入題目要加入的題本。 */
    book: {
        id: string;
        name: string;
        ownerRole: AccountRole;
        learnerId: string;
    };
}

/** 判斷未知值是否為一般物件。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 驗證並限制匯入 API 的文字欄位。 */
function parseImportRequest(value: unknown): ImportRequest | null {
    if (!isRecord(value) || !Array.isArray(value.fileNames) || !Array.isArray(value.questions) || !isRecord(value.book)) return null;
    if (!value.fileNames.length || value.fileNames.length > 20 || !value.fileNames.every((item) => typeof item === "string" && item.length <= 240)) return null;
    if (!value.questions.length || value.questions.length > 500) return null;
    if (typeof value.book.id !== "string" || !value.book.id || value.book.id.length > 80
        || typeof value.book.name !== "string" || !value.book.name.trim() || value.book.name.length > 80
        || !["家長", "學習者", "家教"].includes(String(value.book.ownerRole))
        || typeof value.book.learnerId !== "string" || !value.book.learnerId || value.book.learnerId.length > 80) return null;

    const valid = value.questions.every((item) => {
        if (!isRecord(item)) return false;
        const required = ["prompt", "answer", "subject", "grade", "semester", "version", "chapter", "unit", "topic", "knowledge", "difficulty", "source", "sourceCategory", "questionNumber"];
        if (!required.every((key) => typeof item[key] === "string" && String(item[key]).trim() && String(item[key]).length <= 4_000)) return false;
        if (!SUBJECTS.some((subject) => subject === item.subject) || !["易", "中", "難"].includes(String(item.difficulty))) return false;
        if (item.kind !== undefined && !["choice", "boolean", "written"].includes(String(item.kind))) return false;
        if (item.options !== undefined && (!Array.isArray(item.options) || item.options.length > 20 || !item.options.every((option) => typeof option === "string" && option.length <= 1_000))) return false;
        if (item.explanation !== undefined && (typeof item.explanation !== "string" || item.explanation.length > 8_000)) return false;
        if (item.code !== undefined && (typeof item.code !== "string" || item.code.length > 120)) return false;
        if (item.metadata !== undefined && (!Array.isArray(item.metadata) || item.metadata.length > 100 || !item.metadata.every((field) => isRecord(field)
            && typeof field.key === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(field.key)
            && typeof field.label === "string" && field.label.length > 0 && field.label.length <= 120
            && typeof field.rawValue === "string" && field.rawValue.length <= 4_000
            && Array.isArray(field.values) && field.values.length <= 100
            && field.values.every((entry) => typeof entry === "string" && entry.length <= 500)
            && ["fixture", "document", "path", "ai", "user"].includes(String(field.valueSource))
            && typeof field.confidence === "number" && field.confidence >= 0 && field.confidence <= 1))) return false;
        if (item.blocks !== undefined && (!Array.isArray(item.blocks) || item.blocks.length > 100 || !item.blocks.every((block) => isRecord(block)
            && ["prompt", "option", "answer", "explanation"].includes(String(block.placement))
            && (typeof block.text === "string" || typeof block.imageDataUrl === "string")))) return false;
        return true;
    });
    return valid ? value as unknown as ImportRequest : null;
}

/** 將校正完成的題目與圖片實際寫入 runtime JSON。 */
export async function POST(request: Request) {
    const savedAssets: string[] = [];

    try {
        const payload = parseImportRequest(await request.json());
        if (!payload) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: "匯入題目缺少必要欄位或格式不正確。" } }, { status: 400 });

        const database = await updateDatabase(async (current) => {
            let nextId = Math.max(0, ...current.questions.map((question) => question.id)) + 1;
            const questions: Question[] = [];

            for (const [index, input] of payload.questions.entries()) {
                const prompt = normalizeQuestionText(input.prompt.trim());
                const blocks: QuestionBlock[] = [];
                const sourceBlocks = input.blocks?.length
                    ? input.blocks
                    : [
                        { placement: "prompt" as const, text: input.prompt },
                        { placement: "answer" as const, text: input.answer },
                        { placement: "explanation" as const, text: input.explanation ?? "" },
                    ];
                const placementOrder = new Map<ContentPlacement, number>();

                for (const block of sourceBlocks) {
                    const order = (placementOrder.get(block.placement) ?? 0) + 1;
                    placementOrder.set(block.placement, order);
                    if (block.imageDataUrl) {
                        const asset = await writeDataImage(block.imageDataUrl);
                        savedAssets.push(asset.storageKey);
                        blocks.push({
                            id: `q${nextId}-${block.placement}-${order}`,
                            placement: block.placement,
                            type: "image",
                            order,
                            asset: { storageKey: asset.storageKey, mimeType: asset.mimeType, alt: block.alt?.trim() || `${prompt}的附圖` },
                        });
                    }
                    else if (block.text?.trim()) {
                        blocks.push({ id: `q${nextId}-${block.placement}-${order}`, placement: block.placement, type: "text", order, text: normalizeQuestionText(block.text.trim()) });
                    }
                }

                questions.push({
                    id: nextId,
                    ...(input.code?.trim() ? { code: input.code.trim() } : {}),
                    subject: input.subject,
                    grade: input.grade.trim(),
                    semester: input.semester.trim(),
                    bookVersion: input.version.trim(),
                    chapter: input.chapter.trim(),
                    unit: input.unit.trim(),
                    topic: input.topic.trim(),
                    knowledge: input.knowledge.trim(),
                    difficulty: input.difficulty === "易" ? "基礎" : input.difficulty === "難" ? "進階" : "中等",
                    kind: input.kind ?? (input.options?.length ? "choice" : "written"),
                    prompt,
                    ...(input.options?.length ? { options: input.options.map((option) => normalizeQuestionText(option.trim())) } : {}),
                    answer: normalizeQuestionText(input.answer.trim()),
                    explanation: input.explanation?.trim() ? normalizeQuestionText(input.explanation.trim()) : "尚未提供解析。",
                    source: input.source.trim(),
                    sourceCategory: input.sourceCategory.trim(),
                    sourceDetail: {
                        documentName: payload.fileNames[0],
                        questionNumber: input.questionNumber.trim() || String(index + 1),
                        valueSource: "user",
                        confidence: 1,
                    },
                    ...(input.metadata?.length ? { metadata: input.metadata.map((field) => ({
                        ...field,
                        key: field.key.trim(),
                        label: field.label.trim(),
                        rawValue: field.rawValue.trim(),
                        values: field.values.map((value) => value.trim()).filter(Boolean),
                    })) } : {}),
                    blocks,
                });
                nextId += 1;
            }

            const batch = {
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                fileNames: payload.fileNames,
                questionIds: questions.map((question) => question.id),
                status: "confirmed" as const,
                bookId: payload.book.id,
                bookName: payload.book.name.trim(),
                ownerRole: payload.book.ownerRole,
                learnerId: payload.book.learnerId,
            };
            return { ...current, questions: [...current.questions, ...questions], imports: [...current.imports, batch] };
        });
        const batch = database.imports.at(-1);
        const questions = database.questions.filter((question) => batch?.questionIds.includes(question.id));
        return NextResponse.json({ data: { batch, questions }, meta: { mock: true, persistence: "runtime-json" } }, { status: 201 });
    }
    catch (error) {
        await removeAssets(savedAssets);
        const invalidImage = error instanceof Error && ["INVALID_IMAGE", "INVALID_IMAGE_SIZE"].includes(error.message);
        return NextResponse.json({
            error: {
                code: invalidImage ? "INVALID_IMAGE" : "MOCK_IMPORT_WRITE_FAILED",
                message: invalidImage ? "題目圖片格式不正確或超過大小限制。" : "目前無法寫入模擬題庫。",
            },
        }, { status: invalidImage ? 400 : 500 });
    }
}
