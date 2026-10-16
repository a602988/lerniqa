import assert from "node:assert/strict";
import test from "node:test";

import { createAdminAssetGetHandler } from "../app/lib/admin/admin-asset-handler.ts";
import type { AdminQueryRunner } from "../app/lib/admin/admin-auth.ts";
import type {
    AdminQuestionAssetFile,
    AdminQuestionAssetRecord,
} from "../app/lib/admin/admin-asset-repository.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const STORAGE_KEY = "private/questions/do-not-expose.png";
const runner = {} as AdminQueryRunner;
const asset: AdminQuestionAssetRecord = {
    id: ASSET_ID,
    storageKey: STORAGE_KEY,
    mimeType: "image/png",
    byteSize: 4,
    checksum: "a".repeat(64),
};
const file: AdminQuestionAssetFile = {
    bytes: Uint8Array.from([137, 80, 78, 71]),
    mimeType: "image/png",
    extension: "png",
};

function request(): Request {
    return new Request(`http://127.0.0.1/api/v1/admin/assets/${ASSET_ID}`);
}

test("asset handler authorizes before parsing the route ID or querying assets", async () => {
    const events: string[] = [];
    const handler = createAdminAssetGetHandler({
        async requireReadContext() {
            events.push("authorize");
            throw new AdminApiError("FORBIDDEN", "沒有後台權限。", 403);
        },
        async findAsset() {
            events.push("query");
            return asset;
        },
        async readAsset() {
            events.push("read");
            return file;
        },
    });

    const response = await handler(request(), {
        params: Promise.resolve({ assetId: "not-a-uuid" }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(events, ["authorize"]);
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
});

test("asset handler validates UUID only after authorization", async () => {
    const events: string[] = [];
    const handler = createAdminAssetGetHandler({
        async requireReadContext() {
            events.push("authorize");
            return { runner };
        },
        async findAsset() {
            events.push("query");
            return asset;
        },
        async readAsset() {
            events.push("read");
            return file;
        },
    });

    const response = await handler(request(), {
        params: Promise.resolve({ assetId: "not-a-uuid" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(events, ["authorize"]);
    assert.equal((await response.json()).error.code, "INVALID_UUID");
});

test("asset handler serves bytes with hardened headers and an opaque filename", async () => {
    const handler = createAdminAssetGetHandler({
        async requireReadContext() {
            return { runner };
        },
        async findAsset(_runner, id) {
            assert.equal(id, ASSET_ID);
            return asset;
        },
        async readAsset(value) {
            assert.equal(value.storageKey, STORAGE_KEY);
            return file;
        },
    });

    const response = await handler(request(), {
        params: Promise.resolve({ assetId: ASSET_ID }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-length"), "4");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(
        response.headers.get("content-disposition"),
        `inline; filename="question-asset-${ASSET_ID}.png"`,
    );
    const serializedHeaders = JSON.stringify([...response.headers.entries()]);
    assert.doesNotMatch(serializedHeaders, /storage_key|local-data|do-not-expose|questions\//iu);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...file.bytes]);
});

test("unknown records and unavailable files share one non-disclosing 404", async () => {
    for (const mode of ["missing-row", "missing-file"] as const) {
        const handler = createAdminAssetGetHandler({
            async requireReadContext() {
                return { runner };
            },
            async findAsset() {
                return mode === "missing-row" ? null : asset;
            },
            async readAsset() {
                return null;
            },
        });
        const response = await handler(request(), {
            params: Promise.resolve({ assetId: ASSET_ID }),
        });
        const serialized = JSON.stringify(await response.json());

        assert.equal(response.status, 404);
        assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
        assert.match(serialized, /NOT_FOUND/u);
        assert.doesNotMatch(serialized, /storage|private|do-not-expose|local-data/iu);
    }
});
