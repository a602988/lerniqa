import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function repositoryFile(relativePath) {
    return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("the long-running dev site and validation build never share Next output", async () => {
    const [packageJson, nextConfig] = await Promise.all([
        repositoryFile("package.json").then(JSON.parse),
        repositoryFile("next.config.ts"),
    ]);
    const devOutput = packageJson.scripts.dev.match(/LERNIQA_NEXT_DIST_DIR=([^ ]+)/u)?.[1];
    const buildOutput = packageJson.scripts.build.match(/LERNIQA_NEXT_DIST_DIR=([^ ]+)/u)?.[1];
    const startOutput = packageJson.scripts.start.match(/LERNIQA_NEXT_DIST_DIR=([^ ]+)/u)?.[1];

    assert.equal(devOutput, ".next-dev");
    assert.equal(buildOutput, ".next-build");
    assert.equal(startOutput, buildOutput);
    assert.notEqual(devOutput, buildOutput);
    assert.match(nextConfig, /distDir:\s*process\.env\.LERNIQA_NEXT_DIST_DIR\s*\?\?\s*"\.next"/u);
});
