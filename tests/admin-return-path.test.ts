import assert from "node:assert/strict";
import test from "node:test";

import { resolveAdminReturnPath } from "../app/lib/admin-return-path.ts";

test("accepts only the admin route tree", () => {
    assert.equal(resolveAdminReturnPath("/admin"), "/admin");
    assert.equal(
        resolveAdminReturnPath("/admin/questions?status=draft#review"),
        "/admin/questions?status=draft#review",
    );
});

test("rejects external, protocol-relative and unrelated paths", () => {
    assert.equal(resolveAdminReturnPath("https://example.com/admin"), null);
    assert.equal(resolveAdminReturnPath("//example.com/admin"), null);
    assert.equal(resolveAdminReturnPath("/\\example.com/admin"), null);
    assert.equal(resolveAdminReturnPath("/practice"), null);
    assert.equal(resolveAdminReturnPath(null), null);
});
