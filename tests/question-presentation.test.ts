import assert from "node:assert/strict";
import test from "node:test";

import {
    formatNumberedReferenceAnswers,
    getRepeatedNumberedPartLabel,
    normalizeQuestionDisplayText,
    reflowNumberedExplanation,
    tokenizeInlineQuestionText,
    tokenizePromptBlanks,
} from "../app/lib/question-presentation.ts";

test("multi-part reference answers retain their visible part numbers", () => {
    assert.equal(
        formatNumberedReferenceAnswers([
            { answerKeys: [], acceptedValues: ["東北方；"], options: [] },
            { answerKeys: [], acceptedValues: ["東南方；"], options: [] },
            { answerKeys: [], acceptedValues: ["西南方；"], options: [] },
            { answerKeys: [], acceptedValues: ["西北方"], options: [] },
        ]),
        "(1)東北方；(2)東南方；(3)西南方；(4)西北方",
    );
});

test("single-part reference answers do not gain a synthetic part number", () => {
    assert.equal(
        formatNumberedReferenceAnswers([
            { answerKeys: ["B"], acceptedValues: [], options: [{ key: "B", label: "乙" }] },
        ]),
        "乙",
    );
});

test("numbered English cloze blanks retain their number on an underline", () => {
    assert.deepEqual(tokenizePromptBlanks("Alan: I’m Alan. 　(1)　 your name?"), [
        { kind: "text", value: "Alan: I’m Alan." },
        { kind: "blank", label: "(1)", widthEm: 5 },
        { kind: "text", value: "your name?" },
    ]);
    assert.deepEqual(tokenizePromptBlanks("請填　　答案"), [
        { kind: "text", value: "請填" },
        { kind: "blank", widthEm: 3 },
        { kind: "text", value: "答案" },
    ]);
    assert.deepEqual(tokenizePromptBlanks("一般的 (1) 小題編號"), [
        { kind: "text", value: "一般的 (1) 小題編號" },
    ]);
    assert.deepEqual(tokenizePromptBlanks("George: My name is George. 　(1)"), [
        { kind: "text", value: "George: My name is George." },
        { kind: "blank", label: "(1)", widthEm: 4 },
    ]);
    assert.deepEqual(tokenizePromptBlanks("George: My name is George. 　(１)\nSusan: Hi."), [
        { kind: "text", value: "George: My name is George." },
        { kind: "blank", label: "(1)", widthEm: 4 },
        { kind: "text", value: "\nSusan: Hi." },
    ]);
    assert.deepEqual(tokenizePromptBlanks("一般的　(1) 小題編號"), [
        { kind: "text", value: "一般的　(1) 小題編號" },
    ]);
});

test("legacy Symbol implication marks become standard double arrows", () => {
    assert.equal(
        normalizeQuestionDisplayText("432□6為倍數\n□＝9"),
        "432□6為倍數\n⇒□＝9",
    );
});

test("reason symbols become readable Chinese words on screen", () => {
    assert.equal(
        normalizeQuestionDisplayText("∵甲成立，∴乙成立"),
        "因為甲成立，所以乙成立",
    );
});

test("explicit fraction markup becomes structured inline math without changing dates or ratios", () => {
    assert.deepEqual(
        tokenizeInlineQuestionText("介於 \\frac{13}{14} 與 \\frac{15}{16} 之間"),
        [
            { kind: "text", value: "介於 " },
            { kind: "fraction", numerator: "13", denominator: "14" },
            { kind: "text", value: " 與 " },
            { kind: "fraction", numerator: "15", denominator: "16" },
            { kind: "text", value: " 之間" },
        ],
    );
    assert.deepEqual(
        tokenizeInlineQuestionText("日期 2026/10/17，比例 3/4"),
        [{ kind: "text", value: "日期 2026/10/17，比例 3/4" }],
    );
});

test("explicit exponent and subscript markup becomes structured inline math", () => {
    assert.deepEqual(
        tokenizeInlineQuestionText("(10^(3))^(5)＝10^(3×5)，a_(n＋1)"),
        [
            { kind: "text", value: "(10" },
            { kind: "script", placement: "superscript", value: "3" },
            { kind: "text", value: ")" },
            { kind: "script", placement: "superscript", value: "5" },
            { kind: "text", value: "＝10" },
            { kind: "script", placement: "superscript", value: "3×5" },
            { kind: "text", value: "，a" },
            { kind: "script", placement: "subscript", value: "n＋1" },
        ],
    );
    assert.deepEqual(
        tokenizeInlineQuestionText("來源截斷3^"),
        [{ kind: "text", value: "來源截斷3^" }],
    );
});

test("repeated numbered subquestions show only their matching number", () => {
    const parent = "試回答：\n(1) 第一題？\n(2) 第二題？\n(3) 第三題？";

    assert.equal(getRepeatedNumberedPartLabel(parent, "第一題？", 0), "(1)");
    assert.equal(getRepeatedNumberedPartLabel(parent, "第二題？", 1), "(2)");
    assert.equal(getRepeatedNumberedPartLabel(parent, "不同文字", 2), undefined);
});

test("numbered explanations fill each section before starting the next one", () => {
    const explanation = "（1）第一段\n128÷3＝42…2\n結論一\n（2）第二段\n計算二\n結論二";

    assert.equal(
        reflowNumberedExplanation(explanation),
        "（1）第一段 128÷3＝42…2 結論一\n（2）第二段 計算二 結論二",
    );
});

test("non-numbered explanation formatting remains unchanged", () => {
    const explanation = "第一行\n第二行";
    assert.equal(reflowNumberedExplanation(explanation), explanation);
});
