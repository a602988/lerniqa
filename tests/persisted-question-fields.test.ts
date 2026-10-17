import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("題幹已有多個空格時只顯示對應的文字輸入欄位", async () => {
    const fields = await readFile(
        new URL("../app/components/persisted-question-fields.tsx", import.meta.url),
        "utf8",
    );

    assert.match(fields, /countPromptBlanks\(question\.prompt\) >= parts\.length/u);
    assert.match(fields, /usesInlineBlankAnswerFields \? "sr-only" : legendClassName/u);
    assert.match(fields, /usesInlineBlankAnswerFields[\s\S]*aria-label=\{`第 \$\{sourceIndex \+ 1\} 個答案`\}/u);
    assert.match(fields, /!usesInlineBlankAnswerFields && gradingNotice/u);
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
