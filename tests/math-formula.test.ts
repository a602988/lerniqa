import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mathFormulaRenderExpression, mathFormulaSearchText } from "../app/lib/math-formula.ts";

test("fractions render with readable display-style numerals inside the inline flow", () => {
    assert.equal(mathFormulaRenderExpression("\\frac{6}{8}"), "\\displaystyle \\frac{6}{8}");
});

test("fraction formulas expose canonical and readable search terms", () => {
    const searchText = mathFormulaSearchText("\\frac{6}{8}");
    assert.match(searchText, /\\frac\{6\}\{8\}/u);
    assert.match(searchText, /6\/8/u);
});

test("formula search normalizes multiplication and division symbols", () => {
    const searchText = mathFormulaSearchText("3 \\times 4 \\div 2");
    assert.match(searchText, /3×4÷2/u);
    assert.match(searchText, /3\*4\/2/u);
});

test("shared formula styling keeps math readable inside smaller surrounding text", async () => {
    const [styles, standalonePracticeStyles] = await Promise.all([
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/local-practice.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(styles, /\.math-formula \{[\s\S]*font-size: clamp\(1\.5rem, 1\.6em, 1\.75rem\);/u);
    assert.match(styles, /\.question-inline-formula-flow\[role="heading"\] \.math-formula \{[\s\S]*font-size: clamp\(1\.25rem, 1\.3em, 1\.5rem\);/u);
    assert.match(standalonePracticeStyles, /\.formula \{[\s\S]*font-size: clamp\(1\.5rem, 1\.6em, 1\.75rem\);/u);
});
