import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { QueryResultRow } from "pg";

import {
    findAdminQuestionAsset,
    readAdminQuestionAssetFile,
    type AdminQuestionAssetRecord,
} from "../app/lib/admin/admin-asset-repository.ts";
import type {
    AdminQueryResult,
    AdminQueryRunner,
} from "../app/lib/admin/admin-auth.ts";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly rows: QueryResultRow[];

    constructor(rows: QueryResultRow[]) {
        this.rows = rows;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        this.calls.push({ text, values });
        return { rows: this.rows as Row[] };
    }
}

function assetRecord(
    storageKey: string,
    bytes: Uint8Array,
    overrides: Partial<AdminQuestionAssetRecord> = {},
): AdminQuestionAssetRecord {
    return {
        id: ASSET_ID,
        storageKey,
        mimeType: "image/png",
        byteSize: bytes.byteLength,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        ...overrides,
    };
}

test("admin asset lookup is parameterized and limited to formal question references", async () => {
    const runner = new FakeRunner([{
        id: ASSET_ID,
        storage_key: "questions/safe.png",
        mime_type: "image/png",
        byte_size: "4",
        checksum: "a".repeat(64),
    }]);

    const result = await findAdminQuestionAsset(runner, ASSET_ID);
    assert.deepEqual(result, {
        id: ASSET_ID,
        storageKey: "questions/safe.png",
        mimeType: "image/png",
        byteSize: 4,
        checksum: "a".repeat(64),
    });

    const call = runner.calls[0];
    assert.ok(call);
    assert.deepEqual(call.values, [ASSET_ID]);
    assert.doesNotMatch(call.text, new RegExp(ASSET_ID, "u"));
    assert.match(call.text, /asset\.deleted_at IS NULL/iu);
    assert.match(call.text, /asset\.scan_status = 'clean'/iu);
    assert.match(call.text, /question_content_blocks AS content_block/iu);
    assert.match(call.text, /content_block\.asset_id = asset\.id/iu);
    assert.match(call.text, /question_revision_sources AS revision_source/iu);
    assert.match(call.text, /revision_source\.crop_asset_id = asset\.id/iu);
    assert.match(call.text, /asset\.purpose = 'question_content'/iu);
    assert.match(call.text, /asset\.purpose = 'page_crop'/iu);
    assert.match(call.text, /content_block\.content_type = 'audio'[\s\S]+asset\.mime_type LIKE 'audio\/%'/iu);
    assert.match(call.text, /content_block\.content_type = 'page_crop'[\s\S]+asset\.mime_type LIKE 'image\/%'/iu);
});

test("safe asset reader verifies root containment, symlinks, size, checksum and MIME", async (context) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "lerniqa-admin-asset-"));
    context.after(async () => {
        await rm(temporary, { force: true, recursive: true });
    });
    const root = path.join(temporary, "assets");
    const nested = path.join(root, "questions");
    const bytes = Uint8Array.from([137, 80, 78, 71]);
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "safe.png"), bytes);

    const safe = assetRecord("questions/safe.png", bytes);
    const result = await readAdminQuestionAssetFile(safe, root);
    assert.ok(result);
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.extension, "png");
    assert.deepEqual([...result.bytes], [...bytes]);

    assert.equal(await readAdminQuestionAssetFile(
        assetRecord("../outside.png", bytes),
        root,
    ), null);
    assert.equal(await readAdminQuestionAssetFile(
        assetRecord("questions/safe.png", bytes, { byteSize: bytes.byteLength + 1 }),
        root,
    ), null);
    assert.equal(await readAdminQuestionAssetFile(
        assetRecord("questions/safe.png", bytes, { checksum: "b".repeat(64) }),
        root,
    ), null);
    assert.equal(await readAdminQuestionAssetFile(
        assetRecord("questions/safe.png", bytes, { mimeType: "text/html" }),
        root,
    ), null);

    const outside = path.join(temporary, "outside.png");
    await writeFile(outside, bytes);
    await symlink(outside, path.join(root, "linked.png"));
    assert.equal(await readAdminQuestionAssetFile(
        assetRecord("linked.png", bytes),
        root,
    ), null);
});
