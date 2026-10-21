import assert from "node:assert/strict";
import test from "node:test";
import { validateClassificationSuggestions } from "../app/lib/question-classification-ai.ts";
import { createBlankImportQuestion } from "../app/lib/question-import-contract.ts";

const FIELD_ID = "11111111-1111-4111-8111-111111111111";
const OPTION_ID = "22222222-2222-4222-8222-222222222222";

test("accepts only suggestions from the supplied closed taxonomy", () => {
    const question = createBlankImportQuestion();
    const result = validateClassificationSuggestions({ suggestions: [{
        draftKey: question.draftKey,
        fieldId: FIELD_ID,
        optionIds: [OPTION_ID],
        confidence: 0.91,
        reason: "題幹主要測驗單字意義。",
    }] }, [question], [{
        id: FIELD_ID,
        name: "內容類型",
        selectionMode: "single",
        subjectIds: [],
        options: [{ id: OPTION_ID, label: "單字", value: "vocabulary", sortOrder: 0 }],
    }]);
    assert.equal(result[0]?.optionIds[0], OPTION_ID);
});

test("rejects option identifiers invented by the model", () => {
    const question = createBlankImportQuestion();
    assert.throws(() => validateClassificationSuggestions({ suggestions: [{
        draftKey: question.draftKey,
        fieldId: FIELD_ID,
        optionIds: ["33333333-3333-4333-8333-333333333333"],
        confidence: 0.8,
        reason: "不在允許清單。",
    }] }, [question], [{
        id: FIELD_ID,
        name: "內容類型",
        selectionMode: "single",
        subjectIds: [],
        options: [{ id: OPTION_ID, label: "單字", value: "vocabulary", sortOrder: 0 }],
    }]), /允許清單/u);
});
