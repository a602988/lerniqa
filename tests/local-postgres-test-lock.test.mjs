import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    chmod,
    lstat,
    mkdir,
    readFile,
    realpath,
    rmdir,
    unlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    acquireLocalPostgresTestLock,
    LocalPostgresTestLockError,
    releaseLocalPostgresTestLock,
    runLocalPostgresTestCommand,
    verifyLocalPostgresTestLockProof,
} from "../scripts/with-local-postgres-test-lock.mjs";

const canonicalTempDirectory = await realpath("/tmp");

function uniqueLockDirectory() {
    return path.join(
        canonicalTempDirectory,
        `lerniqa-postgres-test-runner.${randomUUID().replaceAll("-", "")}.lock`,
    );
}

async function pathExists(target) {
    return (await lstat(target).catch(() => null)) !== null;
}

async function waitForPath(target, timeoutMilliseconds = 5_000) {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
        if (await pathExists(target)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${target}`);
}

test("lock acquisition is atomic and a competing runner fails closed", async () => {
    const lockDirectory = uniqueLockDirectory();
    const attempts = await Promise.allSettled([
        acquireLocalPostgresTestLock({ lockDirectory, command: "atomic-first" }),
        acquireLocalPostgresTestLock({ lockDirectory, command: "atomic-second" }),
    ]);
    const acquired = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");

    assert.equal(acquired.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof LocalPostgresTestLockError);
    assert.equal(rejected[0].reason.code, "LOCAL_POSTGRES_TEST_LOCKED");
    assert.equal(await pathExists(lockDirectory), true);

    await releaseLocalPostgresTestLock(acquired[0].value);
    assert.equal(await pathExists(lockDirectory), false);
});

test("an existing stale lock is preserved instead of auto-removed", async () => {
    const lockDirectory = uniqueLockDirectory();
    const markerPath = path.join(lockDirectory, "owner.json");
    await mkdir(lockDirectory, { mode: 0o700 });
    await chmod(lockDirectory, 0o700);
    await writeFile(markerPath, `${JSON.stringify({
        version: 1,
        token: randomUUID(),
        pid: 999_999,
        command: "stale-test-runner",
        createdAt: new Date(0).toISOString(),
    })}\n`, { mode: 0o600 });
    await chmod(markerPath, 0o600);

    await assert.rejects(
        acquireLocalPostgresTestLock({ lockDirectory, command: "must-not-steal" }),
        (error) => error instanceof LocalPostgresTestLockError
            && error.code === "LOCAL_POSTGRES_TEST_LOCKED",
    );
    assert.equal(await pathExists(markerPath), true);

    await unlink(markerPath);
    await rmdir(lockDirectory);
});

test("release preserves a lock whose ownership token changed", async () => {
    const lockDirectory = uniqueLockDirectory();
    const lock = await acquireLocalPostgresTestLock({ lockDirectory, command: "token-test" });
    const originalMarker = await readFile(lock.markerPath, "utf8");
    const changedOwner = { ...JSON.parse(originalMarker), token: randomUUID() };
    await writeFile(lock.markerPath, `${JSON.stringify(changedOwner)}\n`, { mode: 0o600 });
    await chmod(lock.markerPath, 0o600);

    await assert.rejects(
        releaseLocalPostgresTestLock(lock),
        (error) => error instanceof LocalPostgresTestLockError
            && error.code === "TEST_LOCK_OWNERSHIP_MISMATCH",
    );
    assert.equal(await pathExists(lock.lockDirectory), true);

    await writeFile(lock.markerPath, originalMarker, { mode: 0o600 });
    await chmod(lock.markerPath, 0o600);
    await releaseLocalPostgresTestLock(lock);
    assert.equal(await pathExists(lockDirectory), false);
});

test("release refuses unexpected lock contents and removes only its marker", async () => {
    const lockDirectory = uniqueLockDirectory();
    const lock = await acquireLocalPostgresTestLock({ lockDirectory, command: "content-test" });
    const unexpectedPath = path.join(lockDirectory, "unexpected");
    await writeFile(unexpectedPath, "do not delete\n", { mode: 0o600 });

    await assert.rejects(
        releaseLocalPostgresTestLock(lock),
        (error) => error instanceof LocalPostgresTestLockError
            && error.code === "TEST_LOCK_CONTENT_MISMATCH",
    );
    assert.equal(await pathExists(unexpectedPath), true);
    assert.equal(await pathExists(lock.markerPath), true);

    await unlink(unexpectedPath);
    await releaseLocalPostgresTestLock(lock);
    assert.equal(await pathExists(lockDirectory), false);
});

test("a child proof must match the canonical marker token and wrapper PID", async () => {
    const lockDirectory = uniqueLockDirectory();
    const lock = await acquireLocalPostgresTestLock({ lockDirectory, command: "proof-test" });
    const environment = {
        LERNIQA_POSTGRES_TEST_LOCK_DIRECTORY: lock.lockDirectory,
        LERNIQA_POSTGRES_TEST_LOCK_TOKEN: lock.token,
        LERNIQA_POSTGRES_TEST_LOCK_WRAPPER_PID: String(lock.pid),
    };

    try {
        assert.deepEqual(
            await verifyLocalPostgresTestLockProof({ environment, expectedLockDirectory: lockDirectory }),
            {
                lockDirectory,
                token: lock.token,
                wrapperPid: lock.pid,
            },
        );
        await assert.rejects(
            verifyLocalPostgresTestLockProof({
                environment: {
                    ...environment,
                    LERNIQA_POSTGRES_TEST_LOCK_TOKEN: randomUUID(),
                },
                expectedLockDirectory: lockDirectory,
            }),
            (error) => error instanceof LocalPostgresTestLockError
                && error.code === "TEST_LOCK_PROOF_OWNERSHIP_MISMATCH",
        );
        await assert.rejects(
            verifyLocalPostgresTestLockProof({
                environment: {
                    ...environment,
                    LERNIQA_POSTGRES_TEST_LOCK_WRAPPER_PID: String(lock.pid + 1),
                },
                expectedLockDirectory: lockDirectory,
            }),
            (error) => error instanceof LocalPostgresTestLockError
                && error.code === "TEST_LOCK_PROOF_OWNERSHIP_MISMATCH",
        );
    }
    finally {
        await releaseLocalPostgresTestLock(lock);
    }
});

test("the wrapper gives its direct child a verifiable lock proof", async () => {
    const lockDirectory = uniqueLockDirectory();
    const moduleUrl = new URL("../scripts/with-local-postgres-test-lock.mjs", import.meta.url).href;
    const childCode = `
        import { verifyLocalPostgresTestLockProof } from ${JSON.stringify(moduleUrl)};
        await verifyLocalPostgresTestLockProof({
            expectedLockDirectory: process.env.LERNIQA_POSTGRES_TEST_LOCK_DIRECTORY,
        });
    `;
    const exitCode = await runLocalPostgresTestCommand({
        command: process.execPath,
        args: ["--input-type=module", "-e", childCode],
        lockDirectory,
    });

    assert.equal(exitCode, 0);
    assert.equal(await pathExists(lockDirectory), false);
});

test("the child-proof CLI fails closed when invoked without wrapper proof", async () => {
    const wrapperPath = fileURLToPath(
        new URL("../scripts/with-local-postgres-test-lock.mjs", import.meta.url),
    );
    const environment = { ...process.env };
    delete environment.LERNIQA_POSTGRES_TEST_LOCK_DIRECTORY;
    delete environment.LERNIQA_POSTGRES_TEST_LOCK_TOKEN;
    delete environment.LERNIQA_POSTGRES_TEST_LOCK_WRAPPER_PID;
    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [wrapperPath, "--verify-child-proof"], {
            env: environment,
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /INVALID_TEST_LOCK_PROOF/u);
});

test("the migration shell fails closed before direct invocation can do work", async () => {
    const runnerPath = fileURLToPath(
        new URL("../scripts/verify-database-migrations.sh", import.meta.url),
    );
    const environment = { ...process.env };
    delete environment.LERNIQA_POSTGRES_TEST_LOCK_DIRECTORY;
    delete environment.LERNIQA_POSTGRES_TEST_LOCK_TOKEN;
    delete environment.LERNIQA_POSTGRES_TEST_LOCK_WRAPPER_PID;
    const result = await new Promise((resolve, reject) => {
        const child = spawn("sh", [runnerPath], {
            env: environment,
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /INVALID_TEST_LOCK_PROOF/u);
    assert.match(result.stderr, /必須透過受鎖定的 npm run db:test/u);
});

test("SIGTERM is forwarded and the owned lock is released after the child exits", async () => {
    const lockDirectory = uniqueLockDirectory();
    const readyPath = path.join(
        canonicalTempDirectory,
        `lerniqa-postgres-test-runner-ready.${randomUUID().replaceAll("-", "")}`,
    );
    const moduleUrl = new URL("../scripts/with-local-postgres-test-lock.mjs", import.meta.url).href;
    const childCode = `
        import { runLocalPostgresTestCommand } from ${JSON.stringify(moduleUrl)};
        process.exitCode = await runLocalPostgresTestCommand({
            command: process.execPath,
            args: ["-e", ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready\\n"); setTimeout(() => process.exit(0), 10000);`)}],
            lockDirectory: ${JSON.stringify(lockDirectory)},
        });
    `;
    const wrapper = spawn(process.execPath, ["--input-type=module", "-e", childCode], {
        stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    wrapper.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
    });

    try {
        await waitForPath(readyPath);
        assert.equal(await pathExists(path.join(lockDirectory, "owner.json")), true);
        const exitPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("wrapper did not exit after SIGTERM")), 5_000);
            wrapper.once("error", (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            wrapper.once("exit", (code, signal) => {
                clearTimeout(timeout);
                resolve({ code, signal });
            });
        });
        wrapper.kill("SIGTERM");
        const result = await exitPromise;
        assert.deepEqual(result, { code: 143, signal: null }, stderr);
        assert.equal(await pathExists(lockDirectory), false);
    }
    finally {
        if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill("SIGKILL");
        await unlink(readyPath).catch(() => undefined);
        const markerPath = path.join(lockDirectory, "owner.json");
        await unlink(markerPath).catch(() => undefined);
        await rmdir(lockDirectory).catch(() => undefined);
    }
});

test("the exported command runner accepts only string commands and arguments", async () => {
    await assert.rejects(
        runLocalPostgresTestCommand({ command: "", args: [] }),
        (error) => error instanceof LocalPostgresTestLockError
            && error.code === "INVALID_TEST_LOCK_COMMAND",
    );
    await assert.rejects(
        runLocalPostgresTestCommand({ command: process.execPath, args: [null] }),
        (error) => error instanceof LocalPostgresTestLockError
            && error.code === "INVALID_TEST_LOCK_COMMAND",
    );
});

test("a nonzero child exit code is preserved after releasing the lock", async () => {
    const lockDirectory = uniqueLockDirectory();
    const exitCode = await runLocalPostgresTestCommand({
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        lockDirectory,
    });
    assert.equal(exitCode, 7);
    assert.equal(await pathExists(lockDirectory), false);
});
