import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
    assertEligibleClaim,
    HANDWRITING_MODEL_DIGEST,
    HANDWRITING_MODEL_NAME,
    HANDWRITING_SCHEMA_VERSION,
    handwritingAiConfiguration,
    inspectHandwritingModel,
    prepareHandwritingImage,
    readHandwritingAsset,
    transcribeHandwriting,
    validateTranscription,
} from "../app/lib/handwriting-analysis.mjs";
import { retryBackoffSeconds } from "../scripts/lib/handwriting-analysis-db.mjs";
import {
    evaluateQualityRecords,
    QUALITY_MANIFEST_VERSION,
    validateQualityManifest,
} from "../scripts/lib/handwriting-quality.mjs";
import {
    resolveOcrConsensus,
    resolveWithModel,
} from "../app/lib/handwriting-transcription.mjs";
import { parseArguments as parseWorkerArguments, processClaim } from "../scripts/process-handwriting-analysis.mjs";
import { parseArguments as parseSmokeArguments } from "../scripts/smoke-handwriting-analysis.mjs";

const IDS = Object.freeze({
    job: "10000000-0000-4000-8000-000000000001",
    run: "10000000-0000-4000-8000-000000000002",
    result: "10000000-0000-4000-8000-000000000003",
    asset: "10000000-0000-4000-8000-000000000004",
    revision: "10000000-0000-4000-8000-000000000005",
    part: "10000000-0000-4000-8000-000000000006",
    answer1: "10000000-0000-4000-8000-000000000007",
    answer2: "10000000-0000-4000-8000-000000000008",
});
const SYNTHETIC_PNG = await readFile(new URL("fixtures/handwriting-ai-synthetic/png/readable-a.png", import.meta.url));

function candidate(overrides = {}) {
    return {
        jobId: IDS.job,
        runId: IDS.run,
        answerPartResultId: IDS.result,
        assetId: IDS.asset,
        questionRevisionId: IDS.revision,
        questionPartId: IDS.part,
        assetChecksum: "a".repeat(64),
        referenceSha256: null,
        attemptNumber: 1,
        maxAttempts: 4,
        answerPayload: { value: null },
        currentResult: "pending",
        gradingSource: "manual_review",
        answerMode: "text",
        gradingPolicy: "manual_review",
        storageKey: `handwriting/aaaa/${IDS.asset}.png`,
        assetPurpose: "handwriting",
        assetSensitivity: "private",
        assetScanStatus: "clean",
        assetDeletedAt: null,
        promptText: "請寫出答案",
        referenceAnswers: [
            { id: IDS.answer2, answerKey: null, acceptedValue: "乙", position: 1 },
            { id: IDS.answer1, answerKey: null, acceptedValue: "甲", position: 0 },
        ],
        rubric: ["意思相同才算正確"],
        ...overrides,
    };
}

function jsonResponse(url, body, status = 200, headers = undefined) {
    const response = new Response(JSON.stringify(body), { status, headers });
    Object.defineProperty(response, "url", { value: String(url) });
    return response;
}

function modelFetch({ chatOutputs = [] } = {}) {
    const calls = [];
    let chatIndex = 0;
    const fetchImpl = async (url, init = {}) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, init });
        if (parsed.pathname === "/api/version") return jsonResponse(parsed, { version: "0.34.4" });
        if (parsed.pathname === "/api/tags") {
            return jsonResponse(parsed, { models: [{ name: HANDWRITING_MODEL_NAME, digest: HANDWRITING_MODEL_DIGEST }] });
        }
        if (parsed.pathname === "/api/show") return jsonResponse(parsed, { capabilities: ["completion", "vision"] });
        if (parsed.pathname === "/api/chat") {
            const output = chatOutputs[chatIndex++] ?? {
                schemaVersion: HANDWRITING_SCHEMA_VERSION,
                transcription: "甲",
                legibility: "clear",
                transcriptionConfidence: 0.98,
                uncertaintyReasons: [],
            };
            if (output instanceof Response) return output;
            return jsonResponse(parsed, { model: HANDWRITING_MODEL_NAME, message: { content: JSON.stringify(output) } });
        }
        if (parsed.pathname === "/api/generate") return jsonResponse(parsed, { done: true });
        throw new Error(`unexpected path ${parsed.pathname}`);
    };
    return { fetchImpl, calls };
}

test("worker CLI is once + dry-run by default and continuous requires explicit execute", () => {
    assert.deepEqual(parseWorkerArguments([]), { mode: "once", execute: false, help: false });
    assert.deepEqual(parseWorkerArguments(["--once", "--execute"]), { mode: "once", execute: true, help: false });
    assert.deepEqual(parseWorkerArguments(["--continuous", "--execute"]), { mode: "continuous", execute: true, help: false });
    assert.throws(() => parseWorkerArguments(["--continuous"]), /--execute/u);
    assert.throws(() => parseWorkerArguments(["--once", "--continuous", "--execute"]), /只能選一個/u);
});

test("local AI uses the ERP Ollama environment contract and rejects non-loopback handwriting targets", () => {
    assert.deepEqual(handwritingAiConfiguration({
        OLLAMA_BASE_URL: "http://[::1]:11434/",
        OLLAMA_MODEL: HANDWRITING_MODEL_NAME,
        OLLAMA_KEEP_ALIVE: "30m",
    }), {
        baseUrl: "http://[::1]:11434",
        model: HANDWRITING_MODEL_NAME,
        keepAlive: "30m",
    });
    assert.throws(
        () => handwritingAiConfiguration({ OLLAMA_BASE_URL: "https://ai.example.com" }),
        /loopback/u,
    );
    assert.throws(
        () => handwritingAiConfiguration({ OLLAMA_MODEL: "another-model:latest" }),
        /固定 digest/u,
    );
});

test("smoke CLI requires explicit synthetic manifest paths and defaults to no model call", () => {
    assert.deepEqual(
        parseSmokeArguments(["--manifest", "tests/fixtures/handwriting-ai-synthetic/manifest.json", "--png-dir", "tests/fixtures/handwriting-ai-synthetic/png"]),
        {
            manifest: "tests/fixtures/handwriting-ai-synthetic/manifest.json",
            pngDirectory: "tests/fixtures/handwriting-ai-synthetic/png",
            execute: false,
            hybrid: false,
            help: false,
        },
    );
    assert.throws(() => parseSmokeArguments([]), /必須指定/u);
});

test("eligibility accepts only JSON {value:null} pending manual text answers with clean private handwriting", () => {
    const target = assertEligibleClaim(candidate());
    assert.equal(target.questionRevisionId, IDS.revision);
    assert.equal(target.questionPartId, IDS.part);
    assert.throws(() => assertEligibleClaim(candidate({ answerPayload: null })), /已具有答案/u);
    assert.throws(() => assertEligibleClaim(candidate({ answerPayload: { value: "甲" } })), /已具有答案/u);
    assert.throws(() => assertEligibleClaim(candidate({ gradingSource: "automatic" })), /不是人工待審/u);
    assert.throws(() => assertEligibleClaim(candidate({ currentResult: "correct" })), /已非待審/u);
    assert.throws(() => assertEligibleClaim(candidate({ assetScanStatus: "pending" })), /不是 clean/u);
});

test("worker reads the four-hex object shard emitted by the formal handwriting object store", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "lerniqa-handwriting-worker-"));
    const storageKey = `handwriting/aaaa/${IDS.asset}.png`;
    const assetDirectory = path.join(repositoryRoot, "local-data", "assets", path.dirname(storageKey));
    try {
        await mkdir(assetDirectory, { recursive: true });
        await writeFile(path.join(repositoryRoot, "local-data", "assets", storageKey), SYNTHETIC_PNG);
        const assetChecksum = createHash("sha256").update(SYNTHETIC_PNG).digest("hex");
        const bytes = await readHandwritingAsset(candidate({ storageKey, assetChecksum }), repositoryRoot);
        assert.deepEqual(bytes, SYNTHETIC_PNG);
    }
    finally {
        await rm(repositoryRoot, { recursive: true, force: true });
    }
});

test("eligibility does not inspect prompts, rubrics or reference answers", () => {
    assert.doesNotThrow(() => assertEligibleClaim(candidate({
        promptText: null,
        referenceAnswers: null,
        rubric: null,
        referenceSha256: "b".repeat(64),
    })));
});

test("strict transcription validation rejects extra keys and inconsistent unreadable output", () => {
    const valid = validateTranscription({
        schemaVersion: HANDWRITING_SCHEMA_VERSION,
        transcription: "甲",
        legibility: "clear",
        transcriptionConfidence: 0.9,
        uncertaintyReasons: [],
    });
    assert.equal(valid.transcription, "甲");
    assert.throws(() => validateTranscription({ ...valid, score: 1 }), /欄位/u);
    assert.throws(() => validateTranscription({ ...valid, legibility: "unreadable" }), /不一致/u);
    assert.throws(() => validateTranscription({ ...valid, uncertaintyReasons: ["made_up_reason"] }), /uncertaintyReasons/u);
});

test("independent OCR engines must agree before bypassing the local vision model", () => {
    const consensus = resolveOcrConsensus([
        { engine: "paddleocr", text: "如", confidence: 0.98 },
        { engine: "apple-vision", text: "如", confidence: 0.52 },
    ]);
    assert.equal(consensus.transcription, "如");
    assert.equal(consensus.legibility, "clear");
    assert.equal(resolveOcrConsensus([
        { engine: "paddleocr", text: "A", confidence: 0.99 },
        { engine: "apple-vision", text: "4", confidence: 0.5 },
    ]), null);
    assert.equal(resolveOcrConsensus([
        { engine: "paddleocr", text: "A", confidence: 0.99 },
        null,
    ]), null);
});

test("the local vision model remains primary and OCR consensus fills only unclear results", () => {
    const modelResult = validateTranscription({
        schemaVersion: HANDWRITING_SCHEMA_VERSION,
        transcription: "4",
        legibility: "clear",
        transcriptionConfidence: 0.96,
        uncertaintyReasons: [],
    });
    const conflict = resolveWithModel([
        { engine: "paddleocr", text: "A", confidence: 0.99 },
        null,
    ], modelResult);
    assert.equal(conflict.transcription, "4");
    assert.equal(conflict.legibility, "clear");

    const unclear = validateTranscription({
        schemaVersion: HANDWRITING_SCHEMA_VERSION,
        transcription: null,
        legibility: "unreadable",
        transcriptionConfidence: 0,
        uncertaintyReasons: ["ambiguous_glyphs"],
    });
    const fallback = resolveWithModel([
        { engine: "paddleocr", text: "如", confidence: 0.98 },
        { engine: "apple-vision", text: "如", confidence: 0.52 },
    ], unclear);
    assert.equal(fallback.transcription, "如");
    assert.equal(fallback.legibility, "clear");
});

test("model attestation checks version, tags, exact digest, show and explicit vision capability", async () => {
    const { fetchImpl, calls } = modelFetch();
    const model = await inspectHandwritingModel({ fetchImpl });
    assert.equal(model.digest, HANDWRITING_MODEL_DIGEST);
    assert.deepEqual(calls.map((call) => call.url.pathname).sort(), ["/api/show", "/api/tags", "/api/version"]);
    assert.ok(calls.every((call) => call.init.redirect === "error"));
    assert.ok(!calls.some((call) => call.url.pathname.includes("pull")));

    const noVision = modelFetch();
    noVision.fetchImpl = async (url, init) => {
        if (new URL(url).pathname === "/api/show") return jsonResponse(url, { capabilities: ["completion"] });
        return modelFetch().fetchImpl(url, init);
    };
    await assert.rejects(() => inspectHandwritingModel({ fetchImpl: noVision.fetchImpl }), /vision/u);
});

test("model request contains only the handwriting image and fixed transcription instructions", async () => {
    const retry = new Response("temporary", { status: 503 });
    Object.defineProperty(retry, "url", { value: "http://127.0.0.1:11434/api/chat" });
    const success = {
        schemaVersion: HANDWRITING_SCHEMA_VERSION,
        transcription: "甲",
        legibility: "clear",
        transcriptionConfidence: 0.97,
        uncertaintyReasons: [],
    };
    const { fetchImpl, calls } = modelFetch({ chatOutputs: [retry, success] });
    const model = { engine: "ollama", name: HANDWRITING_MODEL_NAME, digest: HANDWRITING_MODEL_DIGEST, version: "ollama:0.34.4" };
    const output = await transcribeHandwriting(SYNTHETIC_PNG, model, { fetchImpl });
    assert.equal(output.transcription, "甲");
    const chatCalls = calls.filter((call) => call.url.pathname === "/api/chat");
    assert.equal(chatCalls.length, 2);
    const request = JSON.parse(chatCalls[1].init.body);
    assert.equal(request.model, HANDWRITING_MODEL_NAME);
    assert.equal(request.stream, false);
    assert.equal(request.think, false);
    assert.equal(request.keep_alive, "30m");
    assert.equal(request.options.temperature, 0);
    assert.ok(!Object.hasOwn(request, "tools"));
    assert.ok(!chatCalls[1].init.body.includes("promptText"));
    assert.ok(!chatCalls[1].init.body.includes("referenceAnswers"));
    assert.ok(!chatCalls[1].init.body.includes("rubric"));
    assert.ok(!chatCalls[1].init.body.includes("correct"));
    assert.ok(!chatCalls[1].init.body.includes("wrong"));
    assert.equal(request.messages[1].images.length, 1);
    assert.notEqual(request.messages[1].images[0], SYNTHETIC_PNG.toString("base64"));
    assert.ok(prepareHandwritingImage(SYNTHETIC_PNG).subarray(0, 8).equals(SYNTHETIC_PNG.subarray(0, 8)));
});

test("identity and schema violations are not retried and oversized responses fail closed", async () => {
    const model = { engine: "ollama", name: HANDWRITING_MODEL_NAME, digest: HANDWRITING_MODEL_DIGEST, version: "ollama:0.34.4" };
    let identityCalls = 0;
    const identityFetch = async (url) => {
        identityCalls += 1;
        return jsonResponse(url, {
            model: "different-model",
            message: { content: JSON.stringify({
                schemaVersion: HANDWRITING_SCHEMA_VERSION,
                transcription: "甲",
                legibility: "clear",
                transcriptionConfidence: 1,
                uncertaintyReasons: [],
            }) },
        });
    };
    await assert.rejects(
        () => transcribeHandwriting(SYNTHETIC_PNG, model, { fetchImpl: identityFetch }),
        /identity/u,
    );
    assert.equal(identityCalls, 1);

    let largeCalls = 0;
    const largeFetch = async (url) => {
        largeCalls += 1;
        return jsonResponse(url, { padding: "x".repeat(70_000) });
    };
    await assert.rejects(
        () => transcribeHandwriting(SYNTHETIC_PNG, model, { fetchImpl: largeFetch }),
        /64 KiB/u,
    );
    assert.equal(largeCalls, 1);
});

test("processClaim writes only a sidecar completion and fails the leased job without leaking raw errors", async () => {
    const calls = [];
    const model = { engine: "ollama", name: HANDWRITING_MODEL_NAME, digest: HANDWRITING_MODEL_DIGEST, version: "ollama:0.34.4" };
    const result = await processClaim({}, candidate(), model, "worker-test", {
        repositoryRoot: "/synthetic",
        readAsset: async () => Buffer.from("synthetic"),
        transcribe: async () => ({ transcription: "甲", legibility: "clear", transcriptionConfidence: 1, uncertaintyReasons: [] }),
        complete: async (_client, input) => calls.push({ kind: "complete", input }),
        failJob: async () => calls.push({ kind: "fail" }),
    });
    assert.equal(result.recognized_text, "甲");
    assert.equal(result.legibility, "clear");
    assert.deepEqual(calls.map((call) => call.kind), ["complete"]);

    await assert.rejects(() => processClaim({}, candidate(), model, "worker-test", {
        repositoryRoot: "/synthetic",
        readAsset: async () => { throw Object.assign(new Error("sensitive path and content"), { code: "SYNTHETIC_FAILURE" }); },
        failJob: async (_client, input) => calls.push({ kind: "fail", input }),
    }));
    const failure = calls.at(-1);
    assert.equal(failure.kind, "fail");
    assert.equal(failure.input.errorCode, "HANDWRITING_ANALYSIS_FAILED");
    assert.ok(!JSON.stringify(failure).includes("sensitive path"));
});

test("lease backoff is bounded exponential", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(retryBackoffSeconds), [30, 60, 120, 240, 480]);
    assert.equal(retryBackoffSeconds(99), 3600);
});

test("synthetic quality gate measures transcription, unreadable blanks and fault fail-closed", () => {
    const manifest = validateQualityManifest({
        schemaVersion: QUALITY_MANIFEST_VERSION,
        qualityGates: {
            minimumReadableTranscriptionRate: 0.9,
            minimumBlankUnclearUnrecognizedRate: 1,
            requireFaultFailClosed: true,
        },
        fixtures: [
            {
                id: "readable-correct", kind: "readable", image: "readable.png", imageSha256: "a".repeat(64),
                expectedTranscription: "甲",
            },
            {
                id: "blank", kind: "blank", image: "blank.png", imageSha256: "b".repeat(64),
                expectedTranscription: null,
            },
            {
                id: "unclear", kind: "unclear", image: "unclear.png", imageSha256: "c".repeat(64),
                expectedTranscription: null,
            },
        ],
    });
    const summary = evaluateQualityRecords(manifest, [
        { id: "readable-correct", status: "completed", transcription: "甲" },
        { id: "blank", status: "completed", transcription: null },
        { id: "unclear", status: "fault", transcription: null },
    ]);
    assert.equal(summary.readable_transcription_rate, 1);
    assert.equal(summary.fault_fail_closed, true);
    assert.equal(summary.blank_unclear_unrecognized_rate, 1);
    assert.equal(summary.passed, true);
});

test("repository SQL claims with SKIP LOCKED and never mutates formal grading tables", async () => {
    const source = await readFile(new URL("../scripts/lib/handwriting-analysis-db.mjs", import.meta.url), "utf8");
    assert.match(source, /FOR UPDATE OF job SKIP LOCKED/u);
    assert.match(source, /result\.answer_payload = '\{"value":null\}'::jsonb/u);
    assert.match(source, /result\.current_result = 'pending'/u);
    assert.match(source, /result\.grading_source = 'manual_review'/u);
    assert.match(source, /part\.answer_mode = 'text'/u);
    assert.match(source, /asset\.sensitivity = 'private'/u);
    assert.match(source, /asset\.scan_status = 'clean'/u);
    assert.doesNotMatch(source, /question_answers|prompt_text|reference_answers|rubric\.rows/u);
    assert.match(source, /"pending", 0/u);
    assert.match(source, /analysis_kind: "handwriting_transcription_only"/u);
    assert.doesNotMatch(source, /UPDATE public\.(?:answer_part_results|answer_reviews|learner_practice_queue_items|learner_practice_stats)/u);
});

test("submitted handwriting-only text answers enqueue one sidecar analysis job in the attempt transaction", async () => {
    const source = await readFile(new URL("../app/lib/local-practice-store.ts", import.meta.url), "utf8");
    const submission = source.slice(source.indexOf("export async function submitLocalPracticeAttempt("));
    assert.match(
        submission,
        /INSERT INTO answer_part_assets[\s\S]*graded\.result === "pending"[\s\S]*graded\.gradingSource === "manual_review"[\s\S]*INSERT INTO handwriting_analysis_jobs/u,
    );
    assert.match(
        submission,
        /answer_part_result_id,[\s\S]*asset_id,[\s\S]*question_revision_id,[\s\S]*question_part_id,[\s\S]*asset_checksum,[\s\S]*status/u,
    );
});
