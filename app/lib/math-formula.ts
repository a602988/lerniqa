function replaceFractions(value: string): string {
    let result = "";
    let cursor = 0;
    const readGroup = (start: number) => {
        if (value[start] !== "{") return null;
        let depth = 0;
        for (let index = start; index < value.length; index += 1) {
            if (value[index] === "{") depth += 1;
            if (value[index] === "}") depth -= 1;
            if (depth === 0) return { content: value.slice(start + 1, index), end: index + 1 };
        }
        return null;
    };

    while (cursor < value.length) {
        if (!value.startsWith("\\frac", cursor)) {
            result += value[cursor];
            cursor += 1;
            continue;
        }
        const numerator = readGroup(cursor + 5);
        const denominator = numerator ? readGroup(numerator.end) : null;
        if (!numerator || !denominator) {
            result += value[cursor];
            cursor += 1;
            continue;
        }
        result += `(${replaceFractions(numerator.content)})/(${replaceFractions(denominator.content)})`;
        cursor = denominator.end;
    }
    return result;
}

/** Keep formulas inline while using full-size mathematical numerals and fractions. */
export function mathFormulaRenderExpression(expression: string): string {
    return `\\displaystyle ${expression}`;
}

/** Build an invisible search projection from canonical TeX without changing its display value. */
export function mathFormulaSearchText(expression: string): string {
    const canonical = expression.normalize("NFKC").trim();
    if (!canonical) return "";
    const readable = replaceFractions(canonical.replace(/\\phantom\{[^{}]*\}/gu, "□"))
        .replace(/\\(?:times|cdot)/gu, "×")
        .replace(/\\div/gu, "÷")
        .replace(/\\(?:left|right)/gu, "")
        .replace(/[{}\s]/gu, "")
        .replace(/\(([^()]*)\)/gu, "$1");
    const ascii = readable.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
    return [...new Set([canonical, canonical.replace(/\s/gu, ""), readable, ascii].filter(Boolean))].join(" ");
}
