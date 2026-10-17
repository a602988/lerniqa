import assert from "node:assert/strict";
import test from "node:test";
import {
    CORRECTION_ANSWER_HINT,
    CORRECTION_ANSWER_PLACEHOLDER,
    isCorrectionQuestion,
} from "../app/lib/question-answer-guidance.ts";

test("改錯題會提示使用半形逗號分隔多個答案", () => {
    assert.equal(isCorrectionQuestion("改錯題"), true);
    assert.equal(isCorrectionQuestion("  改錯題  "), true);
    assert.match(CORRECTION_ANSWER_HINT, /半形逗號（,）分隔/u);
    assert.match(CORRECTION_ANSWER_PLACEHOLDER, /答案一,答案二,答案三/u);
});

test("其他文字題不會套用改錯題提示", () => {
    assert.equal(isCorrectionQuestion("填充題"), false);
    assert.equal(isCorrectionQuestion("寫出國字、注音"), false);
    assert.equal(isCorrectionQuestion(undefined), false);
});
