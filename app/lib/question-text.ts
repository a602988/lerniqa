const EMPTY_OVERSTRIKE_PATTERN = /eq\s+\\o\\ar\(\s*,\s*([^)]+?)\s*\)/gi;

/**
 * 移除 Word 題庫轉換後殘留的空白疊字欄位碼。
 * @param value 題目來源中的文字。
 * @returns 可直接顯示與保存的題目文字。
 */
export function normalizeQuestionText(value: string) {
    return value.replace(EMPTY_OVERSTRIKE_PATTERN, (_match, label: string) => label.trim());
}
