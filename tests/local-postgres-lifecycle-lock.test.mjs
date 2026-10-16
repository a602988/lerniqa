import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceScript = path.join(repositoryRoot, "scripts/local-postgres.sh");

async function pathExists(target) {
    return (await lstat(target).catch(() => null)) !== null;
}

async function writeExecutable(target, contents) {
    await writeFile(target, contents, { mode: 0o700 });
    await chmod(target, 0o700);
}

async function createFixture(t) {
    const createdRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-postgres-lifecycle-"));
    const root = await realpath(createdRoot);
    t.after(() => rm(root, { recursive: true, force: true }));

    const scriptsDirectory = path.join(root, "scripts");
    const databaseDirectory = path.join(root, "database/migrations");
    const localDataDirectory = path.join(root, "local-data");
    const clusterDirectory = path.join(localDataDirectory, "postgres");
    const socketDirectory = path.join(localDataDirectory, "postgres-socket");
    const stubDirectory = path.join(root, "stub-bin");
    const callLog = path.join(root, "calls.log");
    const scriptPath = path.join(scriptsDirectory, "local-postgres.sh");

    await Promise.all([
        mkdir(scriptsDirectory, { recursive: true }),
        mkdir(databaseDirectory, { recursive: true }),
        mkdir(clusterDirectory, { recursive: true }),
        mkdir(socketDirectory, { recursive: true }),
        mkdir(stubDirectory, { recursive: true }),
    ]);
    await copyFile(sourceScript, scriptPath);
    await chmod(scriptPath, 0o700);
    await writeFile(path.join(clusterDirectory, "PG_VERSION"), "18\n");
    await writeFile(
        path.join(clusterDirectory, ".lerniqa-local-postgres"),
        "lerniqa-local-postgres-v1\n",
    );
    await writeFile(
        path.join(databaseDirectory, "0001_base.up.sql"),
        "-- synthetic migration; the stub database reports it as applied\n",
    );

    await writeExecutable(path.join(stubDirectory, "pg_ctl"), `#!/bin/sh
printf 'pg_ctl' >> "$STUB_CALL_LOG"
printf ' %s' "$@" >> "$STUB_CALL_LOG"
printf '\n' >> "$STUB_CALL_LOG"
for argument in "$@"
do
    if [ "$argument" = "status" ]; then
        exit "\${STUB_PG_CTL_STATUS:-0}"
    fi
done
exit 0
`);
    await writeExecutable(path.join(stubDirectory, "lsof"), `#!/bin/sh
printf 'lsof' >> "$STUB_CALL_LOG"
printf ' %s' "$@" >> "$STUB_CALL_LOG"
printf '\n' >> "$STUB_CALL_LOG"
[ "\${STUB_ADD_LOCK_FILE:-0}" != "1" ] \
    || printf 'unexpected\n' > "$STUB_LIFECYCLE_LOCK_DIRECTORY/unexpected"
[ -z "\${STUB_LSOF_ERROR:-}" ] || printf '%s\n' "$STUB_LSOF_ERROR" >&2
exit "\${STUB_LSOF_STATUS:-1}"
`);
    await writeExecutable(path.join(stubDirectory, "pg_isready"), `#!/bin/sh
printf 'pg_isready\n' >> "$STUB_CALL_LOG"
exit 0
`);
    await writeExecutable(path.join(stubDirectory, "psql"), `#!/bin/sh
printf 'psql' >> "$STUB_CALL_LOG"
printf ' %s' "$@" >> "$STUB_CALL_LOG"
printf '\n' >> "$STUB_CALL_LOG"
case "$*" in
    *"SHOW data_directory"*) printf '%s\n' "$STUB_CLUSTER_DIRECTORY" ;;
    *"SHOW listen_addresses"*) printf '\n' ;;
    *"SHOW unix_socket_directories"*) printf '%s\n' "$STUB_SOCKET_DIRECTORY" ;;
    *"SHOW unix_socket_permissions"*) printf '0700\n' ;;
    *"SHOW port"*) printf '55432\n' ;;
    *"SELECT inet_server_addr() IS NULL"*) printf 't\n' ;;
    *"SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database"*) printf 't\n' ;;
    *"to_regclass('public.schema_migrations')"*) printf 't\n' ;;
    *"SELECT version || '|' || name"*) printf '0001|base\n' ;;
    *) printf 'unexpected psql invocation: %s\n' "$*" >&2; exit 2 ;;
esac
`);
    for (const command of ["createdb", "initdb"]) {
        await writeExecutable(path.join(stubDirectory, command), `#!/bin/sh
printf '${command}' >> "$STUB_CALL_LOG"
printf ' %s' "$@" >> "$STUB_CALL_LOG"
printf '\n' >> "$STUB_CALL_LOG"
exit 0
`);
    }

    return {
        callLog,
        clusterDirectory,
        lifecycleLockDirectory: path.join(localDataDirectory, ".postgres-lifecycle-lock"),
        localDataDirectory,
        root,
        scriptPath,
        socketDirectory,
        stubDirectory,
    };
}

function runScript(fixture, command, environment = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn("/bin/sh", [fixture.scriptPath, command], {
            cwd: fixture.root,
            env: {
                ...process.env,
                PATH: `${fixture.stubDirectory}:${process.env.PATH}`,
                STUB_CALL_LOG: fixture.callLog,
                STUB_CLUSTER_DIRECTORY: fixture.clusterDirectory,
                STUB_LIFECYCLE_LOCK_DIRECTORY: fixture.lifecycleLockDirectory,
                STUB_SOCKET_DIRECTORY: fixture.socketDirectory,
                ...environment,
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal, stderr, stdout }));
    });
}

async function readCallLog(fixture) {
    return readFile(fixture.callLog, "utf8").catch(() => "");
}

test("all state-changing commands preserve an existing lifecycle lock", async (t) => {
    const fixture = await createFixture(t);
    const ownerFile = path.join(fixture.lifecycleLockDirectory, "owner");
    await mkdir(fixture.lifecycleLockDirectory, { mode: 0o700 });
    await writeFile(ownerFile, "synthetic-stale-owner\n", { mode: 0o600 });

    for (const command of ["init", "start", "stop", "migrate", "ensure"]) {
        const result = await runScript(fixture, command);
        assert.equal(result.code, 1, `${command}: ${result.stderr}`);
        assert.match(result.stderr, /stale lock/u);
        assert.equal(await readFile(ownerFile, "utf8"), "synthetic-stale-owner\n");
    }
    assert.equal(await readCallLog(fixture), "");
});

test("ensure reuses one lifecycle lock across nested start, init, and migrate calls", async (t) => {
    const fixture = await createFixture(t);
    const result = await runScript(fixture, "ensure");

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /本機 PostgreSQL 已在執行/u);
    assert.match(result.stdout, /migration 已是最新，共 1 版/u);
    assert.equal(await pathExists(fixture.lifecycleLockDirectory), false);
    assert.equal(
        await pathExists(path.join(fixture.localDataDirectory, ".migration-lock")),
        false,
    );
    assert.match(await readCallLog(fixture), /pg_ctl .* status/u);
});

test("stop fails closed while port 3500 is active and releases its own lock", async (t) => {
    const fixture = await createFixture(t);
    const result = await runScript(fixture, "stop", { STUB_LSOF_STATUS: "0" });
    const calls = await readCallLog(fixture);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /port 3500/u);
    assert.match(result.stderr, /LERNIQA_POSTGRES_MAINTENANCE=1/u);
    assert.match(calls, /lsof .*iTCP:3500 .*TCP:LISTEN/u);
    assert.doesNotMatch(calls, /pg_ctl .* -m fast /u);
    assert.equal(await pathExists(fixture.lifecycleLockDirectory), false);
});

test("stop also fails closed when port inspection itself fails", async (t) => {
    const fixture = await createFixture(t);
    const result = await runScript(fixture, "stop", { STUB_LSOF_STATUS: "2" });
    const calls = await readCallLog(fixture);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /無法確認 port 3500/u);
    assert.doesNotMatch(calls, /pg_ctl .* -m fast /u);
    assert.equal(await pathExists(fixture.lifecycleLockDirectory), false);
});

test("a no-match exit accompanied by an lsof error still fails closed", async (t) => {
    const fixture = await createFixture(t);
    const result = await runScript(fixture, "stop", {
        STUB_LSOF_ERROR: "synthetic inspection failure",
        STUB_LSOF_STATUS: "1",
    });
    const calls = await readCallLog(fixture);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /無法確認 port 3500/u);
    assert.doesNotMatch(calls, /pg_ctl .* -m fast /u);
    assert.equal(await pathExists(fixture.lifecycleLockDirectory), false);
});

test("cleanup preserves a lifecycle lock whose contents changed", async (t) => {
    const fixture = await createFixture(t);
    const result = await runScript(fixture, "stop", {
        STUB_ADD_LOCK_FILE: "1",
        STUB_LSOF_STATUS: "0",
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /包含非本次建立的內容/u);
    assert.equal(await pathExists(path.join(fixture.lifecycleLockDirectory, "owner")), true);
    assert.equal(await pathExists(path.join(fixture.lifecycleLockDirectory, "unexpected")), true);
});

test("the exact maintenance override permits an intentional stop", async (t) => {
    const fixture = await createFixture(t);
    const result = await runScript(fixture, "stop", {
        LERNIQA_POSTGRES_MAINTENANCE: "1",
        STUB_LSOF_STATUS: "0",
    });
    const calls = await readCallLog(fixture);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /已停止本機 PostgreSQL/u);
    assert.doesNotMatch(calls, /lsof/u);
    assert.match(calls, /pg_ctl .* -m fast -w stop/u);
    assert.equal(await pathExists(fixture.lifecycleLockDirectory), false);
});

test("the shared-memory startup diagnostic remains present", async () => {
    const script = await readFile(sourceScript, "utf8");
    assert.match(script, /could not create shared memory segment/u);
    assert.match(script, /勿直接停止其他專案服務/u);
    assert.doesNotMatch(script, /migration_lock_directory/u);
});
