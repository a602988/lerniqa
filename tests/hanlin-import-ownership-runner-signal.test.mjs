import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
    mkdtemp,
    readFile,
    rmdir,
    unlink,
    writeFile,
} from "node:fs/promises";
import test from "node:test";

import {
    createImportOwnershipSignalLifecycle,
    IMPORT_OWNERSHIP_SIGNAL_EXIT_CODES,
    ImportOwnershipSignalError,
} from "../scripts/run-hanlin-import-ownership-isolated.mjs";

const runnerUrl = new URL("../scripts/run-hanlin-import-ownership-isolated.mjs", import.meta.url);

async function pathExists(filePath) {
    try {
        await readFile(filePath);
        return true;
    }
    catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
    }
}

async function waitForPath(filePath) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        if (await pathExists(filePath)) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${filePath}`);
}

test("import ownership runner installs handled signals and awaits cleanup before choosing an exit code", async () => {
    const source = await readFile(runnerUrl, "utf8");

    assert.match(source, /SIGHUP:\s*129[\s\S]*SIGINT:\s*130[\s\S]*SIGTERM:\s*143/u);
    assert.match(source, /activeChild\.kill\(signal\)/u);
    assert.match(source, /await signalLifecycle\.cleanupOnce/u);
    assert.doesNotMatch(source, /process\.exit\(/u);
});

test("all handled signals keep their conventional exit code and forward to the active child", () => {
    for (const [signal, exitCode] of Object.entries(IMPORT_OWNERSHIP_SIGNAL_EXIT_CODES)) {
        const signalTarget = new EventEmitter();
        const signalLifecycle = createImportOwnershipSignalLifecycle(signalTarget);
        const forwardedSignals = [];
        const activeChild = {
            exitCode: null,
            signalCode: null,
            kill(forwardedSignal) {
                forwardedSignals.push(forwardedSignal);
                return true;
            },
        };

        try {
            signalLifecycle.registerActiveChild(activeChild);
            signalTarget.emit(signal);

            assert.deepEqual(forwardedSignals, [signal]);
            assert.equal(signalLifecycle.signal, signal);
            assert.equal(signalLifecycle.exitCode, exitCode);
            assert.throws(
                () => signalLifecycle.throwIfInterrupted(),
                (error) => error instanceof ImportOwnershipSignalError && error.signal === signal,
            );
        }
        finally {
            signalLifecycle.clearActiveChild(activeChild);
            signalLifecycle.dispose();
        }
    }
});

test("a signal captured in the spawn race is forwarded when the work child registers", () => {
    const signalTarget = new EventEmitter();
    const signalLifecycle = createImportOwnershipSignalLifecycle(signalTarget);
    const forwardedSignals = [];
    const lateChild = {
        exitCode: null,
        signalCode: null,
        kill(signal) {
            forwardedSignals.push(signal);
            return true;
        },
    };

    try {
        signalTarget.emit("SIGINT");
        signalLifecycle.registerActiveChild(lateChild);
        assert.deepEqual(forwardedSignals, ["SIGINT"]);
        assert.equal(signalLifecycle.exitCode, 130);
    }
    finally {
        signalLifecycle.clearActiveChild(lateChild);
        signalLifecycle.dispose();
    }
});

test("SIGTERM forwarding uses a real child while cleanup remains serialized and awaited", async () => {
    const temporaryRoot = await mkdtemp("/tmp/lerniqa-import-ownership-signal-unit.");
    const readyPath = `${temporaryRoot}/ready`;
    const signalPath = `${temporaryRoot}/signal`;
    const cleanupPath = `${temporaryRoot}/cleanup`;
    const signalTarget = new EventEmitter();
    const signalLifecycle = createImportOwnershipSignalLifecycle(signalTarget);
    const childCode = `
        const fs = require("node:fs");
        const timer = setInterval(() => {}, 1_000);
        process.on("SIGTERM", () => {
            fs.writeFileSync(${JSON.stringify(signalPath)}, "SIGTERM\\n");
            clearInterval(timer);
            process.exitCode = 0;
        });
        fs.writeFileSync(${JSON.stringify(readyPath)}, "ready\\n");
    `;
    const child = spawn(process.execPath, ["-e", childCode], {
        stdio: ["ignore", "ignore", "pipe"],
    });
    let childStderr = "";
    child.stderr.on("data", (chunk) => {
        childStderr += chunk.toString("utf8");
    });

    try {
        signalLifecycle.registerActiveChild(child);
        await waitForPath(readyPath);
        const childExit = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("signal test child did not exit")), 3_000);
            child.once("error", (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            child.once("exit", (code, signal) => {
                clearTimeout(timeout);
                resolve({ code, signal });
            });
        });

        signalTarget.emit("SIGTERM");
        assert.deepEqual(await childExit, { code: 0, signal: null }, childStderr);
        signalLifecycle.clearActiveChild(child);
        assert.equal((await readFile(signalPath, "utf8")).trim(), "SIGTERM");

        let releaseCleanup;
        const cleanupGate = new Promise((resolve) => {
            releaseCleanup = resolve;
        });
        let unexpectedCleanupCalls = 0;
        const cleanupPromise = signalLifecycle.cleanupOnce(async () => {
            await cleanupGate;
            await writeFile(cleanupPath, "cleaned\n", { mode: 0o600 });
        });
        const duplicateCleanupPromise = signalLifecycle.cleanupOnce(async () => {
            unexpectedCleanupCalls += 1;
        });
        assert.equal(cleanupPromise, duplicateCleanupPromise);
        assert.equal(await pathExists(cleanupPath), false);
        assert.equal(signalLifecycle.cleanupConfirmed, false);

        releaseCleanup();
        await cleanupPromise;
        assert.equal(unexpectedCleanupCalls, 0);
        assert.equal(signalLifecycle.cleanupConfirmed, true);
        assert.equal((await readFile(cleanupPath, "utf8")).trim(), "cleaned");
        assert.equal(signalLifecycle.exitCode, 143);
    }
    finally {
        signalLifecycle.clearActiveChild(child);
        signalLifecycle.dispose();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        for (const filePath of [cleanupPath, signalPath, readyPath]) {
            await unlink(filePath).catch(() => undefined);
        }
        await rmdir(temporaryRoot).catch(() => undefined);
    }
});

test("a signal received during a cleanup child retries the same cleanup before confirmation", async () => {
    const signalTarget = new EventEmitter();
    const signalLifecycle = createImportOwnershipSignalLifecycle(signalTarget);
    let attempts = 0;
    const forwardedSignals = [];

    try {
        await signalLifecycle.cleanupOnce(async () => {
            attempts += 1;
            if (attempts !== 1) return;
            const cleanupChild = {
                exitCode: null,
                signalCode: null,
                kill(signal) {
                    forwardedSignals.push(signal);
                    return true;
                },
            };
            signalLifecycle.registerActiveChild(cleanupChild);
            signalTarget.emit("SIGHUP");
            signalLifecycle.clearActiveChild(cleanupChild);
            throw new Error("simulated interrupted cleanup command");
        });

        assert.deepEqual(forwardedSignals, ["SIGHUP"]);
        assert.equal(attempts, 2);
        assert.equal(signalLifecycle.cleanupConfirmed, true);
        assert.equal(signalLifecycle.exitCode, 129);
    }
    finally {
        signalLifecycle.dispose();
    }
});
