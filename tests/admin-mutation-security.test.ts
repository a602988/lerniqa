import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import {
    type AdminQueryResult,
    type AdminQueryRunner,
} from "../app/lib/admin/admin-auth.ts";
import {
    ADMIN_MUTATION_AUTH_LOCK_SQL,
    parseAdminIdempotencyKey,
    readStrictAdminMutationJson,
    requireAdminMutationEvidence,
    requireAdminMutationSameOrigin,
    revalidateSystemAdminMutation,
} from "../app/lib/admin/admin-mutation-security.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const TOKEN = "a".repeat(43);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-33333333333a";
const UUID_V7 = "01890f47-3a6d-7cc0-8c3a-8ea6b31ce7ee";

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly rows: QueryResultRow[][];

    constructor(rows: QueryResultRow[][]) {
        this.rows = rows;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const index = this.calls.length;
        this.calls.push({ text, values });
        return { rows: (this.rows[index] ?? []) as Row[] };
    }
}

function mutationRequest(
    url = "http://127.0.0.1:3617/api/v1/admin/plans",
    headers: Record<string, string> = {},
    body = JSON.stringify({ name: "基礎方案" }),
): Request {
    return new Request(url, {
        method: "POST",
        headers: {
            "content-type": "application/json; charset=utf-8",
            origin: new URL(url).origin,
            "sec-fetch-site": "same-origin",
            "x-lerniqa-csrf": "same-origin",
            "idempotency-key": IDEMPOTENCY_KEY,
            ...headers,
        },
        body,
    });
}

function assertAdminError(
    action: () => unknown | Promise<unknown>,
    code: string,
    status: number,
): Promise<void> {
    return assert.rejects(async () => action(), (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
    });
}

test("admin mutation idempotency keys accept canonical lower-case UUID v4/v7 only", async () => {
    assert.equal(parseAdminIdempotencyKey(IDEMPOTENCY_KEY), IDEMPOTENCY_KEY);
    assert.equal(parseAdminIdempotencyKey(UUID_V7), UUID_V7);

    for (const value of [
        null,
        IDEMPOTENCY_KEY.toUpperCase(),
        "11111111-1111-1111-8111-111111111111",
        "00000000-0000-0000-0000-000000000000",
        `${IDEMPOTENCY_KEY} `,
    ]) {
        await assertAdminError(
            () => parseAdminIdempotencyKey(value),
            "INVALID_IDEMPOTENCY_KEY",
            422,
        );
    }
});

test("mutation protection requires exact same origin, fetch context and custom header", async () => {
    const request = mutationRequest();
    assert.doesNotThrow(() => requireAdminMutationSameOrigin(request));
    const evidence = requireAdminMutationEvidence(request);
    assert.equal(evidence.idempotencyKey, IDEMPOTENCY_KEY);
    assert.match(
        evidence.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );

    const httpsRequest = mutationRequest("https://admin.example.invalid/api/v1/admin/plans");
    assert.doesNotThrow(() => requireAdminMutationSameOrigin(httpsRequest));

    for (const invalid of [
        mutationRequest(undefined, { origin: "https://attacker.example.invalid" }),
        mutationRequest(undefined, { "x-lerniqa-csrf": "wrong" }),
        mutationRequest(undefined, { "sec-fetch-site": "cross-site" }),
        mutationRequest("http://admin.example.invalid/api/v1/admin/plans"),
        new Request("http://127.0.0.1:3617/api/v1/admin/plans", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-lerniqa-csrf": "same-origin",
                "idempotency-key": IDEMPOTENCY_KEY,
            },
            body: "{}",
        }),
    ]) {
        await assertAdminError(
            () => requireAdminMutationSameOrigin(invalid),
            "FORBIDDEN",
            403,
        );
    }
});

test("strict mutation JSON rejects unknown trusted fields and malformed bodies", async () => {
    assert.deepEqual(
        await readStrictAdminMutationJson(mutationRequest(), ["name"]),
        { name: "基礎方案" },
    );

    await assertAdminError(
        () => readStrictAdminMutationJson(
            mutationRequest(undefined, {}, JSON.stringify({ name: "方案", actorUserId: USER_ID })),
            ["name"],
        ),
        "INVALID_INPUT",
        422,
    );
    await assertAdminError(
        () => readStrictAdminMutationJson(
            mutationRequest(undefined, { "content-type": "text/plain" }),
            ["name"],
        ),
        "INVALID_INPUT",
        422,
    );
    await assertAdminError(
        () => readStrictAdminMutationJson(mutationRequest(undefined, {}, "{"), ["name"]),
        "INVALID_INPUT",
        422,
    );
    await assertAdminError(
        () => readStrictAdminMutationJson(
            mutationRequest(undefined, {}, JSON.stringify({ name: "123456789" })),
            ["name"],
            8,
        ),
        "INVALID_INPUT",
        422,
    );
});

test("transaction authorization takes the shared auth lock before revalidation", async () => {
    const runner = new FakeRunner([
        [{ locked: null }],
        [{
            session_id: SESSION_ID,
            user_id: USER_ID,
            display_name: "管理員",
            expires_at: "2026-10-20T00:00:00.000Z",
            is_system_admin: true,
        }],
    ]);
    const expectedActor = {
        sessionId: SESSION_ID,
        userId: USER_ID,
        displayName: "管理員",
        expiresAt: "2026-10-20T00:00:00.000Z",
    };

    assert.deepEqual(
        await revalidateSystemAdminMutation(TOKEN, expectedActor, runner),
        expectedActor,
    );
    assert.equal(runner.calls.length, 2);
    assert.equal(runner.calls[0]?.text, ADMIN_MUTATION_AUTH_LOCK_SQL);
    assert.deepEqual(runner.calls[0]?.values, [USER_ID]);
    assert.match(runner.calls[1]?.text ?? "", /lerniqa_auth_session_is_valid/iu);
    assert.match(String(runner.calls[1]?.values[0]), /^sha256:v1:[0-9a-f]{64}$/u);
    assert.notEqual(runner.calls[1]?.values[0], TOKEN);
});

test("transaction authorization rejects a session identity change", async () => {
    const runner = new FakeRunner([
        [{ locked: null }],
        [{
            session_id: "44444444-4444-4444-8444-444444444444",
            user_id: USER_ID,
            display_name: "管理員",
            expires_at: "2026-10-20T00:00:00.000Z",
            is_system_admin: true,
        }],
    ]);

    await assertAdminError(
        () => revalidateSystemAdminMutation(TOKEN, {
            sessionId: SESSION_ID,
            userId: USER_ID,
            displayName: "管理員",
            expiresAt: "2026-10-20T00:00:00.000Z",
        }, runner),
        "UNAUTHENTICATED",
        401,
    );
});
