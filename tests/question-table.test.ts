import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseQuestionTable } from "../app/lib/question-table.ts";

test("native question tables preserve rows, columns, and empty cells", () => {
    assert.deepEqual(parseQuestionTable("\t(A)\t(B)\r\n大比例尺\t詳細\t範圍小\r\n小比例尺\t簡略\t範圍大"), [
        ["", "(A)", "(B)"],
        ["大比例尺", "詳細", "範圍小"],
        ["小比例尺", "簡略", "範圍大"],
    ]);
});

test("both learner question surfaces use the shared semantic table renderer", async () => {
    const [component, fields, practice, styles] = await Promise.all([
        readFile(new URL("../app/components/question-table.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

    assert.match(component, /<table className="question-data-table">/u);
    assert.match(component, /<tbody>/u);
    assert.match(component, /<tr key=/u);
    assert.match(component, /<td key=/u);
    assert.match(fields, /<QuestionTable key=\{block\.id\} text=\{block\.text\} \/>/u);
    assert.match(practice, /<QuestionTable key=\{block\.id\} text=\{block\.text\} \/>/u);
    assert.match(styles, /\.question-data-table-wrap \{[\s\S]*overflow-x: auto;/u);
    assert.match(styles, /\.question-data-table td \{[\s\S]*border: 1px solid/u);
});
