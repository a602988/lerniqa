import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AdminQueryRunner } from "../app/lib/admin/admin-auth.ts";
import {
    loadAdminQuestionDetailRequest,
    loadAdminQuestionListRequest,
} from "../app/lib/admin/question-read-handler.ts";
import type {
    AdminQuestionDetail,
    AdminQuestionPage,
} from "../app/lib/admin/question-repository.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";

function source(relativePath: string): string {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("question list authorizes inside the snapshot before parsing protected input", async () => {
    const events: string[] = [];
    const forbidden = new AdminApiError(
        "FORBIDDEN",
        "這個帳號沒有管理後台權限。",
        403,
    );

    await assert.rejects(
        () => loadAdminQuestionListRequest(
            new Request("https://example.test/api/v1/admin/questions?page=invalid"),
            {
                withSnapshot: async (operation) => {
                    events.push("snapshot");
                    return operation({} as AdminQueryRunner);
                },
                authorize: async () => {
                    events.push("authorize");
                    throw forbidden;
                },
                loadPage: async () => {
                    events.push("load");
                    throw new Error("must not load");
                },
            },
        ),
        (error) => error === forbidden,
    );
    assert.deepEqual(events, ["snapshot", "authorize"]);
});

test("question list authorization and data load use the same snapshot runner", async () => {
    const events: string[] = [];
    const runner = {} as AdminQueryRunner;
    const page: AdminQuestionPage = { items: [], page: 2, pageSize: 25, total: 0 };

    const result = await loadAdminQuestionListRequest(
        new Request("https://example.test/api/v1/admin/questions?page=2&status=published"),
        {
            withSnapshot: async (operation) => {
                events.push("snapshot");
                return operation(runner);
            },
            authorize: async (_request, receivedRunner) => {
                events.push("authorize");
                assert.equal(receivedRunner, runner);
            },
            loadPage: async (receivedRunner, query) => {
                events.push("load");
                assert.equal(receivedRunner, runner);
                assert.equal(query.page, 2);
                assert.deepEqual(query.statuses, ["published"]);
                return page;
            },
        },
    );

    assert.equal(result, page);
    assert.deepEqual(events, ["snapshot", "authorize", "load"]);
});

test("question detail parses path and revision selector only after snapshot authorization", async () => {
    const events: string[] = [];
    const runner = {} as AdminQueryRunner;
    const detail = { id: QUESTION_ID } as AdminQuestionDetail;

    const result = await loadAdminQuestionDetailRequest(
        new Request(`https://example.test/api/v1/admin/questions/${QUESTION_ID}?revision=${REVISION_ID}`),
        async () => {
            events.push("params");
            return { questionId: QUESTION_ID.toUpperCase() };
        },
        {
            withSnapshot: async (operation) => {
                events.push("snapshot");
                return operation(runner);
            },
            authorize: async (_request, receivedRunner) => {
                events.push("authorize");
                assert.equal(receivedRunner, runner);
            },
            loadDetail: async (receivedRunner, questionId, query) => {
                events.push("load");
                assert.equal(receivedRunner, runner);
                assert.equal(questionId, QUESTION_ID);
                assert.equal(query.selectedRevisionId, REVISION_ID);
                return detail;
            },
        },
    );

    assert.equal(result, detail);
    assert.deepEqual(events, ["snapshot", "authorize", "params", "load"]);
});

test("question detail does not resolve protected route params when authorization fails", async () => {
    const events: string[] = [];
    const forbidden = new AdminApiError(
        "FORBIDDEN",
        "這個帳號沒有管理後台權限。",
        403,
    );

    await assert.rejects(
        () => loadAdminQuestionDetailRequest(
            new Request(`https://example.test/api/v1/admin/questions/${QUESTION_ID}`),
            async () => {
                events.push("params");
                return { questionId: QUESTION_ID };
            },
            {
                withSnapshot: async (operation) => {
                    events.push("snapshot");
                    return operation({} as AdminQueryRunner);
                },
                authorize: async () => {
                    events.push("authorize");
                    throw forbidden;
                },
                loadDetail: async () => {
                    events.push("load");
                    throw new Error("must not load");
                },
            },
        ),
        (error) => error === forbidden,
    );
    assert.deepEqual(events, ["snapshot", "authorize"]);
});

test("production question reads keep authorization, filters and detail in repeatable-read snapshots", () => {
    const pageSource = source("app/admin/questions/page.tsx");
    assert.match(pageSource, /withAdminReadOnlySnapshot\(async \(runner\)/u);
    assert.match(pageSource, /readAdminPageAccessInSnapshot\(runner\)/u);
    assert.match(pageSource, /listQuestions\(runner, query\)/u);
    assert.match(pageSource, /getQuestionDetail\(\s*runner,/u);
    assert.match(pageSource, /listQuestionFilterOptions\(runner\)/u);
    assert.match(pageSource, /catch \(error\) \{\s*unstable_rethrow\(error\);/u);
    assert.doesNotMatch(pageSource, /adminPostgresRunner/u);

    const queuePageSource = source("app/admin/questions/reviews/page.tsx");
    assert.match(queuePageSource, /withAdminReadOnlySnapshot\(async \(runner\)/u);
    assert.match(queuePageSource, /readAdminPageAccessInSnapshot\(runner\)/u);
    assert.match(queuePageSource, /listQuestionReviewQueue\(runner, query\)/u);
    assert.match(
        queuePageSource,
        /catch \(error\) \{\s*unstable_rethrow\(error\);/u,
    );
    assert.doesNotMatch(queuePageSource, /adminPostgresRunner/u);

    for (const route of [
        "app/api/v1/admin/questions/route.ts",
        "app/api/v1/admin/questions/[questionId]/route.ts",
    ]) {
        const routeSource = source(route);
        assert.match(routeSource, /withSnapshot:\s*withAdminReadOnlySnapshot/u);
        assert.match(routeSource, /authorize:\s*requireAdminReadContext/u);
    }
});
