import assert from "node:assert/strict";
import test from "node:test";

import {
    adminDataResponse,
    handleAdminHttpError,
} from "../app/lib/admin/admin-http.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

test("admin success responses are private, non-cacheable and consistently shaped", async () => {
    const response = adminDataResponse(
        { accounts: [{ id: "safe-id" }] },
        { page: 2, pageSize: 25, total: 26 },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.deepEqual(await response.json(), {
        data: { accounts: [{ id: "safe-id" }] },
        meta: {
            persistence: "local-postgresql",
            page: 2,
            pageSize: 25,
            total: 26,
        },
    });
});

test("admin input and authorization errors retain only their safe contract", async () => {
    const response = handleAdminHttpError(new AdminApiError(
        "FORBIDDEN",
        "這個帳號沒有管理後台權限。",
        403,
    ));

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(await response.json(), {
        error: {
            code: "FORBIDDEN",
            message: "這個帳號沒有管理後台權限。",
        },
    });
});

test("unknown failures never expose SQL, connection data or stack messages", async () => {
    const originalConsoleError = console.error;
    const logs: unknown[][] = [];
    console.error = (...values: unknown[]) => {
        logs.push(values);
    };

    try {
        const response = handleAdminHttpError(new Error(
            "password=secret socket=/private/tmp/private.sock SELECT token_hash FROM auth_sessions",
        ));
        const serialized = JSON.stringify(await response.json());

        assert.equal(response.status, 500);
        assert.doesNotMatch(serialized, /secret|socket|SELECT|token_hash/iu);
        assert.deepEqual(JSON.parse(serialized), {
            error: {
                code: "INTERNAL_ERROR",
                message: "系統暫時無法完成操作，請稍後再試。",
            },
        });
        assert.equal(logs.length, 1);
        assert.deepEqual(logs[0], [
            "Admin API request failed",
            { errorName: "Error" },
        ]);
    }
    finally {
        console.error = originalConsoleError;
    }
});
