#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyLocalPostgresTestLockProof } from "./with-local-postgres-test-lock.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIRECTORY = path.join(REPOSITORY_ROOT, "database", "migrations");
const MIGRATION_TEST_DIRECTORY = path.join(REPOSITORY_ROOT, "database", "tests");
const SYSTEM_TEMPORARY_DIRECTORY = "/tmp";
const TEMPORARY_ROOT_PREFIX = "lerniqa-import-ownership-test.";
const TEMPORARY_ROOT_PATTERN = /^lerniqa-import-ownership-test\.[A-Za-z0-9_-]+$/u;
const DATABASE_NAME_PATTERN = /^lerniqa_import_ownership_test_[a-z0-9_]+$/u;
const ISOLATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const ISOLATION_MARKER_FILE = ".lerniqa-import-ownership-test";
const MAX_CAPTURED_CHARACTERS = 64 * 1024;
const EXISTING_SERVER_ENVIRONMENT = "LERNIQA_IMPORT_OWNERSHIP_TEST_EXISTING";
const EXISTING_SOCKET_ENVIRONMENT = "LERNIQA_IMPORT_OWNERSHIP_TEST_SOCKET";
const EXISTING_PORT_ENVIRONMENT = "LERNIQA_IMPORT_OWNERSHIP_TEST_PORT";
const EXISTING_DATA_DIRECTORY_ENVIRONMENT = "LERNIQA_IMPORT_OWNERSHIP_TEST_DATA_DIRECTORY";
const DATABASE_OWNERSHIP_COMMENT_PREFIX = "lerniqa-import-ownership-test:";
export const IMPORT_OWNERSHIP_SIGNAL_EXIT_CODES = Object.freeze({
    SIGHUP: 129,
    SIGINT: 130,
    SIGTERM: 143,
});

export class ImportOwnershipSignalError extends Error {
    constructor(signal) {
        super(`import ownership test interrupted by ${signal}`);
        this.name = "ImportOwnershipSignalError";
        this.signal = signal;
    }
}

export function createImportOwnershipSignalLifecycle(signalTarget = process) {
    let activeChild = null;
    let activeChildBelongsToCleanup = false;
    let cleanupChildInterrupted = false;
    let cleanupConfirmed = false;
    let cleanupPromise = null;
    let cleanupStarted = false;
    let requestedSignal = null;
    let requestedExitCode = 0;
    const handlers = new Map();

    for (const [signal, exitCode] of Object.entries(IMPORT_OWNERSHIP_SIGNAL_EXIT_CODES)) {
        const handler = () => {
            // The first handled signal owns the lifecycle. Later signals must not
            // start parallel cleanup or interrupt a cleanup retry.
            if (requestedSignal !== null) return;
            requestedSignal = signal;
            requestedExitCode = exitCode;
            if (activeChild !== null
                && activeChild.exitCode === null
                && activeChild.signalCode === null) {
                const forwarded = activeChild.kill(signal);
                if (forwarded && activeChildBelongsToCleanup) cleanupChildInterrupted = true;
            }
        };
        handlers.set(signal, handler);
        signalTarget.on(signal, handler);
    }

    return {
        get cleanupConfirmed() {
            return cleanupConfirmed;
        },
        get cleanupStarted() {
            return cleanupStarted;
        },
        get exitCode() {
            return requestedExitCode;
        },
        get signal() {
            return requestedSignal;
        },
        clearActiveChild(child) {
            if (activeChild !== child) return;
            activeChild = null;
            activeChildBelongsToCleanup = false;
        },
        dispose() {
            for (const [signal, handler] of handlers) signalTarget.off(signal, handler);
        },
        registerActiveChild(child) {
            assert.equal(activeChild, null, "import ownership runner commands must remain serial");
            activeChild = child;
            activeChildBelongsToCleanup = cleanupStarted;
            // Close the narrow race where a signal arrives after the command's
            // pre-spawn checkpoint but before the new child is registered.
            if (requestedSignal !== null && !cleanupStarted
                && child.exitCode === null && child.signalCode === null) {
                child.kill(requestedSignal);
            }
        },
        throwIfInterrupted() {
            if (requestedSignal !== null && !cleanupStarted) {
                throw new ImportOwnershipSignalError(requestedSignal);
            }
        },
        cleanupOnce(cleanupCallback) {
            if (cleanupPromise !== null) return cleanupPromise;
            cleanupStarted = true;
            cleanupPromise = (async () => {
                let retriedInterruptedCleanup = false;
                for (;;) {
                    try {
                        await cleanupCallback();
                        cleanupConfirmed = true;
                        return;
                    }
                    catch (error) {
                        if (!retriedInterruptedCleanup && cleanupChildInterrupted) {
                            retriedInterruptedCleanup = true;
                            cleanupChildInterrupted = false;
                            continue;
                        }
                        throw error;
                    }
                }
            })();
            return cleanupPromise;
        },
    };
}

let activeSignalLifecycle = null;

function appendCapturedText(current, chunk) {
    const combined = `${current}${chunk}`;
    return combined.length <= MAX_CAPTURED_CHARACTERS
        ? combined
        : combined.slice(combined.length - MAX_CAPTURED_CHARACTERS);
}

function commandFailure(command, args, result) {
    const detail = (result.stderr || result.stdout).trim().slice(-4_000);
    const suffix = detail === "" ? "" : `\n${detail}`;
    return new Error(
        `${path.basename(command)} failed (${result.signal ?? `exit ${result.code ?? "unknown"}`}).${suffix}`,
        { cause: result.spawnError },
    );
}

async function runCommand(command, args, options = {}) {
    activeSignalLifecycle?.throwIfInterrupted();
    const inheritedOutput = options.stdio === "inherit";
    const result = await new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: options.cwd ?? REPOSITORY_ROOT,
            env: options.env,
            shell: false,
            stdio: inheritedOutput ? "inherit" : ["ignore", "pipe", "pipe"],
        });
        activeSignalLifecycle?.registerActiveChild(child);
        let stdout = "";
        let stderr = "";
        let spawnError = null;
        if (!inheritedOutput) {
            child.stdout.on("data", (chunk) => {
                stdout = appendCapturedText(stdout, chunk.toString("utf8"));
            });
            child.stderr.on("data", (chunk) => {
                stderr = appendCapturedText(stderr, chunk.toString("utf8"));
            });
        }
        child.once("error", (error) => {
            spawnError = error;
        });
        child.once("close", (code, signal) => {
            activeSignalLifecycle?.clearActiveChild(child);
            resolve({ code, signal, spawnError, stdout, stderr });
        });
    });
    activeSignalLifecycle?.throwIfInterrupted();
    if (options.rejectOnFailure !== false && (result.spawnError !== null || result.code !== 0)) {
        throw commandFailure(command, args, result);
    }
    return result;
}

function isolatedEnvironment({
    databaseName,
    existingServerConfig,
    port,
    root,
    socketDirectory,
    token,
    user,
}) {
    const environment = {};
    const allowedNames = new Set(["HOME", "LANG", "LOGNAME", "PATH", "SHELL", "USER"]);
    for (const [name, value] of Object.entries(process.env)) {
        if ((allowedNames.has(name) || name.startsWith("LC_")) && value !== undefined) {
            environment[name] = value;
        }
    }
    return {
        ...environment,
        TMPDIR: SYSTEM_TEMPORARY_DIRECTORY,
        PSQLRC: "/dev/null",
        PGAPPNAME: "lerniqa-import-ownership-isolated",
        PGCONNECT_TIMEOUT: "5",
        PGSSLMODE: "disable",
        LOCAL_PG_SOCKET: socketDirectory,
        LOCAL_PG_PORT: String(port),
        LOCAL_PG_DATABASE: databaseName,
        LOCAL_PG_USER: user,
        LERNIQA_IMPORT_OWNERSHIP_TEST_ROOT: root,
        LERNIQA_IMPORT_OWNERSHIP_TEST_TOKEN: token,
        LERNIQA_IMPORT_OWNERSHIP_TEST_EXISTING: existingServerConfig === null ? "0" : "1",
        ...(existingServerConfig === null ? {} : {
            LERNIQA_IMPORT_OWNERSHIP_TEST_SOCKET: existingServerConfig.socketDirectory,
            LERNIQA_IMPORT_OWNERSHIP_TEST_PORT: String(existingServerConfig.port),
            LERNIQA_IMPORT_OWNERSHIP_TEST_DATA_DIRECTORY: existingServerConfig.dataDirectory,
        }),
    };
}

function requiredEnvironment(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be set explicitly in existing-local-server mode`);
    return value;
}

function existingServerModeEnabled() {
    const value = process.env[EXISTING_SERVER_ENVIRONMENT]?.trim() ?? "0";
    assert.ok(["0", "1"].includes(value), `${EXISTING_SERVER_ENVIRONMENT} must be 0 or 1`);
    return value === "1";
}

function parsePort(value, name) {
    assert.match(value, /^\d+$/u, `${name} must be an integer from 1 to 65535`);
    const port = Number(value);
    assert.ok(Number.isSafeInteger(port) && port >= 1 && port <= 65_535,
        `${name} must be an integer from 1 to 65535`);
    return port;
}

async function resolveExistingServerConfig() {
    if (!existingServerModeEnabled()) return null;

    const configuredSocket = process.env[EXISTING_SOCKET_ENVIRONMENT]?.trim() || "/tmp";
    assert.equal(path.isAbsolute(configuredSocket), true,
        `${EXISTING_SOCKET_ENVIRONMENT} must be an absolute Unix socket directory`);
    const socketDirectory = await realpath(configuredSocket).catch(() => null);
    assert.notEqual(socketDirectory, null,
        `existing-local-server socket directory does not exist: ${configuredSocket}`);
    await assertDirectory(socketDirectory, `${EXISTING_SOCKET_ENVIRONMENT} must name a directory`);

    const port = parsePort(
        process.env[EXISTING_PORT_ENVIRONMENT]?.trim() || "5432",
        EXISTING_PORT_ENVIRONMENT,
    );
    const configuredDataDirectory = requiredEnvironment(EXISTING_DATA_DIRECTORY_ENVIRONMENT);
    assert.equal(path.isAbsolute(configuredDataDirectory), true,
        `${EXISTING_DATA_DIRECTORY_ENVIRONMENT} must be an absolute path`);
    const dataDirectory = await realpath(configuredDataDirectory).catch(() => null);
    assert.notEqual(dataDirectory, null,
        `existing-local-server data directory does not exist: ${configuredDataDirectory}`);
    await assertDirectory(dataDirectory, `${EXISTING_DATA_DIRECTORY_ENVIRONMENT} must name a directory`);

    return { dataDirectory, port, socketDirectory };
}

async function assertDirectory(directory, message) {
    const metadata = await lstat(directory);
    assert.equal(metadata.isDirectory(), true, message);
    assert.equal(metadata.isSymbolicLink(), false, `${directory} must not be a symlink`);
}

async function assertPrivateDirectory(directory) {
    const metadata = await lstat(directory);
    assert.equal(metadata.isDirectory(), true, `${directory} must be a directory`);
    assert.equal(metadata.isSymbolicLink(), false, `${directory} must not be a symlink`);
    assert.equal(metadata.mode & 0o077, 0, `${directory} must not grant group or other permissions`);
}

async function assertSafeTemporaryRoot(context) {
    assert.match(context.token, ISOLATION_TOKEN_PATTERN);
    assert.match(path.basename(context.root), TEMPORARY_ROOT_PATTERN);
    assert.equal(path.isAbsolute(context.root), true);
    assert.equal(context.root, await realpath(context.root));
    assert.equal(path.dirname(context.root), await realpath(SYSTEM_TEMPORARY_DIRECTORY));
    assert.notEqual(context.root, REPOSITORY_ROOT);
    assert.equal(context.root.startsWith(`${REPOSITORY_ROOT}${path.sep}`), false);
    await assertPrivateDirectory(context.root);

    const markerPath = path.join(context.root, ISOLATION_MARKER_FILE);
    const markerMetadata = await lstat(markerPath);
    assert.equal(markerMetadata.isFile(), true, "isolation marker must be a regular file");
    assert.equal(markerMetadata.isSymbolicLink(), false, "isolation marker must not be a symlink");
    assert.equal(markerMetadata.mode & 0o077, 0, "isolation marker must be private");
    assert.equal(await realpath(markerPath), markerPath);
    assert.equal((await readFile(markerPath, "utf8")).trim(), context.token);

    assert.equal(context.clusterDirectory, path.join(context.root, "postgres"));
    if (!context.borrowedExistingServer) {
        assert.equal(context.socketDirectory, path.join(context.root, "socket"));
        for (const directory of [context.clusterDirectory, context.socketDirectory]) {
            assert.equal(await realpath(directory), directory);
            await assertPrivateDirectory(directory);
        }
    }
}

async function assertRegularRepositoryFile(filePath) {
    const metadata = await lstat(filePath);
    assert.equal(metadata.isFile(), true, `${filePath} must be a regular file`);
    assert.equal(metadata.isSymbolicLink(), false, `${filePath} must not be a symlink`);
    assert.equal(await realpath(filePath), filePath);
}

async function migrationManifest() {
    const directoryEntries = await readdir(MIGRATION_DIRECTORY);
    const upCandidates = directoryEntries.filter((fileName) => fileName.endsWith(".up.sql"));
    const entries = upCandidates.map((fileName) => {
        const match = fileName.match(/^(\d{4})_([a-z0-9_]+)\.up\.sql$/u);
        assert.ok(match, `invalid up migration filename: ${fileName}`);
        return { fileName, version: match[1], name: match[2] };
    }).sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));
    assert.ok(entries.length > 0, "no up migrations found");

    for (const [index, entry] of entries.entries()) {
        const expectedVersion = String(index + 1).padStart(4, "0");
        assert.equal(entry.version, expectedVersion, `migration versions must be contiguous at ${entry.fileName}`);
        const upPath = path.join(MIGRATION_DIRECTORY, entry.fileName);
        const downPath = path.join(MIGRATION_DIRECTORY, `${entry.version}_${entry.name}.down.sql`);
        const testPath = path.join(MIGRATION_TEST_DIRECTORY, `${entry.version}_${entry.name}.sql`);
        await Promise.all([
            assertRegularRepositoryFile(upPath),
            assertRegularRepositoryFile(downPath),
            assertRegularRepositoryFile(testPath),
        ]);
        entry.path = upPath;
    }
    return entries;
}

function postgresqlString(value) {
    assert.equal(/[\0\r\n]/u.test(value), false, "PostgreSQL setting must remain on one line");
    return `'${value.replaceAll("'", "''")}'`;
}

function psqlArguments(context, databaseName, commandArguments) {
    return [
        "-X",
        "-w",
        "-h", context.socketDirectory,
        "-p", String(context.port),
        "-U", context.user,
        "-d", databaseName,
        "-v", "ON_ERROR_STOP=1",
        ...commandArguments,
    ];
}

async function queryJson(context, sql, databaseName = context.databaseName) {
    const result = await runCommand("psql", psqlArguments(context, databaseName, [
        "-A", "-t", "-q", "-c", sql,
    ]), { env: context.environment });
    const output = result.stdout.trim();
    assert.notEqual(output, "", "PostgreSQL identity query returned no data");
    return JSON.parse(output);
}

async function assertDatabaseIdentity(context, databaseName, expectedOwnershipComment = undefined) {
    await assertSafeTemporaryRoot(context);
    assert.match(context.databaseName, DATABASE_NAME_PATTERN);
    assert.equal(context.user, os.userInfo().username);
    assert.ok(Number.isInteger(context.port) && context.port >= 1 && context.port <= 65_535);
    const identity = await queryJson(context, `
        SELECT json_build_object(
            'dataDirectory', current_setting('data_directory'),
            'listenAddresses', current_setting('listen_addresses'),
            'socketDirectories', current_setting('unix_socket_directories'),
            'socketPermissions', current_setting('unix_socket_permissions'),
            'serverPort', current_setting('port'),
            'usesUnixSocket', inet_server_addr() IS NULL,
            'databaseName', current_database(),
            'databaseUser', current_user,
            'sessionUser', session_user,
            'inRecovery', pg_catalog.pg_is_in_recovery(),
            'databaseComment', (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = current_database()
            )
        )::text
    `, databaseName);
    const [actualDataDirectory, actualSocketDirectory] = await Promise.all([
        realpath(identity.dataDirectory).catch(() => null),
        realpath(identity.socketDirectories).catch(() => null),
    ]);
    const expectedDataDirectory = context.existingServerConfig?.dataDirectory
        ?? context.clusterDirectory;
    assert.equal(actualDataDirectory, expectedDataDirectory, "PostgreSQL data_directory mismatch");
    assert.equal(actualSocketDirectory, context.socketDirectory, "PostgreSQL Unix socket directory mismatch");
    assert.equal(identity.serverPort, String(context.port));
    assert.equal(identity.usesUnixSocket, true, "PostgreSQL connection must use a Unix socket");
    assert.equal(identity.databaseName, databaseName);
    assert.equal(identity.databaseUser, context.user);
    assert.equal(identity.sessionUser, context.user);
    assert.equal(identity.inRecovery, false, "refusing to run ownership tests on a recovery server");
    if (!context.borrowedExistingServer) {
        assert.equal(identity.listenAddresses, "", "disposable PostgreSQL must not listen on TCP");
        assert.equal(identity.socketPermissions, "0700");
    }
    if (expectedOwnershipComment !== undefined) {
        assert.equal(identity.databaseComment, expectedOwnershipComment,
            "test database ownership marker mismatch");
    }
    return identity;
}

async function applyMigrations(context, manifest) {
    for (const entry of manifest) {
        await runCommand("psql", psqlArguments(context, context.databaseName, ["-f", entry.path]), {
            env: context.environment,
        });
    }
    const actual = await queryJson(context, `
        SELECT COALESCE(
            json_agg(json_build_object('version', version, 'name', name) ORDER BY version),
            '[]'::json
        )::text
        FROM schema_migrations
    `);
    assert.deepEqual(
        actual,
        manifest.map(({ version, name }) => ({ version, name })),
        "schema_migrations must exactly match the repository up-migration manifest",
    );
}

async function databaseOwnership(context, databaseName) {
    assert.match(databaseName, DATABASE_NAME_PATTERN);
    return await queryJson(context, `
        SELECT json_build_object(
            'exists', EXISTS (
                SELECT 1 FROM pg_catalog.pg_database
                WHERE datname = '${databaseName}'
            ),
            'comment', (
                SELECT pg_catalog.shobj_description(oid, 'pg_database')
                FROM pg_catalog.pg_database
                WHERE datname = '${databaseName}'
            )
        )::text
    `, "postgres");
}

async function createTestDatabase(context) {
    const before = await databaseOwnership(context, context.databaseName);
    assert.deepEqual(before, { exists: false, comment: null },
        `test database already exists: ${context.databaseName}`);
    let ownershipComment = null;
    if (context.borrowedExistingServer) {
        ownershipComment = `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${context.token}`;
        // Register before CREATE so a handled failure cannot make cleanup target
        // any database other than this run's random name and marker.
        context.ownedExistingDatabase = {
            databaseName: context.databaseName,
            ownershipComment,
        };
    }
    await runCommand("createdb", [
        "-w",
        "-h", context.socketDirectory,
        "-p", String(context.port),
        "-U", context.user,
        "--maintenance-db=postgres",
        "--template=template0",
        "--encoding=UTF8",
        context.databaseName,
    ], { env: context.environment });

    if (context.borrowedExistingServer) {
        await runCommand("psql", psqlArguments(context, "postgres", [
            "-c", `COMMENT ON DATABASE "${context.databaseName}" IS '${ownershipComment}'`,
        ]), { env: context.environment });
        await assertDatabaseIdentity(context, context.databaseName, ownershipComment);
    }
    else {
        await assertDatabaseIdentity(context, context.databaseName, null);
    }
}

async function dropOwnedExistingDatabase(context) {
    if (context.ownedExistingDatabase === null) return;
    await assertSafeTemporaryRoot(context);
    const { databaseName, ownershipComment } = context.ownedExistingDatabase;
    assert.equal(context.borrowedExistingServer, true,
        "refusing existing-server cleanup outside explicit opt-in mode");
    assert.equal(context.startAttempted, false,
        "borrowed PostgreSQL must never be registered as a started test process");
    assert.equal(databaseName, context.databaseName);
    assert.equal(ownershipComment, `${DATABASE_OWNERSHIP_COMMENT_PREFIX}${context.token}`);
    assert.match(databaseName, DATABASE_NAME_PATTERN);

    await assertDatabaseIdentity(context, "postgres");
    const ownership = await databaseOwnership(context, databaseName);
    if (ownership.exists === false) {
        context.ownedExistingDatabase = null;
        return;
    }
    assert.deepEqual(ownership, { exists: true, comment: ownershipComment },
        "refusing to drop a database without this run's ownership marker");
    await runCommand("dropdb", [
        "-w",
        "-h", context.socketDirectory,
        "-p", String(context.port),
        "-U", context.user,
        "--maintenance-db=postgres",
        "--if-exists",
        "--force",
        databaseName,
    ], { env: context.environment });
    const after = await databaseOwnership(context, databaseName);
    assert.deepEqual(after, { exists: false, comment: null },
        "existing-server test database was not removed");
    context.ownedExistingDatabase = null;
}

async function postgresStatus(context) {
    return await runCommand("pg_ctl", ["-D", context.clusterDirectory, "status"], {
        env: context.environment,
        rejectOnFailure: false,
    });
}

async function stopPostgresForCleanup(context) {
    if (!context.startAttempted) return;
    assert.equal(context.borrowedExistingServer, false,
        "refusing to stop a borrowed PostgreSQL server");
    await assertSafeTemporaryRoot(context);
    const before = await postgresStatus(context);
    if (before.spawnError !== null) throw commandFailure("pg_ctl", ["status"], before);
    if (before.code === 0) {
        await runCommand("pg_ctl", [
            "-D", context.clusterDirectory,
            "-m", "fast",
            "-w", "stop",
        ], { env: context.environment });
    }
    else if (before.code !== 3) {
        throw new Error(`PostgreSQL status is uncertain (exit ${before.code}); preserving ${context.root}`);
    }

    const after = await postgresStatus(context);
    if (after.spawnError !== null || after.code !== 3) {
        throw new Error(`PostgreSQL did not confirm a stopped state; preserving ${context.root}`);
    }
}

async function cleanup(context) {
    await dropOwnedExistingDatabase(context);
    await stopPostgresForCleanup(context);
    await assertSafeTemporaryRoot(context);
    await rm(context.root, { recursive: true, force: false, maxRetries: 2 });
}

async function main(signalLifecycle) {
    let context = null;
    let primaryError = null;
    let cleanupError = null;

    try {
        const existingServerConfig = await resolveExistingServerConfig();
        signalLifecycle.throwIfInterrupted();
        const manifest = await migrationManifest();
        signalLifecycle.throwIfInterrupted();
        const canonicalTemporaryDirectory = await realpath(SYSTEM_TEMPORARY_DIRECTORY);
        signalLifecycle.throwIfInterrupted();
        const createdRoot = await mkdtemp(path.join(canonicalTemporaryDirectory, TEMPORARY_ROOT_PREFIX));
        const root = await realpath(createdRoot);
        const token = randomBytes(32).toString("base64url");
        const databaseName = `lerniqa_import_ownership_test_${randomBytes(8).toString("hex")}`;
        const user = os.userInfo().username;
        const borrowedExistingServer = existingServerConfig !== null;
        const port = existingServerConfig?.port
            ?? 49_152 + (randomBytes(2).readUInt16BE(0) % 15_000);
        const clusterDirectory = path.join(root, "postgres");
        const socketDirectory = existingServerConfig?.socketDirectory ?? path.join(root, "socket");

        await chmod(root, 0o700);
        await writeFile(path.join(root, ISOLATION_MARKER_FILE), `${token}\n`, { mode: 0o600 });
        if (!borrowedExistingServer) {
            await mkdir(clusterDirectory, { mode: 0o700 });
            await mkdir(socketDirectory, { mode: 0o700 });
        }
        context = {
            root,
            token,
            databaseName,
            user,
            port,
            clusterDirectory,
            socketDirectory,
            borrowedExistingServer,
            existingServerConfig,
            ownedExistingDatabase: null,
            startAttempted: false,
            environment: null,
        };
        context.environment = isolatedEnvironment(context);
        await assertSafeTemporaryRoot(context);
        signalLifecycle.throwIfInterrupted();

        if (borrowedExistingServer) {
            await assertDatabaseIdentity(context, "postgres");
        }
        else {
            await runCommand("initdb", [
                "-D", clusterDirectory,
                `--username=${user}`,
                "--auth-local=trust",
                "--auth-host=reject",
                "--encoding=UTF8",
                "--no-locale",
            ], { env: context.environment });
            await chmod(clusterDirectory, 0o700);
            await writeFile(path.join(clusterDirectory, "postgresql.conf"), [
                "",
                "# Disposable Lerniqa import-ownership test cluster.",
                "listen_addresses = ''",
                `port = ${port}`,
                `unix_socket_directories = ${postgresqlString(socketDirectory)}`,
                "unix_socket_permissions = 0700",
                "",
            ].join("\n"), { encoding: "utf8", flag: "a" });

            context.startAttempted = true;
            await runCommand("pg_ctl", [
                "-D", clusterDirectory,
                "-l", path.join(root, "postgres.log"),
                "-w", "start",
            ], { env: context.environment });
            await assertDatabaseIdentity(context, "postgres");
        }

        await createTestDatabase(context);
        await applyMigrations(context, manifest);
        await runCommand(process.execPath, [
            "--test",
            path.join(REPOSITORY_ROOT, "tests", "hanlin-import-ownership.test.mjs"),
            path.join(REPOSITORY_ROOT, "tests", "hanlin-import-ownership.integration.test.mjs"),
        ], { env: context.environment, stdio: "inherit" });
    }
    catch (error) {
        primaryError = error;
    }
    finally {
        try {
            await signalLifecycle.cleanupOnce(async () => {
                if (context !== null) await cleanup(context);
            });
        }
        catch (error) {
            cleanupError = error;
        }
    }

    if (primaryError !== null && cleanupError !== null) {
        throw new AggregateError([primaryError, cleanupError], "ownership test failed and isolated cleanup was not safe");
    }
    if (cleanupError !== null) throw cleanupError;
    assert.equal(signalLifecycle.cleanupConfirmed, true,
        "import ownership cleanup must finish before the runner chooses an exit code");
    const handledInterruption = primaryError instanceof ImportOwnershipSignalError
        && signalLifecycle.signal !== null;
    if (primaryError !== null && !handledInterruption) throw primaryError;
    if (signalLifecycle.signal !== null) return signalLifecycle.exitCode;
    process.stdout.write(context?.borrowedExistingServer
        ? "Hanlin import ownership tests passed in an owned disposable database on the approved local PostgreSQL server.\n"
        : "Hanlin import ownership tests passed in a disposable PostgreSQL cluster.\n");
    return 0;
}

const isEntrypoint = typeof process.argv[1] === "string"
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
    const signalLifecycle = createImportOwnershipSignalLifecycle();
    activeSignalLifecycle = signalLifecycle;
    try {
        await verifyLocalPostgresTestLockProof({ requireDirectParent: true });
        process.exitCode = await main(signalLifecycle);
    }
    catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
    finally {
        activeSignalLifecycle = null;
        signalLifecycle.dispose();
    }
}
