const NUMBERED_LINE_PATTERN = /^\s*\((\d+)\)\s*(.*)$/u;
const INLINE_FRACTION_AT_START_PATTERN = /^\\frac\{([^{}\r\n]+)\}\{([^{}\r\n]+)\}/u;

export type InlineQuestionTextToken =
    | Readonly<{ kind: "text"; value: string }>
    | Readonly<{ kind: "fraction"; numerator: string; denominator: string }>
    | Readonly<{ kind: "script"; placement: "superscript" | "subscript"; value: string }>;

/** 將舊版 Symbol 字型留下的私用區數學符號轉成標準 Unicode。 */
export function normalizeLegacyMathSymbols(value: string): string {
    return value.replaceAll("\uF0DE", "⇒");
}

function scriptEnd(value: string, openParenthesisIndex: number): number | null {
    let depth = 0;
    for (let index = openParenthesisIndex; index < value.length; index += 1) {
        if (value[index] === "(") depth += 1;
        else if (value[index] === ")") {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return null;
}

/**
 * 解析匯入規範明確標記的行內分數、上標與下標。括號以平衡方式讀取，
 * 因此 `(10^(3))^(5)` 仍可保留兩層結構；不完整標記則維持原文供稽核。
 */
export function tokenizeInlineQuestionText(value: string): InlineQuestionTextToken[] {
    const tokens: InlineQuestionTextToken[] = [];
    let textStart = 0;
    let cursor = 0;
    const flushText = (end: number) => {
        if (end > textStart) tokens.push({ kind: "text", value: value.slice(textStart, end) });
    };

    while (cursor < value.length) {
        const fraction = value.slice(cursor).match(INLINE_FRACTION_AT_START_PATTERN);
        if (fraction) {
            flushText(cursor);
            tokens.push({ kind: "fraction", numerator: fraction[1].trim(), denominator: fraction[2].trim() });
            cursor += fraction[0].length;
            textStart = cursor;
            continue;
        }

        const marker = value[cursor];
        if ((marker === "^" || marker === "_") && value[cursor + 1] === "(") {
            const end = scriptEnd(value, cursor + 1);
            if (end !== null) {
                flushText(cursor);
                tokens.push({
                    kind: "script",
                    placement: marker === "^" ? "superscript" : "subscript",
                    value: value.slice(cursor + 2, end),
                });
                cursor = end + 1;
                textStart = cursor;
                continue;
            }
        }
        cursor += 1;
    }

    flushText(value.length);
    return tokens.length ? tokens : [{ kind: "text", value }];
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
