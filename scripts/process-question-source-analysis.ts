#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Client } from "pg";
import { cropQuestionImage } from "../app/lib/question-image-crop.ts";
import { listQuestionExchangeAssets, resolveQuestionExchangePackage } from "../app/lib/question-exchange-contract.ts";
import { QuestionImportStoreError } from "../app/lib/question-import-persistence.ts";
import {
    analyzeQuestionSourcePages,
    classifyQuestionSourceDocuments,
    QuestionSourceAnalysisError,
    suggestQuestionAnswers,
    type QuestionSourceAnalysisPage,
    type ResolvedQuestionSourceRole,
} from "../app/lib/question-source-analysis.ts";
import { findQuestionSourceCatalogSuggestion } from "../app/lib/question-source-catalog.ts";
import {
    deriveQuestionSourceIdentity,
    removeQuestionSource,
    resolveQuestionSourcePath,
    storeQuestionSource,
    validateQuestionSource,
} from "../app/lib/question-source-object-store.ts";
import {
    applyQuestionSourceRoleAnalysis,
    beginQuestionSourceProcessing,
    completeQuestionSourceProcessing,
    type ProcessedPageAsset,
    type ProcessedPageDraft,
    type ProcessedQuestionAsset,
    type QuestionSourceProcessingDocument,
} from "../app/lib/question-source-processing.ts";
import {
    assertConnectedHandwritingDatabase,
    assertHandwritingDatabaseFilesystem,
    createHandwritingDatabaseClient,
    handwritingDatabaseConfiguration,
} from "./lib/handwriting-analysis-db.mjs";
import {
    claimQuestionSourceAnalysis,
    completeQuestionSourceAnalysis,
    failQuestionSourceAnalysis,
    previewQuestionSourceAnalysis,
    renewQuestionSourceAnalysisLease,
    assertQuestionSourceAnalysisSchema,
    reconcileQuestionSourceAnalysisQueue,
    type QuestionSourceCandidate,
} from "./lib/question-source-analysis-db.ts";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROCESSOR_VERSION = "lerniqa-question-scan/v1";
const WORKER_LOCK = "lerniqa:question-source-analysis-worker:v1";
const POLL_MILLISECONDS = 3_000;
const MODES = ["bw", "color", "gray", "handwriting-mask", "handwriting-removed"] as const;

interface ProcessorPage {
    cornerConfidence: number;
    corners: Array<{ x: number; y: number }>;
    dewarped: boolean;
    files: Record<(typeof MODES)[number], {
        byteSize: number;
        file: string;
        height: number;
        sha256: string;
        width: number;
    }>;
    ocr: NonNullable<QuestionSourceAnalysisPage["ocr"]>;
    ocrText: string;
    page: number;
    source: { height: number; width: number };
    warnings: string[];
}

interface ProcessorManifest {
    durationMilliseconds: number;
    pages: ProcessorPage[];
    processorVersion: string;
    schemaVersion: number;
    sourceSha256: string;
}

type WorkerOptions = Readonly<{ execute: boolean; mode: "continuous" | "once" }>;

interface ProcessedDocument {
    analysisPages: QuestionSourceAnalysisPage[];
    document: QuestionSourceProcessingDocument;
    manifest: ProcessorManifest;
    output: string;
    role: ResolvedQuestionSourceRole;
}

export function parseArguments(argv: string[]): WorkerOptions {
    let mode: WorkerOptions["mode"] = "once";
    let execute = false;
    for (const argument of argv) {
        if (argument === "--once") mode = "once";
        else if (argument === "--continuous") mode = "continuous";
        else if (argument === "--execute") execute = true;
        else if (argument !== "--dry-run") throw new Error(`INVALID_ARGUMENT:${argument}`);
    }
    if (mode === "continuous" && !execute) throw new Error("CONTINUOUS_EXECUTION_REQUIRES_EXECUTE");
    return { execute, mode };
}

function runProcessor(input: string, output: string, corners: string, useDewarp: boolean): Promise<ProcessorManifest> {
    return new Promise((resolve, reject) => {
        const python = path.resolve(REPOSITORY_ROOT, "local-data", "handwriting-python", "bin", "python");
        const script = path.resolve(REPOSITORY_ROOT, "scripts", "process-question-source.py");
        const args = [script, "--input", input, "--output", output, "--corners", corners, ...(useDewarp ? ["--dewarp"] : [])];
        const child = spawn(python, args, { cwd: REPOSITORY_ROOT, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.length > 5_000_000) child.kill("SIGKILL");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > 1_000_000) child.kill("SIGKILL");
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`QUESTION_PROCESSOR_EXIT_${code}:${stderr.slice(-2_000)}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout) as ProcessorManifest);
            }
            catch (error) {
                reject(error);
            }
        });
    });
}

function validManifest(value: ProcessorManifest, checksum: string): boolean {
    const pageNumbers = value?.pages?.map((page) => page.page) ?? [];
    return value?.schemaVersion === 1
        && value.processorVersion === PROCESSOR_VERSION
        && value.sourceSha256 === checksum
        && Array.isArray(value.pages)
        && value.pages.length >= 1
        && value.pages.length <= 20
        && new Set(pageNumbers).size === pageNumbers.length
        && value.pages.every((page) => Number.isInteger(page.page) && page.page >= 1
            && Array.isArray(page.corners) && page.corners.length === 4
            && page.corners.every((corner) => Number.isFinite(corner.x) && Number.isFinite(corner.y))
            && Number.isFinite(page.cornerConfidence) && page.cornerConfidence >= 0 && page.cornerConfidence <= 1
            && Number.isInteger(page.source?.width) && page.source.width > 0
            && Number.isInteger(page.source?.height) && page.source.height > 0
            && Array.isArray(page.ocr) && Array.isArray(page.warnings)
            && MODES.every((mode) => {
                const file = page.files?.[mode];
                return file?.file === `${mode}.png`
                    && /^[0-9a-f]{64}$/u.test(file.sha256)
                    && Number.isInteger(file.byteSize) && file.byteSize > 0
                    && Number.isInteger(file.width) && file.width > 0
                    && Number.isInteger(file.height) && file.height > 0;
            }));
}

function errorCode(error: unknown): string {
    if (error instanceof QuestionSourceAnalysisError || error instanceof QuestionImportStoreError) return error.code;
    if (error instanceof Error) {
        const code = error.message.split(":", 1)[0]?.replace(/[^A-Z0-9_.-]/gu, "_").slice(0, 80);
        if (code && /^[A-Z0-9]/u.test(code)) return code;
    }
    return "SOURCE_PROCESSING_FAILED";
}

function retryable(error: unknown): boolean {
    return error instanceof QuestionSourceAnalysisError
        && ["LOCAL_MODEL_TIMEOUT", "LOCAL_MODEL_UNAVAILABLE", "LOCAL_MODEL_LOW_CONFIDENCE"].includes(error.code);
}

async function processCandidate(client: Client, candidate: QuestionSourceCandidate, workerId: string): Promise<void> {
    const stored: Array<Awaited<ReturnType<typeof storeQuestionSource>>> = [];
    const runRoot = path.resolve(REPOSITORY_ROOT, "local-data", "question-import-runs", candidate.batchId);
    let committed = false;
    try {
        await client.query("BEGIN");
        const target = await beginQuestionSourceProcessing(client, candidate.batchId, candidate.ownerUserId);
        await client.query("COMMIT");
        await rm(runRoot, { recursive: true, force: true });
        await mkdir(runRoot, { recursive: true, mode: 0o700 });

        const processedDocuments: ProcessedDocument[] = [];
        const processedAssets: ProcessedPageAsset[] = [];

        for (const document of target.documents) {
            const input = await resolveQuestionSourcePath(document.storageKey);
            const bytes = await readFile(input);
            if (bytes.length !== document.byteSize || createHash("sha256").update(bytes).digest("hex") !== document.checksum) {
                throw new Error("QUESTION_SOURCE_CHECKSUM_MISMATCH");
            }
            const output = path.join(runRoot, `source-${document.position}`);
            await mkdir(output, { recursive: true, mode: 0o700 });
            const cornersPath = path.join(output, "corners.json");
            const corners = target.documents.length === 1 ? candidate.settings.corners : {};
            await writeFile(cornersPath, `${JSON.stringify(corners)}\n`, { encoding: "utf8", mode: 0o600 });
            const manifest = await runProcessor(input, output, cornersPath, candidate.settings.dewarp);
            if (!validManifest(manifest, document.checksum)) throw new Error("QUESTION_PROCESSOR_MANIFEST_INVALID");
            const analysisPages = await Promise.all(manifest.pages.map(async (page) => ({
                image: await readFile(path.resolve(output, `page-${page.page}`, page.files["handwriting-removed"].file)),
                ocr: page.ocr,
                ocrText: page.ocrText,
                page: page.page,
            })));
            processedDocuments.push({
                analysisPages,
                document,
                manifest,
                output,
                role: document.role === "auto" ? "supplement" : document.role,
            });

            for (const page of manifest.pages) {
                for (const mode of MODES) {
                    const evidence = page.files[mode];
                    const filePath = path.resolve(output, `page-${page.page}`, evidence.file);
                    if (!filePath.startsWith(`${output}${path.sep}`)) throw new Error("QUESTION_PROCESSOR_OUTPUT_ESCAPED");
                    const source = validateQuestionSource(await readFile(filePath));
                    if (!source || source.mimeType !== "image/png" || source.checksum !== evidence.sha256 || source.bytes.length !== evidence.byteSize) {
                        throw new Error("QUESTION_PROCESSOR_OUTPUT_INVALID");
                    }
                    const assetKey = `${candidate.batchId}:${document.position}:${page.page}:${mode}`;
                    const identity = deriveQuestionSourceIdentity(candidate.ownerUserId, assetKey, source);
                    const object = await storeQuestionSource(identity, source);
                    stored.push(object);
                    processedAssets.push({
                        byteSize: source.bytes.length,
                        checksum: source.checksum,
                        height: evidence.height,
                        id: identity.assetId,
                        mimeType: "image/png",
                        mode,
                        page: page.page,
                        sourceDocumentId: document.sourceDocumentId,
                        storageKey: identity.storageKey,
                        width: evidence.width,
                    });
                }
            }
        }

        const roleAnalysis = candidate.analyze ? await classifyQuestionSourceDocuments(processedDocuments.map((processed) => ({
            fileName: processed.document.fileName,
            pages: processed.analysisPages,
            role: processed.document.role,
            sourceDocumentId: processed.document.sourceDocumentId,
        }))) : [];
        const roles = new Map(roleAnalysis.map((result) => [result.sourceDocumentId, result.role]));
        for (const processed of processedDocuments) {
            processed.role = processed.document.role === "auto"
                ? roles.get(processed.document.sourceDocumentId) ?? "supplement"
                : processed.document.role;
        }

        const questionDocuments = processedDocuments.filter((processed) => processed.role === "question");
        if (candidate.analyze && questionDocuments.length === 0) {
            throw new QuestionSourceAnalysisError("QUESTION_SOURCE_NOT_FOUND", "找不到可建立題目的原始檔，請調整圖片用途後重新分析。", 422);
        }
        const questionAssets: ProcessedQuestionAsset[] = [];
        const resolvedQuestions: Array<{ question: import("../app/lib/question-import-contract.ts").ImportQuestionDraft; sourceDocumentId: string }> = [];
        for (const processed of questionDocuments) {
            const analyses = candidate.analyze
                ? await analyzeQuestionSourcePages(processed.analysisPages, processed.document.fileName)
                : [];
            const pageImages = new Map(processed.analysisPages.map((page) => [page.page, page.image]));
            for (const analysis of analyses) {
                const references: Record<string, string> = {};
                for (const reference of listQuestionExchangeAssets(analysis.package)) {
                    if (reference.kind !== "crop") throw new Error("QUESTION_ANALYSIS_EXTERNAL_IMAGE_UNSUPPORTED");
                    const pageImage = pageImages.get(reference.page);
                    if (!pageImage) throw new Error("QUESTION_ANALYSIS_PAGE_NOT_FOUND");
                    const crop = await cropQuestionImage(pageImage, reference.rect);
                    const source = validateQuestionSource(crop.bytes);
                    if (!source || source.mimeType !== "image/png") throw new Error("QUESTION_ANALYSIS_CROP_INVALID");
                    const cropKey = `analysis:${candidate.batchId}:${processed.document.position}:${reference.page}:${reference.ref}:${JSON.stringify(reference.rect)}`;
                    const identity = deriveQuestionSourceIdentity(candidate.ownerUserId, cropKey, source);
                    const object = await storeQuestionSource(identity, source);
                    stored.push(object);
                    questionAssets.push({
                        byteSize: source.bytes.length,
                        checksum: source.checksum,
                        height: crop.height,
                        id: identity.assetId,
                        mimeType: "image/png",
                        storageKey: identity.storageKey,
                        width: crop.width,
                    });
                    references[reference.ref] = identity.assetId;
                }
                const resolved = resolveQuestionExchangePackage(analysis.package, references);
                if (!resolved.ok) throw new Error("QUESTION_ANALYSIS_REFERENCE_UNRESOLVED");
                resolvedQuestions.push(...resolved.value.questions.map((question) => ({
                    question,
                    sourceDocumentId: processed.document.sourceDocumentId,
                })));
            }
        }

        let answerSuggestions: Awaited<ReturnType<typeof suggestQuestionAnswers>> = [];
        let answerSuggestionError: string | null = null;
        if (candidate.analyze && resolvedQuestions.length) {
            try {
                answerSuggestions = await suggestQuestionAnswers(
                    resolvedQuestions.map(({ question }) => question),
                    processedDocuments.map((processed) => ({
                        fileName: processed.document.fileName,
                        pages: processed.analysisPages,
                        role: processed.role,
                        sourceDocumentId: processed.document.sourceDocumentId,
                    })),
                );
            }
            catch (error) {
                answerSuggestionError = errorCode(error);
            }
        }
        await client.query("BEGIN");
        await applyQuestionSourceRoleAnalysis(client, target.batchId, roleAnalysis);
        const catalogSuggestion = await findQuestionSourceCatalogSuggestion(
            client,
            candidate.ownerUserId,
            processedDocuments.flatMap((processed) => processed.analysisPages.map((page) => page.ocrText)).join("\n"),
        );
        const pages: ProcessedPageDraft[] = processedDocuments.flatMap((processed) => processed.manifest.pages.map(({ files: _files, ...page }) => ({
            ...page,
            documentPosition: processed.document.position,
            fileName: processed.document.fileName,
            role: processed.role,
            sourceDocumentId: processed.document.sourceDocumentId,
        })));
        await completeQuestionSourceProcessing(
            client,
            target,
            PROCESSOR_VERSION,
            pages,
            processedAssets,
            questionAssets,
            resolvedQuestions,
            candidate.ownerUserId,
        );
        const resultPages = processedDocuments.flatMap((processed) => processed.manifest.pages.map((page) => ({
            ...page,
            documentPosition: processed.document.position,
            fileName: processed.document.fileName,
            role: processed.role,
            sourceDocumentId: processed.document.sourceDocumentId,
            files: Object.fromEntries(MODES.map((mode) => {
                const asset = processedAssets.find((item) => item.sourceDocumentId === processed.document.sourceDocumentId
                    && item.page === page.page && item.mode === mode)!;
                return [mode, { assetId: asset.id, url: `/api/v1/question-import-assets/${asset.id}` }];
            })),
        })));
        await completeQuestionSourceAnalysis(client, candidate, PROCESSOR_VERSION, {
            answerSuggestionError,
            answerSuggestions,
            catalogSuggestion,
            pages: resultPages,
        }, workerId);
        await client.query("COMMIT");
        committed = true;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        await failQuestionSourceAnalysis(client, candidate, errorCode(error), retryable(error), workerId);
        throw error;
    }
    finally {
        if (!committed) await Promise.all(stored.map((object) => removeQuestionSource(object).catch(() => undefined)));
        await rm(runRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

function waitForPoll(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, POLL_MILLISECONDS);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

export async function runWorker(options: WorkerOptions, signal: AbortSignal): Promise<{ failed: number; pending: boolean; processed: number }> {
    const configuration = handwritingDatabaseConfiguration(REPOSITORY_ROOT, process.env);
    const filesystem = await assertHandwritingDatabaseFilesystem(configuration);
    const client = createHandwritingDatabaseClient(configuration, "lerniqa-question-source-worker");
    const leaseClient = createHandwritingDatabaseClient(configuration, "lerniqa-question-source-worker-lease");
    const workerId = `question-source-${process.pid}-${randomUUID()}`;
    let locked = false;
    let processed = 0;
    let failed = 0;
    let pending = false;
    try {
        await client.connect();
        await leaseClient.connect();
        await assertConnectedHandwritingDatabase(client, configuration, filesystem);
        await assertConnectedHandwritingDatabase(leaseClient, configuration, filesystem);
        await assertQuestionSourceAnalysisSchema(client);
        const lock = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [WORKER_LOCK]);
        locked = lock.rows[0]?.acquired === true;
        if (!locked) return { failed, pending, processed };
        if (!options.execute) {
            pending = await previewQuestionSourceAnalysis(client);
            return { failed, pending, processed };
        }
        await reconcileQuestionSourceAnalysisQueue(client);
        while (!signal.aborted) {
            const candidate = await claimQuestionSourceAnalysis(client, workerId);
            if (!candidate) {
                if (options.mode === "once") break;
                await waitForPoll(signal);
                continue;
            }
            let leaseTask = Promise.resolve(true);
            const leaseTimer = setInterval(() => {
                leaseTask = leaseTask
                    .catch(() => false)
                    .then(() => renewQuestionSourceAnalysisLease(leaseClient, candidate, workerId));
            }, 60_000);
            try {
                await processCandidate(client, candidate, workerId);
                processed += 1;
            }
            catch (error) {
                failed += 1;
                console.error(`[question-source-worker] ${candidate.jobId} ${errorCode(error)}`);
            }
            finally {
                clearInterval(leaseTimer);
                await leaseTask.catch(() => false);
            }
            if (options.mode === "once") break;
        }
        return { failed, pending, processed };
    }
    finally {
        if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [WORKER_LOCK]).catch(() => undefined);
        await leaseClient.end().catch(() => undefined);
        await client.end().catch(() => undefined);
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
        const summary = await runWorker(options, controller.signal);
        process.stdout.write(`${JSON.stringify(summary)}\n`);
    }
    finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
