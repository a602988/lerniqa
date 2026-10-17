import assert from "node:assert/strict";
import test from "node:test";

import {
    getRepeatedNumberedPartLabel,
    normalizeLegacyMathSymbols,
    reflowNumberedExplanation,
} from "../app/lib/question-presentation.ts";

test("legacy Symbol implication marks become standard double arrows", () => {
    assert.equal(
        normalizeLegacyMathSymbols("432□6為倍數\n□＝9"),
        "432□6為倍數\n⇒□＝9",
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
