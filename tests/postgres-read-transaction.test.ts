import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

import {
    READ_ONLY_REPEATABLE_READ_BEGIN,
    runReadOnlyRepeatableReadTransaction,
} from "../app/lib/postgres-read-transaction.ts";

interface FakeTransactionClient {
    commands: string[];
    releases: Array<boolean | Error | undefined>;
    query: (text: string) => Promise<{ rows: never[] }>;
    release: (error?: boolean | Error) => void;
}

function fakeClient(options: { rollbackFails?: boolean } = {}): FakeTransactionClient {
    const client: FakeTransactionClient = {
        commands: [],
        releases: [],
        async query(text) {
            client.commands.push(text);
            if (options.rollbackFails && text === "ROLLBACK") {
                throw new Error("rollback failed");
            }
            return { rows: [] };
        },
        release(error) {
            client.releases.push(error);
        },
    };
    return client;
}

test("commits and releases one read-only repeatable-read snapshot", async () => {
    const client = fakeClient();
    const value = await runReadOnlyRepeatableReadTransaction(
        client as unknown as PoolClient,
        async (scopedClient) => {
            assert.equal(scopedClient, client);
            await scopedClient.query("SELECT 1");
            return "snapshot";
        },
    );

    assert.equal(value, "snapshot");
    assert.deepEqual(client.commands, [
        READ_ONLY_REPEATABLE_READ_BEGIN,
        "SELECT 1",
        "COMMIT",
    ]);
    assert.deepEqual(client.releases, [false]);
});

test("rolls back and releases when a snapshot operation fails", async () => {
    const client = fakeClient();
    const operationError = new Error("aggregate failed");

    await assert.rejects(
        () => runReadOnlyRepeatableReadTransaction(
            client as unknown as PoolClient,
            async () => {
                throw operationError;
            },
        ),
        (error) => error === operationError,
    );

    assert.deepEqual(client.commands, [
        READ_ONLY_REPEATABLE_READ_BEGIN,
        "ROLLBACK",
    ]);
    assert.deepEqual(client.releases, [false]);
});

test("preserves the operation error and discards a client after rollback failure", async () => {
    const client = fakeClient({ rollbackFails: true });
    const operationError = new Error("aggregate failed");

    await assert.rejects(
        () => runReadOnlyRepeatableReadTransaction(
            client as unknown as PoolClient,
            async () => {
                throw operationError;
            },
        ),
        (error) => error === operationError,
    );

    assert.deepEqual(client.commands, [
        READ_ONLY_REPEATABLE_READ_BEGIN,
        "ROLLBACK",
    ]);
    assert.deepEqual(client.releases, [true]);
});
