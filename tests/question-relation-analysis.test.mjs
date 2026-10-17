import assert from "node:assert/strict";
import test from "node:test";

import {
    buildRelationAnalysisDocument,
    relationAnalysisJsonSchema,
    relationKeywordId,
    relationTemplateId,
    validateRelationAnalysis,
} from "../scripts/lib/question-relation-analysis.mjs";

const valid = {
    template: {
        normalized_pattern: "小明有 {{count}} 顆蘋果，送給 {{person}} 後剩幾顆？",
        logic_key: "math.subtract.remaining",
        variables: { count: "8", person: "小華" },
        confidence: 0.91,
        evidence: ["題幹骨架與求剩餘量的解法固定。"],
    },
    keywords: [
        {
            keyword_key: "math:subtraction",
            label: "減法",
            kind: "knowledge_point",
            confidence: 0.95,
            evidence: ["題目明確評量求剩餘量。"],
        },
    ],
};

test("relation analysis validates a template and deterministic identities", () => {
    const result = validateRelationAnalysis(valid);
    assert.match(result.template.template_key, /^tpl:[0-9a-f]{48}$/u);
    assert.deepEqual(result.template.variables, { count: "8", person: "小華" });
    assert.equal(relationTemplateId(result.template.template_key), relationTemplateId(result.template.template_key));
    assert.equal(relationKeywordId("math:subtraction"), relationKeywordId("math:subtraction"));
});

test("relation analysis rejects variables that do not match placeholders", () => {
    assert.throws(() => validateRelationAnalysis({
        ...valid,
        template: { ...valid.template, variables: { count: "8" } },
    }), /placeholders/u);
});

test("relation analysis rejects duplicate keyword keys", () => {
    assert.throws(() => validateRelationAnalysis({
        ...valid,
        keywords: [...valid.keywords, { ...valid.keywords[0] }],
    }), /重複/u);
});

test("relation schema is strict and limits keyword kinds", () => {
    const schema = relationAnalysisJsonSchema();
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(
        schema.properties.keywords.items.properties.kind.enum,
        ["person", "work", "passage", "target_character", "concept", "topic", "knowledge_point", "other"],
    );
});

test("relation checkpoint records failures without marking the document complete", () => {
    const questions = [{
        questionId: "11111111-1111-4111-8111-111111111111",
        revisionId: "22222222-2222-4222-8222-222222222222",
        questionTypeCode: "single-choice",
        questionTypeName: "單一選擇題",
        parts: [],
        contentBlocks: [],
        options: [],
        answers: [],
    }];
    const failures = [{
        question_id: questions[0].questionId,
        question_revision_id: questions[0].revisionId,
        code: "MODEL_CLASSIFICATION_FAILED",
        message: "分類失敗。",
        cause_code: null,
        cause_message: null,
    }];
    const document = buildRelationAnalysisDocument(
        questions,
        [],
        { name: "model", digest: "a".repeat(64), version: "runtime" },
        { complete: false, failures },
    );
    assert.equal(document.complete, false);
    assert.equal(document.failure_count, 1);
    assert.equal(document.failures[0].question_revision_id, questions[0].revisionId);
});
