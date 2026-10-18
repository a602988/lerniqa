import assert from "node:assert/strict";
import test from "node:test";

import { getSubjectUnitProgress } from "../app/lib/subject-progress.ts";

test("groups unit progress under each subject without merging shared unit names", () => {
    const progress = getSubjectUnitProgress(
        [
            { id: 1, subject: "國語", unit: "第一單元" },
            { id: 2, subject: "數學", unit: "第一單元" },
            { id: 3, subject: "國語", unit: "第一單元" },
            { id: 4, subject: "國語", unit: "第二單元" },
        ],
        [
            { questionId: 1, correct: true },
            { questionId: 2, correct: false },
            { questionId: 3, correct: null },
        ],
    );

    assert.deepEqual(progress, [
        {
            subject: "國語",
            units: [
                { unit: "第一單元", answered: 2, correct: 1, total: 2, value: 100 },
                { unit: "第二單元", answered: 0, correct: 0, total: 1, value: 0 },
            ],
        },
        {
            subject: "數學",
            units: [
                { unit: "第一單元", answered: 1, correct: 0, total: 1, value: 100 },
            ],
        },
    ]);
});

test("ignores attempts outside the learner question set", () => {
    assert.deepEqual(
        getSubjectUnitProgress(
            [{ id: 1, subject: "國語", unit: "第一單元" }],
            [
                { questionId: 1, correct: true },
                { questionId: 99, correct: true },
            ],
        ),
        [{
            subject: "國語",
            units: [{ unit: "第一單元", answered: 1, correct: 1, total: 1, value: 100 }],
        }],
    );
});

test("returns no subject rows when the learner has no questions", () => {
    assert.deepEqual(
        getSubjectUnitProgress([], [{ questionId: 1, correct: true }]),
        [],
    );
});
