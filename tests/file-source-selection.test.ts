import assert from "node:assert/strict";
import test from "node:test";
import {
    createClipboardFile,
    selectFilesForAccept,
} from "../app/lib/file-source-selection.ts";

test("accepts clipboard images and copied files using MIME type or extension", () => {
    const accepted = selectFilesForAccept([
        { name: "畫面.png", type: "image/png" },
        { name: "試卷.pdf", type: "" },
    ], ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf", true);

    assert.equal(accepted.kind, "accepted");
    if (accepted.kind === "accepted") assert.equal(accepted.files.length, 2);
});

test("rejects unsupported clipboard content without treating text as a file", () => {
    const unsupported = selectFilesForAccept([
        { name: "筆記.txt", type: "text/plain" },
    ], ".json,application/json", false);
    const empty = selectFilesForAccept([], ".json,application/json", false);

    assert.equal(unsupported.kind, "unsupported");
    assert.equal(empty.kind, "empty");
});

test("rejects multiple pasted files when the picker accepts one file", () => {
    const result = selectFilesForAccept([
        { name: "一.png", type: "image/png" },
        { name: "二.png", type: "image/png" },
    ], "image/png", false);

    assert.equal(result.kind, "too_many");
});

test("creates named files for supported clipboard blobs", () => {
    const image = createClipboardFile(new Blob(["image"], { type: "image/png" }), 0);
    const pdf = createClipboardFile(new Blob(["pdf"], { type: "application/pdf" }), 1);
    const unsupported = createClipboardFile(new Blob(["text"], { type: "text/plain" }), 2);

    assert.equal(image?.name, "clipboard-1.png");
    assert.equal(pdf?.name, "clipboard-2.pdf");
    assert.equal(unsupported, null);
});
