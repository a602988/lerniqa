const NUMBERED_LINE_PATTERN = /^\s*\((\d+)\)\s*(.*)$/u;

/** 將舊版 Symbol 字型留下的私用區數學符號轉成標準 Unicode。 */
export function normalizeLegacyMathSymbols(value: string): string {
    return value.replaceAll("\uF0DE", "⇒");
}

function isNumberedLine(value: string): boolean {
    return NUMBERED_LINE_PATTERN.test(value.normalize("NFKC"));
}

function comparableText(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/** 大題已完整列出同一段小題文字時，只回傳對應的小題編號。 */
export function getRepeatedNumberedPartLabel(parentPrompt: string, partPrompt: string, partIndex: number): string | undefined {
    const expectedNumber = String(partIndex + 1);
    const expectedPrompt = comparableText(partPrompt);
    if (!expectedPrompt) return undefined;

    const repeated = parentPrompt
        .normalize("NFKC")
        .split(/\r?\n/gu)
        .some((line) => {
            const match = line.match(NUMBERED_LINE_PATTERN);
            return match?.[1] === expectedNumber && comparableText(match[2] ?? "") === expectedPrompt;
        });

    return repeated ? `(${expectedNumber})` : undefined;
}

/** 編號解析維持分段，但移除段內由來源文件帶入的硬換行。 */
export function reflowNumberedExplanation(value: string): string {
    const lines = value
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.filter(isNumberedLine).length < 2) return value.trim();

    const sections: string[] = [];
    let currentSection: string[] = [];
    for (const line of lines) {
        if (isNumberedLine(line) && currentSection.length) {
            sections.push(currentSection.join(" "));
            currentSection = [];
        }
        currentSection.push(line);
    }
    if (currentSection.length) sections.push(currentSection.join(" "));
    return sections.join("\n");
}
