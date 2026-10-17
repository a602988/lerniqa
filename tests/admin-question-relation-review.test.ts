import assert from "node:assert/strict";
import test from "node:test";

import type { QueryResultRow } from "pg";

import {
    listPendingQuestionRelations,
    questionRelationReviewSpec,
} from "../app/lib/admin/question-relation-review.ts";
import type { AdminQueryRunner } from "../app/lib/admin/admin-auth.ts";

test("relation review input requires a reason only when rejecting", () => {
    const spec = questionRelationReviewSpec(
        "template",
        "11111111-1111-4111-8111-111111111111",
    );
    assert.deepEqual(spec.parse({ decision: "approve", reason: null }, {
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        requestId: "request",
    }), { decision: "approve", reason: null });
    assert.throws(() => spec.parse({ decision: "reject", reason: "" }, {
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        requestId: "request",
    }), /退回時必須填寫原因/u);
});

test("pending relation snapshot preserves review evidence and totals", async () => {
    const runner: AdminQueryRunner = {
        async query<Row extends QueryResultRow>(text: string) {
            if (text.includes("FROM question_templates AS template")) {
                return { rows: [{
                    id: "11111111-1111-4111-8111-111111111111",
                    template_key: "tpl:test",
                    normalized_pattern: "{{name}}正在閱讀",
                    logic_key: "reading.identify",
                    evidence: { confidence: 0.9 },
                    question_count: 1,
                    prompts: ["小明正在閱讀"],
                    variables: [{ name: "小明" }],
                }] as unknown as Row[] };
            }
            if (text.includes("FROM question_revision_keywords AS relation")) {
                return { rows: [{
                    keyword_id: "22222222-2222-4222-8222-222222222222",
                    revision_id: "33333333-3333-4333-8333-333333333333",
                    question_id: "44444444-4444-4444-8444-444444444444",
                    keyword_key: "concept:reading",
                    label: "閱讀",
                    keyword_kind: "concept",
                    evidence: { confidence: 0.8 },
                    prompt: "小明正在閱讀",
                }] as unknown as Row[] };
            }
            return { rows: [{ template_total: 1, keyword_total: 1 }] as unknown as Row[] };
        },
    };
    const snapshot = await listPendingQuestionRelations(runner);
    assert.equal(snapshot.templateTotal, 1);
    assert.deepEqual(snapshot.templates[0]?.variables, [{ name: "小明" }]);
    assert.equal(snapshot.keywords[0]?.evidence.confidence, 0.8);
});
