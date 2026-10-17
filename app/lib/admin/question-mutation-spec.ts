import type {
    AdminMutationContext,
    AdminMutationSpec,
} from "./admin-mutation-handler.ts";
import {
    parseCreateQuestionDraftInput,
    parsePublishQuestionRevisionInput,
    parseReviewQuestionRevisionInput,
} from "./question-mutation-input.ts";
import type {
    CreateSystemQuestionDraftInput,
    CreateSystemQuestionDraftResult,
    PublishSystemQuestionRevisionInput,
    PublishSystemQuestionRevisionResult,
    ReviewSystemQuestionRevisionInput,
    ReviewSystemQuestionRevisionResult,
} from "./question-mutation-service.ts";

export const CREATE_QUESTION_DRAFT_FIELDS = [
    "baseRevisionId",
    "baseRevisionNumber",
    "changeNote",
    "contentPatch",
] as const;
export const REVIEW_QUESTION_REVISION_FIELDS = [
    "expectedRevisionNumber",
    "decision",
    "reason",
] as const;
export const PUBLISH_QUESTION_REVISION_FIELDS = [
    "expectedCurrentRevisionId",
    "expectedCurrentRevisionNumber",
    "changeNote",
] as const;

export interface QuestionMutationCommands {
    createDraftRevision(
        context: AdminMutationContext,
        input: CreateSystemQuestionDraftInput,
    ): Promise<CreateSystemQuestionDraftResult>;
    reviewDraftRevision(
        context: AdminMutationContext,
        input: ReviewSystemQuestionRevisionInput,
    ): Promise<ReviewSystemQuestionRevisionResult>;
    publishDraftRevision(
        context: AdminMutationContext,
        input: PublishSystemQuestionRevisionInput,
    ): Promise<PublishSystemQuestionRevisionResult>;
}

export function createQuestionDraftMutationSpec(
    rawQuestionId: string,
    commands: QuestionMutationCommands,
): AdminMutationSpec<CreateSystemQuestionDraftInput, CreateSystemQuestionDraftResult> {
    return {
        allowedFields: CREATE_QUESTION_DRAFT_FIELDS,
        parse(body) {
            return parseCreateQuestionDraftInput(body, rawQuestionId);
        },
        mutate(context, input) {
            return commands.createDraftRevision(context, input);
        },
        successStatus: 201,
    };
}

export function reviewQuestionRevisionMutationSpec(
    rawQuestionId: string,
    rawRevisionId: string,
    commands: QuestionMutationCommands,
): AdminMutationSpec<ReviewSystemQuestionRevisionInput, ReviewSystemQuestionRevisionResult> {
    return {
        allowedFields: REVIEW_QUESTION_REVISION_FIELDS,
        parse(body) {
            return parseReviewQuestionRevisionInput(body, rawQuestionId, rawRevisionId);
        },
        mutate(context, input) {
            return commands.reviewDraftRevision(context, input);
        },
    };
}

export function publishQuestionRevisionMutationSpec(
    rawQuestionId: string,
    rawRevisionId: string,
    commands: QuestionMutationCommands,
): AdminMutationSpec<PublishSystemQuestionRevisionInput, PublishSystemQuestionRevisionResult> {
    return {
        allowedFields: PUBLISH_QUESTION_REVISION_FIELDS,
        parse(body) {
            return parsePublishQuestionRevisionInput(body, rawQuestionId, rawRevisionId);
        },
        mutate(context, input) {
            return commands.publishDraftRevision(context, input);
        },
    };
}
