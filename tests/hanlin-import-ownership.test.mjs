import assert from "node:assert/strict";
import test from "node:test";

import {
    deterministicUuid,
    LOCAL_CATALOG_IDS,
    stripLegacyWordSequenceFieldPrefixes,
} from "../scripts/lib/hanlin-chinese-import.mjs";
import {
    HANLIN_IMPORT_PRINCIPAL,
    HANLIN_REAL_DATA_OWNERSHIP,
} from "../scripts/lib/hanlin-postgres-writer.mjs";

test("real curriculum imports use a dedicated, deterministic system principal", () => {
    assert.deepEqual(HANLIN_IMPORT_PRINCIPAL, {
        userId: deterministicUuid("system-user:hanlin-curriculum-import"),
        displayName: "翰林題庫匯入服務",
    });
    assert.equal(Object.isFrozen(HANLIN_IMPORT_PRINCIPAL), true);
});

test("real curriculum data is system-owned and not scoped to a synthetic learner", () => {
    assert.deepEqual(HANLIN_REAL_DATA_OWNERSHIP, {
        origin: "system",
        ownerUserId: null,
        batchLearnerId: null,
    });
    assert.equal(Object.isFrozen(HANLIN_REAL_DATA_OWNERSHIP), true);
    for (const removedIdentity of [
        "userId",
        "learnerId",
        "roleId",
        "learnerAccessId",
        "learnerSubjectSettingId",
    ]) {
        assert.equal(removedIdentity in LOCAL_CATALOG_IDS, false);
    }
});

test("legacy Word sequence fields are removed without dropping question text", () => {
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("\\S\\do 9(１)１\\S\\do 9(１))\\S\\do 9(１)子曰：學而時習之。"),
        "子曰：學而時習之。",
    );
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("\\S\\do 0(６６\\S\\do 0(６\\S\\do 0(６休養性情最好的方式之一便是讀書。"),
        "休養性情最好的方式之一便是讀書。",
    );
    assert.equal(
        stripLegacyWordSequenceFieldPrefixes("2026 年的題目內容"),
        "2026 年的題目內容",
    );
});
