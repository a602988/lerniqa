import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
    AdminQueryResult,
    AdminQueryRunner,
    SystemAdminActor,
} from "../app/lib/admin/admin-auth.ts";
import {
    QuestionMutationService,
    type QuestionMutationCompletion,
    type QuestionMutationIdempotency,
    type QuestionMutationIdempotencyRequest,
} from "../app/lib/admin/question-mutation-service.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_ID = "44444444-4444-4444-8444-444444444444";
const CURRENT_REVISION_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_REVISION_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const IDEMPOTENCY_KEY = "88888888-8888-4788-8788-888888888888";
const BASE_TEXT_BLOCK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000103";
const BASE_ANSWER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000104";

const contentPatch = {
    textBlocks: [{
        blockId: BASE_TEXT_BLOCK_ID,
        textContent: "修正版題目敘述",
    }],
    answers: [{
        answerId: BASE_ANSWER_ID,
        answerKey: "B",
        acceptedValue: null,
    }],
} as const;

const evidence = {
    requestId: REQUEST_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
} as const;

const actor: SystemAdminActor = {
    sessionId: SESSION_ID,
    userId: ACTOR_ID,
    displayName: "審核管理員",
    expiresAt: "2026-10-20T00:00:00.000Z",
};

function mutationContext(
    runner: AdminQueryRunner,
    mutationEvidence: typeof evidence | { requestId: string; idempotencyKey: string } = evidence,
) {
    return { actor, runner, evidence: mutationEvidence };
}

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

type Resolver = (
    text: string,
    values: readonly unknown[],
    callIndex: number,
) => { rows?: QueryResultRow[]; rowCount?: number } | QueryResultRow[];

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly resolver: Resolver;

    constructor(resolver: Resolver) {
        this.resolver = resolver;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const callIndex = this.calls.length;
        this.calls.push({ text, values });
        const resolved = this.resolver(text, values, callIndex);
        if (Array.isArray(resolved)) return { rows: resolved as Row[] };
        return {
            rows: (resolved.rows ?? []) as Row[],
            rowCount: resolved.rowCount,
        };
    }
}

class MemoryIdempotency implements QuestionMutationIdempotency {
    readonly runners: AdminQueryRunner[] = [];
    readonly completions: QuestionMutationCompletion<unknown>[] = [];
    private readonly records = new Map<
        string,
        { fingerprint: string; promise: Promise<unknown> }
    >();

    async execute<Result>(
        runner: AdminQueryRunner,
        request: QuestionMutationIdempotencyRequest,
        operation: () => Promise<QuestionMutationCompletion<Result>>,
    ): Promise<Result> {
        this.runners.push(runner);
        const recordKey = `${request.scope}:${request.key}`;
        const existing = this.records.get(recordKey);
        if (existing) {
            if (existing.fingerprint !== request.payloadFingerprint) {
                throw new AdminApiError(
                    "CONFLICT",
                    "相同冪等鍵不可搭配不同內容。",
                    409,
                );
            }
            return existing.promise as Promise<Result>;
        }

        const promise = operation().then((completion) => {
            this.completions.push(completion);
            return completion.result;
        });
        this.records.set(recordKey, {
            fingerprint: request.payloadFingerprint,
            promise,
        });
        try {
            return await promise;
        }
        catch (error) {
            this.records.delete(recordKey);
            throw error;
        }
    }
}

class SequenceIds {
    private index = 0;
    private readonly ids: readonly string[];

    constructor(ids: readonly string[]) {
        this.ids = ids;
    }

    next(): string {
        const id = this.ids[this.index];
        this.index += 1;
        if (!id) throw new Error("test id sequence exhausted");
        return id;
    }
}

function sequenceUuid(index: number): string {
    return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
}

function successfulResolver(options?: Readonly<{
    origin?: "system" | "account";
    currentCreatorId?: string;
    draftCreatorId?: string;
}>): Resolver {
    return (text, values) => {
        if (/FROM questions\s+WHERE id/iu.test(text)) {
            return [{
                id: QUESTION_ID,
                origin: options?.origin ?? "system",
                status: "published",
                current_revision_id: CURRENT_REVISION_ID,
            }];
        }
        if (/FROM question_revisions\s+WHERE id/iu.test(text)) {
            if (values[0] === DRAFT_REVISION_ID) {
                return [{
                    id: DRAFT_REVISION_ID,
                    question_id: QUESTION_ID,
                    revision_number: 2,
                    status: "draft",
                    change_note: "修正題目內容與答案",
                    created_by_type: "user",
                    created_by_user_id: options?.draftCreatorId ?? OTHER_ADMIN_ID,
                }];
            }
            return [{
                id: CURRENT_REVISION_ID,
                question_id: QUESTION_ID,
                revision_number: 1,
                status: "published",
                change_note: null,
                created_by_type: "user",
                created_by_user_id: options?.currentCreatorId ?? OTHER_ADMIN_ID,
            }];
        }
        if (/next_revision_number/iu.test(text)) {
            return [{ next_revision_number: 2 }];
        }
        if (/FROM admin_audit_logs AS audit/iu.test(text)) {
            return [{ base_revision_id: CURRENT_REVISION_ID }];
        }
        if (/AS part_ids/iu.test(text)) {
            return [{
                part_ids: [sequenceUuid(101)],
                option_ids: [sequenceUuid(102)],
                block_ids: [sequenceUuid(103)],
                text_block_ids: [sequenceUuid(103)],
                answer_ids: [sequenceUuid(104)],
                answer_contracts: [{
                    answerId: sequenceUuid(104),
                    answerMode: "single_choice",
                    optionKeys: ["A", "B"],
                }],
                filter_value_ids: [sequenceUuid(105)],
                source_ids: [sequenceUuid(106)],
            }];
        }
        if (/INSERT INTO question_revisions/iu.test(text)) {
            return [{ id: String(values[2]) }];
        }
        if (/INSERT INTO (question_revision_reviews|admin_audit_logs)/iu.test(text)) {
            return [{ id: String(values[0]) }];
        }
        if (/UPDATE question_revisions/iu.test(text)) {
            return [{ id: String(values[0]) }];
        }
        if (/UPDATE question_content_blocks/iu.test(text)) {
            const edits = JSON.parse(String(values[1])) as Array<{ blockId: string }>;
            return edits.map((edit) => ({ id: edit.blockId }));
        }
        if (/UPDATE question_answers/iu.test(text)) {
            const edits = JSON.parse(String(values[1])) as Array<{ answerId: string }>;
            return edits.map((edit) => ({ id: edit.answerId }));
        }
        if (/UPDATE questions/iu.test(text)) {
            return [{ id: String(values[0]) }];
        }
        return [];
    };
}

async function assertAdminError(
    action: () => Promise<unknown>,
    code: string,
    status: number,
): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
    });
}

test("creates a system draft on the supplied transaction runner without mutating history", async () => {
    const runner = new FakeRunner(successfulResolver());
    const generatedIds = Array.from({ length: 8 }, (_, index) => sequenceUuid(index + 1));
    const idempotency = new MemoryIdempotency();
    const service = new QuestionMutationService({
        idempotency,
        ids: new SequenceIds(generatedIds),
    });

    const result = await service.createDraftRevision(mutationContext(runner), {
        questionId: QUESTION_ID,
        baseRevisionId: CURRENT_REVISION_ID,
        baseRevisionNumber: 1,
        changeNote: "修正題目內容與答案",
        contentPatch,
    });

    assert.deepEqual(result, {
        questionId: QUESTION_ID,
        revisionId: generatedIds[0],
        revisionNumber: 2,
        baseRevisionId: CURRENT_REVISION_ID,
        status: "draft",
    });
    assert.deepEqual(idempotency.runners, [runner]);
    assert.deepEqual(idempotency.completions[0]?.receipt, {
        targetType: "question_revision",
        targetId: generatedIds[0],
        auditLogId: generatedIds[1],
        responseStatus: 201,
    });

    const sql = runner.calls.map((call) => call.text).join("\n");
    assert.match(sql, /pg_advisory_xact_lock/iu);
    assert.match(sql, /INSERT INTO question_revisions/iu);
    assert.match(sql, /'draft'/iu);
    for (const table of [
        "question_parts",
        "question_options",
        "question_content_blocks",
        "question_answers",
        "question_revision_units",
        "question_revision_topics",
        "question_revision_knowledge_points",
        "question_revision_curriculum_codes",
        "question_revision_filter_values",
        "question_revision_sources",
    ]) {
        assert.match(sql, new RegExp(`INSERT INTO ${table}`, "iu"));
    }
    const sourceClone = runner.calls.find((call) => (
        /INSERT INTO question_revision_sources/iu.test(call.text)
    ));
    assert.ok(sourceClone);
    assert.match(sourceClone.text, /source_document_id, import_item_id/iu);
    assert.match(sourceClone.text, /source\.source_document_id,\s*NULL/iu);
    assert.match(sourceClone.text, /source\.source_page/iu);
    assert.match(sourceClone.text, /source\.source_question_number/iu);
    assert.match(sourceClone.text, /source\.crop_asset_id/iu);
    assert.match(sourceClone.text, /source\.is_primary/iu);
    const partClone = runner.calls.find((call) => /INSERT INTO question_parts/iu.test(call.text));
    const optionClone = runner.calls.find((call) => /INSERT INTO question_options/iu.test(call.text));
    const blockClone = runner.calls.find((call) => /INSERT INTO question_content_blocks/iu.test(call.text));
    const answerClone = runner.calls.find((call) => /INSERT INTO question_answers/iu.test(call.text));
    assert.ok(partClone && optionClone && blockClone && answerClone);
    assert.match(partClone.text, /parent_map\.new_id/iu);
    assert.match(optionClone.text, /part_map\.new_id/iu);
    assert.match(blockClone.text, /part_map\.new_id/iu);
    assert.match(blockClone.text, /option_map\.new_id/iu);
    assert.match(blockClone.text, /parent_map\.new_id/iu);
    assert.match(answerClone.text, /part_map\.new_id/iu);
    for (const table of [
        "question_revision_units",
        "question_revision_topics",
        "question_revision_knowledge_points",
        "question_revision_curriculum_codes",
    ]) {
        const clone = runner.calls.find((call) => (
            new RegExp(`INSERT INTO ${table}`, "iu").test(call.text)
        ));
        assert.ok(clone);
        assert.match(clone.text, /SELECT \$2::uuid/iu);
        assert.deepEqual(clone.values, [CURRENT_REVISION_ID, generatedIds[0]]);
    }
    assert.doesNotMatch(sql, /DELETE FROM question_revisions/iu);
    const searchUpdate = runner.calls.find((call) => (
        /UPDATE question_revisions AS revision/iu.test(call.text)
    ));
    assert.ok(searchUpdate);
    assert.match(searchUpdate.text, /SET search_text/iu);
    assert.match(searchUpdate.text, /revision\.status = 'draft'/iu);
    assert.deepEqual(searchUpdate.values, [generatedIds[0]]);
    assert.doesNotMatch(sql, /SET\s+status\s*=/iu);
    assert.doesNotMatch(sql, /UPDATE questions/iu);

    const draftInsert = runner.calls.find((call) => (
        /INSERT INTO question_revisions/iu.test(call.text)
    ));
    assert.ok(draftInsert);
    assert.equal(draftInsert.values[4], "修正題目內容與答案");
    assert.equal(draftInsert.values[5], ACTOR_ID);

    const textEdit = runner.calls.find((call) => /UPDATE question_content_blocks/iu.test(call.text));
    const answerEdit = runner.calls.find((call) => /UPDATE question_answers/iu.test(call.text));
    assert.ok(textEdit && answerEdit);
    assert.match(textEdit.text, /SET text_content = edits\.text_content/iu);
    assert.doesNotMatch(textEdit.text, /asset_id|source_document_id|question_part_id|question_option_id/iu);
    assert.match(answerEdit.text, /SET\s+answer_key = edits\.answer_key,\s+accepted_value = edits\.accepted_value/iu);
    assert.doesNotMatch(answerEdit.text, /SET[\s\S]*question_part_id\s*=/iu);
    assert.deepEqual(JSON.parse(String(textEdit.values[1])), [{
        blockId: generatedIds[4],
        textContent: "修正版題目敘述",
    }]);
    assert.deepEqual(JSON.parse(String(answerEdit.values[1])), [{
        answerId: generatedIds[5],
        answerKey: "B",
        acceptedValue: null,
    }]);

    const audit = runner.calls.find((call) => (
        /INSERT INTO admin_audit_logs/iu.test(call.text)
    ));
    assert.ok(audit);
    assert.equal(audit.values[2], "system_question_revision_draft_created");
    assert.deepEqual(JSON.parse(String(audit.values[5])), {
        questionId: QUESTION_ID,
        revisionNumber: 2,
        baseRevisionId: CURRENT_REVISION_ID,
        changeNote: "修正題目內容與答案",
        status: "draft",
    });
    assert.equal(audit.values[6], REQUEST_ID);
});

test("content edits cannot inject relationship, asset, or source fields", async () => {
    const runner = new FakeRunner(successfulResolver());
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
    });
    await assertAdminError(
        () => service.createDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            baseRevisionId: CURRENT_REVISION_ID,
            baseRevisionNumber: 1,
            changeNote: "修正題目內容與答案",
            contentPatch: {
                textBlocks: [{
                    blockId: BASE_TEXT_BLOCK_ID,
                    textContent: "修正版題目敘述",
                    assetId: QUESTION_ID,
                    questionPartId: QUESTION_ID,
                    sourceDocumentId: QUESTION_ID,
                }],
                answers: [],
            } as unknown as typeof contentPatch,
        }),
        "INVALID_QUESTION_REVISION",
        400,
    );
    assert.equal(runner.calls.length, 0);
});

test("content edits must target a child of the selected immutable base revision", async () => {
    const runner = new FakeRunner(successfulResolver());
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
        ids: new SequenceIds(Array.from({ length: 8 }, (_, index) => sequenceUuid(index + 1))),
    });
    await assertAdminError(
        () => service.createDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            baseRevisionId: CURRENT_REVISION_ID,
            baseRevisionNumber: 1,
            changeNote: "修正題目內容與答案",
            contentPatch: {
                textBlocks: [{
                    blockId: QUESTION_ID,
                    textContent: "不屬於基準版本的內容",
                }],
                answers: [],
            },
        }),
        "INVALID_QUESTION_REVISION",
        422,
    );
    assert.equal(
        runner.calls.some((call) => /INSERT INTO question_revisions/iu.test(call.text)),
        false,
    );
});

test("answer edits must match the base part answer mode and existing option keys", async () => {
    for (const variant of ["choice_text", "unknown_key", "text_key"] as const) {
        const baseResolver = successfulResolver();
        const runner = new FakeRunner((text, values, callIndex) => {
            if (/AS part_ids/iu.test(text)) {
                const resolved = baseResolver(text, values, callIndex) as QueryResultRow[];
                return resolved.map((row) => ({
                    ...row,
                    answer_contracts: [{
                        answerId: BASE_ANSWER_ID,
                        answerMode: variant === "text_key" ? "text" : "single_choice",
                        optionKeys: variant === "text_key" ? [] : ["A", "B"],
                    }],
                }));
            }
            return baseResolver(text, values, callIndex);
        });
        const service = new QuestionMutationService({
            idempotency: new MemoryIdempotency(),
            ids: new SequenceIds(Array.from({ length: 8 }, (_, index) => sequenceUuid(index + 1))),
        });
        await assertAdminError(
            () => service.createDraftRevision(mutationContext(runner), {
                questionId: QUESTION_ID,
                baseRevisionId: CURRENT_REVISION_ID,
                baseRevisionNumber: 1,
                changeNote: "修正題目內容與答案",
                contentPatch: {
                    textBlocks: [],
                    answers: [{
                        answerId: BASE_ANSWER_ID,
                        answerKey: variant === "choice_text" ? null : variant === "unknown_key" ? "Z" : "B",
                        acceptedValue: variant === "choice_text" ? "文字答案" : null,
                    }],
                },
            }),
            "INVALID_QUESTION_REVISION",
            422,
        );
        assert.equal(
            runner.calls.some((call) => /INSERT INTO question_revisions/iu.test(call.text)),
            false,
        );
    }
});

test("rejects account-origin and archived questions before writing a revision", async () => {
    for (const variant of ["account", "archived"] as const) {
        const runner = new FakeRunner((text, values, callIndex) => {
            const base = successfulResolver({ origin: variant === "account" ? "account" : "system" });
            if (/FROM questions\s+WHERE id/iu.test(text) && variant === "archived") {
                return [{
                    id: QUESTION_ID,
                    origin: "system",
                    status: "archived",
                    current_revision_id: CURRENT_REVISION_ID,
                }];
            }
            return base(text, values, callIndex);
        });
        const service = new QuestionMutationService({
            idempotency: new MemoryIdempotency(),
            ids: new SequenceIds([sequenceUuid(1)]),
        });
        await assertAdminError(
            () => service.createDraftRevision(mutationContext(runner), {
                questionId: QUESTION_ID,
                baseRevisionId: CURRENT_REVISION_ID,
                baseRevisionNumber: 1,
                changeNote: "修正題目內容與答案",
                contentPatch,
            }),
            variant === "account" ? "FORBIDDEN" : "INVALID_STATUS_TRANSITION",
            variant === "account" ? 403 : 422,
        );
        assert.equal(
            runner.calls.some((call) => /INSERT INTO question_revisions/iu.test(call.text)),
            false,
        );
    }
});

test("requires a meaningful later-version change note before using the transaction runner", async () => {
    const runner = new FakeRunner(() => []);
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
    });
    await assertAdminError(
        () => service.createDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            baseRevisionId: CURRENT_REVISION_ID,
            baseRevisionNumber: 1,
            changeNote: "短",
            contentPatch,
        }),
        "INVALID_QUESTION_REVISION",
        400,
    );
    assert.equal(runner.calls.length, 0);
});

test("detects a stale base revision without cloning", async () => {
    const runner = new FakeRunner((text, values, callIndex) => {
        if (/FROM questions\s+WHERE id/iu.test(text)) {
            return [{
                id: QUESTION_ID,
                origin: "system",
                status: "published",
                current_revision_id: DRAFT_REVISION_ID,
            }];
        }
        return successfulResolver()(text, values, callIndex);
    });
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
    });
    await assertAdminError(
        () => service.createDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            baseRevisionId: CURRENT_REVISION_ID,
            baseRevisionNumber: 1,
            changeNote: "修正題目內容與答案",
            contentPatch,
        }),
        "STALE_VERSION",
        409,
    );
    assert.equal(
        runner.calls.some((call) => /INSERT INTO question_revisions/iu.test(call.text)),
        false,
    );
});

test("a revision creator cannot review their own draft", async () => {
    const runner = new FakeRunner(successfulResolver({ draftCreatorId: ACTOR_ID }));
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
    });

    await assertAdminError(
        () => service.reviewDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            revisionId: DRAFT_REVISION_ID,
            expectedRevisionNumber: 2,
            decision: "rejected",
            reason: "答案依據仍然不足",
        }),
        "FORBIDDEN",
        403,
    );
    assert.equal(
        runner.calls.some((call) => /INSERT INTO question_revision_reviews/iu.test(call.text)),
        false,
    );
});

test("reject review records review, matching audits, and an optimistic draft transition", async () => {
    const runner = new FakeRunner(successfulResolver());
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
        ids: new SequenceIds([sequenceUuid(1), sequenceUuid(2), sequenceUuid(3)]),
    });

    const result = await service.reviewDraftRevision(mutationContext(runner), {
        questionId: QUESTION_ID,
        revisionId: DRAFT_REVISION_ID,
        expectedRevisionNumber: 2,
        decision: "rejected",
        reason: "答案依據仍然不足",
    });
    assert.equal(result.status, "rejected");

    const review = runner.calls.find((call) => (
        /INSERT INTO question_revision_reviews/iu.test(call.text)
    ));
    assert.ok(review);
    assert.deepEqual(review.values.slice(3, 7), [
        "rejected",
        "答案依據仍然不足",
        "draft",
        "rejected",
    ]);
    const audits = runner.calls.filter((call) => /INSERT INTO admin_audit_logs/iu.test(call.text));
    assert.deepEqual(audits.map((call) => call.values[2]), [
        "system_question_revision_reviewed",
        "system_question_revision_status_changed",
    ]);
    const transition = runner.calls.find((call) => /UPDATE question_revisions/iu.test(call.text));
    assert.ok(transition);
    assert.match(transition.text, /revision_number\s*=\s*\$3/iu);
    assert.match(transition.text, /status\s*=\s*\$4/iu);
    assert.deepEqual(transition.values.slice(2), [2, "draft", "rejected"]);
});

test("changes-requested review preserves draft status without rewriting content", async () => {
    const runner = new FakeRunner(successfulResolver());
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
        ids: new SequenceIds([sequenceUuid(1), sequenceUuid(2)]),
    });
    const result = await service.reviewDraftRevision(mutationContext(runner), {
        questionId: QUESTION_ID,
        revisionId: DRAFT_REVISION_ID,
        expectedRevisionNumber: 2,
        decision: "changes_requested",
        reason: "請補齊題目來源說明",
    });
    assert.equal(result.status, "draft");
    assert.equal(
        runner.calls.some((call) => /UPDATE question_revisions/iu.test(call.text)),
        false,
    );
    assert.equal(
        runner.calls.filter((call) => /INSERT INTO admin_audit_logs/iu.test(call.text)).length,
        1,
    );
});

test("publishes a newer draft and supersedes the old current revision with matching reviews and audits", async () => {
    const runner = new FakeRunner(successfulResolver());
    const idempotency = new MemoryIdempotency();
    const service = new QuestionMutationService({
        idempotency,
        ids: new SequenceIds(Array.from({ length: 6 }, (_, index) => sequenceUuid(index + 1))),
    });

    const result = await service.publishDraftRevision(mutationContext(runner), {
        questionId: QUESTION_ID,
        draftRevisionId: DRAFT_REVISION_ID,
        expectedCurrentRevisionId: CURRENT_REVISION_ID,
        expectedCurrentRevisionNumber: 1,
        changeNote: "修正題目內容與答案",
    });
    assert.deepEqual(result, {
        questionId: QUESTION_ID,
        revisionId: DRAFT_REVISION_ID,
        revisionNumber: 2,
        previousRevisionId: CURRENT_REVISION_ID,
        status: "published",
    });
    assert.deepEqual(idempotency.runners, [runner]);
    assert.deepEqual(idempotency.completions[0]?.receipt, {
        targetType: "question_revision",
        targetId: DRAFT_REVISION_ID,
        auditLogId: sequenceUuid(3),
        responseStatus: 200,
    });

    const reviews = runner.calls.filter((call) => /INSERT INTO question_revision_reviews/iu.test(call.text));
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews.map((call) => call.values.slice(3, 7)), [
        ["approved", null, "draft", "published"],
        ["approved", null, "published", "superseded"],
    ]);

    const statusAudits = runner.calls.filter((call) => (
        /INSERT INTO admin_audit_logs/iu.test(call.text)
        && call.values[2] === "system_question_revision_status_changed"
    ));
    assert.equal(statusAudits.length, 2);
    const reviewAudits = runner.calls.filter((call) => (
        /INSERT INTO admin_audit_logs/iu.test(call.text)
        && call.values[2] === "system_question_revision_reviewed"
    ));
    assert.equal(reviewAudits.length, 2);
    const transitions = runner.calls.filter((call) => /UPDATE question_revisions/iu.test(call.text));
    assert.deepEqual(transitions.map((call) => call.values.slice(3, 5)), [
        ["draft", "published"],
        ["published", "superseded"],
    ]);
    const pointerUpdate = runner.calls.find((call) => /UPDATE questions/iu.test(call.text));
    assert.ok(pointerUpdate);
    assert.match(pointerUpdate.text, /current_revision_id IS NOT DISTINCT FROM \$2::uuid/iu);
    assert.deepEqual(pointerUpdate.values, [
        QUESTION_ID,
        CURRENT_REVISION_ID,
        DRAFT_REVISION_ID,
    ]);
});

test("publish rejects a draft cloned from an older published revision", async () => {
    const baseResolver = successfulResolver();
    const runner = new FakeRunner((text, values, callIndex) => {
        if (/FROM admin_audit_logs AS audit/iu.test(text)) {
            return [{ base_revision_id: "99999999-9999-4999-8999-999999999999" }];
        }
        return baseResolver(text, values, callIndex);
    });
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
    });
    await assertAdminError(
        () => service.publishDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            draftRevisionId: DRAFT_REVISION_ID,
            expectedCurrentRevisionId: CURRENT_REVISION_ID,
            expectedCurrentRevisionNumber: 1,
            changeNote: "修正題目內容與答案",
        }),
        "INVALID_STATUS_TRANSITION",
        422,
    );
    assert.equal(
        runner.calls.some((call) => /INSERT INTO question_revision_reviews/iu.test(call.text)),
        false,
    );
});

test("publish refuses a reviewer who created either transitioning revision", async () => {
    for (const creator of ["draft", "current"] as const) {
        const runner = new FakeRunner(successfulResolver({
            draftCreatorId: creator === "draft" ? ACTOR_ID : OTHER_ADMIN_ID,
            currentCreatorId: creator === "current" ? ACTOR_ID : OTHER_ADMIN_ID,
        }));
        const service = new QuestionMutationService({
            idempotency: new MemoryIdempotency(),
        });
        await assertAdminError(
            () => service.publishDraftRevision(mutationContext(runner), {
                questionId: QUESTION_ID,
                draftRevisionId: DRAFT_REVISION_ID,
                expectedCurrentRevisionId: CURRENT_REVISION_ID,
                expectedCurrentRevisionNumber: 1,
                changeNote: "修正題目內容與答案",
            }),
            "FORBIDDEN",
            403,
        );
        assert.equal(
            runner.calls.some((call) => /INSERT INTO question_revision_reviews/iu.test(call.text)),
            false,
        );
    }
});

test("a changes-requested draft cannot be published unchanged", async () => {
    const baseResolver = successfulResolver();
    const runner = new FakeRunner((text, values, callIndex) => {
        if (/SELECT decision\s+FROM question_revision_reviews/iu.test(text)) {
            return [{ decision: "changes_requested" }];
        }
        return baseResolver(text, values, callIndex);
    });
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
    });
    await assertAdminError(
        () => service.publishDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            draftRevisionId: DRAFT_REVISION_ID,
            expectedCurrentRevisionId: CURRENT_REVISION_ID,
            expectedCurrentRevisionNumber: 1,
            changeNote: "修正題目內容與答案",
        }),
        "INVALID_STATUS_TRANSITION",
        422,
    );
    assert.equal(
        runner.calls.some((call) => /INSERT INTO question_revision_reviews/iu.test(call.text)),
        false,
    );
});

test("idempotency returns the same result and rejects payload mismatch", async () => {
    const runner = new FakeRunner(successfulResolver());
    const idempotency = new MemoryIdempotency();
    const ids = Array.from({ length: 8 }, (_, index) => sequenceUuid(index + 1));
    const service = new QuestionMutationService({
        idempotency,
        ids: new SequenceIds(ids),
    });
    const input = {
        questionId: QUESTION_ID,
        baseRevisionId: CURRENT_REVISION_ID,
        baseRevisionNumber: 1,
        changeNote: "修正題目內容與答案",
        contentPatch,
    };

    const first = await service.createDraftRevision(mutationContext(runner), input);
    const repeated = await service.createDraftRevision(mutationContext(runner), input);
    assert.deepEqual(repeated, first);
    assert.deepEqual(idempotency.runners, [runner, runner]);
    assert.equal(
        runner.calls.filter((call) => /INSERT INTO question_revisions/iu.test(call.text)).length,
        1,
    );
    assert.equal(idempotency.completions.length, 1);

    await assertAdminError(
        () => service.createDraftRevision(mutationContext(runner), {
            ...input,
            changeNote: "改成另一份不同內容",
        }),
        "CONFLICT",
        409,
    );
    assert.deepEqual(idempotency.runners, [runner, runner, runner]);
    assert.equal(idempotency.completions.length, 1);
});

test("mutation evidence only accepts canonical lowercase UUID v4 or v7 header values", async () => {
    for (const invalidEvidence of [
        { requestId: REQUEST_ID, idempotencyKey: "admin-question-00000001" },
        {
            requestId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            idempotencyKey: IDEMPOTENCY_KEY,
        },
        {
            requestId: "99999999-9999-1999-8999-999999999999",
            idempotencyKey: IDEMPOTENCY_KEY,
        },
    ]) {
        const runner = new FakeRunner(() => []);
        const service = new QuestionMutationService({
            idempotency: new MemoryIdempotency(),
        });
        await assert.rejects(
            () => service.createDraftRevision(mutationContext(runner, invalidEvidence), {
                questionId: QUESTION_ID,
                baseRevisionId: CURRENT_REVISION_ID,
                baseRevisionNumber: 1,
                changeNote: "修正題目內容與答案",
                contentPatch,
            }),
            (error: unknown) => (
                error instanceof AdminApiError
                && (error.code === "INVALID_INPUT" || error.code === "INVALID_IDEMPOTENCY_KEY")
                && error.status === 400
            ),
        );
        assert.equal(runner.calls.length, 0);
    }
});

test("an audit insert failure aborts the mutation result instead of reporting success", async () => {
    const runner = new FakeRunner((text, values, callIndex) => {
        if (/INSERT INTO admin_audit_logs/iu.test(text)) {
            throw new Error("synthetic audit failure");
        }
        return successfulResolver()(text, values, callIndex);
    });
    const service = new QuestionMutationService({
        idempotency: new MemoryIdempotency(),
        ids: new SequenceIds([sequenceUuid(1), sequenceUuid(2), sequenceUuid(3)]),
    });
    await assert.rejects(
        () => service.reviewDraftRevision(mutationContext(runner), {
            questionId: QUESTION_ID,
            revisionId: DRAFT_REVISION_ID,
            expectedRevisionNumber: 2,
            decision: "rejected",
            reason: "答案依據仍然不足",
        }),
        /synthetic audit failure/u,
    );
    assert.equal(
        runner.calls.some((call) => /UPDATE question_revisions/iu.test(call.text)),
        false,
    );
});
