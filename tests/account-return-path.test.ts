import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveAccountReturnPath,
    resolveLearningBookShareReturnPath,
} from "../app/lib/account-return-path.ts";

const token = "aB0_-".repeat(8) + "xyz";
const sharePath = `/learning-books/share/${token}`;

test("returns to exactly the canonical learning-book invitation", () => {
    assert.equal(resolveLearningBookShareReturnPath(sharePath), sharePath);
    assert.equal(resolveAccountReturnPath(sharePath), sharePath);
});

test("retains existing administration return paths", () => {
    assert.equal(resolveAccountReturnPath("/admin"), "/admin");
    assert.equal(resolveAccountReturnPath("/admin/questions?status=draft#review"), "/admin/questions?status=draft#review");
    assert.equal(resolveLearningBookShareReturnPath("/admin"), null);
});

test("rejects external URLs, encoded separators, dot segments and extra share-route data", () => {
    for (const path of [
        null,
        `https://example.com${sharePath}`,
        `//example.com${sharePath}`,
        `/\\example.com${sharePath}`,
        `/learning-books/share/${"a".repeat(42)}`,
        `/learning-books/share/${"a".repeat(44)}`,
        `/learning-books/share/${"a".repeat(42)}=`,
        `/learning-books/share/${"a".repeat(42)}%`,
        `${sharePath}/`,
        `${sharePath}/../other`,
        `/learning-books/../learning-books/share/${token}`,
        `/learning-books%2fshare%2f${token}`,
        `${sharePath}?next=https://example.com`,
        `${sharePath}#other`,
        ` ${sharePath}`,
        `${sharePath}\n`,
        `${sharePath}\r`,
        `/learning-books/share/\t${token}`,
        "/learning-books",
        "/practice",
    ]) {
        assert.equal(resolveLearningBookShareReturnPath(path), null, String(path));
        assert.equal(resolveAccountReturnPath(path), null, String(path));
    }
});
