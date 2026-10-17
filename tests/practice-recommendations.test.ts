import assert from "node:assert/strict";
import test from "node:test";

import {
    isSameFineQuestionType,
    recommendationClassificationLabel,
    selectRecommendationTier,
    type FineQuestionTypeClassification,
} from "../app/lib/practice-recommendations.ts";

const SINGLE_CHOICE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

test("a blank original type label falls back to the formal type name", () => {
    assert.equal(recommendationClassificationLabel("  ", "選擇題"), "選擇題");
    assert.equal(recommendationClassificationLabel(null, "問答題"), "問答題");
    assert.equal(recommendationClassificationLabel("  題組  ", "選擇題"), "題組");
});

function classification(
    overrides: Partial<FineQuestionTypeClassification> = {},
): FineQuestionTypeClassification {
    return {
        questionTypeId: SINGLE_CHOICE_ID,
        questionTypeCode: "single-choice",
        sourceCategoryId: SOURCE_CATEGORY_ID,
        originalQuestionTypeLabel: "單一選擇題",
        ...overrides,
    };
}

test("Hanlin coarse formal types require the exact non-empty original type and source category", () => {
    for (const [questionTypeCode, originalQuestionTypeLabel] of [
        ["single-choice", "單一選擇題"],
        ["multi-choice", "題組"],
        ["written", "注釋"],
    ] as const) {
        const source = classification({ questionTypeCode, originalQuestionTypeLabel });
        assert.equal(isSameFineQuestionType(source, classification({
            questionTypeCode,
            originalQuestionTypeLabel,
        })), true);
        assert.equal(isSameFineQuestionType(source, classification({
            questionTypeCode,
            originalQuestionTypeLabel: `${originalQuestionTypeLabel}-另一原始題型`,
        })), false, `${questionTypeCode} must not collapse distinct source types`);
    }

    const source = classification();
    assert.equal(isSameFineQuestionType(source, classification({
        originalQuestionTypeLabel: " 單一選擇題 ",
    })), false, "the original label match is exact, not whitespace-normalized");
    assert.equal(isSameFineQuestionType(source, classification({
        originalQuestionTypeLabel: "",
    })), false);
    assert.equal(isSameFineQuestionType(source, classification({
        sourceCategoryId: "33333333-3333-4333-8333-333333333333",
    })), false);
    assert.equal(isSameFineQuestionType(source, classification({
        sourceCategoryId: null,
    })), false);
    assert.equal(isSameFineQuestionType(source, classification({
        questionTypeId: "44444444-4444-4444-8444-444444444444",
    })), false);
});

test("genuinely fine formal types can match by formal type id", () => {
    const source = classification({
        questionTypeId: "55555555-5555-4555-8555-555555555555",
        questionTypeCode: "sentence-reordering",
        sourceCategoryId: null,
        originalQuestionTypeLabel: null,
    });

    assert.equal(isSameFineQuestionType(source, {
        ...source,
        questionTypeCode: "renamed-sentence-reordering",
    }), true);
    assert.equal(isSameFineQuestionType(source, {
        ...source,
        questionTypeId: "66666666-6666-4666-8666-666666666666",
    }), false);
    assert.equal(isSameFineQuestionType(source, {
        ...source,
        questionTypeCode: "written",
    }), false, "inconsistent coarse metadata must not weaken the fine-type guard");
});

test("same-type candidates select the whole tier without confirmed-similar top-up", () => {
    const selection = selectRecommendationTier({
        sameTypeCandidates: [
            { questionId: "question-b", revisionId: "revision-b" },
        ],
        confirmedSimilarCandidates: [
            { questionId: "question-c", revisionId: "revision-c" },
            { questionId: "question-a", revisionId: "revision-a" },
        ],
        limit: 3,
    });

    assert.deepEqual(selection, {
        recommendationKind: "same_type",
        candidates: [{ questionId: "question-b", revisionId: "revision-b" }],
    });
});

test("confirmed similarity is used only when the complete same-type set is empty", () => {
    const selection = selectRecommendationTier({
        sameTypeCandidates: [],
        confirmedSimilarCandidates: [
            { questionId: "question-c", revisionId: "revision-c", source: "second-group" },
            { questionId: "question-a", revisionId: "revision-a", source: "first-group" },
            { questionId: "question-c", revisionId: "revision-d", source: "duplicate-membership" },
            { questionId: "question-b", revisionId: "revision-b", source: "first-group" },
        ],
        limit: 2,
    });

    assert.deepEqual(selection, {
        recommendationKind: "confirmed_similar",
        candidates: [
            { questionId: "question-a", revisionId: "revision-a", source: "first-group" },
            { questionId: "question-b", revisionId: "revision-b", source: "first-group" },
        ],
    });
});

test("domain ranking stays deterministic and deduplicates by question before limiting", () => {
    const selection = selectRecommendationTier({
        sameTypeCandidates: [
            { questionId: "question-b", revisionId: "revision-z", rank: 1 },
            { questionId: "question-a", revisionId: "revision-b", rank: 1 },
            { questionId: "question-a", revisionId: "revision-a", rank: 1 },
            { questionId: "question-c", revisionId: "revision-c", rank: 0 },
        ],
        confirmedSimilarCandidates: [],
        limit: 2,
        compareCandidates: (left, right) => left.rank - right.rank,
    });

    assert.deepEqual(selection.candidates, [
        { questionId: "question-c", revisionId: "revision-c", rank: 0 },
        { questionId: "question-a", revisionId: "revision-a", rank: 1 },
    ]);
});

test("an empty candidate set has an explicit none tier", () => {
    assert.deepEqual(selectRecommendationTier({
        sameTypeCandidates: [],
        confirmedSimilarCandidates: [],
        limit: 5,
    }), {
        recommendationKind: "none",
        candidates: [],
    });
});

test("the helper rejects limits that cannot produce a valid recommendation page", () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => selectRecommendationTier({
            sameTypeCandidates: [],
            confirmedSimilarCandidates: [],
            limit,
        }), RangeError);
    }
});
