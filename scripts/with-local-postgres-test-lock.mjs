#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    chmod,
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rmdir,
    unlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_DIRECTORY_PATTERN = /^lerniqa-postgres-test-runner(?:\.[A-Za-z0-9_-]+)?\.lock$/u;
const LOCK_MARKER_FILE = "owner.json";
const LOCK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });
const CHILD_PROOF_DIRECTORY_VARIABLE = "LERNIQA_POSTGRES_TEST_LOCK_DIRECTORY";
const CHILD_PROOF_TOKEN_VARIABLE = "LERNIQA_POSTGRES_TEST_LOCK_TOKEN";
const CHILD_PROOF_WRAPPER_PID_VARIABLE = "LERNIQA_POSTGRES_TEST_LOCK_WRAPPER_PID";
const CANONICAL_TEMP_DIRECTORY = await realpath("/tmp");

export const LOCAL_POSTGRES_TEST_LOCK_DIRECTORY = path.join(
    CANONICAL_TEMP_DIRECTORY,
    "lerniqa-postgres-test-runner.lock",
);

export class LocalPostgresTestLockError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = "LocalPostgresTestLockError";
        this.code = code;
        this.details = details;
    }
}

function lockError(code, message, details = undefined) {
    return new LocalPostgresTestLockError(code, message, details);
}

async function validateLockLocation(lockDirectory) {
    if (typeof lockDirectory !== "string"
        || !path.isAbsolute(lockDirectory)
        || path.resolve(lockDirectory) !== lockDirectory
        || !LOCK_DIRECTORY_PATTERN.test(path.basename(lockDirectory))) {
        throw lockError("INVALID_TEST_LOCK_PATH", "PostgreSQL test lock 必須是 canonical /tmp 直屬安全路徑。");
    }
    const canonicalParent = await realpath(path.dirname(lockDirectory)).catch(() => null);
    if (canonicalParent !== CANONICAL_TEMP_DIRECTORY) {
        throw lockError("INVALID_TEST_LOCK_PATH", "PostgreSQL test lock 必須位於 canonical /tmp 直屬目錄。");
    }
    return lockDirectory;
}

async function validatePrivateDirectory(lockDirectory) {
    const metadata = await lstat(lockDirectory).catch(() => null);
    const canonical = await realpath(lockDirectory).catch(() => null);
    const currentUserId = typeof process.getuid === "function" ? process.getuid() : null;
    if (metadata === null
        || !metadata.isDirectory()
        || metadata.isSymbolicLink()
        || canonical !== lockDirectory
        || (metadata.mode & 0o777) !== 0o700
        || (currentUserId !== null && metadata.uid !== currentUserId)) {
        throw lockError(
            "INVALID_TEST_LOCK_DIRECTORY",
            "PostgreSQL test lock 不是目前使用者擁有的 0700 真實目錄；拒絕使用或清理。",
            { lockDirectory },
        );
    }
}

async function readLockOwner(lockDirectory) {
    const markerPath = path.join(lockDirectory, LOCK_MARKER_FILE);
    const metadata = await lstat(markerPath).catch(() => null);
    const canonical = await realpath(markerPath).catch(() => null);
    const currentUserId = typeof process.getuid === "function" ? process.getuid() : null;
    if (metadata === null
        || !metadata.isFile()
        || metadata.isSymbolicLink()
        || canonical !== markerPath
        || metadata.size > 4_096
        || (metadata.mode & 0o777) !== 0o600
        || (currentUserId !== null && metadata.uid !== currentUserId)) {
        throw lockError(
            "INVALID_TEST_LOCK_MARKER",
            "PostgreSQL test lock marker 不符合 0600 一般檔案規則；拒絕清理。",
            { lockDirectory },
        );
    }
    let owner;
    try {
        owner = JSON.parse(await readFile(markerPath, "utf8"));
    }
    catch {
        throw lockError(
            "INVALID_TEST_LOCK_MARKER",
            "PostgreSQL test lock marker 不是有效 JSON；視為 stale 並 fail-closed。",
            { lockDirectory },
        );
    }
    if (owner?.version !== 1
        || !Number.isSafeInteger(owner.pid)
        || owner.pid < 1
        || typeof owner.command !== "string"
        || owner.command.trim() === ""
        || typeof owner.createdAt !== "string"
        || !Number.isFinite(Date.parse(owner.createdAt))
        || typeof owner.token !== "string"
        || !LOCK_TOKEN_PATTERN.test(owner.token)) {
        throw lockError(
            "INVALID_TEST_LOCK_MARKER",
            "PostgreSQL test lock marker 欄位不完整；視為 stale 並 fail-closed。",
            { lockDirectory },
        );
    }
    return owner;
}

async function rollbackIncompleteAcquisition(lockDirectory, token) {
    try {
        await validatePrivateDirectory(lockDirectory);
        const entries = await readdir(lockDirectory);
        if (entries.length === 0) {
            await rmdir(lockDirectory);
            return;
        }
        if (entries.length !== 1 || entries[0] !== LOCK_MARKER_FILE) return;
        const owner = await readLockOwner(lockDirectory);
        if (owner.token !== token || owner.pid !== process.pid) return;
        await unlink(path.join(lockDirectory, LOCK_MARKER_FILE));
        await rmdir(lockDirectory);
    }
    catch {
        // Acquisition failed before ownership could be proven. Preserve the
        // lock fail-closed for manual inspection instead of broad cleanup.
    }
}

export async function acquireLocalPostgresTestLock({
    lockDirectory = LOCAL_POSTGRES_TEST_LOCK_DIRECTORY,
    command = "local-postgres-test",
} = {}) {
    const safeLockDirectory = await validateLockLocation(lockDirectory);
    const token = randomUUID();
    try {
        await mkdir(safeLockDirectory, { mode: 0o700 });
    }
    catch (error) {
        if (error?.code === "EEXIST") {
            throw lockError(
                "LOCAL_POSTGRES_TEST_LOCKED",
                "另一個 PostgreSQL integration runner 已持有鎖；existing 或 stale lock 都不會自動移除。",
                { lockDirectory: safeLockDirectory },
            );
        }
        throw error;
    }

    try {
        await chmod(safeLockDirectory, 0o700);
        await validatePrivateDirectory(safeLockDirectory);
        const markerPath = path.join(safeLockDirectory, LOCK_MARKER_FILE);
        const owner = {
            version: 1,
            token,
            pid: process.pid,
            command: String(command).slice(0, 200),
            createdAt: new Date().toISOString(),
        };
        await writeFile(markerPath, `${JSON.stringify(owner)}\n`, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
        });
        await chmod(markerPath, 0o600);
        const persistedOwner = await readLockOwner(safeLockDirectory);
        if (persistedOwner.token !== token || persistedOwner.pid !== process.pid) {
            throw lockError(
                "TEST_LOCK_OWNERSHIP_MISMATCH",
                "PostgreSQL test lock marker 無法證明屬於本次程序。",
                { lockDirectory: safeLockDirectory },
            );
        }
        return Object.freeze({
            lockDirectory: safeLockDirectory,
            markerPath,
            token,
            pid: process.pid,
        });
    }
    catch (error) {
        await rollbackIncompleteAcquisition(safeLockDirectory, token);
        throw error;
    }
}

export async function releaseLocalPostgresTestLock(lock) {
    if (lock === null
        || typeof lock !== "object"
        || typeof lock.lockDirectory !== "string"
        || typeof lock.markerPath !== "string"
        || typeof lock.token !== "string"
        || lock.pid !== process.pid) {
        throw lockError("INVALID_TEST_LOCK_HANDLE", "PostgreSQL test lock handle 無效；拒絕清理。");
    }
    const safeLockDirectory = await validateLockLocation(lock.lockDirectory);
    if (lock.markerPath !== path.join(safeLockDirectory, LOCK_MARKER_FILE)) {
        throw lockError("INVALID_TEST_LOCK_HANDLE", "PostgreSQL test lock marker path 不符；拒絕清理。");
    }
    await validatePrivateDirectory(safeLockDirectory);
    const owner = await readLockOwner(safeLockDirectory);
    if (owner.token !== lock.token || owner.pid !== lock.pid) {
        throw lockError(
            "TEST_LOCK_OWNERSHIP_MISMATCH",
            "PostgreSQL test lock token 不符；保留 lock 並拒絕清理。",
            { lockDirectory: safeLockDirectory },
        );
    }
    const entries = await readdir(safeLockDirectory);
    if (entries.length !== 1 || entries[0] !== LOCK_MARKER_FILE) {
        throw lockError(
            "TEST_LOCK_CONTENT_MISMATCH",
            "PostgreSQL test lock 內含非本次建立的檔案；保留 lock 並拒絕清理。",
            { lockDirectory: safeLockDirectory },
        );
    }
    await unlink(lock.markerPath);
    await rmdir(safeLockDirectory);
}

export async function verifyLocalPostgresTestLockProof({
    environment = process.env,
    expectedLockDirectory = LOCAL_POSTGRES_TEST_LOCK_DIRECTORY,
    requireDirectParent = false,
} = {}) {
    const safeExpectedLockDirectory = await validateLockLocation(expectedLockDirectory);
    const proofLockDirectory = environment?.[CHILD_PROOF_DIRECTORY_VARIABLE];
    const proofToken = environment?.[CHILD_PROOF_TOKEN_VARIABLE];
    const proofWrapperPid = environment?.[CHILD_PROOF_WRAPPER_PID_VARIABLE];

    if (proofLockDirectory !== safeExpectedLockDirectory) {
        throw lockError(
            "INVALID_TEST_LOCK_PROOF",
            "PostgreSQL test child lock directory proof 不符；拒絕直接執行 runner。",
        );
    }
    if (typeof proofToken !== "string" || !LOCK_TOKEN_PATTERN.test(proofToken)) {
        throw lockError(
            "INVALID_TEST_LOCK_PROOF",
            "PostgreSQL test child lock token proof 無效；拒絕直接執行 runner。",
        );
    }
    if (typeof proofWrapperPid !== "string" || !/^[1-9][0-9]*$/u.test(proofWrapperPid)) {
        throw lockError(
            "INVALID_TEST_LOCK_PROOF",
            "PostgreSQL test child wrapper PID proof 無效；拒絕直接執行 runner。",
        );
    }
    const parsedWrapperPid = Number(proofWrapperPid);
    if (!Number.isSafeInteger(parsedWrapperPid)) {
        throw lockError(
            "INVALID_TEST_LOCK_PROOF",
            "PostgreSQL test child wrapper PID proof 超出安全整數範圍。",
        );
    }
    if (requireDirectParent && process.ppid !== parsedWrapperPid) {
        throw lockError(
            "TEST_LOCK_PROOF_PARENT_MISMATCH",
            "PostgreSQL test runner 不是 lock wrapper 的直接 child；拒絕執行。",
        );
    }

    await validatePrivateDirectory(safeExpectedLockDirectory);
    const entries = await readdir(safeExpectedLockDirectory);
    if (entries.length !== 1 || entries[0] !== LOCK_MARKER_FILE) {
        throw lockError(
            "INVALID_TEST_LOCK_PROOF",
            "PostgreSQL test child proof 目錄不只包含 canonical ownership marker。",
            { lockDirectory: safeExpectedLockDirectory },
        );
    }
    const owner = await readLockOwner(safeExpectedLockDirectory);
    if (owner.token !== proofToken || owner.pid !== parsedWrapperPid) {
        throw lockError(
            "TEST_LOCK_PROOF_OWNERSHIP_MISMATCH",
            "PostgreSQL test child proof 與 canonical ownership marker 不符。",
            { lockDirectory: safeExpectedLockDirectory },
        );
    }
    return Object.freeze({
        lockDirectory: safeExpectedLockDirectory,
        token: proofToken,
        wrapperPid: parsedWrapperPid,
    });
}

function runChild(command, args, signalState, lock) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                [CHILD_PROOF_DIRECTORY_VARIABLE]: lock.lockDirectory,
                [CHILD_PROOF_TOKEN_VARIABLE]: lock.token,
                [CHILD_PROOF_WRAPPER_PID_VARIABLE]: String(lock.pid),
            },
            shell: false,
            stdio: "inherit",
        });
        signalState.child = child;
        let settled = false;
        const finish = (callback) => {
            if (settled) return;
            settled = true;
            if (signalState.child === child) signalState.child = null;
            callback();
        };
        child.once("error", (error) => finish(() => reject(error)));
        child.once("exit", (code, signal) => finish(() => resolve({ code, signal })));
        if (signalState.signal !== null) child.kill(signalState.signal);
    });
}

export async function runLocalPostgresTestCommand({
    command,
    args = [],
    lockDirectory = LOCAL_POSTGRES_TEST_LOCK_DIRECTORY,
} = {}) {
    if (typeof command !== "string"
        || command.trim() === ""
        || command.includes("\0")
        || !Array.isArray(args)
        || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
        throw lockError("INVALID_TEST_LOCK_COMMAND", "PostgreSQL test runner command 或參數無效。");
    }
    const signalState = { child: null, signal: null, exitCode: 0 };
    const signalHandlers = new Map();
    for (const [signal, exitCode] of Object.entries(SIGNAL_EXIT_CODES)) {
        const handler = () => {
            // The first signal owns shutdown. A later signal must not be
            // forwarded into the child's serialized database cleanup.
            if (signalState.signal !== null) return;
            signalState.signal = signal;
            signalState.exitCode = exitCode;
            if (signalState.child !== null
                && signalState.child.exitCode === null
                && signalState.child.signalCode === null) {
                signalState.child.kill(signal);
            }
        };
        signalHandlers.set(signal, handler);
        process.on(signal, handler);
    }

    let lock = null;
    let commandExitCode = 1;
    try {
        lock = await acquireLocalPostgresTestLock({
            lockDirectory,
            command: [path.basename(command), ...args].join(" "),
        });
        if (signalState.signal === null) {
            const result = await runChild(command, args, signalState, lock);
            commandExitCode = result.code ?? 1;
        }
    }
    finally {
        try {
            if (lock !== null) await releaseLocalPostgresTestLock(lock);
        }
        finally {
            for (const [signal, handler] of signalHandlers) process.off(signal, handler);
        }
    }
    return signalState.signal === null ? commandExitCode : signalState.exitCode;
}

async function main() {
    if (process.argv[2] === "--verify-child-proof" && process.argv.length === 3) {
        await verifyLocalPostgresTestLockProof();
        return 0;
    }
    if (process.argv[2] !== "--" || process.argv.length < 4) {
        throw lockError(
            "INVALID_TEST_LOCK_COMMAND",
            "用法：node scripts/with-local-postgres-test-lock.mjs -- <command> [args...]，或 --verify-child-proof",
        );
    }
    return runLocalPostgresTestCommand({
        command: process.argv[3],
        args: process.argv.slice(4),
    });
}

const isEntrypoint = typeof process.argv[1] === "string"
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
    try {
        process.exitCode = await main();
    }
    catch (error) {
        process.stderr.write(`${JSON.stringify({
            ok: false,
            code: error?.code ?? "LOCAL_POSTGRES_TEST_LOCK_FAILED",
            message: error instanceof Error ? error.message : "PostgreSQL test lock 執行失敗。",
            details: error?.details,
        })}\n`);
        process.exitCode = 1;
    }
}
