#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    assertEligibleClaim,
    compactErrorCode,
    handwritingAiConfiguration,
    HandwritingAnalysisError,
    inspectHandwritingModel,
    readHandwritingAsset,
    transcribeHandwriting,
    unloadHandwritingModel,
} from "../app/lib/handwriting-analysis.mjs";
import {
    acquireHandwritingWorkerLock,
    assertConnectedHandwritingDatabase,
    assertHandwritingAnalysisSchema,
    assertHandwritingDatabaseFilesystem,
    claimEligibleHandwritingJob,
    completeHandwritingJob,
    createHandwritingDatabaseClient,
    failHandwritingJob,
    handwritingDatabaseConfiguration,
    previewEligibleHandwritingJob,
    releaseHandwritingWorkerLock,
} from "./lib/handwriting-analysis-db.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTINUOUS_POLL_MS = 5_000;

export function usage() {
    return [
        "Usage:",
        "  node scripts/process-handwriting-analysis.mjs [--once] [--dry-run]",
        "  node scripts/process-handwriting-analysis.mjs --once --execute",
        "  node scripts/process-handwriting-analysis.mjs --continuous --execute",
        "",
        "Safe default is --once --dry-run. Dry-run only reports whether one eligible job exists;",
        "it does not lease a job, read an image, call Ollama, or write the database.",
    ].join("\n");
}

export function parseArguments(argv) {
    const parsed = { mode: "once", execute: false, help: false };
    let modeSeen = false;
    let executionSeen = false;
    for (const argument of argv) {
        if (argument === "--help" || argument === "-h") parsed.help = true;
        else if (argument === "--once" || argument === "--continuous") {
            if (modeSeen) throw new HandwritingAnalysisError("INVALID_ARGUMENT", "--once 與 --continuous 只能選一個。 ");
            parsed.mode = argument.slice(2);
            modeSeen = true;
        }
        else if (argument === "--dry-run" || argument === "--execute") {
            if (executionSeen) throw new HandwritingAnalysisError("INVALID_ARGUMENT", "--dry-run 與 --execute 只能選一個。 ");
            parsed.execute = argument === "--execute";
            executionSeen = true;
        }
        else throw new HandwritingAnalysisError("INVALID_ARGUMENT", `不支援的參數：${argument}`);
    }
    if (!parsed.help && parsed.mode === "continuous" && !parsed.execute) {
        throw new HandwritingAnalysisError("INVALID_ARGUMENT", "--continuous 必須明確搭配 --execute，避免空轉讀取。 ");
    }
    return Object.freeze(parsed);
}

function safeSummary(error) {
    return Object.freeze({
        ok: false,
        error_code: compactErrorCode(error),
        retryable: error instanceof HandwritingAnalysisError ? error.retryable : false,
    });
}

function waitForPoll(signal) {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, CONTINUOUS_POLL_MS);
        timer.unref?.();
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

export async function processClaim(client, candidate, model, workerId, {
    repositoryRoot = REPOSITORY_ROOT,
    fetchImpl = fetch,
    readAsset = readHandwritingAsset,
    transcribe = transcribeHandwriting,
    complete = completeHandwritingJob,
    failJob = failHandwritingJob,
} = {}) {
    try {
        assertEligibleClaim(candidate);
        const bytes = await readAsset(candidate, repositoryRoot);
        const transcription = await transcribe(bytes, model, { fetchImpl });
        await complete(client, { workerId, candidate, transcription });
        return Object.freeze({
            ok: true,
            job_id: candidate.jobId,
            run_id: candidate.runId,
            recognized_text: transcription.transcription,
            legibility: transcription.legibility,
        });
    }
    catch (error) {
        const errorCode = compactErrorCode(error);
        const retryable = error instanceof HandwritingAnalysisError && error.retryable;
        await failJob(client, { workerId, candidate, errorCode, retryable }).catch(() => undefined);
        throw error;
    }
}

export async function runWorker(options, {
    environment = process.env,
    fetchImpl = fetch,
    signal,
    repositoryRoot = REPOSITORY_ROOT,
    createClient = createHandwritingDatabaseClient,
    inspectModel = inspectHandwritingModel,
    claimJob = claimEligibleHandwritingJob,
    previewJob = previewEligibleHandwritingJob,
    unloadModel = unloadHandwritingModel,
    processOne = processClaim,
} = {}) {
    const configuration = handwritingDatabaseConfiguration(repositoryRoot, environment);
    const aiConfiguration = handwritingAiConfiguration(environment);
    const filesystem = await assertHandwritingDatabaseFilesystem(configuration);
    const client = createClient(configuration);
    const workerId = `worker-${process.pid}-${randomUUID()}`;
    let locked = false;
    let modelWasUsed = false;
    const summary = { ok: true, mode: options.mode, dry_run: !options.execute, eligible: false, processed: 0, failed: 0 };
    try {
        await client.connect();
        await assertConnectedHandwritingDatabase(client, configuration, filesystem);
        await assertHandwritingAnalysisSchema(client);
        locked = await acquireHandwritingWorkerLock(client);
        if (!locked) return Object.freeze({ ...summary, lock_acquired: false });
        if (!options.execute) {
            summary.eligible = (await previewJob(client)) !== null;
            return Object.freeze({ ...summary, lock_acquired: true });
        }
        while (!signal?.aborted) {
            const model = await inspectModel({ configuration: aiConfiguration, fetchImpl });
            const candidate = await claimJob(client, { workerId, runId: randomUUID(), model });
            if (!candidate) {
                if (options.mode === "once") break;
                await waitForPoll(signal);
                continue;
            }
            summary.eligible = true;
            modelWasUsed = true;
            try {
                await processOne(client, candidate, model, workerId, { repositoryRoot, fetchImpl });
                summary.processed += 1;
            }
            catch {
                summary.failed += 1;
                if (options.mode === "once") break;
            }
            if (options.mode === "once") break;
        }
        return Object.freeze({ ...summary, lock_acquired: true, stopped: Boolean(signal?.aborted) });
    }
    finally {
        if (modelWasUsed) await unloadModel({ configuration: aiConfiguration, fetchImpl }).catch(() => undefined);
        if (locked) await releaseHandwritingWorkerLock(client).catch(() => undefined);
        await client.end().catch(() => undefined);
    }
}

export async function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArguments(argv);
        if (options.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const controller = new AbortController();
        const stop = () => controller.abort();
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        try {
            const summary = await runWorker(options, { signal: controller.signal });
            process.stdout.write(`${JSON.stringify(summary)}\n`);
            if (summary.failed > 0) process.exitCode = 1;
        }
        finally {
            process.removeListener("SIGINT", stop);
            process.removeListener("SIGTERM", stop);
        }
    }
    catch (error) {
        process.stdout.write(`${JSON.stringify(safeSummary(error))}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
