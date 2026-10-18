import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolvePracticeReturnDestination } from "../app/lib/practice-return-navigation.ts";

test("a practice opened from question overview returns to the same question", () => {
    assert.deepEqual(
        resolvePracticeReturnDestination({ kind: "question", questionId: 41841564556775 }, "practice"),
        { section: "questions", path: "/questions/41841564556775" },
    );
});

test("sessions without an explicit origin retain their existing section return behavior", () => {
    assert.deepEqual(resolvePracticeReturnDestination(undefined, "practice"), {
        section: "practice",
        path: "/practice",
    });
    assert.deepEqual(resolvePracticeReturnDestination(undefined, "review"), {
        section: "mistakes",
        path: "/mistakes",
    });
});

test("question overview practice and every exit action use the session return target", async () => {
    const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
    assert.match(source, /onStartPractice=\{\(\) => void beginSession\("practice", \[selectedOverviewQuestion\.id\][\s\S]*\{ kind: "question", questionId: selectedOverviewQuestion\.id \}\)\}/u);
    assert.equal(source.match(/resolvePracticeReturnDestination\(session\.returnTarget, session\.mode\)/gu)?.length, 2);
    assert.match(source, /resolvePracticeReturnDestination\(session\?\.returnTarget, session\?\.mode \?\? "practice"\)/u);
});
