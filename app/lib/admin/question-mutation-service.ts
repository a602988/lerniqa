import { createHash, randomUUID } from "node:crypto";

import type {
    AdminQueryRunner,
    SystemAdminActor,
} from "./admin-auth.ts";
import type {
    AdminMutationIdempotency,
    AdminMutationReceiptCompletion,
    AdminMutationReceiptRequest,
} from "./admin-mutation-receipts.ts";
import type { AdminMutationContext } from "./admin-mutation-handler.ts";
import {
    acquireQuestionMutationLock,
    applyDraftRevisionContentEdits,
    assertRevisionAutomaticAnswersComplete,
    insertDraftRevisionClone,
    insertQuestionMutationAudit,
    insertQuestionRevisionReview,
    lockQuestionForMutation,
    lockRevisionForMutation,
    readDraftBaseRevisionId,
    readNextRevisionNumber,
    readLatestRevisionReviewDecision,
    readRevisionCloneKeys,
    rebuildDraftRevisionSearchText,
    replaceQuestionCurrentRevision,
    transitionQuestionRevision,
    type LockedQuestionRecord,
    type LockedQuestionRevisionRecord,
    type DraftAnswerEdit,
    type DraftTextBlockEdit,
    type RevisionCloneIdMaps,
    type RevisionCloneKeys,
} from "./question-mutation-repository.ts";
import {
    AdminApiError,
    type AdminMutationEvidence,
} from "./admin-types.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MUTATION_EVIDENCE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type QuestionMutationIdempotencyRequest = AdminMutationReceiptRequest;

export interface QuestionMutationReceipt {
    targetType: "question_revision";
    targetId: string;
    auditLogId: string;
    responseStatus: 200 | 201;
}

export type QuestionMutationCompletion<Result> = AdminMutationReceiptCompletion<Result>;

/**
 * The adapter is intentionally required: production uses the 0012 shared
 * receipt ledger on the supplied transaction runner. It returns the stored
 * result for the same fingerprint and rejects a different fingerprint with
 * AdminApiError(CONFLICT, 409). It must not open a second transaction. No
 * unsafe default exists.
 */
export interface QuestionMutationIdempotency extends AdminMutationIdempotency {}

export interface QuestionMutationIdGenerator {
    next(): string;
}

/** Parsed from trusted mutation-security headers, never from the JSON body. */
export type QuestionMutationEvidence = AdminMutationEvidence;

export interface CreateSystemQuestionDraftInput {
    questionId: string;
    baseRevisionId: string;
    baseRevisionNumber: number;
    changeNote: string;
    /** Targets IDs from the immutable base revision; relationships stay fixed. */
    contentPatch: {
        textBlocks: readonly {
            blockId: string;
            textContent: string;
        }[];
        answers: readonly {
            answerId: string;
            answerKey: string | null;
            acceptedValue: string | null;
        }[];
    };
}

export interface PublishSystemQuestionRevisionInput {
    questionId: string;
    draftRevisionId: string;
    expectedCurrentRevisionId: string;
    expectedCurrentRevisionNumber: number;
    changeNote: string;
}

export interface ReviewSystemQuestionRevisionInput {
    questionId: string;
    revisionId: string;
    expectedRevisionNumber: number;
    decision: "changes_requested" | "rejected";
    reason: string;
}

export interface CreateSystemQuestionDraftResult {
    questionId: string;
    revisionId: string;
    revisionNumber: number;
    baseRevisionId: string;
    status: "draft";
}

export interface ReviewSystemQuestionRevisionResult {
    questionId: string;
    revisionId: string;
    revisionNumber: number;
    decision: "changes_requested" | "rejected";
    status: "draft" | "rejected";
}

export interface PublishSystemQuestionRevisionResult {
    questionId: string;
    revisionId: string;
    revisionNumber: number;
    previousRevisionId: string;
    status: "published";
}

interface QuestionMutationServiceDependencies {
    idempotency: QuestionMutationIdempotency;
    ids?: QuestionMutationIdGenerator;
}

const randomIdGenerator: QuestionMutationIdGenerator = {
    next: randomUUID,
};

function normalizeText(
    value: string,
    label: string,
    minimum: number,
    maximum: number,
): string {
    if (typeof value !== "string") {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            `${label}格式不正確。`,
            400,
        );
    }
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (
        normalized.length < minimum
        || normalized.length > maximum
        || /[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            `${label}必須是 ${minimum} 到 ${maximum} 個字元。`,
            400,
        );
    }
    return normalized;
}

function normalizeContentValue(
    value: unknown,
    label: string,
    maximum: number,
): string {
    if (typeof value !== "string") {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            `${label}格式不正確。`,
            400,
        );
    }
    const normalized = value.normalize("NFKC").trim();
    if (
        normalized.length < 1
        || normalized.length > maximum
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
    ) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            `${label}必須是 1 到 ${maximum} 個字元。`,
            400,
        );
    }
    return normalized;
}

function assertUuid(value: string, label: string): void {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            `${label}格式不正確。`,
            400,
        );
    }
}

function assertPositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            `${label}格式不正確。`,
            400,
        );
    }
}

function assertRequestEvidence(evidence: QuestionMutationEvidence): void {
    if (
        typeof evidence.requestId !== "string"
        || !MUTATION_EVIDENCE_UUID_PATTERN.test(evidence.requestId)
        || evidence.requestId !== evidence.requestId.toLowerCase()
    ) {
        throw new AdminApiError(
            "INVALID_INPUT",
            "請求識別碼必須是小寫 UUID v4 或 v7。",
            400,
        );
    }
    if (
        typeof evidence.idempotencyKey !== "string"
        || !MUTATION_EVIDENCE_UUID_PATTERN.test(evidence.idempotencyKey)
        || evidence.idempotencyKey !== evidence.idempotencyKey.toLowerCase()
    ) {
        throw new AdminApiError(
            "INVALID_IDEMPOTENCY_KEY",
            "冪等鍵必須是小寫 UUID v4 或 v7。",
            400,
        );
    }
}

function fingerprint(values: readonly unknown[]): string {
    return createHash("sha256")
        .update(JSON.stringify(values))
        .digest("hex");
}

function assertSystemQuestionCanChange(question: LockedQuestionRecord): void {
    if (question.origin === "account") {
        throw new AdminApiError(
            "FORBIDDEN",
            "帳號題目只能由擁有者修改，管理後台保持唯讀。",
            403,
        );
    }
    if (question.status === "archived") {
        throw new AdminApiError(
            "INVALID_STATUS_TRANSITION",
            "已封存題目不可建立、審核或發布新版本。",
            422,
        );
    }
}

function assertRevisionState(
    revision: LockedQuestionRevisionRecord,
    expectedNumber: number,
    expectedStatus: "draft" | "published",
): void {
    if (
        revision.revisionNumber !== expectedNumber
        || revision.status !== expectedStatus
    ) {
        throw new AdminApiError(
            "STALE_VERSION",
            "題目版本已變更，請重新載入後再試。",
            409,
        );
    }
}

function assertDifferentReviewer(
    actor: SystemAdminActor,
    revision: LockedQuestionRevisionRecord,
): void {
    if (
        revision.createdByType === "user"
        && revision.createdByUserId === actor.userId
    ) {
        throw new AdminApiError(
            "FORBIDDEN",
            "題目版本建立者不可審核自己的版本。",
            403,
        );
    }
}

function createIdMaps(
    keys: RevisionCloneKeys,
    ids: QuestionMutationIdGenerator,
): RevisionCloneIdMaps {
    const allocated = new Set<string>();
    const map = (oldIds: readonly string[]): Array<{ oldId: string; newId: string }> => (
        oldIds.map((oldId) => {
            const newId = ids.next();
            assertUuid(newId, "新題目內容識別碼");
            if (allocated.has(newId)) {
                throw new AdminApiError(
                    "INTERNAL_ERROR",
                    "新題目版本的識別碼重複。",
                    500,
                );
            }
            allocated.add(newId);
            return { oldId, newId };
        })
    );
    return {
        parts: map(keys.partIds),
        options: map(keys.optionIds),
        blocks: map(keys.blockIds),
        answers: map(keys.answerIds),
        filterValues: map(keys.filterValueIds),
        sources: map(keys.sourceIds),
    };
}

interface NormalizedContentPatch {
    textBlocks: readonly {
        blockId: string;
        textContent: string;
    }[];
    answers: readonly {
        answerId: string;
        answerKey: string | null;
        acceptedValue: string | null;
    }[];
}

function hasExactKeys(
    value: object,
    allowedKeys: readonly string[],
): boolean {
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = [...allowedKeys].sort();
    return actualKeys.length === expectedKeys.length
        && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function normalizeContentPatch(
    value: CreateSystemQuestionDraftInput["contentPatch"],
): NormalizedContentPatch {
    if (
        typeof value !== "object"
        || value === null
        || !Array.isArray(value.textBlocks)
        || !Array.isArray(value.answers)
        || !hasExactKeys(value, ["textBlocks", "answers"])
    ) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            "題目內容編修資料格式不正確。",
            400,
        );
    }

    const textIds = new Set<string>();
    const textBlocks = value.textBlocks.map((edit) => {
        if (
            typeof edit !== "object"
            || edit === null
            || !hasExactKeys(edit, ["blockId", "textContent"])
        ) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "文字內容編修資料格式不正確。",
                400,
            );
        }
        assertUuid(edit.blockId, "文字內容識別碼");
        if (textIds.has(edit.blockId)) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "同一段文字內容不可重複編修。",
                400,
            );
        }
        textIds.add(edit.blockId);
        return {
            blockId: edit.blockId,
            textContent: normalizeContentValue(
                edit.textContent,
                "文字內容",
                50_000,
            ),
        };
    }).sort((left, right) => left.blockId.localeCompare(right.blockId));

    const answerIds = new Set<string>();
    const answers = value.answers.map((edit) => {
        if (
            typeof edit !== "object"
            || edit === null
            || !hasExactKeys(edit, ["answerId", "answerKey", "acceptedValue"])
        ) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "答案編修資料格式不正確。",
                400,
            );
        }
        assertUuid(edit.answerId, "答案識別碼");
        if (answerIds.has(edit.answerId)) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "同一個答案不可重複編修。",
                400,
            );
        }
        answerIds.add(edit.answerId);
        const hasAnswerKey = edit.answerKey !== null;
        const hasAcceptedValue = edit.acceptedValue !== null;
        if (hasAnswerKey === hasAcceptedValue) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "答案必須且只能提供選項鍵或文字答案其中一種。",
                400,
            );
        }
        return {
            answerId: edit.answerId,
            answerKey: hasAnswerKey
                ? normalizeContentValue(edit.answerKey, "答案選項鍵", 30)
                : null,
            acceptedValue: hasAcceptedValue
                ? normalizeContentValue(edit.acceptedValue, "文字答案", 20_000)
                : null,
        };
    }).sort((left, right) => left.answerId.localeCompare(right.answerId));

    if (textBlocks.length === 0 && answers.length === 0) {
        throw new AdminApiError(
            "INVALID_QUESTION_REVISION",
            "建立新版本時至少要編修一段文字或一個答案。",
            400,
        );
    }
    return { textBlocks, answers };
}

function mapContentPatchToClone(
    patch: NormalizedContentPatch,
    keys: RevisionCloneKeys,
    maps: RevisionCloneIdMaps,
): { textBlocks: DraftTextBlockEdit[]; answers: DraftAnswerEdit[] } {
    const textBlockIds = new Set(keys.textBlockIds);
    const answerIds = new Set(keys.answerIds);
    const answerContracts = new Map(
        keys.answerContracts.map((contract) => [contract.answerId, contract]),
    );
    const blockMap = new Map(maps.blocks.map((entry) => [entry.oldId, entry.newId]));
    const answerMap = new Map(maps.answers.map((entry) => [entry.oldId, entry.newId]));

    const textBlocks = patch.textBlocks.map((edit) => {
        const blockId = blockMap.get(edit.blockId);
        if (!textBlockIds.has(edit.blockId) || !blockId) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "只能編修基準版本既有的文字內容。",
                422,
            );
        }
        return { blockId, textContent: edit.textContent };
    });
    const answers = patch.answers.map((edit) => {
        const answerId = answerMap.get(edit.answerId);
        const contract = answerContracts.get(edit.answerId);
        if (!answerIds.has(edit.answerId) || !answerId || !contract) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "只能編修基準版本既有的答案。",
                422,
            );
        }
        if (contract.answerMode === "text") {
            if (edit.acceptedValue === null || edit.answerKey !== null) {
                throw new AdminApiError(
                    "INVALID_QUESTION_REVISION",
                    "文字題答案只能使用文字答案值。",
                    422,
                );
            }
        } else if (
            edit.answerKey === null
            || edit.acceptedValue !== null
            || !contract.optionKeys.includes(edit.answerKey)
        ) {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "選擇題與是非題答案必須使用同一小題的有效選項鍵。",
                422,
            );
        }
        return {
            answerId,
            answerKey: edit.answerKey,
            acceptedValue: edit.acceptedValue,
        };
    });
    return { textBlocks, answers };
}

async function loadSystemQuestion(
    runner: AdminQueryRunner,
    questionId: string,
): Promise<LockedQuestionRecord> {
    await acquireQuestionMutationLock(runner, questionId);
    const question = await lockQuestionForMutation(runner, questionId);
    assertSystemQuestionCanChange(question);
    return question;
}

export class QuestionMutationService {
    private readonly idempotency: QuestionMutationIdempotency;
    private readonly ids: QuestionMutationIdGenerator;

    constructor(dependencies: QuestionMutationServiceDependencies) {
        this.idempotency = dependencies.idempotency;
        this.ids = dependencies.ids ?? randomIdGenerator;
    }

    /**
     * The context must come from `runAdminMutation`, which starts the
     * transaction and revalidates the session and system-admin role under the
     * shared auth lock. The receipt adapter, business writes and audit below
     * therefore all use that exact transaction-scoped runner.
     */
    async createDraftRevision(
        context: AdminMutationContext,
        input: CreateSystemQuestionDraftInput,
    ): Promise<CreateSystemQuestionDraftResult> {
        const { actor, runner, evidence } = context;
        assertUuid(input.questionId, "題目識別碼");
        assertUuid(input.baseRevisionId, "基準版本識別碼");
        assertPositiveInteger(input.baseRevisionNumber, "基準版本號");
        assertRequestEvidence(evidence);
        const changeNote = normalizeText(input.changeNote, "修改原因", 5, 500);
        const contentPatch = normalizeContentPatch(input.contentPatch);

        return this.idempotency.execute(runner, {
                actorUserId: actor.userId,
                operation: "system_question_draft",
                key: evidence.idempotencyKey,
                payloadFingerprint: fingerprint([
                    "system-question-draft",
                    actor.userId,
                    input.questionId,
                    input.baseRevisionId,
                    input.baseRevisionNumber,
                    changeNote,
                    contentPatch,
                ]),
                requestId: evidence.requestId,
            }, async () => {
            const question = await loadSystemQuestion(runner, input.questionId);
            if (question.currentRevisionId !== input.baseRevisionId) {
                throw new AdminApiError(
                    "STALE_VERSION",
                    "題目的目前版本已變更，請重新載入後再試。",
                    409,
                );
            }

            const base = await lockRevisionForMutation(
                runner,
                input.questionId,
                input.baseRevisionId,
            );
            assertRevisionState(base, input.baseRevisionNumber, "published");

            const revisionNumber = await readNextRevisionNumber(
                runner,
                input.questionId,
            );
            if (revisionNumber <= 1) {
                throw new AdminApiError(
                    "INTERNAL_ERROR",
                    "基準版本與下一個版本號不一致。",
                    500,
                );
            }

            const revisionId = this.ids.next();
            const auditId = this.ids.next();
            assertUuid(revisionId, "新題目版本識別碼");
            assertUuid(auditId, "新稽核識別碼");
            if (revisionId === auditId) {
                throw new AdminApiError("INTERNAL_ERROR", "新資料識別碼重複。", 500);
            }

            const cloneKeys = await readRevisionCloneKeys(
                runner,
                input.baseRevisionId,
            );
            const idMaps = createIdMaps(cloneKeys, this.ids);
            const clonedPatch = mapContentPatchToClone(
                contentPatch,
                cloneKeys,
                idMaps,
            );
            await insertDraftRevisionClone(runner, {
                questionId: input.questionId,
                baseRevisionId: input.baseRevisionId,
                revisionId,
                revisionNumber,
                changeNote,
                actorUserId: actor.userId,
                idMaps,
            });
            await applyDraftRevisionContentEdits(runner, {
                revisionId,
                textBlocks: clonedPatch.textBlocks,
                answers: clonedPatch.answers,
            });
            await rebuildDraftRevisionSearchText(runner, revisionId);
            await insertQuestionMutationAudit(runner, {
                auditId,
                actorUserId: actor.userId,
                action: "system_question_revision_draft_created",
                targetId: revisionId,
                beforeData: {
                    questionId: input.questionId,
                    revisionNumber: base.revisionNumber,
                    status: base.status,
                },
                afterData: {
                    questionId: input.questionId,
                    revisionNumber,
                    baseRevisionId: input.baseRevisionId,
                    changeNote,
                    status: "draft",
                },
                requestId: evidence.requestId,
            });

            return {
                result: {
                    questionId: input.questionId,
                    revisionId,
                    revisionNumber,
                    baseRevisionId: input.baseRevisionId,
                    status: "draft" as const,
                },
                receipt: {
                    targetType: "question_revision" as const,
                    targetId: revisionId,
                    auditLogId: auditId,
                    responseStatus: 201 as const,
                },
            };
            });
    }

    async reviewDraftRevision(
        context: AdminMutationContext,
        input: ReviewSystemQuestionRevisionInput,
    ): Promise<ReviewSystemQuestionRevisionResult> {
        const { actor, runner, evidence } = context;
        assertUuid(input.questionId, "題目識別碼");
        assertUuid(input.revisionId, "題目版本識別碼");
        assertPositiveInteger(input.expectedRevisionNumber, "預期版本號");
        assertRequestEvidence(evidence);
        if (input.decision !== "changes_requested" && input.decision !== "rejected") {
            throw new AdminApiError(
                "INVALID_QUESTION_REVISION",
                "題目審核決定不正確。",
                400,
            );
        }
        const reason = normalizeText(input.reason, "審核原因", 5, 2_000);

        return this.idempotency.execute(runner, {
                actorUserId: actor.userId,
                operation: "system_question_review",
                key: evidence.idempotencyKey,
                payloadFingerprint: fingerprint([
                    "system-question-review",
                    actor.userId,
                    input.questionId,
                    input.revisionId,
                    input.expectedRevisionNumber,
                    input.decision,
                    reason,
                ]),
                requestId: evidence.requestId,
            }, async () => {
            await loadSystemQuestion(runner, input.questionId);
            const revision = await lockRevisionForMutation(
                runner,
                input.questionId,
                input.revisionId,
            );
            assertRevisionState(
                revision,
                input.expectedRevisionNumber,
                "draft",
            );
            assertDifferentReviewer(actor, revision);

            const targetStatus = input.decision === "rejected" ? "rejected" : "draft";
            const reviewId = this.ids.next();
            const reviewAuditId = this.ids.next();
            assertUuid(reviewId, "審核識別碼");
            assertUuid(reviewAuditId, "稽核識別碼");
            await insertQuestionRevisionReview(runner, {
                reviewId,
                revisionId: revision.id,
                reviewerUserId: actor.userId,
                decision: input.decision,
                reason,
                fromStatus: "draft",
                toStatus: targetStatus,
            });
            await insertQuestionMutationAudit(runner, {
                auditId: reviewAuditId,
                actorUserId: actor.userId,
                action: "system_question_revision_reviewed",
                targetId: revision.id,
                beforeData: {
                    questionId: input.questionId,
                    revisionNumber: revision.revisionNumber,
                    status: "draft",
                },
                afterData: {
                    questionId: input.questionId,
                    revisionNumber: revision.revisionNumber,
                    decision: input.decision,
                    status: targetStatus,
                },
                requestId: evidence.requestId,
            });

            if (targetStatus === "rejected") {
                const statusAuditId = this.ids.next();
                assertUuid(statusAuditId, "稽核識別碼");
                await insertQuestionMutationAudit(runner, {
                    auditId: statusAuditId,
                    actorUserId: actor.userId,
                    action: "system_question_revision_status_changed",
                    targetId: revision.id,
                    beforeData: { status: "draft" },
                    afterData: { status: "rejected" },
                    requestId: evidence.requestId,
                });
                await transitionQuestionRevision(runner, {
                    questionId: input.questionId,
                    revisionId: revision.id,
                    revisionNumber: revision.revisionNumber,
                    expectedStatus: "draft",
                    targetStatus: "rejected",
                });
            }

            return {
                result: {
                    questionId: input.questionId,
                    revisionId: revision.id,
                    revisionNumber: revision.revisionNumber,
                    decision: input.decision,
                    status: targetStatus,
                },
                receipt: {
                    targetType: "question_revision" as const,
                    targetId: revision.id,
                    auditLogId: reviewAuditId,
                    responseStatus: 200 as const,
                },
            };
            });
    }

    async publishDraftRevision(
        context: AdminMutationContext,
        input: PublishSystemQuestionRevisionInput,
    ): Promise<PublishSystemQuestionRevisionResult> {
        const { actor, runner, evidence } = context;
        assertUuid(input.questionId, "題目識別碼");
        assertUuid(input.draftRevisionId, "草稿版本識別碼");
        assertUuid(input.expectedCurrentRevisionId, "預期目前版本識別碼");
        assertPositiveInteger(input.expectedCurrentRevisionNumber, "預期目前版本號");
        assertRequestEvidence(evidence);
        const changeNote = normalizeText(input.changeNote, "修改原因", 5, 500);

        return this.idempotency.execute(runner, {
                actorUserId: actor.userId,
                operation: "system_question_publish",
                key: evidence.idempotencyKey,
                payloadFingerprint: fingerprint([
                    "system-question-publish",
                    actor.userId,
                    input.questionId,
                    input.draftRevisionId,
                    input.expectedCurrentRevisionId,
                    input.expectedCurrentRevisionNumber,
                    changeNote,
                ]),
                requestId: evidence.requestId,
            }, async () => {
            const question = await loadSystemQuestion(runner, input.questionId);
            if (question.currentRevisionId !== input.expectedCurrentRevisionId) {
                throw new AdminApiError(
                    "STALE_VERSION",
                    "題目的目前版本已變更，請重新載入後再試。",
                    409,
                );
            }

            const currentRevision = await lockRevisionForMutation(
                runner,
                input.questionId,
                input.expectedCurrentRevisionId,
            );
            assertRevisionState(
                currentRevision,
                input.expectedCurrentRevisionNumber,
                "published",
            );
            const draftRevision = await lockRevisionForMutation(
                runner,
                input.questionId,
                input.draftRevisionId,
            );
            if (draftRevision.status !== "draft") {
                throw new AdminApiError(
                    "STALE_VERSION",
                    "草稿版本狀態已變更，請重新載入後再試。",
                    409,
                );
            }
            if (draftRevision.revisionNumber <= currentRevision.revisionNumber) {
                throw new AdminApiError(
                    "INVALID_STATUS_TRANSITION",
                    "只能發布比目前版本更新的草稿。",
                    422,
                );
            }
            const draftBaseRevisionId = await readDraftBaseRevisionId(runner, {
                questionId: input.questionId,
                revisionId: draftRevision.id,
                revisionNumber: draftRevision.revisionNumber,
            });
            if (draftBaseRevisionId !== currentRevision.id) {
                throw new AdminApiError(
                    "INVALID_STATUS_TRANSITION",
                    "這個草稿不是從目前發布版本建立，請建立新的修正版。",
                    422,
                );
            }
            if (draftRevision.changeNote?.normalize("NFKC").trim() !== changeNote) {
                throw new AdminApiError(
                    "STALE_VERSION",
                    "草稿修改原因已變更，請重新載入後再試。",
                    409,
                );
            }
            const latestReviewDecision = await readLatestRevisionReviewDecision(
                runner,
                draftRevision.id,
            );
            if (latestReviewDecision === "changes_requested") {
                throw new AdminApiError(
                    "INVALID_STATUS_TRANSITION",
                    "這個草稿已被要求修改；請從目前發布版建立並送出新的修正版。",
                    422,
                );
            }
            assertDifferentReviewer(actor, draftRevision);
            // 0005 requires every system-revision status change, including the
            // old published -> superseded transition, to be reviewed by someone
            // other than that revision's creator.
            assertDifferentReviewer(actor, currentRevision);
            await assertRevisionAutomaticAnswersComplete(runner, draftRevision.id);

            const draftReviewId = this.ids.next();
            const draftReviewAuditId = this.ids.next();
            const draftStatusAuditId = this.ids.next();
            const currentReviewId = this.ids.next();
            const currentReviewAuditId = this.ids.next();
            const currentStatusAuditId = this.ids.next();
            for (const [label, id] of [
                ["草稿審核識別碼", draftReviewId],
                ["草稿審核稽核識別碼", draftReviewAuditId],
                ["草稿狀態稽核識別碼", draftStatusAuditId],
                ["舊版本審核識別碼", currentReviewId],
                ["舊版本審核稽核識別碼", currentReviewAuditId],
                ["舊版本狀態稽核識別碼", currentStatusAuditId],
            ] as const) {
                assertUuid(id, label);
            }

            await insertQuestionRevisionReview(runner, {
                reviewId: draftReviewId,
                revisionId: draftRevision.id,
                reviewerUserId: actor.userId,
                decision: "approved",
                reason: null,
                fromStatus: "draft",
                toStatus: "published",
            });
            await insertQuestionMutationAudit(runner, {
                auditId: draftReviewAuditId,
                actorUserId: actor.userId,
                action: "system_question_revision_reviewed",
                targetId: draftRevision.id,
                beforeData: {
                    questionId: input.questionId,
                    revisionNumber: draftRevision.revisionNumber,
                    status: "draft",
                },
                afterData: {
                    questionId: input.questionId,
                    revisionNumber: draftRevision.revisionNumber,
                    decision: "approved",
                    status: "published",
                },
                requestId: evidence.requestId,
            });
            await insertQuestionMutationAudit(runner, {
                auditId: draftStatusAuditId,
                actorUserId: actor.userId,
                action: "system_question_revision_status_changed",
                targetId: draftRevision.id,
                beforeData: { status: "draft" },
                afterData: { status: "published" },
                requestId: evidence.requestId,
            });
            await transitionQuestionRevision(runner, {
                questionId: input.questionId,
                revisionId: draftRevision.id,
                revisionNumber: draftRevision.revisionNumber,
                expectedStatus: "draft",
                targetStatus: "published",
            });

            await insertQuestionRevisionReview(runner, {
                reviewId: currentReviewId,
                revisionId: currentRevision.id,
                reviewerUserId: actor.userId,
                decision: "approved",
                reason: null,
                fromStatus: "published",
                toStatus: "superseded",
            });
            await insertQuestionMutationAudit(runner, {
                auditId: currentReviewAuditId,
                actorUserId: actor.userId,
                action: "system_question_revision_reviewed",
                targetId: currentRevision.id,
                beforeData: {
                    questionId: input.questionId,
                    revisionNumber: currentRevision.revisionNumber,
                    status: "published",
                },
                afterData: {
                    questionId: input.questionId,
                    revisionNumber: currentRevision.revisionNumber,
                    decision: "approved",
                    status: "superseded",
                },
                requestId: evidence.requestId,
            });
            await insertQuestionMutationAudit(runner, {
                auditId: currentStatusAuditId,
                actorUserId: actor.userId,
                action: "system_question_revision_status_changed",
                targetId: currentRevision.id,
                beforeData: { status: "published" },
                afterData: { status: "superseded" },
                requestId: evidence.requestId,
            });
            await transitionQuestionRevision(runner, {
                questionId: input.questionId,
                revisionId: currentRevision.id,
                revisionNumber: currentRevision.revisionNumber,
                expectedStatus: "published",
                targetStatus: "superseded",
            });
            await replaceQuestionCurrentRevision(runner, {
                questionId: input.questionId,
                expectedCurrentRevisionId: input.expectedCurrentRevisionId,
                currentRevisionId: draftRevision.id,
            });

            return {
                result: {
                    questionId: input.questionId,
                    revisionId: draftRevision.id,
                    revisionNumber: draftRevision.revisionNumber,
                    previousRevisionId: currentRevision.id,
                    status: "published" as const,
                },
                receipt: {
                    targetType: "question_revision" as const,
                    targetId: draftRevision.id,
                    auditLogId: draftStatusAuditId,
                    responseStatus: 200 as const,
                },
            };
            });
    }
}
