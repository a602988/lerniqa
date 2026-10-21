import type { QuestionExchangeBlock } from "./question-exchange-contract.ts";
import type { ImportContentBlock } from "./question-import-contract.ts";

const BOPOMOFO_PATTERN = /[\u3105-\u312f\u31a0-\u31bf]/u;
const INVALID_TARGET_PATTERN = /[A-Za-z\u3040-\u30ff]/u;
const HAN_PATTERN = /^[\u3400-\u9fff]{1,8}$/u;
const PHONETIC_PATTERN = /^[\u3105-\u312f\u31a0-\u31bf\u02c9\u02ca\u02c7\u02cb\u02d9\s]+$/u;
const TARGET_PATTERN = /[「『（(]([^」』）)]*)[」』）)]/gu;
const TARGET_ENCLOSURES = new Map([
    ["「", "」"],
    ["『", "』"],
    ["（", "）"],
    ["(", ")"],
]);

export type BopomofoAnswerTask = "han_from_bopomofo" | null;
type BopomofoContentBlock = ImportContentBlock | QuestionExchangeBlock;

interface BopomofoSourceEvidence {
    ocrText?: string;
}

export type BopomofoCorrectionResult =
    | { ok: true; value: string }
    | { ok: false; message: string };

/**
 * 判斷圖片說明是否代表尚未由使用者確認的注音裁切。
 *
 * @param alt 圖片替代文字。
 * @returns 是否為待確認的注音原文。
 */
export function isUncertainBopomofoAlt(alt: string): boolean {
    return alt.includes("待確認的注音原文");
}

/**
 * 驗證使用者依原稿輸入的注音，不接受國字、拉丁字母或不成對的外框。
 *
 * @param value 使用者輸入的注音與可選外框。
 * @returns 正規化後的原稿文字，或可直接顯示的修正方式。
 */
export function parseBopomofoCorrection(value: string): BopomofoCorrectionResult {
    const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
    if (!normalized) return { ok: false, message: "請輸入圖片中的注音。" };
    const closing = TARGET_ENCLOSURES.get(normalized[0]!);
    if (closing && !normalized.endsWith(closing)) {
        return { ok: false, message: `開頭使用 ${normalized[0]}，結尾必須使用 ${closing}。` };
    }
    const target = closing ? normalized.slice(1, -1).trim() : normalized;
    if (!BOPOMOFO_PATTERN.test(target) || !PHONETIC_PATTERN.test(target)) {
        return { ok: false, message: "只能輸入注音符號、聲調與空格；不要用國字或英文字母代替。" };
    }
    return { ok: true, value: normalized };
}

/**
 * 判斷題幹是否以引號內的注音要求填入對應國字。
 *
 * @param blocks 題幹與小題內容區塊。
 * @returns 注音轉國字任務；沒有明確注音目標時回傳 null。
 */
export function inferBopomofoAnswerTask(blocks: BopomofoContentBlock[]): BopomofoAnswerTask {
    const targets = [...visibleText(blocks).matchAll(TARGET_PATTERN)].map((match) => match[1]!.trim());
    return targets.some((target) => BOPOMOFO_PATTERN.test(target) && PHONETIC_PATTERN.test(target))
        ? "han_from_bopomofo"
        : null;
}

/**
 * 檢查答案是否符合題幹明確指定的注音作答方向。
 *
 * @param task 題幹推導出的注音作答方向。
 * @param answers 本地模型提出的文字答案。
 * @returns 答案字形是否符合題目要求。
 */
export function acceptsBopomofoAnswer(task: BopomofoAnswerTask, answers: string[]): boolean {
    return task === null || answers.every((answer) => HAN_PATTERN.test(answer));
}

/**
 * 將題目內容區塊合併為只供辨識品質檢查的文字。
 *
 * @param blocks 題目交換格式的內容區塊。
 * @returns 文字與表格中的可見內容。
 */
function visibleText(blocks: BopomofoContentBlock[]): string {
    return blocks.flatMap((block) => {
        if (block.kind === "text") return [block.text];
        if (block.kind === "table") return block.rows.flat();
        return [];
    }).join("\n");
}

/**
 * 判斷裁切是否明確表示無法可靠抄錄的注音原文。
 *
 * @param block 題目交換格式的內容區塊。
 * @returns 裁切是否足夠小，且標示為待確認的注音原文。
 */
function isUncertainBopomofoCrop(block: QuestionExchangeBlock): boolean {
    return block.kind === "crop_ref"
        && isUncertainBopomofoAlt(block.alt)
        && block.rect.width <= 0.35
        && block.rect.height <= 0.15;
}

/**
 * 檢查國字注音題是否保留可追溯的作答目標。
 *
 * @param blocks 題幹與小題內容區塊。
 * @returns 需要模型重新對照原圖的原因；空陣列代表可進入人工校對草稿。
 */
export function bopomofoTargetIssues(
    blocks: QuestionExchangeBlock[],
    evidence: BopomofoSourceEvidence = {},
): string[] {
    const text = visibleText(blocks);
    const targets = [...text.matchAll(TARGET_PATTERN)].map((match) => match[1]!.trim());
    const bopomofoTargets = targets.filter((target) => BOPOMOFO_PATTERN.test(target) && PHONETIC_PATTERN.test(target));
    const hasBopomofoTarget = bopomofoTargets.length > 0;
    const hasHanTarget = targets.some((target) => HAN_PATTERN.test(target));
    const hasSourceCrop = blocks.some(isUncertainBopomofoCrop);
    const issues: string[] = [];

    if (!hasBopomofoTarget && !hasHanTarget && !hasSourceCrop) {
        issues.push("國字注音題的辨識結果不可靠：題目沒有保留引號內的注音、國字或待確認原圖");
    }
    if (!hasBopomofoTarget && BOPOMOFO_PATTERN.test(text)) {
        issues.push("國字注音題的辨識結果不可靠：注音離開原本作答位置，可能已被改寫成答案");
    }
    if (targets.some((target) => INVALID_TARGET_PATTERN.test(target)
        || (BOPOMOFO_PATTERN.test(target) && /[\u3400-\u9fff]/u.test(target)))) {
        issues.push("國字注音題的辨識結果不可靠：作答位置含英文字母、日文假名或混合字形");
    }
    if (evidence.ocrText && !hasSourceCrop) {
        const sourceText = evidence.ocrText.normalize("NFC").replace(/\s+/gu, " ");
        if (bopomofoTargets.some((target) => !sourceText.includes(target.normalize("NFC").replace(/\s+/gu, " ")))) {
            issues.push("國字注音題的辨識結果不可靠：模型注音沒有相同的 OCR 字串佐證，必須保留待確認原圖");
        }
    }

    return [...new Set(issues)];
}

/**
 * 提供本地模型逐字抄錄注音題時必須遵守的規則。
 *
 * @returns 可直接加入系統提示的規則。
 */
export function bopomofoRecognitionPrompt(): string {
    return [
        "國字注音題必須保留原稿的作答位置與符號順序。原稿是『個性魯「ㄇㄤˇ」：』時，只能抄成相同文字；不得補成『個性魯莽』，不得加入『ㄌㄨˇ』，也不得把目標移到引號外。",
        "逐一辨認每個注音符號與聲調。語境只能用來檢查候選，不可覆蓋圖片字形，也不可補出題目的國字答案。",
        "任一注音符號看不清楚時，保留可確認的前後文字，並在原作答位置加入緊密的 crop_ref。alt 固定寫『待確認的注音原文』；裁切只包含該組注音與必要邊界，不得裁整題或整頁。",
    ].join("\n");
}
