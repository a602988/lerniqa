import assert from "node:assert/strict";
import test from "node:test";
import { hasCompleteAnswerSlots, setAnswerSlot, splitAnswerSlots } from "../app/lib/answer-slots.ts";

test("multiple answer fields preserve order, duplicates, negatives, and unfinished positions", () => {
    let value = setAnswerSlot("", 3, 2, "－4");
    assert.deepEqual(splitAnswerSlots(value, 3), ["", "", "－4"]);
    assert.equal(hasCompleteAnswerSlots(value, 3), false);

    value = setAnswerSlot(value, 3, 0, "7");
    value = setAnswerSlot(value, 3, 1, "7");
    assert.equal(value, "7，7，－4");
    assert.equal(hasCompleteAnswerSlots(value, 3), true);
    assert.equal(hasCompleteAnswerSlots("7，，－4", 3), false);
    assert.equal(hasCompleteAnswerSlots("7，7，－4，5", 3), false);
});
