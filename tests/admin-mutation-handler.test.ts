import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import {
    type AdminQueryResult,
    type AdminQueryRunner,
} from "../app/lib/admin/admin-auth.ts";
import {
    handleAdminMutation,
    normalizeAdminMutationError,
    type AdminMutationDependencies,
} from "../app/lib/admin/admin-mutation-handler.ts";
import type { AdminMutationTransactionProvider } from "../app/lib/admin/admin-mutation-security.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const TOKEN = "a".repeat(43);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-33333333333a";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

interface QueryCall {
    label: string;
    text: string;
    values: readonly unknown[];
}

class TraceRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly label: string;
    private readonly resolve: (
        text: string,
        values: readonly unknown[],
        index: number,
    ) => QueryResultRow[];

    constructor(
        label: string,
        resolve: (
            text: string,
            values: readonly unknown[],
            index: number,
        ) => QueryResultRow[],
    ) {
        this.label = label;
        this.resolve = resolve;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const index = this.calls.length;
        this.calls.push({ label: this.label, text, values });
        return { rows: this.resolve(text, values, index) as Row[] };
    }
}

class TraceTransactions implements AdminMutationTransactionProvider {
    starts = 0;
    private readonly runner: AdminQueryRunner;

    constructor(runner: AdminQueryRunner) {
        this.runner = runner;
    }

    async runInTransaction<Result>(
        operation: (runner: AdminQueryRunner) => Promise<Result>,
    ): Promise<Result> {
        this.starts += 1;
        return operation(this.runner);
    }
}

function adminSessionRow(isSystemAdmin = true): QueryResultRow {
    return {
        session_id: SESSION_ID,
        user_id: USER_ID,
        display_name: "管理員",
        expires_at: "2026-10-20T00:00:00.000Z",
        is_system_admin: isSystemAdmin,
    };
}

function validRequest(
    body: unknown = { name: "基礎方案" },
    headers: Record<string, string> = {},
): Request {
    return new Request("http://127.0.0.1:3617/api/v1/admin/plans", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            cookie: `lerniqa_session=${TOKEN}`,
            origin: "http://127.0.0.1:3617",
            "sec-fetch-site": "same-origin",
            "x-lerniqa-csrf": "same-origin",
            "idempotency-key": IDEMPOTENCY_KEY,
            "x-request-id": REQUEST_ID,
            ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

function dependencies(
    initialRows: QueryResultRow[] = [adminSessionRow()],
    transactionRows: QueryResultRow[][] = [[{ locked: null }], [adminSessionRow()]],
): {
    value: AdminMutationDependencies;
    readRunner: TraceRunner;
    transactionRunner: TraceRunner;
    transactions: TraceTransactions;
} {
    const readRunner = new TraceRunner("read", () => initialRows);
    const transactionRunner = new TraceRunner(
        "transaction",
        (_text, _values, index) => transactionRows[index] ?? [],
    );
    const transactions = new TraceTransactions(transactionRunner);
    return {
        value: { readRunner, transactions },
        readRunner,
        transactionRunner,
        transactions,
    };
}

test("mutation handler authenticates first, revalidates in transaction and passes header evidence", async () => {
    const deps = dependencies();
    const trace: string[] = [];
    const response = await handleAdminMutation(validRequest(), deps.value, {
        allowedFields: ["name"],
        parse(body, evidence) {
            trace.push("parse");
            return { name: String(body.name), idempotencyKey: evidence.idempotencyKey };
        },
        async mutate(context, input) {
            trace.push("mutate");
            assert.equal(context.actor.userId, USER_ID);
            assert.equal(context.evidence.idempotencyKey, IDEMPOTENCY_KEY);
            assert.equal(context.evidence.requestId, REQUEST_ID);
            return input;
        },
        successStatus: 201,
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
        data: { name: "基礎方案", idempotencyKey: IDEMPOTENCY_KEY },
        meta: { persistence: "local-postgresql" },
    });
    assert.equal(deps.readRunner.calls.length, 1);
    assert.equal(deps.transactions.starts, 1);
    assert.equal(deps.transactionRunner.calls.length, 2);
    assert.match(deps.transactionRunner.calls[0]?.text ?? "", /lerniqa_lock_auth_user/iu);
    assert.match(deps.transactionRunner.calls[1]?.text ?? "", /lerniqa_auth_session_is_valid/iu);
    assert.deepEqual(trace, ["parse", "mutate"]);
});

test("authentication failure wins over invalid origin and malformed JSON", async () => {
    const deps = dependencies([]);
    const response = await handleAdminMutation(validRequest("{", {
        origin: "https://attacker.example.invalid",
    }), deps.value, {
        allowedFields: [],
        parse() {
            throw new Error("body must not be parsed");
        },
        async mutate() {
            throw new Error("transaction must not start");
        },
    });

    assert.equal(response.status, 401);
    assert.equal(deps.readRunner.calls.length, 1);
    assert.equal(deps.transactions.starts, 0);
    assert.deepEqual(await response.json(), {
        error: {
            code: "UNAUTHENTICATED",
            message: "管理員登入狀態已失效。",
            requestId: REQUEST_ID,
        },
    });
});

test("unknown fields and parser validation return 422 before a transaction begins", async () => {
    const unknownDeps = dependencies();
    const unknownResponse = await handleAdminMutation(
        validRequest({ name: "方案", actorUserId: USER_ID }),
        unknownDeps.value,
        {
            allowedFields: ["name"],
            parse(body) {
                return body;
            },
            async mutate(_context, input) {
                return input;
            },
        },
    );
    assert.equal(unknownResponse.status, 422);
    assert.equal(unknownDeps.transactions.starts, 0);

    const parserDeps = dependencies();
    const parserResponse = await handleAdminMutation(validRequest(), parserDeps.value, {
        allowedFields: ["name"],
        parse() {
            throw new AdminApiError(
                "INVALID_SUBSCRIPTION_PLAN",
                "方案名稱格式不正確。",
                400,
            );
        },
        async mutate() {
            throw new Error("transaction must not start");
        },
    });
    assert.equal(parserResponse.status, 422);
    assert.equal(parserDeps.transactions.starts, 0);
    assert.deepEqual(await parserResponse.json(), {
        error: {
            code: "INVALID_SUBSCRIPTION_PLAN",
            message: "方案名稱格式不正確。",
            requestId: REQUEST_ID,
        },
    });
});

test("a revoked transaction authorization prevents the mutation", async () => {
    const deps = dependencies([adminSessionRow()], [[{ locked: null }], []]);
    let mutated = false;
    const response = await handleAdminMutation(validRequest(), deps.value, {
        allowedFields: ["name"],
        parse(body) {
            return body;
        },
        async mutate() {
            mutated = true;
            return {};
        },
    });

    assert.equal(response.status, 401);
    assert.equal(mutated, false);
    assert.equal(deps.transactions.starts, 1);
    assert.equal(deps.transactionRunner.calls.length, 2);
});

test("known database failures map to safe 409, 422 and 503 contracts", () => {
    const conflict = normalizeAdminMutationError({
        code: "23505",
        detail: "duplicate token_hash secret SQL",
    });
    assert.ok(conflict instanceof AdminApiError);
    assert.equal(conflict.code, "CONFLICT");
    assert.equal(conflict.status, 409);
    assert.doesNotMatch(conflict.message, /token_hash|secret|SQL/iu);

    const invalid = normalizeAdminMutationError({
        code: "22P02",
        detail: "private input syntax detail",
    });
    assert.ok(invalid instanceof AdminApiError);
    assert.equal(invalid.code, "INVALID_INPUT");
    assert.equal(invalid.status, 422);
    assert.doesNotMatch(invalid.message, /syntax|private/iu);

    const invariantFailure = {
        code: "23514",
        detail: "missing same-transaction admin audit",
    };
    assert.equal(normalizeAdminMutationError(invariantFailure), invariantFailure);

    const unavailable = normalizeAdminMutationError({
        code: "08006",
        message: "password=secret socket=/private/path",
    });
    assert.ok(unavailable instanceof AdminApiError);
    assert.equal(unavailable.code, "INTERNAL_ERROR");
    assert.equal(unavailable.status, 503);
    assert.doesNotMatch(unavailable.message, /password|secret|socket|private/iu);
});

test("handler never serializes database messages, SQL or stacks", async () => {
    const deps = dependencies();
    const originalConsoleError = console.error;
    const logs: unknown[][] = [];
    console.error = (...values: unknown[]) => logs.push(values);

    try {
        const response = await handleAdminMutation(validRequest(), deps.value, {
            allowedFields: ["name"],
            parse(body) {
                return body;
            },
            async mutate() {
                throw {
                    code: "08006",
                    message: "password=secret SELECT token_hash",
                    stack: "private stack",
                };
            },
        });
        const serialized = JSON.stringify(await response.json());

        assert.equal(response.status, 503);
        assert.equal(response.headers.get("x-request-id"), REQUEST_ID);
        assert.doesNotMatch(serialized, /password|secret|SELECT|token_hash|stack/iu);
        assert.doesNotMatch(JSON.stringify(logs), /password|secret|SELECT|token_hash|stack/iu);
    }
    finally {
        console.error = originalConsoleError;
    }
});
