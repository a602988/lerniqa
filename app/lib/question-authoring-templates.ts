import type {
    ImportContentBlock,
    ImportPartDraft,
    ImportQuestionDraft,
} from "./question-import-contract";

const IMAGE_OPTION_PLACEHOLDER = "請加入圖片";

export type QuestionTemplateId =
    | "single-choice"
    | "image-choice"
    | "multiple-choice"
    | "true-false"
    | "fill-blank"
    | "multi-field"
    | "short-answer"
    | "question-group";

export type QuestionTemplateIcon = "circle" | "image" | "checks" | "toggle" | "input" | "rows" | "message" | "tree";

export type QuestionTemplateDefinition = {
    id: QuestionTemplateId;
    name: string;
    description: string;
    icon: QuestionTemplateIcon;
    blueprint: Pick<ImportQuestionDraft, "sharedPrompt" | "parts">;
    previewOptionImages?: Record<string, {
        src: string;
        alt: string;
        label: string;
    }>;
};

const QUESTION_TEMPLATE_MAP: Record<QuestionTemplateId, QuestionTemplateDefinition> = {
    "single-choice": {
        id: "single-choice",
        name: "單選題",
        description: "從文字選項中選出一個答案。",
        icon: "circle",
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "小妍讀完一本 96 頁的故事書，第一天讀了 28 頁，第二天讀了 35 頁。她還有多少頁沒有讀？" }],
            parts: [choicePart("single_choice", ["C"], ["23 頁", "28 頁", "33 頁", "63 頁"], "28＋35＝63，96－63＝33，所以還有 33 頁沒有讀。")],
        },
    },
    "image-choice": {
        id: "image-choice",
        name: "圖片選擇題",
        description: "讓學習者從圖片選項中選出一個答案。",
        icon: "image",
        previewOptionImages: {
            A: { src: "/question-template/slope-sign.svg", alt: "斜坡提醒標誌", label: "小心斜坡" },
            B: { src: "/question-template/no-parking-sign.svg", alt: "禁止停車標誌", label: "禁止停車" },
            C: { src: "/question-template/drinking-water-sign.svg", alt: "飲水處標誌", label: "飲水處" },
            D: { src: "/question-template/exit-sign.svg", alt: "出口方向標誌", label: "出口方向" },
        },
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "社區要在斜坡入口放置提醒標誌。請選出最能表示「小心斜坡」的圖示。" }],
            parts: [choicePart(
                "single_choice",
                ["A"],
                ["請加入圖片 A：斜坡提醒標誌", "請加入圖片 B：禁止停車標誌", "請加入圖片 C：飲水處標誌", "請加入圖片 D：出口方向標誌"],
                "斜坡提醒標誌能直接提示通行者注意地面坡度。",
            )],
        },
    },
    "multiple-choice": {
        id: "multiple-choice",
        name: "複選題",
        description: "可選取兩個以上的正確答案。",
        icon: "checks",
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "下列哪些做法可以減少不必要的用電？（可複選）" }],
            parts: [choicePart("multiple_choice", ["A", "C"], ["離開教室時關燈", "冷氣開著時打開門窗", "不用電腦時關閉螢幕", "白天拉上窗簾並開燈"], "離開時關燈、不用電腦時關閉螢幕，都能減少不必要的用電。")],
        },
    },
    "true-false": {
        id: "true-false",
        name: "是非題",
        description: "判斷題目敘述是否正確。",
        icon: "toggle",
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "植物的根通常能吸收土壤中的水分和礦物質。" }],
            parts: [{
                ...basePart("根能吸收土壤中的水分和礦物質，因此敘述正確。"),
                answerMode: "boolean",
                gradingPolicy: "automatic",
                options: [
                    { key: "true", blocks: [{ kind: "text", text: "是" }] },
                    { key: "false", blocks: [{ kind: "text", text: "否" }] },
                ],
                answers: ["true"],
            }],
        },
    },
    "fill-blank": {
        id: "fill-blank",
        name: "填空題",
        description: "輸入文字後，由系統比對可接受答案。",
        icon: "input",
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "請把注音改寫成國字：雨後的天空出現一道美麗的「ㄘㄞˇ ㄏㄨㄥˊ」。" }],
            parts: [{
                ...basePart("「ㄘㄞˇ ㄏㄨㄥˊ」寫作「彩虹」。"),
                answerMode: "text",
                gradingPolicy: "automatic",
                answers: ["彩虹"],
            }],
        },
    },
    "multi-field": {
        id: "multi-field",
        name: "多格填答題",
        description: "同一小題依序填寫多個答案。",
        icon: "rows",
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "請依序寫出「圖書館」和「早餐」的英文單字。" }],
            parts: [{
                ...basePart("「圖書館」是 library；「早餐」是 breakfast。"),
                answerMode: "text",
                answerFieldCount: 2,
                gradingPolicy: "manual_review",
                answers: ["library", "breakfast"],
            }],
        },
    },
    "short-answer": {
        id: "short-answer",
        name: "簡答題",
        description: "讓學習者輸入一段文字，再由人工或 AI 協助批改。",
        icon: "message",
        blueprint: {
            sharedPrompt: [{ kind: "text", text: "教室甲使用 4 盞 18 W 的燈，教室乙使用 6 盞 10 W 的燈，兩間教室都開燈 1 小時。哪一間教室較省電？請寫出判斷與計算理由。" }],
            parts: [{
                ...basePart("甲的總功率是 4 × 18 = 72 W；乙是 6 × 10 = 60 W。使用時間相同，因此乙較省電。"),
                answerMode: "text",
                gradingPolicy: "manual_review",
                answers: ["乙較省電。甲的總功率是 72 W，乙是 60 W；兩者使用時間相同，所以乙的用電量較少。"],
            }],
        },
    },
    "question-group": {
        id: "question-group",
        name: "題組與子題",
        description: "共用一段資料，接著回答多個小題。",
        icon: "tree",
        blueprint: {
            sharedPrompt: [
                { kind: "text", text: "小組用相同大小的紙張製作三種紙橋，各放置一次砝碼，記錄橋面開始彎曲時的重量：" },
                { kind: "table", rows: [["紙橋設計", "平放", "對折一次", "摺成波浪形"], ["開始彎曲的重量", "120 g", "310 g", "460 g"]] },
                { kind: "text", text: "根據紀錄回答下列問題。" },
            ],
            parts: [
                {
                    ...choicePart("single_choice", ["C"], ["平放", "對折一次", "摺成波浪形", "三種一樣"], "波浪形紙橋在 460 g 時才開始彎曲，是三種設計中最高的。"),
                    stableKey: "part-1",
                    prompt: [{ kind: "text", text: "哪一種紙橋承受的重量最大？" }],
                },
                {
                    ...basePart("紀錄顯示波浪形在這次測試中承受最多重量，但每種設計只測一次，還需要重複實驗才能確認結果是否穩定。"),
                    stableKey: "part-2",
                    prompt: [{ kind: "text", text: "能否只根據這次紀錄就斷定波浪形紙橋一定最堅固？請說明理由。" }],
                    answerMode: "text",
                    gradingPolicy: "manual_review",
                    answers: ["不能。每種設計只測量一次，應重複測試並比較結果，才能判斷差異是否穩定。"],
                },
            ],
        },
    },
};

export const QUESTION_TEMPLATE_IDS: readonly QuestionTemplateId[] = [
    "single-choice",
    "image-choice",
    "multiple-choice",
    "true-false",
    "fill-blank",
    "multi-field",
    "short-answer",
    "question-group",
];

export const QUESTION_TEMPLATES = QUESTION_TEMPLATE_IDS.map((id) => QUESTION_TEMPLATE_MAP[id]);

/**
 * 取得範本在選擇介面使用的名稱、說明與圖示。
 *
 * @param templateId 範本識別碼。
 * @returns 範本定義。
 */
export function getQuestionTemplate(templateId: QuestionTemplateId): QuestionTemplateDefinition {
    return QUESTION_TEMPLATE_MAP[templateId];
}

/**
 * 建立可獨立修改的題目草稿，避免不同題目共用範本中的陣列參照。
 *
 * @param templateId 要套用的範本。
 * @param createId 建立草稿識別碼的方法。
 * @returns 符合題目匯入契約的草稿。
 */
export function createQuestionFromTemplate(
    templateId: QuestionTemplateId,
    createId: () => string = () => globalThis.crypto.randomUUID(),
): ImportQuestionDraft {
    const blueprint = structuredClone(QUESTION_TEMPLATE_MAP[templateId].blueprint);
    return {
        draftKey: createId(),
        classifications: [],
        sourceQuestionNumber: null,
        sourcePage: null,
        ...blueprint,
    };
}

/**
 * 依題目已保存的作答結構找出最接近的範本名稱。
 *
 * @param question 已通過契約檢查的題目。
 * @returns 對應的範本識別碼。
 */
export function inferQuestionTemplate(question: ImportQuestionDraft): QuestionTemplateId {
    if (question.parts.length > 1) return "question-group";
    const part = question.parts[0];
    if (!part) return "short-answer";
    if (part.answerMode === "boolean") return "true-false";
    if (part.answerMode === "multiple_choice") return "multiple-choice";
    if (part.answerMode === "single_choice") {
        const hasImageOption = part.options.some((option) => option.blocks.some((block) => block.kind === "image" || block.kind === "page_crop"));
        const awaitsImageOptions = part.options.length > 0 && part.options.every((option) => option.blocks.some((block) => block.kind === "text" && block.text.startsWith(IMAGE_OPTION_PLACEHOLDER)));
        return hasImageOption || awaitsImageOptions ? "image-choice" : "single-choice";
    }
    if (part.answerFieldCount > 1) return "multi-field";
    if (part.gradingPolicy === "automatic") return "fill-blank";
    return "short-answer";
}

/**
 * 以新範本取代作答結構，同時保留題目內容、分類與匯入追溯資料。
 *
 * @param question 要更換範本的題目。
 * @param templateId 新範本。
 * @returns 保留題目內容的新草稿。
 */
export function replaceQuestionTemplate(
    question: ImportQuestionDraft,
    templateId: QuestionTemplateId,
): ImportQuestionDraft {
    const template = createQuestionFromTemplate(templateId, () => question.draftKey);
    return {
        ...template,
        classifications: question.classifications,
        sourceQuestionNumber: question.sourceQuestionNumber,
        sourcePage: question.sourcePage,
        sharedPrompt: question.sharedPrompt.length > 0 ? structuredClone(question.sharedPrompt) : template.sharedPrompt,
    };
}

function basePart(explanation = "請依題目條件補充解答與解析。"): ImportPartDraft {
    return {
        stableKey: "part-1",
        parentStableKey: null,
        prompt: [],
        answerMode: "text",
        answerFieldCount: 1,
        gradingPolicy: "manual_review",
        options: [],
        answers: [],
        hints: [],
        explanation: [{ kind: "text", text: explanation }],
    };
}

function choicePart(
    answerMode: "single_choice" | "multiple_choice",
    answers: string[],
    labels: string[],
    explanation?: string,
): ImportPartDraft {
    return {
        ...basePart(explanation),
        answerMode,
        gradingPolicy: "automatic",
        options: labels.map((text, index) => ({
            key: String.fromCharCode(65 + index),
            blocks: [{ kind: "text", text }] satisfies ImportContentBlock[],
        })),
        answers,
    };
}
