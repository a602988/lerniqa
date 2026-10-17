import type { LocalPracticeRecommendationKind } from "./local-practice-types";

export type RecommendationKind = LocalPracticeRecommendationKind;

export interface FineQuestionTypeClassification {
    questionTypeId: string;
    questionTypeCode: string;
    sourceCategoryId: string | null;
    originalQuestionTypeLabel: string | null;
}

export interface RecommendationCandidateIdentity {
    questionId: string;
    revisionId: string;
}

export interface RecommendationTierSelection<Candidate> {
    recommendationKind: RecommendationKind;
    candidates: Candidate[];
}

export interface RecommendationTierOptions<Candidate extends RecommendationCandidateIdentity> {
    sameTypeCandidates: readonly Candidate[];
    confirmedSimilarCandidates: readonly Candidate[];
    limit: number;
    /** Optional domain ranking. Question and revision ids remain the deterministic tie-breakers. */
    compareCandidates?: (left: Candidate, right: Candidate) => number;
}

const HANLIN_COARSE_QUESTION_TYPE_CODES = new Set([
    "single-choice",
    "multi-choice",
    "written",
]);

function isNonBlank(value: string | null): value is string {
    return value !== null && value.trim().length > 0;
}

/** Keeps the source label when it has content and otherwise uses the formal type name. */
export function recommendationClassificationLabel(
    originalQuestionTypeLabel: string | null,
    questionTypeName: string,
): string {
    return originalQuestionTypeLabel?.trim() || questionTypeName;
}

/**
 * Hanlin currently imports several source-specific types into three broad formal types.
 * Those broad ids are only a fine-type match when the source category and unmodified
 * source type label also match. A future genuinely fine formal type can match by id.
 */
export function isSameFineQuestionType(
    source: FineQuestionTypeClassification,
    candidate: FineQuestionTypeClassification,
): boolean {
    if (!isNonBlank(source.questionTypeId) || source.questionTypeId !== candidate.questionTypeId) {
        return false;
    }

    const sourceUsesCoarseType = HANLIN_COARSE_QUESTION_TYPE_CODES.has(source.questionTypeCode);
    const candidateUsesCoarseType = HANLIN_COARSE_QUESTION_TYPE_CODES.has(candidate.questionTypeCode);
    if (!sourceUsesCoarseType && !candidateUsesCoarseType) {
        return true;
    }
    if (source.questionTypeCode !== candidate.questionTypeCode) {
        return false;
    }

    return isNonBlank(source.sourceCategoryId)
        && source.sourceCategoryId === candidate.sourceCategoryId
        && isNonBlank(source.originalQuestionTypeLabel)
        && isNonBlank(candidate.originalQuestionTypeLabel)
        && source.originalQuestionTypeLabel === candidate.originalQuestionTypeLabel;
}

function compareCandidateIdentity<Candidate extends RecommendationCandidateIdentity>(
    left: Candidate,
    right: Candidate,
): number {
    if (left.questionId !== right.questionId) {
        return left.questionId < right.questionId ? -1 : 1;
    }
    if (left.revisionId === right.revisionId) return 0;
    return left.revisionId < right.revisionId ? -1 : 1;
}

function selectDeterministicCandidates<Candidate extends RecommendationCandidateIdentity>(
    candidates: readonly Candidate[],
    limit: number,
    compareCandidates?: (left: Candidate, right: Candidate) => number,
): Candidate[] {
    const ranked = [...candidates].sort((left, right) => {
        const domainOrder = compareCandidates?.(left, right) ?? 0;
        return domainOrder !== 0 ? domainOrder : compareCandidateIdentity(left, right);
    });
    const selected: Candidate[] = [];
    const seenQuestionIds = new Set<string>();

    for (const candidate of ranked) {
        if (seenQuestionIds.has(candidate.questionId)) continue;
        seenQuestionIds.add(candidate.questionId);
        selected.push(candidate);
        if (selected.length === limit) break;
    }

    return selected;
}

/**
 * Chooses exactly one recommendation tier from the complete candidate sets.
 * Confirmed-similar questions are fallback-only and never top up a short same-type set.
 */
export function selectRecommendationTier<
    Candidate extends RecommendationCandidateIdentity,
>(options: RecommendationTierOptions<Candidate>): RecommendationTierSelection<Candidate> {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
        throw new RangeError("Recommendation limit must be a positive safe integer.");
    }

    if (options.sameTypeCandidates.length > 0) {
        return {
            recommendationKind: "same_type",
            candidates: selectDeterministicCandidates(
                options.sameTypeCandidates,
                options.limit,
                options.compareCandidates,
            ),
        };
    }
    if (options.confirmedSimilarCandidates.length > 0) {
        return {
            recommendationKind: "confirmed_similar",
            candidates: selectDeterministicCandidates(
                options.confirmedSimilarCandidates,
                options.limit,
                options.compareCandidates,
            ),
        };
    }

    return { recommendationKind: "none", candidates: [] };
}
