import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
    AdminQueryResult,
    AdminQueryRunner,
} from "../app/lib/admin/admin-auth.ts";
import {
    PostgresAdminMutationReceipts,
} from "../app/lib/admin/admin-mutation-receipts.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const RECEIPT_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_ID = "66666666-6666-4666-8666-666666666666";
const FINGERPRINT = "a".repeat(64);

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly resolver: (
        text: string,
        values: readonly unknown[],
        index: number,
    ) => QueryResultRow[];

    constructor(
        resolver: (
            text: string,
            values: readonly unknown[],
            index: number,
        ) => QueryResultRow[],
    ) {
        this.resolver = resolver;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const index = this.calls.length;
        this.calls.push({ text, values });
        return { rows: this.resolver(text, values, index) as Row[] };
    }
}

const request = {
    actorUserId: ACTOR_ID,
    operation: "subscription_plan_create",
    key: KEY,
    payloadFingerprint: FINGERPRINT,
    requestId: REQUEST_ID,
} as const;

test("durable receipt completes business result and audit evidence on the supplied runner", async () => {
    const runner = new FakeRunner((text) => {
        if (/INSERT INTO admin_mutation_receipts/iu.test(text)) return [{ id: RECEIPT_ID }];
        if (/UPDATE admin_mutation_receipts/iu.test(text)) return [{ id: RECEIPT_ID }];
        return [];
    });
    const receipts = new PostgresAdminMutationReceipts({ next: () => RECEIPT_ID });
    let operationCalls = 0;
    const result = await receipts.execute(runner, request, async () => {
        operationCalls += 1;
        return {
            result: { planId: TARGET_ID, status: "draft" },
            receipt: {
                targetType: "subscription_plan",
                targetId: TARGET_ID,
                auditLogId: AUDIT_ID,
                responseStatus: 201,
            },
        };
    });

    assert.deepEqual(result, { planId: TARGET_ID, status: "draft" });
    assert.equal(operationCalls, 1);
    assert.equal(runner.calls.length, 2);
    assert.match(runner.calls[0]!.text, /ON CONFLICT \(actor_user_id, operation, idempotency_key\) DO NOTHING/iu);
    assert.deepEqual(runner.calls[0]!.values, [
        RECEIPT_ID,
        ACTOR_ID,
        "subscription_plan_create",
        KEY,
        FINGERPRINT,
        REQUEST_ID,
    ]);
    assert.match(runner.calls[1]!.text, /status = 'completed'/iu);
    assert.match(runner.calls[1]!.text, /admin_audit_log_id = \$4::uuid/iu);
    assert.deepEqual(runner.calls[1]!.values, [
        RECEIPT_ID,
        "subscription_plan",
        TARGET_ID,
        AUDIT_ID,
        JSON.stringify(result),
    ]);
});

test("same actor, operation, key and fingerprint replays the completed JSON result", async () => {
    const replay = { planId: TARGET_ID, status: "draft" };
    const runner = new FakeRunner((text) => {
        if (/INSERT INTO admin_mutation_receipts/iu.test(text)) return [];
        if (/FROM admin_mutation_receipts/iu.test(text)) return [{
            id: RECEIPT_ID,
            operation: request.operation,
            request_fingerprint: FINGERPRINT,
            request_id: REQUEST_ID,
            status: "completed",
            replay_result: replay,
        }];
        return [];
    });
    const receipts = new PostgresAdminMutationReceipts({ next: () => RECEIPT_ID });
    let operationCalls = 0;
    const result = await receipts.execute(runner, request, async () => {
        operationCalls += 1;
        throw new Error("must not run");
    });

    assert.deepEqual(result, replay);
    assert.equal(operationCalls, 0);
    assert.equal(runner.calls.length, 2);
    assert.match(runner.calls[1]!.text, /FOR UPDATE/iu);
    assert.deepEqual(runner.calls[1]!.values, [ACTOR_ID, request.operation, KEY]);
});

test("same receipt key with a different fingerprint returns a safe conflict", async () => {
    const runner = new FakeRunner((text) => {
        if (/INSERT INTO admin_mutation_receipts/iu.test(text)) return [];
        return [{
            id: RECEIPT_ID,
            operation: request.operation,
            request_fingerprint: "b".repeat(64),
            request_id: REQUEST_ID,
            status: "completed",
            replay_result: { planId: TARGET_ID },
        }];
    });
    const receipts = new PostgresAdminMutationReceipts({ next: () => RECEIPT_ID });

    await assert.rejects(
        () => receipts.execute(runner, request, async () => {
            throw new Error("must not run");
        }),
        (error: unknown) => {
            assert.ok(error instanceof AdminApiError);
            assert.equal(error.code, "CONFLICT");
            assert.equal(error.status, 409);
            assert.doesNotMatch(error.message, /fingerprint|sha|payload/iu);
            return true;
        },
    );
});

test("operation failure never sends a completion update or uses a fallback store", async () => {
    const runner = new FakeRunner((text) =>
        /INSERT INTO admin_mutation_receipts/iu.test(text) ? [{ id: RECEIPT_ID }] : [],
    );
    const receipts = new PostgresAdminMutationReceipts({ next: () => RECEIPT_ID });
    const failure = new Error("business write failed");

    await assert.rejects(
        () => receipts.execute(runner, request, async () => {
            throw failure;
        }),
        failure,
    );
    assert.equal(runner.calls.length, 1);
    assert.match(runner.calls[0]!.text, /INSERT INTO admin_mutation_receipts/iu);
    assert.doesNotMatch(runner.calls[0]!.text, /UPDATE admin_mutation_receipts/iu);
});

test("a visible pending receipt is not replayed as success", async () => {
    const runner = new FakeRunner((text) => {
        if (/INSERT INTO admin_mutation_receipts/iu.test(text)) return [];
        return [{
            id: RECEIPT_ID,
            operation: request.operation,
            request_fingerprint: FINGERPRINT,
            request_id: REQUEST_ID,
            status: "pending",
            replay_result: null,
        }];
    });
    const receipts = new PostgresAdminMutationReceipts({ next: () => RECEIPT_ID });

    await assert.rejects(
        () => receipts.execute(runner, request, async () => {
            throw new Error("must not run");
        }),
        (error: unknown) => {
            assert.ok(error instanceof AdminApiError);
            assert.equal(error.code, "CONFLICT");
            assert.equal(error.status, 409);
            return true;
        },
    );
});
