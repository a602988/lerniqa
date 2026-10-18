const NUMBERED_LINE_PATTERN = /^\s*\((\d+)\)\s*(.*)$/u;
const INLINE_FRACTION_AT_START_PATTERN = /^\\frac\{([^{}\r\n]+)\}\{([^{}\r\n]+)\}/u;

export type InlineQuestionTextToken =
    | Readonly<{ kind: "text"; value: string }>
    | Readonly<{ kind: "fraction"; numerator: string; denominator: string }>
    | Readonly<{ kind: "script"; placement: "superscript" | "subscript"; value: string }>;

export type PromptBlankToken =
    | Readonly<{ kind: "text"; value: string }>
    | Readonly<{ kind: "blank"; label?: string; widthEm: number }>;

type ReferenceAnswerDisplay = Readonly<{
    answerKeys: readonly string[];
    acceptedValues: readonly string[];
    options: readonly Readonly<{ key: string; label: string }>[];
}>;

const PROMPT_BLANK_PATTERN = /((?:[ \t]*　[ \t　]*)[(（][0-9０-９]+[)）](?:(?:[ \t　]*　[ \t　]*)|(?=\r?\n|$))| {4,}|　{2,})/gu;
const NUMBERED_PROMPT_BLANK_PATTERN = /[(（][0-9０-９]+[)）]/u;
const QUESTION_DISPLAY_TEXT_REPLACEMENTS = [
    ["\uF0DE", "⇒"],
    ["∵", "因為"],
    ["∴", "所以"],
] as const;

/**
 * 將來源題幹中的作答空格轉成共用呈現 token。舊版英文 Word 會把
 * 「全形空白＋小題編號＋全形空白」整段加底線，因此編號必須保留在底線上。
 */
export function tokenizePromptBlanks(value: string): PromptBlankToken[] {
    const tokens: PromptBlankToken[] = [];
    let offset = 0;
    for (const match of value.matchAll(PROMPT_BLANK_PATTERN)) {
        const index = match.index ?? 0;
        if (index > offset) tokens.push({ kind: "text", value: value.slice(offset, index) });
        const segment = match[0];
        const label = segment.match(NUMBERED_PROMPT_BLANK_PATTERN)?.[0];
        const spacingWidth = [...segment].reduce((width, character) => {
            if (character === "　") return width + 1;
            if (character === " ") return width + 0.5;
            return width;
        }, 0);
        tokens.push({
            kind: "blank",
            ...(label ? { label: label.normalize("NFKC") } : {}),
            widthEm: Math.min(Math.max(spacingWidth + (label ? 2 : 0), label ? 4 : 3), 8),
        });
        offset = index + segment.length;
    }
    if (offset < value.length) tokens.push({ kind: "text", value: value.slice(offset) });
    return tokens.length ? tokens : [{ kind: "text", value }];
}

/** 將題庫原始字元轉成學習者可直接閱讀的畫面文字，不改寫持久資料。 */
export function normalizeQuestionDisplayText(value: string): string {
    return QUESTION_DISPLAY_TEXT_REPLACEMENTS.reduce(
        (displayText, [source, replacement]) => displayText.replaceAll(source, replacement),
        value,
    );
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

/** 將多小題參考答案依來源順序補回可見編號，單一小題維持原答案文字。 */
export function formatNumberedReferenceAnswers(referenceAnswers: readonly ReferenceAnswerDisplay[]): string {
    return referenceAnswers.map((reference, index) => {
        const optionLabels = new Map(reference.options.map((option) => [option.key, option.label]));
        const values = reference.acceptedValues.length
            ? reference.acceptedValues
            : reference.answerKeys.map((key) => optionLabels.get(key) ?? key);
        const value = values.length ? values.join("、") : "需人工批改";
        if (referenceAnswers.length === 1) return value;
        return `(${index + 1})${value.replace(/[；;]+\s*$/u, "")}`;
    }).join("；");
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
