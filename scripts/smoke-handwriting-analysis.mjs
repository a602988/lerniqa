#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    loadQualityManifest,
    resolveSyntheticFixturePaths,
    runHybridQualitySuite,
    runQualitySuite,
} from "./lib/handwriting-quality.mjs";
import { compactErrorCode } from "../app/lib/handwriting-analysis.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function usage() {
    return [
        "Usage:",
        "  node scripts/smoke-handwriting-analysis.mjs --manifest <json> --png-dir <dir> [--dry-run]",
        "  node scripts/smoke-handwriting-analysis.mjs --manifest <json> --png-dir <dir> --execute [--hybrid]",
        "",
        "Paths must remain under tests/fixtures/handwriting-ai-synthetic/.",
        "Safe default validates only the manifest and PNG directory; --execute is required to call local models.",
    ].join("\n");
}

export function parseArguments(argv) {
    const parsed = { manifest: null, pngDirectory: null, execute: false, hybrid: false, help: false };
    let executionSeen = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") parsed.help = true;
        else if (argument === "--manifest" || argument === "--png-dir") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) throw Object.assign(new Error(`${argument} 缺少參數。`), { code: "INVALID_ARGUMENT" });
            if (argument === "--manifest") parsed.manifest = value;
            else parsed.pngDirectory = value;
            index += 1;
        }
        else if (argument === "--dry-run" || argument === "--execute") {
            if (executionSeen) throw Object.assign(new Error("--dry-run 與 --execute 只能選一個。"), { code: "INVALID_ARGUMENT" });
            parsed.execute = argument === "--execute";
            executionSeen = true;
        }
        else if (argument === "--hybrid") parsed.hybrid = true;
        else throw Object.assign(new Error(`不支援的參數：${argument}`), { code: "INVALID_ARGUMENT" });
    }
    if (!parsed.help && (!parsed.manifest || !parsed.pngDirectory)) {
        throw Object.assign(new Error("必須指定 --manifest 與 --png-dir。"), { code: "INVALID_ARGUMENT" });
    }
    return Object.freeze(parsed);
}

export async function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArguments(argv);
        if (options.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const paths = await resolveSyntheticFixturePaths(REPOSITORY_ROOT, options.manifest, options.pngDirectory);
        const manifest = await loadQualityManifest(paths);
        const summary = options.execute
            ? options.hybrid
                ? await runHybridQualitySuite(manifest, paths)
                : await runQualitySuite(manifest, paths)
            : Object.freeze({ ok: true, dry_run: true, fixtures: manifest.fixtures.length, model_called: false });
        process.stdout.write(`${JSON.stringify(summary)}\n`);
        if (options.execute && !summary.passed) process.exitCode = 1;
    }
    catch (error) {
        process.stdout.write(`${JSON.stringify({ ok: false, error_code: compactErrorCode(error) })}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
