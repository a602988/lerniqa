import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("題幹已有多個空格時只顯示對應的文字輸入欄位", async () => {
    const fields = await readFile(
        new URL("../app/components/persisted-question-fields.tsx", import.meta.url),
        "utf8",
    );

    assert.match(fields, /countPromptBlanks\(question\.prompt\) >= parts\.length/u);
    assert.match(fields, /usesDedicatedAnswerSlots \|\| usesInlineBlankAnswerFields\) \? "sr-only" : legendClassName/u);
    assert.match(fields, /usesInlineBlankAnswerFields[\s\S]*className="practice-answer-slots-row"[\s\S]*className="practice-answer-part-number"[^>]*>\(\{sourceIndex \+ 1\}\)<\/span>[\s\S]*aria-label=\{`第 \$\{sourceIndex \+ 1\} 個答案`\}/u);
    assert.match(fields, /!usesInlineBlankAnswerFields && !usesDedicatedAnswerSlots && gradingNotice/u);
    assert.match(fields, /written-answer-fieldset-compact/u);
});

test("一般文字題不顯示多餘的文字答案標籤", async () => {
    const fields = await readFile(
        new URL("../app/components/persisted-question-fields.tsx", import.meta.url),
        "utf8",
    );

    assert.doesNotMatch(fields, /\slabel="文字答案"/u);
    assert.match(fields, /aria-label="文字答案"/u);
});

test("多欄文字小題在輸入欄位前顯示來源小題編號", async () => {
    const [fields, legacyPractice, styles, practiceStyles] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/local-practice.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(fields, /className="practice-answer-part-number"[^>]*>\(\{sourceIndex \+ 1\}\)<\/span>/u);
    assert.match(legacyPractice, /className=\{styles\.answerSlotsNumber\}[^>]*>\(\{displayIndex \+ 1\}\)<\/span>/u);
    assert.match(styles, /\.practice-answer-part-number \{[\s\S]*font-size: 1\.125rem;/u);
    assert.match(practiceStyles, /\.answerSlotsNumber \{[\s\S]*font-size: 1\.125rem;/u);
});

test("獨立小題逐題切換，但題幹多空格與多欄文字小題維持同頁作答", async () => {
    const fields = await readFile(
        new URL("../app/components/persisted-question-fields.tsx", import.meta.url),
        "utf8",
    );

    assert.match(fields, /parts\.every\(\(part\) => part\.answerMode === "text" && part\.answerFieldCount > 1\)/u);
    assert.match(fields, /const usesStepNavigation = parts\.length > 1[\s\S]*&& !usesInlineBlankAnswerFields[\s\S]*&& !usesDedicatedAnswerSlotRows/u);
    assert.match(fields, /const visibleParts = usesStepNavigation \? parts\.slice\(currentIndex, currentIndex \+ 1\) : parts/u);
    assert.equal(fields.match(/<Button type="button"/gu)?.length, 2);
    assert.match(fields, />上一小題<\/Button>/u);
    assert.match(fields, />下一小題<ArrowRight \/><\/Button>/u);
    assert.doesNotMatch(fields, /setActiveIndex[^;]*update\(/u);
});

test("所有可編輯文字答案欄位使用一致的答案框樣式", async () => {
    const [fields, practice, styles, practiceStyles] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/local-practice.module.css", import.meta.url), "utf8"),
    ]);

    assert.equal(fields.match(/className="practice-answer-control"/gu)?.length, 3);
    assert.equal(practice.match(/className="practice-answer-control"/gu)?.length, 2);
    assert.match(styles, /\.practice-answer-control \{[\s\S]*min-height: 2\.75rem;[\s\S]*border: 1px solid var\(--color-border\);[\s\S]*border-radius: 0\.875rem;[\s\S]*background: var\(--color-card\);/u);
    assert.match(styles, /\.practice-answer-control:focus-visible,[\s\S]*\.practice-answer-control:focus-within/u);
    assert.match(styles, /\.practice-answer-slots-row \{[\s\S]*align-items: flex-start;/u);
    assert.match(practiceStyles, /\.answerSlotsRow \{[\s\S]*align-items: flex-start;/u);
});

test("一般根題幹的文字獨占一列，圖片依來源順序保留同列換行", async () => {
    const [fields, styles] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);
    const orderedContent = fields.slice(fields.indexOf("function OrderedPublicContent"), fields.indexOf("export function PersistedQuestionPromptContent"));
    const rootPrompt = fields.slice(fields.indexOf("export function PersistedQuestionPromptContent"), fields.indexOf("function PromptText"));

    assert.match(rootPrompt, /hasInlineFormulaContent \? "question-inline-formula-flow" : "flex flex-wrap items-center gap-x-1 gap-y-2"/u);
    assert.match(rootPrompt, /layout=\{hasInlineFormulaContent \? "default" : "root-prompt"\}/u);
    assert.match(orderedContent, /const textClassName = `whitespace-pre-wrap\$\{layout === "root-prompt" \? " question-root-prompt-text" : ""\}`/u);
    assert.match(orderedContent, /!hasText && fallbackText \? <span className=\{textClassName\}>/u);
    assert.match(orderedContent, /block\.contentType === "text" \|\| block\.contentType === "transcript"[\s\S]*return <span className=\{textClassName\} key=\{block\.id\}>/u);
    assert.match(styles, /\.question-root-prompt-text \{\s*flex: 0 0 100%;\s*min-width: 0;\s*\}/u);
    assert.match(orderedContent, /\[\.\.\.blocks\]\.sort\(\(first, second\) => first\.position - second\.position\)/u);
    assert.match(orderedContent, /block\.contentType === "image" \|\| block\.contentType === "page_crop"[\s\S]*return <img/u);
    assert.doesNotMatch(orderedContent, /question-root-prompt-text[^\n]*<img/u);
});
