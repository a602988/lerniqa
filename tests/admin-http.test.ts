import assert from "node:assert/strict";
import test from "node:test";

import {
    adminDataResponse,
    adminErrorResponse,
    handleAdminHttpError,
} from "../app/lib/admin/admin-http.ts";
import {
    parseAdminRequestId,
    recordAdminServerFailure,
    resolveAdminRequestId,
    type AdminServerFailureEvent,
} from "../app/lib/admin/admin-observability.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const ACCEPTED_REQUEST_ID = "a1111111-b111-4c11-8d11-e11111111111";
const GENERATED_REQUEST_ID = "77777777-7777-4777-8777-777777777777";

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
    const logs: AdminServerFailureEvent[] = [];
    const response = handleAdminHttpError(new AdminApiError(
        "FORBIDDEN",
        "這個帳號沒有管理後台權限。",
        403,
    ), {
        logger: (event) => logs.push(event),
        generateRequestId: () => GENERATED_REQUEST_ID,
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-request-id"), null);
    assert.deepEqual(await response.json(), {
        error: {
            code: "FORBIDDEN",
            message: "這個帳號沒有管理後台權限。",
        },
    });
    assert.deepEqual(logs, []);
});

test("unknown failures never expose SQL, connection data or stack messages", async () => {
    const logs: AdminServerFailureEvent[] = [];
    const response = handleAdminHttpError(new Error(
        "password=secret socket=/private/tmp/private.sock SELECT token_hash FROM auth_sessions",
    ), {
        requestId: "unsafe id?cookie=secret",
        generateRequestId: () => GENERATED_REQUEST_ID,
        logger: (event) => logs.push(event),
    });
    const serialized = JSON.stringify(await response.json());

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("x-request-id"), GENERATED_REQUEST_ID);
    assert.doesNotMatch(serialized, /secret|socket|SELECT|token_hash/iu);
    assert.deepEqual(JSON.parse(serialized), {
        error: {
            code: "INTERNAL_ERROR",
            message: "系統暫時無法完成操作，請稍後再試。",
            requestId: GENERATED_REQUEST_ID,
        },
    });
    assert.deepEqual(logs, [{
        event: "admin_server_failure",
        scope: "admin_api",
        requestId: GENERATED_REQUEST_ID,
        status: 500,
        failureKind: "unhandled",
        errorCode: "UNHANDLED_ERROR",
        errorName: "Error",
    }]);
    assert.doesNotMatch(JSON.stringify(logs), /secret|socket|SELECT|token_hash|private\.sock/iu);
});

test("classified 503 failures accept a strict request ID and emit one safe event", async () => {
    const logs: AdminServerFailureEvent[] = [];
    const response = handleAdminHttpError(new AdminApiError(
        "INTERNAL_ERROR",
        "管理後台資料庫暫時無法使用，請稍後再試。",
        503,
    ), {
        requestId: ACCEPTED_REQUEST_ID,
        generateRequestId: () => {
            throw new Error("accepted IDs must not call the generator");
        },
        logger: (event) => logs.push(event),
    });

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-request-id"), ACCEPTED_REQUEST_ID);
    assert.deepEqual(await response.json(), {
        error: {
            code: "INTERNAL_ERROR",
            message: "管理後台資料庫暫時無法使用，請稍後再試。",
            requestId: ACCEPTED_REQUEST_ID,
        },
    });
    assert.deepEqual(logs, [{
        event: "admin_server_failure",
        scope: "admin_api",
        requestId: ACCEPTED_REQUEST_ID,
        status: 503,
        failureKind: "classified",
        errorCode: "INTERNAL_ERROR",
        errorName: "AdminApiError",
    }]);
});

test("direct classified 5xx serialization cannot bypass correlation logging", async () => {
    const originalConsoleError = console.error;
    const logs: unknown[][] = [];
    console.error = (...values: unknown[]) => {
        logs.push(values);
    };

    try {
        const response = adminErrorResponse(new AdminApiError(
            "INTERNAL_ERROR",
            "管理後台資料庫暫時無法使用，請稍後再試。",
            503,
            ACCEPTED_REQUEST_ID,
        ));

        assert.equal(response.status, 503);
        assert.equal(response.headers.get("x-request-id"), ACCEPTED_REQUEST_ID);
        assert.equal((await response.json()).error.requestId, ACCEPTED_REQUEST_ID);
        assert.deepEqual(logs, [[
            "Admin server failure",
            {
                event: "admin_server_failure",
                scope: "admin_api",
                requestId: ACCEPTED_REQUEST_ID,
                status: 503,
                failureKind: "classified",
                errorCode: "INTERNAL_ERROR",
                errorName: "AdminApiError",
            },
        ]]);
    }
    finally {
        console.error = originalConsoleError;
    }
});

test("request IDs accept only canonical lower-case UUID v4 or v7 values", () => {
    assert.equal(parseAdminRequestId(ACCEPTED_REQUEST_ID), ACCEPTED_REQUEST_ID);
    assert.equal(
        parseAdminRequestId("01890f47-3a6d-7cc0-8c3a-8ea6b31ce7ee"),
        "01890f47-3a6d-7cc0-8c3a-8ea6b31ce7ee",
    );

    for (const rejected of [
        ACCEPTED_REQUEST_ID.toUpperCase(),
        ` ${ACCEPTED_REQUEST_ID}`,
        "00000000-0000-0000-0000-000000000000",
        "11111111-1111-1111-8111-111111111111",
        "request-123",
        null,
    ]) {
        assert.equal(parseAdminRequestId(rejected), null);
    }

    assert.equal(
        resolveAdminRequestId("invalid", () => GENERATED_REQUEST_ID),
        GENERATED_REQUEST_ID,
    );
});

test("observability rejects non-server failures and cannot break responses", async () => {
    const logs: AdminServerFailureEvent[] = [];
    const ignored = recordAdminServerFailure({
        scope: "admin_api",
        requestId: ACCEPTED_REQUEST_ID,
        status: 403,
        failureKind: "classified",
        errorCode: "FORBIDDEN",
        error: new Error("expected"),
    }, (event) => logs.push(event));

    assert.equal(ignored, null);
    assert.deepEqual(logs, []);

    const response = handleAdminHttpError(new Error("hidden detail"), {
        generateRequestId: () => GENERATED_REQUEST_ID,
        logger: () => {
            throw new Error("logger unavailable");
        },
    });

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("x-request-id"), GENERATED_REQUEST_ID);
    assert.equal((await response.json()).error.requestId, GENERATED_REQUEST_ID);
});

test("observability allowlists every logged string field", () => {
    const logs: AdminServerFailureEvent[] = [];
    const error = new Error("hidden connection detail");
    error.name = "TokenFromSubmittedInput";

    const event = recordAdminServerFailure({
        scope: "admin_page_auth",
        requestId: ACCEPTED_REQUEST_ID,
        status: 500,
        failureKind: "unhandled",
        errorCode: "UNHANDLED_ERROR",
        error,
    }, (value) => logs.push(value));

    assert.equal(event?.errorName, "UnknownError");
    assert.deepEqual(logs, [event]);
    assert.doesNotMatch(JSON.stringify(logs), /TokenFromSubmittedInput|connection detail/iu);
});
