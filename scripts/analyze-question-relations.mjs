#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    RELATION_ANALYSIS_SCHEMA,
    RELATION_ANALYSIS_VERSION,
    buildRelationAnalysisDocument,
    analyzeQuestionRelations,
} from "./lib/question-relation-analysis.mjs";
import { persistPendingQuestionRelations } from "./lib/question-relation-analysis-db.mjs";
import {
    assertConnectedLocalDatabaseIdentity,
    assertLocalDatabaseFilesystem,
    createLocalDatabaseClient,
    localDatabaseConfiguration,
    readCurrentPublishedQuestions,
} from "./lib/question-enrichment-db.mjs";
import {
    inspectLocalModel,
    prepareQuestionInput,
    safeErrorSummary,
    sha256,
} from "./lib/question-enrichment.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function usage() {
    return [
        "Usage:",
        "  node scripts/analyze-question-relations.mjs --all [--output <json>]",
        "  node scripts/analyze-question-relations.mjs --sample <count> [--output <json>]",
        "  node scripts/analyze-question-relations.mjs --persist --input <json>",
        "",
        "分析預設只產生檔案；只有 --persist 會把結果寫成 pending 待審資料。",
    ].join("\n");
}

function positiveInteger(value) {
    if (!/^\d+$/u.test(value ?? "") || Number(value) < 1) throw new TypeError("--sample 必須是正整數。");
    return Number(value);
}

export function parseArguments(argv) {
    const options = { all: false, sample: null, output: null, persist: false, input: null, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--all") options.all = true;
        else if (argument === "--persist") options.persist = true;
        else if (["--help", "-h"].includes(argument)) options.help = true;
        else if (["--sample", "--output", "--input"].includes(argument)) {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) throw new TypeError(`${argument} 缺少參數。`);
            if (argument === "--sample") options.sample = positiveInteger(value);
            if (argument === "--output") options.output = path.resolve(REPOSITORY_ROOT, value);
            if (argument === "--input") options.input = path.resolve(REPOSITORY_ROOT, value);
            index += 1;
        }
        else throw new TypeError(`不支援的參數：${argument}`);
    }
    if (options.help) return options;
    if (options.persist) {
        if (!options.input || options.all || options.sample || options.output) {
            throw new TypeError("--persist 必須單獨搭配 --input <json>。");
        }
        return { mode: "persist", input: options.input };
    }
    if (options.all === (options.sample !== null) || options.input) {
        throw new TypeError("分析時必須且只能指定 --all 或 --sample <count>。");
    }
    return {
        mode: "analyze",
        sample: options.sample,
        output: options.output ?? path.join(REPOSITORY_ROOT, "local-data", "question-relations.json"),
    };
}

async function openDatabase(environment, readOnly, applicationName) {
    const configuration = localDatabaseConfiguration(REPOSITORY_ROOT, environment);
    const filesystem = await assertLocalDatabaseFilesystem(configuration);
    const client = createLocalDatabaseClient(configuration, { readOnly, applicationName });
    await client.connect();
    await assertConnectedLocalDatabaseIdentity(client, configuration, filesystem);
    return client;
}

function selectQuestions(questions, sample) {
    if (sample === null) return questions;
    if (sample > questions.length) throw new TypeError(`題庫只有 ${questions.length} 題，無法選取 ${sample} 題。`);
    return [...questions].sort((left, right) => {
        const leftRank = sha256(`relation-sample|${left.questionId}|${left.revisionId}`);
        const rightRank = sha256(`relation-sample|${right.questionId}|${right.revisionId}`);
        return leftRank.localeCompare(rightRank, "en");
    }).slice(0, sample);
}

async function writeDocument(filePath, document) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await rename(temporary, filePath);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

async function readCheckpoint(filePath) {
    try {
        return JSON.parse(await readFile(filePath, "utf8"));
    }
    catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
    }
}

function assertCompatibleCheckpoint(checkpoint, expected) {
    if (checkpoint.schema_version !== RELATION_ANALYSIS_SCHEMA
        || checkpoint.method_version !== RELATION_ANALYSIS_VERSION
        || checkpoint.source_manifest_sha256 !== expected.source_manifest_sha256
        || checkpoint.model?.name !== expected.model.name
        || checkpoint.model?.digest !== expected.model.digest
        || !Array.isArray(checkpoint.results)
        || checkpoint.result_count !== checkpoint.results.length
        || typeof checkpoint.run_id !== "string") {
        throw new TypeError("既有題型關係分析檔與目前題庫、模型或 schema 不相容；請指定新的輸出檔。 ");
    }
    const selected = new Set(expected.results.map((result) => result.question_revision_id));
    const seen = new Set();
    for (const result of checkpoint.results) {
        if (!selected.has(result.question_revision_id) || seen.has(result.question_revision_id)) {
            throw new TypeError("既有題型關係分析 checkpoint 含範圍外或重複題目版本。 ");
        }
        seen.add(result.question_revision_id);
    }
    return checkpoint;
}

export async function analyze(options, { environment = process.env, fetchImpl = fetch } = {}) {
    const client = await openDatabase(environment, true, "lerniqa-question-relation-read-only");
    let questions;
    try {
        questions = selectQuestions(await readCurrentPublishedQuestions(client), options.sample);
    }
    finally {
        await client.end().catch(() => undefined);
    }
    const model = await inspectLocalModel({
        baseUrl: environment.LERNIQA_ENRICHMENT_OLLAMA_URL ?? "http://127.0.0.1:11434",
        fetchImpl,
    });
    const expected = buildRelationAnalysisDocument(questions, questions.map((question) => {
        const prepared = prepareQuestionInput(question);
        return { question_id: prepared.questionId, question_revision_id: prepared.revisionId, input_sha256: prepared.inputSha256 };
    }), model);
    const stored = await readCheckpoint(options.output);
    const checkpoint = stored ? assertCompatibleCheckpoint(stored, expected) : null;
    if (checkpoint?.complete === true && checkpoint.result_count === questions.length) {
        return { persisted: false, analyzed: questions.length, resumed: true, already_complete: true, output: path.relative(REPOSITORY_ROOT, options.output) };
    }
    const results = checkpoint ? [...checkpoint.results] : [];
    const completed = new Set(results.map((result) => result.question_revision_id));
    const runId = checkpoint?.run_id ?? expected.run_id;
    for (const question of questions) {
        if (completed.has(question.revisionId)) continue;
        results.push(await analyzeQuestionRelations(question, model, { fetchImpl }));
        const partial = buildRelationAnalysisDocument(questions, results, model, { runId, complete: false });
        await writeDocument(options.output, partial);
    }
    const document = buildRelationAnalysisDocument(questions, results, model, { runId, complete: true });
    await writeDocument(options.output, document);
    return { persisted: false, analyzed: results.length, resumed: Boolean(checkpoint), already_complete: false, output: path.relative(REPOSITORY_ROOT, options.output) };
}

export async function persist(options, { environment = process.env } = {}) {
    const raw = await readFile(options.input, "utf8");
    const document = JSON.parse(raw);
    const client = await openDatabase(environment, false, "lerniqa-question-relation-persist");
    try {
        return await persistPendingQuestionRelations(client, document);
    }
    finally {
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
        const result = options.mode === "persist" ? await persist(options) : await analyze(options);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    catch (error) {
        process.stdout.write(`${JSON.stringify(safeErrorSummary(error))}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await main();
}
