import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    loadAdminAccountDetailRequest,
    loadAdminAccountListRequest,
} from "../app/lib/admin/admin-account-handler.ts";
import type { AdminQueryRunner } from "../app/lib/admin/admin-auth.ts";
import type {
    AdminAccountDetail,
    AdminAccountPage,
} from "../app/lib/admin/account-repository.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const emptyPage: AdminAccountPage = {
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
};

test("account list authorizes before parsing and never reads after revocation", async () => {
    const events: string[] = [];
    const runner = {} as AdminQueryRunner;
    const forbidden = new AdminApiError("FORBIDDEN", "權限已撤銷。", 403);

    await assert.rejects(
        () => loadAdminAccountListRequest(
            new Request("https://example.test/api/v1/admin/accounts?page=invalid"),
            {
                withSnapshot: async (operation) => {
                    events.push("snapshot");
                    return operation(runner);
                },
                authorize: async (_request, receivedRunner) => {
                    events.push("authorize");
                    assert.equal(receivedRunner, runner);
                    throw forbidden;
                },
                list: async () => {
                    events.push("list");
                    return emptyPage;
                },
            },
        ),
        (error) => error === forbidden,
    );
    assert.deepEqual(events, ["snapshot", "authorize"]);
});

test("account list uses the snapshot runner for authorization and data", async () => {
    const events: string[] = [];
    const runner = {} as AdminQueryRunner;
    const result = await loadAdminAccountListRequest(
        new Request(
            "https://example.test/api/v1/admin/accounts"
            + "?createdFrom=2026-10-01&createdTo=2026-10-16&accountRole=learner",
        ),
        {
            withSnapshot: async (operation) => {
                events.push("snapshot");
                return operation(runner);
            },
            authorize: async (_request, receivedRunner) => {
                events.push("authorize");
                assert.equal(receivedRunner, runner);
            },
            list: async (receivedRunner, query) => {
                events.push("list");
                assert.equal(receivedRunner, runner);
                assert.deepEqual(query.created, {
                    from: "2026-10-01",
                    to: "2026-10-16",
                });
                assert.deepEqual(query.accountRoles, ["learner"]);
                return emptyPage;
            },
        },
    );

    assert.deepEqual(events, ["snapshot", "authorize", "list"]);
    assert.equal(result.page, emptyPage);
});

test("account detail resolves params and loads only after snapshot authorization", async () => {
    const events: string[] = [];
    const runner = {} as AdminQueryRunner;
    const account = { id: USER_ID } as AdminAccountDetail;
    const result = await loadAdminAccountDetailRequest(
        new Request(`https://example.test/api/v1/admin/accounts/${USER_ID}`),
        () => {
            events.push("params");
            return { userId: USER_ID };
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
            load: async (receivedRunner, receivedUserId) => {
                events.push("detail");
                assert.equal(receivedRunner, runner);
                assert.equal(receivedUserId, USER_ID);
                return account;
            },
        },
    );

    assert.deepEqual(events, ["snapshot", "authorize", "params", "detail"]);
    assert.equal(result.account, account);
});

test("account detail does not resolve params after authorization is revoked", async () => {
    const events: string[] = [];
    const forbidden = new AdminApiError("FORBIDDEN", "權限已撤銷。", 403);
    const resolveParams = () => {
        events.push("params");
        return { userId: "invalid" };
    };

    await assert.rejects(
        () => loadAdminAccountDetailRequest(
            new Request("https://example.test/api/v1/admin/accounts/invalid"),
            resolveParams,
            {
                withSnapshot: async (operation) => {
                    events.push("snapshot");
                    return operation({} as AdminQueryRunner);
                },
                authorize: async () => {
                    events.push("authorize");
                    throw forbidden;
                },
                load: async () => {
                    events.push("detail");
                    return {} as AdminAccountDetail;
                },
            },
        ),
        (error) => error === forbidden,
    );
    assert.deepEqual(events, ["snapshot", "authorize"]);
});

test("account page, APIs, and UI retain the protected lifecycle contracts", async () => {
    const [page, listRoute, detailRoute, accountsView, sharedView] = await Promise.all([
        readFile(new URL("../app/admin/accounts/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/api/v1/admin/accounts/route.ts", import.meta.url), "utf8"),
        readFile(
            new URL("../app/api/v1/admin/accounts/[userId]/route.ts", import.meta.url),
            "utf8",
        ),
        readFile(
            new URL("../app/components/admin/views/accounts-view.tsx", import.meta.url),
            "utf8",
        ),
        readFile(
            new URL("../app/components/admin/views/view-shared.tsx", import.meta.url),
            "utf8",
        ),
    ]);

    assert.match(
        page,
        /withAdminReadOnlySnapshot\(async \(runner\) =>[\s\S]*readAdminPageAccessInSnapshot\(runner\)/u,
    );
    assert.match(page, /listAccounts\(runner, query\)/u);
    assert.match(page, /getAccountDetail\(\s*runner,/u);
    assert.match(page, /catch \(error\) \{\s*unstable_rethrow\(error\);/u);
    assert.doesNotMatch(
        page.slice(page.lastIndexOf("catch (error)")),
        /await searchParams/u,
    );
    assert.match(listRoute, /loadAdminAccountListRequest[\s\S]*withAdminReadOnlySnapshot/u);
    assert.match(detailRoute, /loadAdminAccountDetailRequest[\s\S]*\(\) => context\.params/u);
    assert.doesNotMatch(detailRoute, /await context\.params/u);
    assert.match(accountsView, /identity\.lifecycleState/u);
    assert.match(accountsView, /identity\.revokedAt/u);
    assert.match(accountsView, /learner\.accessState/u);
    assert.match(accountsView, /learner\.learnerStatus/u);
    assert.match(accountsView, /learner\.effective/u);
    assert.match(accountsView, /filters\.dates/u);
    assert.match(sharedView, /type="date"/u);
});
