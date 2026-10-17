import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    buildQuestionDraftContentPatch,
    questionMutationRetryIdentity,
} from "../app/components/admin/views/question-mutation-client.ts";
import { questionContentBlockLabel } from "../app/components/admin/views/question-presentation-labels.ts";
import { leavesCurrentDrawerRoute } from "../app/components/admin/views/route-drawer-navigation.ts";
import type { QuestionRevisionDto } from "../app/components/admin/views/view-types.ts";
import type { AdminMutationContext } from "../app/lib/admin/admin-mutation-handler.ts";
import {
    parseCreateQuestionDraftInput,
    parsePublishQuestionRevisionInput,
    parseReviewQuestionRevisionInput,
} from "../app/lib/admin/question-mutation-input.ts";
import {
    createQuestionDraftMutationSpec,
    publishQuestionRevisionMutationSpec,
    reviewQuestionRevisionMutationSpec,
    type QuestionMutationCommands,
} from "../app/lib/admin/question-mutation-spec.ts";
import type {
    CreateSystemQuestionDraftInput,
    PublishSystemQuestionRevisionInput,
    ReviewSystemQuestionRevisionInput,
} from "../app/lib/admin/question-mutation-service.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_REVISION_ID = "33333333-3333-4333-8333-333333333333";
const BLOCK_ID = "44444444-4444-4444-8444-444444444444";
const ANSWER_ID = "55555555-5555-4555-8555-555555555555";

function source(relativePath: string): string {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const revisionFixture = {
    id: REVISION_ID,
    number: 7,
    status: "published",
    contentBlocks: [
        {
            id: BLOCK_ID,
            contentType: "text",
            textContent: "原題幹",
        },
        {
            id: "66666666-6666-4666-8666-666666666666",
            contentType: "image",
            textContent: null,
        },
    ],
    parts: [
        {
            id: "77777777-7777-4777-8777-777777777777",
            position: 0,
            answerMode: "single_choice",
            options: [
                { id: "88888888-8888-4888-8888-888888888888", key: "A", position: 0 },
                { id: "99999999-9999-4999-8999-999999999999", key: "B", position: 1 },
            ],
            answers: [{
                id: ANSWER_ID,
                answerKey: "A",
                acceptedValue: null,
                position: 0,
            }],
        },
    ],
} as unknown as QuestionRevisionDto;

function assertAdminError(action: () => unknown): void {
    assert.throws(action, (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.code, "INVALID_QUESTION_REVISION");
        assert.equal(error.status, 400);
        return true;
    });
}

test("question draft parser accepts only versioned text and answer patches", () => {
    assert.deepEqual(parseCreateQuestionDraftInput({
        baseRevisionId: REVISION_ID.toUpperCase(),
        baseRevisionNumber: 7,
        changeNote: "修正題幹和答案",
        contentPatch: {
            textBlocks: [{ blockId: BLOCK_ID, textContent: "新的題幹" }],
            answers: [{
                answerId: ANSWER_ID,
                answerKey: "B",
                acceptedValue: null,
            }],
        },
    }, QUESTION_ID), {
        questionId: QUESTION_ID,
        baseRevisionId: REVISION_ID,
        baseRevisionNumber: 7,
        changeNote: "修正題幹和答案",
        contentPatch: {
            textBlocks: [{ blockId: BLOCK_ID, textContent: "新的題幹" }],
            answers: [{
                answerId: ANSWER_ID,
                answerKey: "B",
                acceptedValue: null,
            }],
        },
    });

    assertAdminError(() => parseCreateQuestionDraftInput({
        baseRevisionId: REVISION_ID,
        baseRevisionNumber: 7,
        changeNote: "修正題幹和答案",
        questionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        contentPatch: { textBlocks: [], answers: [] },
    }, QUESTION_ID));
    assertAdminError(() => parseCreateQuestionDraftInput({
        baseRevisionId: REVISION_ID,
        baseRevisionNumber: 7,
        changeNote: "修正題幹和答案",
        contentPatch: {
            textBlocks: [{
                blockId: BLOCK_ID,
                textContent: "新的題幹",
                assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            }],
            answers: [],
        },
    }, QUESTION_ID));
});

test("draft form creates a sparse patch and never treats media fields as editable", () => {
    const unchanged = buildQuestionDraftContentPatch(
        revisionFixture,
        (name) => name.startsWith("block:") ? "原題幹" : "A",
    );
    assert.deepEqual(unchanged, { textBlocks: [], answers: [] });

    const changed = buildQuestionDraftContentPatch(
        revisionFixture,
        (name) => name.startsWith("block:") ? "修正版題幹" : "B",
    );
    assert.deepEqual(changed, {
        textBlocks: [{ blockId: BLOCK_ID, textContent: "修正版題幹" }],
        answers: [{
            answerId: ANSWER_ID,
            answerKey: "B",
            acceptedValue: null,
        }],
    });
    assert.equal(
        changed.textBlocks.some((block) => block.blockId === revisionFixture.contentBlocks[1]?.id),
        false,
    );
});

test("mutation retry identity includes operation and route target", () => {
    const body = JSON.stringify({ expectedRevisionNumber: 8 });
    const firstReview = questionMutationRetryIdentity(
        `/api/v1/admin/questions/${QUESTION_ID}/revisions/${REVISION_ID}/review`,
        body,
    );
    assert.equal(
        firstReview,
        questionMutationRetryIdentity(
            `/api/v1/admin/questions/${QUESTION_ID}/revisions/${REVISION_ID}/review`,
            body,
        ),
    );
    assert.notEqual(
        firstReview,
        questionMutationRetryIdentity(
            `/api/v1/admin/questions/${QUESTION_ID}/revisions/${REVISION_ID}/publish`,
            body,
        ),
    );
    assert.notEqual(
        firstReview,
        questionMutationRetryIdentity(
            `/api/v1/admin/questions/${QUESTION_ID}/revisions/${CURRENT_REVISION_ID}/review`,
            body,
        ),
    );

    const workflowSource = source("app/components/admin/views/question-mutation-workflow.tsx");
    assert.match(workflowSource, /questionMutationRetryIdentity\(url, serializedBody\)/u);
    assert.match(
        workflowSource,
        /useEffect\(\(\) => \{\s*retryEvidence\.current = null;\s*\}, \[detail\.id, revision\?\.id\]\)/u,
    );
});

test("question mutation UI confirms publish, guards dirty navigation and focuses errors", () => {
    assert.equal(questionContentBlockLabel("prompt", "text"), "題幹 · 文字");
    assert.equal(questionContentBlockLabel("explanation", "formula"), "解析 · 公式");
    assert.equal(questionContentBlockLabel("future", "custom"), "future · custom");

    const current = "https://example.test/admin/questions?question=q1&revision=r1";
    assert.equal(leavesCurrentDrawerRoute(current, `${current}#question-version-workflow`), false);
    assert.equal(
        leavesCurrentDrawerRoute(current, "/admin/questions?question=q1&revision=r2"),
        true,
    );
    assert.equal(leavesCurrentDrawerRoute(current, "/admin/questions"), true);
    assert.equal(leavesCurrentDrawerRoute(current, "https://other.test/admin/questions"), true);

    const workflow = source("app/components/admin/views/question-mutation-workflow.tsx");
    assert.match(workflow, /<DialogTitle>[\s\S]*發布題目版本 v\{revision\.number\}/u);
    assert.match(workflow, /useRouteDrawerNavigationGuard\(confirmDiscardChanges\)/u);
    assert.match(workflow, /window\.addEventListener\("beforeunload"/u);
    assert.match(workflow, /onChange=\{markDirty\}/u);
    assert.match(workflow, /errorRef\.current\?\.focus\(\)/u);
    assert.match(workflow, /errorRef\.current\?\.scrollIntoView/u);
    assert.match(workflow, /questionContentBlockLabel\([\s\S]*block\.placement/u);

    const drawer = source("app/components/admin/views/route-drawer.tsx");
    assert.match(drawer, /if \(!nextOpen && allowNavigation\(\)\)/u);
    assert.match(drawer, /onClickCapture=\{guardDrawerLink\}/u);

    const reviewQueue = source("app/components/admin/views/question-review-queue-view.tsx");
    assert.match(reviewQueue, /className=\{styles\.mobilePagination\}[\s\S]*<ViewPagination/u);
});

test("review and publish parsers bind question and revision identities from route params", () => {
    assert.deepEqual(parseReviewQuestionRevisionInput({
        expectedRevisionNumber: 8,
        decision: "changes_requested",
        reason: "答案依據不足，請補正",
    }, QUESTION_ID, REVISION_ID), {
        questionId: QUESTION_ID,
        revisionId: REVISION_ID,
        expectedRevisionNumber: 8,
        decision: "changes_requested",
        reason: "答案依據不足，請補正",
    });
    assert.deepEqual(parsePublishQuestionRevisionInput({
        expectedCurrentRevisionId: CURRENT_REVISION_ID,
        expectedCurrentRevisionNumber: 7,
        changeNote: "修正題幹和答案",
    }, QUESTION_ID, REVISION_ID), {
        questionId: QUESTION_ID,
        draftRevisionId: REVISION_ID,
        expectedCurrentRevisionId: CURRENT_REVISION_ID,
        expectedCurrentRevisionNumber: 7,
        changeNote: "修正題幹和答案",
    });

    assertAdminError(() => parseReviewQuestionRevisionInput({
        expectedRevisionNumber: 8,
        decision: "approved",
        reason: "試圖直接核准",
    }, QUESTION_ID, REVISION_ID));
});

test("question mutation specs delegate parsed inputs and preserve create status", async () => {
    const seen: Array<
        CreateSystemQuestionDraftInput
        | ReviewSystemQuestionRevisionInput
        | PublishSystemQuestionRevisionInput
    > = [];
    const commands: QuestionMutationCommands = {
        async createDraftRevision(_context, input) {
            seen.push(input);
            return {
                questionId: input.questionId,
                revisionId: REVISION_ID,
                revisionNumber: 8,
                baseRevisionId: input.baseRevisionId,
                status: "draft",
            };
        },
        async reviewDraftRevision(_context, input) {
            seen.push(input);
            return {
                questionId: input.questionId,
                revisionId: input.revisionId,
                revisionNumber: input.expectedRevisionNumber,
                decision: input.decision,
                status: input.decision === "rejected" ? "rejected" : "draft",
            };
        },
        async publishDraftRevision(_context, input) {
            seen.push(input);
            return {
                questionId: input.questionId,
                revisionId: input.draftRevisionId,
                revisionNumber: 8,
                previousRevisionId: input.expectedCurrentRevisionId,
                status: "published",
            };
        },
    };
    const context = {} as AdminMutationContext;
    const draftSpec = createQuestionDraftMutationSpec(QUESTION_ID, commands);
    const draft = draftSpec.parse({
        baseRevisionId: CURRENT_REVISION_ID,
        baseRevisionNumber: 7,
        changeNote: "修正題幹和答案",
        contentPatch: {
            textBlocks: [{ blockId: BLOCK_ID, textContent: "新的題幹" }],
            answers: [],
        },
    }, { idempotencyKey: "unused", requestId: "unused" });
    const result = await draftSpec.mutate(context, draft);

    assert.equal(draftSpec.successStatus, 201);
    assert.equal(result.status, "draft");
    assert.equal(seen[0]?.questionId, QUESTION_ID);

    const reviewSpec = reviewQuestionRevisionMutationSpec(
        QUESTION_ID,
        REVISION_ID,
        commands,
    );
    const review = reviewSpec.parse({
        expectedRevisionNumber: 8,
        decision: "rejected",
        reason: "來源與答案不一致",
    }, { idempotencyKey: "unused", requestId: "unused" });
    await reviewSpec.mutate(context, review);

    const publishSpec = publishQuestionRevisionMutationSpec(
        QUESTION_ID,
        REVISION_ID,
        commands,
    );
    const publish = publishSpec.parse({
        expectedCurrentRevisionId: CURRENT_REVISION_ID,
        expectedCurrentRevisionNumber: 7,
        changeNote: "修正題幹和答案",
    }, { idempotencyKey: "unused", requestId: "unused" });
    await publishSpec.mutate(context, publish);

    assert.equal(seen[1]?.questionId, QUESTION_ID);
    assert.equal(seen[2]?.questionId, QUESTION_ID);
});

test("production question routes use the guarded transaction handler and durable receipt ledger", () => {
    const serverSource = source("app/lib/admin/question-mutation-server.ts");
    assert.match(serverSource, /idempotency:\s*adminMutationReceipts/u);
    assert.doesNotMatch(serverSource, /Memory|Map\s*</u);

    for (const route of [
        "app/api/v1/admin/questions/[questionId]/revisions/route.ts",
        "app/api/v1/admin/questions/[questionId]/revisions/[revisionId]/review/route.ts",
        "app/api/v1/admin/questions/[questionId]/revisions/[revisionId]/publish/route.ts",
    ]) {
        const routeSource = source(route);
        assert.match(routeSource, /handleAdminMutation/u);
        assert.match(routeSource, /adminMutationDependencies/u);
        assert.match(routeSource, /questionMutationService/u);
        assert.doesNotMatch(routeSource, /request\.json\s*\(/u);
    }
});
