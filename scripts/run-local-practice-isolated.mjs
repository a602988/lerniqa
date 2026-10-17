#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    chmod,
    cp,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyLocalPostgresTestLockProof } from "./with-local-postgres-test-lock.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_TEMP_DIRECTORY = "/tmp";
const TEMP_PREFIX = "lerniqa-practice-test.";
const ROOT_PATTERN = /^lerniqa-practice-test\.[A-Za-z0-9_-]+$/u;
const MARKER_FILE = ".lerniqa-isolated-practice-test";
const DATABASE_PORT = 55_432;
const MAX_LOG_CHARACTERS = 64 * 1024;
const EXISTING_SERVER_ENVIRONMENT = "LERNIQA_PRACTICE_TEST_EXISTING";
const EXISTING_SOCKET_ENVIRONMENT = "LERNIQA_PRACTICE_TEST_SOCKET";
const EXISTING_PORT_ENVIRONMENT = "LERNIQA_PRACTICE_TEST_PORT";
const EXISTING_DATA_DIRECTORY_ENVIRONMENT = "LERNIQA_PRACTICE_TEST_DATA_DIRECTORY";
const DATABASE_OWNERSHIP_COMMENT_PREFIX = "lerniqa-isolated-practice-test:";

let testRoot = null;
let isolationToken = null;
let postgresStartAttempted = false;
let nextProcess = null;
let nextLog = "";
let activeCleanup = null;
let borrowedExistingServer = false;
let ownedExistingDatabase = null;
let activeCommandProcess = null;

function appendLog(current, chunk) {
    const combined = `${current}${chunk}`;
    return combined.length <= MAX_LOG_CHARACTERS
        ? combined
        : combined.slice(combined.length - MAX_LOG_CHARACTERS);
}

function commandError(command, args, code, stderr) {
    const error = new Error(`${path.basename(command)} 執行失敗（exit ${code ?? "unknown"}）。`);
    error.code = "ISOLATED_COMMAND_FAILED";
    error.details = {
        command: path.basename(command),
        arguments: args.filter((argument) => !String(argument).includes(isolationToken ?? "__never__")),
        stderr: stderr.trim().slice(-4_000),
    };
    return error;
}

function nextSpawnError(error) {
    const cause = error instanceof Error ? error : new Error("unknown child process error");
    const failure = new Error(`隔離 Next server 無法啟動：${cause.message}`, { cause });
    failure.code = "ISOLATED_NEXT_SPAWN_FAILED";
    failure.details = {
        childCode: typeof cause.code === "string" ? cause.code : undefined,
        syscall: typeof cause.syscall === "string" ? cause.syscall : undefined,
        path: typeof cause.path === "string" ? path.basename(cause.path) : undefined,
    };
    return failure;
}

function shutdownError() {
    const error = new Error("收到中止訊號，停止建立新的隔離測試資源並進入序列化清理。");
    error.code = "ISOLATED_SHUTDOWN_REQUESTED";
    return error;
}

async function run(command, args, options = {}) {
    return await new Promise((resolve, reject) => {
        if (exitCode !== 0 && activeCleanup === null) {
            reject(shutdownError());
            return;
        }
        if (activeCommandProcess !== null) {
            reject(new Error("隔離 runner 不允許重疊執行一般 child command。"));
            return;
        }
        const child = spawn(command, args, {
            cwd: options.cwd ?? REPOSITORY_ROOT,
            env: options.env ?? process.env,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        activeCommandProcess = child;
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout = appendLog(stdout, chunk.toString("utf8"));
        });
        child.stderr.on("data", (chunk) => {
            stderr = appendLog(stderr, chunk.toString("utf8"));
        });
        child.once("error", (error) => {
            if (activeCommandProcess === child) activeCommandProcess = null;
            reject(error);
        });
        child.once("exit", (code, signal) => {
            if (activeCommandProcess === child) activeCommandProcess = null;
            if (exitCode !== 0 && activeCleanup === null) reject(shutdownError());
            else if (code === 0 || options.rejectOnFailure === false) resolve({ code, signal, stdout, stderr });
            else reject(commandError(command, args, code ?? signal, stderr || stdout));
        });
    });
}

function isolatedEnvironment(databaseName, socketDirectory, databasePort, existingServerConfig = null) {
    const environment = {};
    for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"]) {
        if (typeof process.env[name] === "string") environment[name] = process.env[name];
    }
    return {
        ...environment,
        TMPDIR: TEST_TEMP_DIRECTORY,
        NEXT_TELEMETRY_DISABLED: "1",
        PSQLRC: "/dev/null",
        PGAPPNAME: "lerniqa-isolated-practice-test",
        PGCONNECT_TIMEOUT: "5",
        PGSSLMODE: "disable",
        LOCAL_PG_SOCKET: socketDirectory,
        LOCAL_PG_PORT: String(databasePort),
        LOCAL_PG_DATABASE: databaseName,
        LOCAL_PG_USER: os.userInfo().username,
        // Recovery request E2E needs a configured adapter to reach the
        // enumeration-safe accepted response.  Point it at a closed loopback
        // port with synthetic credentials: no real SMTP service or recipient
        // is contacted, and the application must cancel the undelivered token.
        LERNIQA_MAIL_SMTP_HOST: "127.0.0.1",
        LERNIQA_MAIL_SMTP_PORT: "1",
        LERNIQA_MAIL_SMTP_SECURE: "false",
        LERNIQA_MAIL_SMTP_USER: "isolated-test",
        LERNIQA_MAIL_SMTP_PASSWORD: isolationToken,
        LERNIQA_MAIL_FROM_NAME: "Lerniqa isolated test",
        LERNIQA_MAIL_FROM_ADDRESS: "no-reply@lerniqa.invalid",
        LERNIQA_ISOLATED_TEST_ROOT: testRoot,
        LERNIQA_ISOLATED_TEST_TOKEN: isolationToken,
        LERNIQA_PRACTICE_TEST_EXISTING: existingServerConfig ? "1" : "0",
        ...(existingServerConfig ? {
            LERNIQA_PRACTICE_TEST_SOCKET: existingServerConfig.socketDirectory,
            LERNIQA_PRACTICE_TEST_PORT: String(existingServerConfig.port),
            LERNIQA_PRACTICE_TEST_DATA_DIRECTORY: existingServerConfig.dataDirectory,
        } : {}),
        VERIFY_CATALOG_PROFILE: "synthetic-import",
    };
}

function requiredEnvironment(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} 不可為空，且 existing-local-server 模式必須明確提供。`);
    return value;
}

function existingServerModeEnabled() {
    const value = process.env[EXISTING_SERVER_ENVIRONMENT]?.trim() ?? "0";
    if (!["0", "1"].includes(value)) {
        throw new Error(`${EXISTING_SERVER_ENVIRONMENT} 只接受 0 或 1。`);
    }
    return value === "1";
}

function parseDatabasePort(raw, environmentName) {
    if (!/^\d+$/u.test(raw)) throw new Error(`${environmentName} 必須是 1 到 65535 的整數。`);
    const port = Number(raw);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`${environmentName} 必須是 1 到 65535 的整數。`);
    }
    return port;
}

async function resolveExistingServerConfig() {
    if (!existingServerModeEnabled()) return null;

    const configuredSocket = requiredEnvironment(EXISTING_SOCKET_ENVIRONMENT);
    if (!path.isAbsolute(configuredSocket)) {
        throw new Error(`${EXISTING_SOCKET_ENVIRONMENT} 必須是絕對 Unix socket 目錄。`);
    }
    const socketDirectory = await realpath(configuredSocket).catch(() => null);
    if (socketDirectory === null || !(await lstat(socketDirectory)).isDirectory()) {
        throw new Error(`找不到 existing-local-server Unix socket 目錄：${configuredSocket}`);
    }

    const port = parseDatabasePort(
        requiredEnvironment(EXISTING_PORT_ENVIRONMENT),
        EXISTING_PORT_ENVIRONMENT,
    );
    const configuredDataDirectory = requiredEnvironment(EXISTING_DATA_DIRECTORY_ENVIRONMENT);
    if (!path.isAbsolute(configuredDataDirectory)) {
        throw new Error(`${EXISTING_DATA_DIRECTORY_ENVIRONMENT} 必須是絕對路徑。`);
    }
    const dataDirectory = await realpath(configuredDataDirectory).catch(() => null);
    if (dataDirectory === null || !(await lstat(dataDirectory)).isDirectory()) {
        throw new Error(`找不到 existing-local-server data_directory：${configuredDataDirectory}`);
    }

    return { socketDirectory, port, dataDirectory };
}

async function assertSafeRoot() {
    if (testRoot === null || isolationToken === null) throw new Error("隔離測試根目錄尚未建立。");
    const metadata = await lstat(testRoot);
    if (!metadata.isDirectory()
        || metadata.isSymbolicLink()
        || (metadata.mode & 0o077) !== 0
        || !ROOT_PATTERN.test(path.basename(testRoot))) {
        throw new Error("拒絕清理不符合安全規則的隔離測試目錄。");
    }
    const canonicalRoot = await realpath(testRoot);
    const canonicalTemp = await realpath(TEST_TEMP_DIRECTORY);
    if (canonicalRoot !== testRoot || path.dirname(canonicalRoot) !== canonicalTemp) {
        throw new Error("隔離測試目錄不在 canonical 暫存目錄內。");
    }
    const markerPath = path.join(testRoot, MARKER_FILE);
    const markerMetadata = await lstat(markerPath);
    if (!markerMetadata.isFile()
        || markerMetadata.isSymbolicLink()
        || (markerMetadata.mode & 0o077) !== 0) {
        throw new Error("隔離測試 marker 不是私有一般檔案。");
    }
    const marker = await readFile(markerPath, "utf8");
    if (marker.trim() !== isolationToken) throw new Error("隔離測試 marker 不符，拒絕清理。");
}

function childHasExited(child) {
    return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMilliseconds) {
    if (childHasExited(child)) return true;
    return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
            child.off("exit", onExit);
            resolve(false);
        }, timeoutMilliseconds);
        const onExit = () => {
            clearTimeout(timeout);
            resolve(true);
        };
        child.once("exit", onExit);
    });
}

async function stopNext() {
    const child = nextProcess;
    if (!child) return;
    if (childHasExited(child)) {
        nextProcess = null;
        return;
    }
    child.kill("SIGTERM");
    const exited = await waitForChildExit(child, 5_000);
    if (!exited && !childHasExited(child)) {
        child.kill("SIGKILL");
        const killed = await waitForChildExit(child, 5_000);
        if (!killed || !childHasExited(child)) {
            throw new Error("無法確認隔離 Next server 已停止；保留臨時目錄供人工檢查。");
        }
    }
    nextProcess = null;
}

async function stopPostgres(clusterDirectory, environment) {
    if (!postgresStartAttempted) return;
    await assertSafeRoot();
    const before = await run("pg_ctl", ["-D", clusterDirectory, "status"], {
        env: environment,
        rejectOnFailure: false,
    });
    if (before.code === 0) {
        await run("pg_ctl", ["-D", clusterDirectory, "-m", "fast", "-w", "stop"], { env: environment });
    }
    else if (before.code !== 3) {
        throw new Error(`無法確認隔離 PostgreSQL 狀態（exit ${before.code ?? before.signal ?? "unknown"}）；保留臨時目錄供人工檢查。`);
    }
    const after = await run("pg_ctl", ["-D", clusterDirectory, "status"], {
        env: environment,
        rejectOnFailure: false,
    });
    if (after.code !== 3) {
        throw new Error(`隔離 PostgreSQL 未確認停止（exit ${after.code ?? after.signal ?? "unknown"}）；保留臨時目錄供人工檢查。`);
    }
    postgresStartAttempted = false;
}

async function dropOwnedExistingDatabase(environment) {
    if (ownedExistingDatabase === null) return;
    await assertSafeRoot();
    const { databaseName, ownershipComment } = ownedExistingDatabase;
    if (!borrowedExistingServer
        || databaseName !== environment.LOCAL_PG_DATABASE
        || ownershipComment !== `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${isolationToken}`
        || !/^lerniqa_practice_test_[a-z0-9_]+$/u.test(databaseName)) {
        throw new Error("拒絕清理未通過本次 ownership 驗證的 PostgreSQL 資料庫。");
    }

    await verifyPostgresIdentity("postgres", environment, {
        dataDirectory: environment.LERNIQA_PRACTICE_TEST_DATA_DIRECTORY,
        socketDirectory: environment.LERNIQA_PRACTICE_TEST_SOCKET,
        port: Number(environment.LERNIQA_PRACTICE_TEST_PORT),
        ownedCluster: false,
        ownershipComment: null,
    });
    const ownershipResult = await run("psql", [
        "-X", "-w", "-h", environment.LOCAL_PG_SOCKET,
        "-p", environment.LOCAL_PG_PORT, "-U", environment.LOCAL_PG_USER,
        "-d", "postgres", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
        "-c", `SELECT json_build_object(
            'exists', EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = '${databaseName}'),
            'comment', (SELECT shobj_description(oid, 'pg_database') FROM pg_catalog.pg_database WHERE datname = '${databaseName}')
        )::text`,
    ], { env: environment });
    let ownership;
    try {
        ownership = JSON.parse(ownershipResult.stdout.trim());
    }
    catch {
        throw new Error("無法解析 existing-local-server 資料庫 ownership 查詢。");
    }
    if (ownership.exists === false) {
        ownedExistingDatabase = null;
        return;
    }
    if (ownership.exists !== true || ownership.comment !== ownershipComment) {
        throw new Error("資料庫 ownership marker 不符；拒絕刪除 existing-local-server 上的資料庫。");
    }

    await run("dropdb", [
        "-w", "-h", environment.LOCAL_PG_SOCKET, "-p", environment.LOCAL_PG_PORT,
        "-U", environment.LOCAL_PG_USER, "--maintenance-db=postgres", "--if-exists", "--force",
        databaseName,
    ], { env: environment });
    const countResult = await run("psql", [
        "-X", "-w", "-h", environment.LOCAL_PG_SOCKET,
        "-p", environment.LOCAL_PG_PORT, "-U", environment.LOCAL_PG_USER,
        "-d", "postgres", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
        "-c", `SELECT count(*) FROM pg_catalog.pg_database WHERE datname = '${databaseName}'`,
    ], { env: environment });
    if (countResult.stdout.trim() !== "0") {
        throw new Error("existing-local-server 測試資料庫未確認刪除；保留暫存目錄供人工檢查。");
    }
    ownedExistingDatabase = null;
}

async function cleanup(clusterDirectory, environment) {
    if (activeCleanup !== null) return await activeCleanup;
    activeCleanup = (async () => {
        const serviceErrors = [];
        try {
            await stopNext();
        }
        catch (error) {
            serviceErrors.push(error);
        }
        try {
            await dropOwnedExistingDatabase(environment);
        }
        catch (error) {
            serviceErrors.push(error);
        }
        try {
            await stopPostgres(clusterDirectory, environment);
        }
        catch (error) {
            serviceErrors.push(error);
        }
        if (serviceErrors.length > 0) {
            const error = new AggregateError(serviceErrors, "隔離服務或資料庫尚未確認清理；臨時目錄已保留，未執行刪除。");
            error.code = "ISOLATED_CLEANUP_UNCONFIRMED";
            error.details = {
                preservedRoot: testRoot,
                preservedDatabase: ownedExistingDatabase?.databaseName,
            };
            throw error;
        }
        if (testRoot !== null) {
            await assertSafeRoot();
            const removedRoot = testRoot;
            await rm(removedRoot, { recursive: true, force: false });
            testRoot = null;
            isolationToken = null;
            cleanupContext = null;
        }
    })();
    try {
        await activeCleanup;
    }
    finally {
        activeCleanup = null;
    }
}

async function verifyPostgresIdentity(database, environment, expected) {
    const query = `
        SELECT json_build_object(
            'dataDirectory', current_setting('data_directory'),
            'listenAddresses', current_setting('listen_addresses'),
            'socketDirectories', current_setting('unix_socket_directories'),
            'socketPermissions', current_setting('unix_socket_permissions'),
            'serverPort', current_setting('port'),
            'serverAddress', inet_server_addr()::text,
            'databaseName', current_database(),
            'currentUser', current_user,
            'sessionUser', session_user,
            'inRecovery', pg_catalog.pg_is_in_recovery(),
            'databaseComment', (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = current_database()
            )
        )::text
    `;
    const result = await run("psql", [
        "-X", "-w", "-h", environment.LOCAL_PG_SOCKET, "-p", environment.LOCAL_PG_PORT,
        "-U", environment.LOCAL_PG_USER, "-d", database, "-A", "-t", "-q",
        "-v", "ON_ERROR_STOP=1", "-c", query,
    ], { env: environment });
    let identity;
    try {
        identity = JSON.parse(result.stdout.trim());
    }
    catch {
        throw new Error("PostgreSQL 身分查詢未回傳有效 JSON。");
    }
    const actualDataDirectory = await realpath(identity.dataDirectory).catch(() => null);
    const actualSocketDirectory = await realpath(identity.socketDirectories).catch(() => null);
    const expectedDataDirectory = await realpath(expected.dataDirectory).catch(() => null);
    const expectedSocketDirectory = await realpath(expected.socketDirectory).catch(() => null);
    const expectedUser = os.userInfo().username;
    const identityMatches = identity.serverAddress === null
        && identity.databaseName === database
        && Number(identity.serverPort) === expected.port
        && identity.currentUser === expectedUser
        && identity.sessionUser === expectedUser
        && identity.inRecovery === false
        && actualDataDirectory !== null
        && actualDataDirectory === expectedDataDirectory
        && actualSocketDirectory !== null
        && actualSocketDirectory === expectedSocketDirectory
        && (!expected.ownedCluster || (
            identity.listenAddresses === ""
            && identity.socketPermissions === "0700"
        ))
        && (expected.ownershipComment === null || identity.databaseComment === expected.ownershipComment);
    if (!identityMatches) {
        throw new Error(`隔離 PostgreSQL 身分不符：${JSON.stringify({
            ...identity,
            dataDirectory: actualDataDirectory,
            socketDirectories: actualSocketDirectory,
        })}`);
    }
    return identity;
}

async function startPostgres(clusterDirectory, socketDirectory, logPath, environment) {
    await assertSafeRoot();
    postgresStartAttempted = true;
    try {
        await run("pg_ctl", [
            "-D", clusterDirectory,
            "-l", logPath,
            "-o", `-F -h '' -k ${socketDirectory} -p ${DATABASE_PORT} -c unix_socket_permissions=0700`,
            "-w", "start",
        ], { env: environment });
    }
    catch (error) {
        const postgresLog = await readFile(logPath, "utf8").catch(() => "");
        if (error && typeof error === "object" && "details" in error) {
            error.details.postgresLog = postgresLog.trim().slice(-4_000);
        }
        throw error;
    }
    await verifyPostgresIdentity("postgres", environment, {
        dataDirectory: clusterDirectory,
        socketDirectory,
        port: DATABASE_PORT,
        ownedCluster: true,
        ownershipComment: null,
    });
}

async function createIsolatedDatabase(databaseName, environment, existingServerConfig) {
    const existingCount = await run("psql", [
        "-X", "-w", "-h", environment.LOCAL_PG_SOCKET,
        "-p", environment.LOCAL_PG_PORT, "-U", environment.LOCAL_PG_USER,
        "-d", "postgres", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
        "-c", `SELECT count(*) FROM pg_catalog.pg_database WHERE datname = '${databaseName}'`,
    ], { env: environment });
    if (existingCount.stdout.trim() !== "0") {
        throw new Error(`隔離測試資料庫名稱已存在：${databaseName}`);
    }

    let ownershipComment = null;
    if (existingServerConfig) {
        ownershipComment = `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${isolationToken}`;
        ownedExistingDatabase = { databaseName, ownershipComment };
    }

    await run("createdb", [
        "-w", "-h", environment.LOCAL_PG_SOCKET, "-p", environment.LOCAL_PG_PORT,
        "-U", environment.LOCAL_PG_USER, "--maintenance-db=postgres",
        "--template=template0", "--encoding=UTF8", databaseName,
    ], { env: environment });

    if (existingServerConfig) {
        await run("psql", [
            "-X", "-w", "-h", environment.LOCAL_PG_SOCKET,
            "-p", environment.LOCAL_PG_PORT, "-U", environment.LOCAL_PG_USER,
            "-d", "postgres", "-v", "ON_ERROR_STOP=1",
            "-c", `COMMENT ON DATABASE \"${databaseName}\" IS '${ownershipComment}'`,
        ], { env: environment });
    }

    await verifyPostgresIdentity(databaseName, environment, {
        dataDirectory: existingServerConfig?.dataDirectory ?? path.join(testRoot, "postgres"),
        socketDirectory: existingServerConfig?.socketDirectory ?? path.join(testRoot, "socket"),
        port: existingServerConfig?.port ?? DATABASE_PORT,
        ownedCluster: existingServerConfig === null,
        ownershipComment,
    });
}

async function applyMigrations(databaseName, socketDirectory, environment) {
    const migrationDirectory = path.join(REPOSITORY_ROOT, "database", "migrations");
    const migrationFiles = (await readdir(migrationDirectory))
        .filter((fileName) => /^[0-9]{4}_[a-z0-9_]+\.up\.sql$/u.test(fileName))
        .sort();
    if (migrationFiles.length === 0) throw new Error("找不到 migration。");
    for (const [index, fileName] of migrationFiles.entries()) {
        const expectedVersion = String(index + 1).padStart(4, "0");
        if (!fileName.startsWith(`${expectedVersion}_`)) throw new Error(`migration 版本不連續：${fileName}`);
        await run("psql", [
            "-X", "-w", "-h", environment.LOCAL_PG_SOCKET,
            "-p", environment.LOCAL_PG_PORT, "-U", environment.LOCAL_PG_USER,
            "-d", databaseName, "-v", "ON_ERROR_STOP=1",
            "-f", path.join(migrationDirectory, fileName),
        ], { env: environment });
    }
}

async function copyApplication(applicationRoot) {
    await mkdir(applicationRoot, { mode: 0o700 });
    for (const directory of ["app", "public"]) {
        await cp(path.join(REPOSITORY_ROOT, directory), path.join(applicationRoot, directory), {
            recursive: true,
            preserveTimestamps: true,
            errorOnExist: true,
            async filter(source) {
                if (path.basename(source).startsWith(".env")) return false;
                const metadata = await lstat(source);
                if (metadata.isSymbolicLink()) {
                    throw new Error(`隔離 Next 執行副本拒絕符號連結：${path.relative(REPOSITORY_ROOT, source)}`);
                }
                return metadata.isDirectory() || metadata.isFile();
            },
        });
    }
    for (const fileName of [
        "next-env.d.ts",
        "next.config.ts",
        "package-lock.json",
        "package.json",
        "postcss.config.js",
        "tailwind.config.ts",
        "tsconfig.json",
    ]) {
        const source = path.join(REPOSITORY_ROOT, fileName);
        const metadata = await lstat(source);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
            throw new Error(`隔離 Next 執行檔案不是一般檔案：${fileName}`);
        }
        await cp(source, path.join(applicationRoot, fileName), {
            preserveTimestamps: true,
            errorOnExist: true,
        });
    }
    await symlink(path.join(REPOSITORY_ROOT, "node_modules"), path.join(applicationRoot, "node_modules"), "dir");
}

async function startNext(applicationRoot, environment) {
    if (exitCode !== 0) throw shutdownError();
    nextLog = "";
    const httpPort = await new Promise((resolve, reject) => {
        const probe = createServer();
        probe.unref();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address ? address.port : null;
            probe.close((error) => error ? reject(error) : resolve(port));
        });
    });
    if (!Number.isSafeInteger(httpPort) || httpPort < 1 || httpPort > 65_535) {
        throw new Error("無法配置隔離 Next loopback port。");
    }
    if (exitCode !== 0) throw shutdownError();
    const nextCli = path.join(REPOSITORY_ROOT, "node_modules", "next", "dist", "bin", "next");
    const child = spawn(process.execPath, [nextCli, "dev", "-p", String(httpPort), "--hostname", "127.0.0.1"], {
        cwd: applicationRoot,
        env: { ...environment, LERNIQA_NEXT_DIST_DIR: ".next-isolated" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
    });
    nextProcess = child;
    let processFailure = null;
    let wakeForProcessFailure;
    const processFailureSignal = new Promise((resolve) => {
        wakeForProcessFailure = resolve;
    });
    child.once("error", (error) => {
        processFailure = nextSpawnError(error);
        if (child.pid === undefined && nextProcess === child) nextProcess = null;
        wakeForProcessFailure();
    });
    let resolvedPort = null;
    const observe = (chunk) => {
        const text = chunk.toString("utf8");
        nextLog = appendLog(nextLog, text);
        const match = text.replaceAll(/\u001b\[[0-9;]*m/gu, "").match(/http:\/\/127\.0\.0\.1:(\d+)/u);
        if (match) resolvedPort = Number(match[1]);
    };
    child.stdout.on("data", observe);
    child.stderr.on("data", observe);

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        if (processFailure !== null) throw processFailure;
        if (childHasExited(child)) throw new Error(`隔離 Next server 提前結束。\n${nextLog.slice(-4_000)}`);
        if (resolvedPort === httpPort) {
            try {
                const response = await fetch(`http://127.0.0.1:${resolvedPort}/api/v1/auth/me`, {
                    signal: AbortSignal.timeout(2_000),
                });
                const body = await response.json();
                if (response.status === 401 && body?.error?.code === "AUTH_REQUIRED") {
                    return resolvedPort;
                }
            }
            catch {
                // The process still owns the fresh port; compilation may still be in progress.
            }
        }
        await Promise.race([
            new Promise((resolve) => setTimeout(resolve, 250)),
            processFailureSignal,
        ]);
    }
    if (processFailure !== null) throw processFailure;
    throw new Error(`隔離 Next server 未在期限內就緒。\n${nextLog.slice(-4_000)}`);
}

async function runVerifier(environment, httpPort, extraEnvironment = {}) {
    const result = await run(process.execPath, [path.join(REPOSITORY_ROOT, "scripts", "verify-local-practice.mjs")], {
        env: {
            ...environment,
            ...extraEnvironment,
            BASE_URL: `http://127.0.0.1:${httpPort}`,
            LERNIQA_ISOLATED_HTTP_PORT: String(httpPort),
        },
    });
    const line = result.stdout.trim().split("\n").at(-1);
    const parsed = JSON.parse(line);
    if (parsed?.ok !== true) throw new Error(`隔離練習驗證失敗：${line}`);
    return { parsed, raw: `${line}\n` };
}

async function main() {
    const existingServerConfig = await resolveExistingServerConfig();
    borrowedExistingServer = existingServerConfig !== null;
    const temporaryParent = await realpath(TEST_TEMP_DIRECTORY);
    testRoot = await mkdtemp(path.join(temporaryParent, TEMP_PREFIX));
    testRoot = await realpath(testRoot);
    isolationToken = randomUUID().replaceAll("-", "");

    const clusterDirectory = path.join(testRoot, "postgres");
    const socketDirectory = existingServerConfig?.socketDirectory ?? path.join(testRoot, "socket");
    const databasePort = existingServerConfig?.port ?? DATABASE_PORT;
    const applicationRoot = path.join(testRoot, "application");
    const postgresLog = path.join(testRoot, "postgres.log");
    const firstEvidencePath = path.join(testRoot, "full-verification.json");
    const databaseName = `lerniqa_practice_test_${isolationToken.slice(0, 16)}`;
    const environment = isolatedEnvironment(databaseName, socketDirectory, databasePort, existingServerConfig);

    await writeFile(path.join(testRoot, MARKER_FILE), `${isolationToken}\n`, { mode: 0o600 });
    cleanupContext = { clusterDirectory, environment };
    if (exitCode !== 0) {
        await cleanup(clusterDirectory, environment);
        return;
    }
    if (!borrowedExistingServer) {
        await mkdir(clusterDirectory, { mode: 0o700 });
        await mkdir(socketDirectory, { mode: 0o700 });
    }
    await chmod(testRoot, 0o700);
    await copyApplication(applicationRoot);

    if (borrowedExistingServer) {
        await verifyPostgresIdentity("postgres", environment, {
            dataDirectory: existingServerConfig.dataDirectory,
            socketDirectory: existingServerConfig.socketDirectory,
            port: existingServerConfig.port,
            ownedCluster: false,
            ownershipComment: null,
        });
    }
    else {
        await run("initdb", [
            "-D", clusterDirectory,
            `--username=${environment.LOCAL_PG_USER}`,
            "--auth-local=trust",
            "--auth-host=reject",
            "--encoding=UTF8",
            "--no-locale",
        ], { env: environment });
        await startPostgres(clusterDirectory, socketDirectory, postgresLog, environment);
    }
    await createIsolatedDatabase(databaseName, environment, existingServerConfig);
    await applyMigrations(databaseName, socketDirectory, environment);
    await run(process.execPath, [path.join(REPOSITORY_ROOT, "scripts", "seed-local-practice-test-fixture.mjs")], { env: environment });

    let httpPort = await startNext(applicationRoot, environment);
    const first = await runVerifier(environment, httpPort);
    await writeFile(firstEvidencePath, first.raw, { mode: 0o600 });

    await stopNext();
    if (!borrowedExistingServer) {
        await stopPostgres(clusterDirectory, environment);
        await startPostgres(clusterDirectory, socketDirectory, postgresLog, environment);
    }
    httpPort = await startNext(applicationRoot, environment);
    const persistence = await runVerifier(environment, httpPort, {
        VERIFY_PERSISTENCE_ONLY: "1",
        PERSISTED_ATTEMPT_IDS_FILE: firstEvidencePath,
    });

    const output = JSON.stringify({
        ok: true,
        mode: borrowedExistingServer
            ? "isolated-database-and-application-restart"
            : "isolated-full-and-database-restart",
        persistentApplicationDatabaseTouched: false,
        borrowedExistingPostgres: borrowedExistingServer,
        borrowedClusterCatalogTemporarilyMutated: borrowedExistingServer,
        fixture: { synthetic: true, questions: first.parsed.catalog.questions },
        full: first.parsed,
        restart: persistence.parsed.persistence.databaseRestart,
    });

    await cleanup(clusterDirectory, environment);
    process.stdout.write(`${output}\n`);
}

let exitCode = 0;
let cleanupContext = null;
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(signal, () => {
        if (exitCode === 0) exitCode = code;
        if (activeCleanup !== null) return;
        if (activeCommandProcess !== null && !childHasExited(activeCommandProcess)) {
            activeCommandProcess.kill("SIGTERM");
        }
        if (nextProcess !== null && !childHasExited(nextProcess)) {
            nextProcess.kill("SIGTERM");
        }
    });
}

try {
    await verifyLocalPostgresTestLockProof({ requireDirectParent: true });
    await main();
}
catch (error) {
    if (exitCode === 0) exitCode = 1;
    const details = error && typeof error === "object" && "details" in error ? error.details : undefined;
    process.stderr.write(`${JSON.stringify({
        ok: false,
        code: error?.code ?? "ISOLATED_LOCAL_PRACTICE_FAILED",
        message: error instanceof Error ? error.message : "隔離練習驗證失敗。",
        details,
        nextLog: nextLog.slice(-4_000),
    })}\n`);
    if (cleanupContext !== null) {
        await cleanup(cleanupContext.clusterDirectory, cleanupContext.environment).catch((cleanupError) => {
            process.stderr.write(`${JSON.stringify({
                ok: false,
                code: cleanupError?.code ?? "ISOLATED_CLEANUP_FAILED",
                message: cleanupError instanceof Error ? cleanupError.message : "隔離環境清理失敗。",
                details: cleanupError?.details ?? { preservedRoot: testRoot },
            })}\n`);
        });
    }
}

process.exitCode = exitCode;
