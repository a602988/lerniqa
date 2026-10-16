import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceScript = path.join(repositoryRoot, "scripts", "backup-local-data.sh");

async function writeExecutable(filePath, contents) {
    await writeFile(filePath, contents, { mode: 0o700 });
    await chmod(filePath, 0o700);
}

test("backup command preserves existing bundles and includes only committed assets", async (context) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-backup-test-"));
    context.after(async () => rm(temporaryRoot, { recursive: true, force: true }));

    const fakeRepository = path.join(temporaryRoot, "repository");
    const scriptDirectory = path.join(fakeRepository, "scripts");
    const localDataDirectory = path.join(fakeRepository, "local-data");
    const clusterDirectory = path.join(localDataDirectory, "postgres");
    const socketDirectory = path.join(localDataDirectory, "postgres-socket");
    const assetsDirectory = path.join(localDataDirectory, "assets");
    const fakeBin = path.join(temporaryRoot, "bin");

    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(clusterDirectory, { recursive: true });
    await mkdir(socketDirectory, { recursive: true });
    await mkdir(path.join(assetsDirectory, ".staging"), { recursive: true });
    await mkdir(path.join(assetsDirectory, "documents"), { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await cp(sourceScript, path.join(scriptDirectory, "backup-local-data.sh"));
    await writeFile(path.join(clusterDirectory, "PG_VERSION"), "18\n");
    await writeFile(path.join(clusterDirectory, ".lerniqa-local-postgres"), "lerniqa-local-postgres-v1\n");
    await writeFile(path.join(assetsDirectory, "documents", "source.docx"), "sanitized source\n");
    await writeFile(path.join(assetsDirectory, ".staging", "unfinished.docx"), "must not be backed up\n");

    await writeExecutable(path.join(fakeBin, "pg_ctl"), "#!/bin/sh\nexit 0\n");
    await writeExecutable(path.join(fakeBin, "pg_isready"), "#!/bin/sh\nexit 0\n");
    await writeExecutable(path.join(fakeBin, "date"), `#!/bin/sh
case "$*" in
    *%Y%m%dT%H%M%SZ*) printf '%s\\n' '20260102T030405Z' ;;
    *) printf '%s\\n' '2026-01-02T03:04:05Z' ;;
esac
`);
    await writeExecutable(path.join(fakeBin, "psql"), `#!/bin/sh
sql=''
previous=''
for argument in "$@"
do
    if [ "$previous" = '-c' ]; then sql=$argument; fi
    previous=$argument
done
case "$sql" in
    *'SHOW data_directory'*) printf '%s\\n' "$FAKE_PGDATA" ;;
    *'SHOW listen_addresses'*) printf '\\n' ;;
    *'SHOW unix_socket_directories'*) printf '%s\\n' "$FAKE_SOCKET" ;;
    *'SHOW unix_socket_permissions'*) printf '%s\\n' '0700' ;;
    *'SHOW port'*) printf '%s\\n' '55432' ;;
    *'inet_server_addr() IS NULL'*) printf '%s\\n' 't' ;;
    *'pg_catalog.pg_database'*) printf '%s\\n' 't' ;;
    *) printf '%s\\n' 'unexpected SQL' >&2; exit 1 ;;
esac
`);
    await writeExecutable(path.join(fakeBin, "pg_dump"), `#!/bin/sh
output=''
for argument in "$@"
do
    case "$argument" in
        --file=*) output=\${argument#--file=} ;;
    esac
done
[ -n "$output" ] || exit 2
printf '%s\\n' 'fake PostgreSQL custom dump' > "$output"
`);
    await writeExecutable(path.join(fakeBin, "pg_restore"), `#!/bin/sh
[ "$1" = '--list' ] || exit 2
printf '%s\\n' '; fake archive table of contents'
`);

    const environment = {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        FAKE_PGDATA: await realpath(clusterDirectory),
        FAKE_SOCKET: await realpath(socketDirectory),
    };
    const backupScript = path.join(scriptDirectory, "backup-local-data.sh");
    const firstRun = spawnSync("sh", [backupScript], { encoding: "utf8", env: environment });
    assert.equal(firstRun.status, 0, firstRun.stderr);

    const backupsDirectory = path.join(localDataDirectory, "backups");
    const firstBundle = path.join(backupsDirectory, "lerniqa-local-20260102T030405Z");
    const firstManifestBefore = await readFile(path.join(firstBundle, "manifest.txt"), "utf8");
    assert.match(firstManifestBefore, /^assets_included=yes$/m);
    assert.match(firstManifestBefore, /^assets_file_count=1$/m);
    assert.equal((await stat(firstBundle)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(firstBundle, "database.dump"))).mode & 0o077, 0);

    const archiveList = await readFile(path.join(firstBundle, "assets.archive-list.txt"), "utf8");
    assert.match(archiveList, /^assets\/documents\/source\.docx$/m);
    assert.doesNotMatch(archiveList, /\.staging/);
    execFileSync("shasum", ["-a", "256", "-c", "checksums.sha256"], {
        cwd: firstBundle,
        stdio: "ignore",
    });
    execFileSync("shasum", ["-a", "256", "-c", "manifest.sha256"], {
        cwd: firstBundle,
        stdio: "ignore",
    });

    const secondRun = spawnSync("sh", [backupScript], { encoding: "utf8", env: environment });
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.deepEqual((await readdir(backupsDirectory)).sort(), [
        "lerniqa-local-20260102T030405Z",
        "lerniqa-local-20260102T030405Z-01",
    ]);
    assert.equal(await readFile(path.join(firstBundle, "manifest.txt"), "utf8"), firstManifestBefore);
});
