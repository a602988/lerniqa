import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("question images share a row and wrap only when the available width is exhausted", async () => {
    const [sharedFields, practiceStyles] = await Promise.all([
        readFile(new URL("../app/components/persisted-question-fields.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/local-practice/local-practice.module.css", import.meta.url), "utf8"),
    ]);

    assert.match(sharedFields, /flex w-full flex-wrap items-start gap-3/u);
    assert.match(sharedFields, /max-h-96 max-w-full flex-none object-contain/u);
    assert.match(practiceStyles, /\.contentBlocks\s*\{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;/u);
    assert.match(practiceStyles, /\.mediaAsset\s*\{[\s\S]*width: fit-content;[\s\S]*flex: 0 1 auto;/u);
});
