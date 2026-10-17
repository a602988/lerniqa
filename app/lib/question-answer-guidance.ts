export const CORRECTION_QUESTION_TYPE_LABEL = "改錯題";
export const CORRECTION_ANSWER_HINT = "請使用半形逗號（,）分隔每個答案。";
export const CORRECTION_ANSWER_PLACEHOLDER = "例如：答案一,答案二,答案三";

/** 判斷來源題型是否為需要輸入多個更正文字的改錯題。 */
export function isCorrectionQuestion(typeLabel: string | null | undefined) {
    return typeLabel?.normalize("NFKC").trim() === CORRECTION_QUESTION_TYPE_LABEL;
}
