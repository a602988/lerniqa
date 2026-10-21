import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("question images share a row and wrap only when the available width is exhausted", async () => {
    const [sharedFields, practiceStyles] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/local-practice.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(sharedFields, /flex w-full flex-wrap items-start gap-3/u);
    assert.match(sharedFields, /max-h-96 max-w-full flex-none object-contain/u);
    assert.match(practiceStyles, /\.contentBlocks\s*\{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;/u);
    assert.match(practiceStyles, /\.mediaAsset\s*\{[\s\S]*width: fit-content;[\s\S]*flex: 0 1 auto;/u);
    assert.match(practiceStyles, /\.inlineFormulaImage\s*\{[\s\S]*display: inline-block;[\s\S]*border: 0;/u);
});

test("inline formula blocks preserve Word line breaks in both question surfaces", async () => {
    const [sharedFields, sharedStyles, practicePage, practiceStyles] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/local-practice.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(sharedFields, /hasInlineFormulaContent \? "question-inline-formula-flow"/u);
    assert.match(sharedFields, /className="question-inline-formula-flow"/u);
    assert.match(sharedStyles, /\.question-inline-formula-flow\s*\{[\s\S]*white-space: pre-wrap;/u);
    assert.match(sharedStyles, /\.question-inline-formula-flow\[role="heading"\]\s*\{[\s\S]*line-height: 4rem;/u);
    assert.match(sharedStyles, /\.question-inline-formula-image\s*\{[\s\S]*display: inline-block;[\s\S]*vertical-align: middle;/u);
    assert.match(practicePage, /hasInlineFormula[\s\S]*\? <span key=\{block\.id\}><BopomofoText text=\{block\.text\} \/><\/span>/u);
    assert.match(practiceStyles, /\.inlineFormulaSequence\s*\{[\s\S]*display: block;[\s\S]*white-space: pre-wrap;/u);
    assert.match(practiceStyles, /\.inlineFormulaAsset\s*\{[\s\S]*vertical-align: middle;/u);
});
