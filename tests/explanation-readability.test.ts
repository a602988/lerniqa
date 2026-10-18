import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("多段解析保留段落並使用較寬鬆的閱讀樣式", async () => {
    const [page, styles] = await Promise.all([
        readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
        readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    ]);

    assert.match(page, /\.join\("\\n\\n"\)/u);
    assert.match(page, /question-review-explanation-text/u);
    assert.match(styles, /\.question-review-explanation-text[\s\S]*font-size: 1rem[\s\S]*letter-spacing: 0\.05em[\s\S]*line-height: 1\.85[\s\S]*white-space: pre-line/u);
    assert.match(styles, /\.practice-feedback-explanation[\s\S]*letter-spacing: 0\.05em[\s\S]*line-height: 1\.8[\s\S]*white-space: pre-line/u);
});
