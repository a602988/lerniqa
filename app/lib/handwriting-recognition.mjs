export const HANDWRITING_RECOGNITION_MODES = Object.freeze([
    "single_character",
    "single_line",
]);

const RECOGNITION_MODE_BY_TYPE_LABEL = Object.freeze(new Map([
    ["寫出國字、注音", "single_character"],
    ["注釋", "single_line"],
]));

export const HANDWRITING_RECOGNITION_TYPE_LABELS = Object.freeze([
    ...RECOGNITION_MODE_BY_TYPE_LABEL.keys(),
]);

/**
 * 題庫保留的細題型是辨識方式的權威來源，避免用題幹內容猜測作答方式。
 *
 * @param {unknown} value 題庫的原始題型標籤。
 * @returns {"single_character" | "single_line" | null} 可用的辨識方式。
 */
export function handwritingRecognitionModeForLabel(value) {
    if (typeof value !== "string") return null;
    return RECOGNITION_MODE_BY_TYPE_LABEL.get(value.normalize("NFKC").trim()) ?? null;
}

/**
 * 驗證來自 HTTP 或 worker 邊界的辨識方式。
 *
 * @param {unknown} value 未信任的辨識方式。
 * @returns {value is "single_character" | "single_line"} 是否為支援值。
 */
export function isHandwritingRecognitionMode(value) {
    return typeof value === "string" && HANDWRITING_RECOGNITION_MODES.includes(value);
}
