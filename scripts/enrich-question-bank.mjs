#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    assertResumeCompatible,
    acquireJsonlLock,
    assertLocalModelUnchanged,
    CHECKPOINT_INTERVAL,
    classifyWithLocalModel,
    createCheckpoint,
    createResultRecord,
    createRunHeader,
    defaultOutputPath,
    deterministicStratifiedSample,
    inspectLocalModel,
    openJsonlWriter,
    prepareQuestionInput,
    QuestionEnrichmentError,
    readJsonlFile,
    readJsonlForResume,
    safeErrorSummary,
    SAMPLE_SEED,
} from "./lib/question-enrichment.mjs";
import {
    assertConnectedLocalDatabaseIdentity,
    assertLocalDatabaseFilesystem,
    createLocalDatabaseClient,
    localDatabaseConfiguration,
    persistPendingSuggestions,
    readCurrentPublishedQuestions,
} from "./lib/question-enrichment-db.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function usage() {
    return [
        "Usage:",
        "  node scripts/enrich-question-bank.mjs --sample <count> [--output <jsonl>]",
        "  node scripts/enrich-question-bank.mjs --all [--output <jsonl>]",
        "  node scripts/enrich-question-bank.mjs --persist --input <completed-jsonl>",
        "",
        "Generation is dry-run by default: it reads only current published system questions and writes JSONL.",
        "--persist is the only mode that may write pending suggestions, after fail-closed schema detection.",
    ].join("\n");
}

function positiveInteger(value, label) {
    if (!/^\d+$/u.test(value ?? "")) {
        throw new QuestionEnrichmentError("INVALID_ARGUMENT", `${label} 必須是正整數。`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new QuestionEnrichmentError("INVALID_ARGUMENT", `${label} 必須是正整數。`);
    }
    return parsed;
}

export function parseArguments(argv, repositoryRoot = REPOSITORY_ROOT) {
    const parsed = { all: false, sample: null, output: null, persist: false, input: null, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--all") parsed.all = true;
        else if (argument === "--persist") parsed.persist = true;
        else if (argument === "--help" || argument === "-h") parsed.help = true;
        else if (["--sample", "--output", "--input"].includes(argument)) {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) {
                throw new QuestionEnrichmentError("INVALID_ARGUMENT", `${argument} 缺少參數。`);
            }
            if (argument === "--sample") parsed.sample = positiveInteger(value, "--sample");
            if (argument === "--output") parsed.output = path.resolve(repositoryRoot, value);
            if (argument === "--input") parsed.input = path.resolve(repositoryRoot, value);
            index += 1;
        }
        else {
            throw new QuestionEnrichmentError("INVALID_ARGUMENT", `不支援的參數：${argument}`);
        }
    }
    if (parsed.help) return parsed;
    if (parsed.persist) {
        if (!parsed.input || parsed.all || parsed.sample !== null || parsed.output) {
            throw new QuestionEnrichmentError(
                "INVALID_ARGUMENT",
                "--persist 必須單獨搭配 --input <completed-jsonl>，不可同時執行模型分類。",
            );
        }
        return Object.freeze({ mode: "persist", input: parsed.input });
    }
    if (parsed.input || parsed.all === (parsed.sample !== null)) {
        throw new QuestionEnrichmentError("INVALID_ARGUMENT", "產生 JSONL 時必須且只能指定 --all 或 --sample <count>。 ");
    }
    const selection = parsed.all
        ? Object.freeze({ mode: "all" })
        : Object.freeze({ mode: "sample", size: parsed.sample, seed: SAMPLE_SEED });
    return Object.freeze({
        mode: "generate",
        selection,
        output: parsed.output ?? defaultOutputPath(repositoryRoot, selection),
    });
}

function displayPath(filePath) {
    const relative = path.relative(REPOSITORY_ROOT, filePath);
    return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
        ? relative
        : path.basename(filePath);
}

async function loadQuestionSnapshot(environment) {
    const configuration = localDatabaseConfiguration(REPOSITORY_ROOT, environment);
    const filesystem = await assertLocalDatabaseFilesystem(configuration);
    const client = createLocalDatabaseClient(configuration, {
        readOnly: true,
        applicationName: "lerniqa-question-enrichment-read-only",
    });
    try {
        await client.connect();
        await assertConnectedLocalDatabaseIdentity(client, configuration, filesystem);
        return await readCurrentPublishedQuestions(client);
    }
    finally {
        await client.end().catch(() => undefined);
    }
}

export async function generateJsonl(options, {
    environment = process.env,
    fetchImpl = fetch,
    loadQuestions = loadQuestionSnapshot,
} = {}) {
    const questions = await loadQuestions(environment);
    const prepared = questions
        .map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const selected = options.selection.mode === "all"
        ? [...prepared]
        : deterministicStratifiedSample(prepared, options.selection.size, options.selection.seed);
    const lock = await acquireJsonlLock(options.output);
    try {
        const existing = await readJsonlForResume(options.output);
        const model = await inspectLocalModel({
            baseUrl: environment.LERNIQA_ENRICHMENT_OLLAMA_URL ?? "http://127.0.0.1:11434",
            fetchImpl,
        });
        const expectedHeader = createRunHeader({
            selection: options.selection,
            selected,
            catalog: prepared,
            model,
            runId: existing?.header.run_id,
        });
        const completed = existing
            ? assertResumeCompatible(existing, expectedHeader, selected)
            : new Set();
        const results = existing ? [...existing.results] : [];
        if (existing?.lastCheckpoint?.complete) {
            return Object.freeze({
                ok: true,
                persisted: false,
                resumed: true,
                already_complete: true,
                selected: selected.length,
                processed: results.length,
                output: displayPath(options.output),
            });
        }

        const writer = await openJsonlWriter(options.output, { newHeader: existing ? null : expectedHeader });
        let checkpoint = existing?.lastCheckpoint ?? null;
        try {
            for (const item of selected) {
                const key = `${item.questionId}:${item.revisionId}`;
                if (completed.has(key)) continue;
                const classification = await classifyWithLocalModel(item, model, { fetchImpl });
                const result = createResultRecord(item, classification, existing?.header ?? expectedHeader);
                await writer.write(result);
                results.push(result);
                if (results.length % CHECKPOINT_INTERVAL === 0) {
                    await assertLocalModelUnchanged(model, { fetchImpl });
                    checkpoint = createCheckpoint(results, selected.length, results.length === selected.length);
                    await writer.checkpoint(checkpoint);
                }
            }
            if (!checkpoint?.complete || checkpoint.processed_count !== results.length) {
                await assertLocalModelUnchanged(model, { fetchImpl });
                checkpoint = createCheckpoint(results, selected.length, true);
                await writer.checkpoint(checkpoint);
            }
        }
        finally {
            await writer.close();
        }
        return Object.freeze({
            ok: true,
            persisted: false,
            resumed: Boolean(existing),
            already_complete: false,
            selected: selected.length,
            processed: results.length,
            sample_coverage: expectedHeader.sample_coverage,
            output: displayPath(options.output),
        });
    }
    finally {
        await lock.release();
    }
}

export async function persistJsonl(options, { environment = process.env } = {}) {
    const lock = await acquireJsonlLock(options.input);
    try {
        const parsed = await readJsonlFile(options.input);
        if (!parsed) {
            throw new QuestionEnrichmentError("INPUT_NOT_FOUND", "找不到指定的 enrichment JSONL。 ");
        }
        const configuration = localDatabaseConfiguration(REPOSITORY_ROOT, environment);
        const filesystem = await assertLocalDatabaseFilesystem(configuration);
        const client = createLocalDatabaseClient(configuration, {
            readOnly: false,
            applicationName: "lerniqa-question-enrichment-persist",
        });
        try {
            await client.connect();
            await assertConnectedLocalDatabaseIdentity(client, configuration, filesystem);
            return await persistPendingSuggestions(client, parsed);
        }
        finally {
            await client.end().catch(() => undefined);
        }
    }
    finally {
        await lock.release();
    }
}

export async function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArguments(argv);
        if (options.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const summary = options.mode === "persist"
            ? await persistJsonl(options)
            : await generateJsonl(options);
        process.stdout.write(`${JSON.stringify(summary)}\n`);
    }
    catch (error) {
        process.stdout.write(`${JSON.stringify(safeErrorSummary(error))}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
