import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = await readFile(
    path.join(repositoryRoot, "scripts", "run-local-practice-isolated.mjs"),
    "utf8",
);

test("Next spawn errors return through the runner cleanup path", () => {
    const startNextStart = runner.indexOf("async function startNext(");
    const startNextEnd = runner.indexOf("\nasync function runVerifier(", startNextStart);
    const startNext = runner.slice(startNextStart, startNextEnd);
    const spawn = startNext.indexOf("const child = spawn(");
    const errorListener = startNext.indexOf('child.once("error"');
    const failureCheck = startNext.indexOf("if (processFailure !== null) throw processFailure;");
    const waitSignal = startNext.lastIndexOf("processFailureSignal");
    const mainCatch = runner.lastIndexOf("catch (error) {");
    const cleanupFromCatch = runner.indexOf("await cleanup(cleanupContext.clusterDirectory", mainCatch);

    assert.notEqual(startNextStart, -1);
    assert.notEqual(startNextEnd, -1);
    assert.ok(spawn >= 0 && errorListener > spawn, "startNext must observe the spawned child's error event");
    assert.ok(failureCheck > errorListener, "startNext must throw the observed child error");
    assert.ok(waitSignal > errorListener, "the readiness loop must wake immediately on a child error");
    assert.match(startNext, /processFailure = nextSpawnError\(error\)/u);
    assert.match(startNext, /child\.pid === undefined[\s\S]*nextProcess = null/u);
    assert.ok(mainCatch >= 0 && cleanupFromCatch > mainCatch, "main must clean up after startNext rejects");
});
