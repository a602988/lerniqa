import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    assertResumeCompatible,
    acquireJsonlLock,
    CHECKPOINT_INTERVAL,
    classifyWithLocalModel,
    createCheckpoint,
    createResultRecord,
    createRunHeader,
    deterministicStratifiedSample,
    deterministicUuid,
    parseJsonlText,
    prepareQuestionInput,
    PROMPT_VERSION,
    QuestionEnrichmentError,
    redactSensitiveText,
    readJsonlFile,
    readJsonlForResume,
    SAMPLE_SEED,
    sha256,
    stableJson,
    TAXONOMY_VERSION,
    validateModelClassification,
} from "../scripts/lib/question-enrichment.mjs";
import {
    assertPersistenceSchema,
    assertJsonlMatchesCurrentPublishedQuestions,
    assertLocalDatabaseFilesystem,
    CURRENT_QUESTION_SQL,
    localDatabaseConfiguration,
    persistPendingSuggestions,
    PERSIST_BATCH_SIZE,
    QUESTION_ANSWER_SQL,
    QUESTION_CONTENT_SQL,
    QUESTION_OPTION_SQL,
    QUESTION_PART_SQL,
} from "../scripts/lib/question-enrichment-db.mjs";
import {
    generateJsonl,
    parseArguments,
} from "../scripts/enrich-question-bank.mjs";

const MODEL = Object.freeze({
    name: "qwen3.8:27b",
    digest: "a".repeat(64),
    version: "ollama:0.99.0;family:qwen3;size:27B;quant:Q4_K_M",
});

const CLASSIFICATION = Object.freeze({
    fine_question_type: Object.freeze({
        key: "single_choice",
        label: "單一選擇題",
        confidence: 0.94,
        evidence: Object.freeze(["題目要求從有限選項中選出一個答案。"]),
    }),
    knowledge_point: Object.freeze({
        key: "chinese:character-pronunciation",
        label: "國字與注音辨識",
        confidence: 0.9,
        evidence: Object.freeze(["主要評量字形與讀音的對應。"]),
    }),
    solution_method: Object.freeze({
        key: "concept_recognition",
        label: "概念辨識",
        confidence: 0.88,
        evidence: Object.freeze(["辨識已學過的語文概念即可作答。"]),
    }),
});

function fixtureQuestion(index, { stratum = index % 3, typeLabel = null } = {}) {
    const questionId = deterministicUuid(`question:${index}`);
    const revisionId = deterministicUuid(`revision:${index}`);
    const partId = deterministicUuid(`part:${index}`);
    const optionId = deterministicUuid(`option:${index}`);
    return {
        questionId,
        revisionId,
        originalQuestionTypeLabel: typeLabel ?? (stratum === 0 ? "單一選擇題" : stratum === 1 ? "填充題" : "改錯題"),
        questionTypeCode: stratum === 0 ? "single-choice" : "written",
        questionTypeName: stratum === 0 ? "單選題" : "非選題",
        subjectCode: stratum === 2 ? "math" : "chinese",
        subjectName: stratum === 2 ? "數學" : "國文",
        gradeCode: "junior-high-1",
        gradeName: "七年級",
        semesterCode: "semester-1",
        semesterName: "上學期",
        difficultyCode: "basic",
        difficultyName: "基礎",
        parts: [{
            id: partId,
            stableKey: "main",
            position: 0,
            answerMode: "single_choice",
            gradingPolicy: "automatic",
            isIndependentlyGradable: true,
            options: [{ id: optionId, optionKey: "A", position: 0 }],
            answers: [{ id: deterministicUuid(`answer:${index}`), answerKey: "A", acceptedValue: null, position: 0 }],
        }],
        contentBlocks: [
            {
                id: deterministicUuid(`prompt:${index}`),
                questionPartId: partId,
                questionOptionId: null,
                parentBlockId: null,
                placement: "prompt",
                contentType: "text",
                position: 0,
                textContent: `第 ${index} 題的合成題幹`,
                altText: null,
            },
            {
                id: deterministicUuid(`option-block:${index}`),
                questionPartId: partId,
                questionOptionId: optionId,
                parentBlockId: null,
                placement: "option",
                contentType: "text",
                position: 0,
                textContent: "合成選項",
                altText: null,
            },
            {
                id: deterministicUuid(`explanation:${index}`),
                questionPartId: partId,
                questionOptionId: null,
                parentBlockId: null,
                placement: "explanation",
                contentType: "text",
                position: 0,
                textContent: "合成解析",
                altText: null,
            },
        ],
    };
}

function fakeOllama() {
    const state = { chats: 0, bodies: [], redirects: [] };
    const fetchImpl = async (url, init = {}) => {
        state.redirects.push(init.redirect);
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/api/version") return { ok: true, status: 200, url: String(url), json: async () => ({ version: "0.99.0" }) };
        if (pathname === "/api/tags") {
            return {
                ok: true,
                status: 200,
                url: String(url),
                json: async () => ({ models: [{ name: MODEL.name, digest: MODEL.digest, details: { family: "qwen3", parameter_size: "27B", quantization_level: "Q4_K_M" } }] }),
            };
        }
        if (pathname === "/api/show") return { ok: true, status: 200, url: String(url), json: async () => ({ details: {} }) };
        if (pathname === "/api/chat") {
            state.chats += 1;
            state.bodies.push(JSON.parse(init.body));
            return { ok: true, status: 200, url: String(url), json: async () => ({ model: MODEL.name, message: { content: JSON.stringify(CLASSIFICATION) } }) };
        }
        throw new Error(`unexpected URL: ${pathname}`);
    };
    return { state, fetchImpl };
}

test("stratified sampling is deterministic across input order and covers distinct strata first", () => {
    const records = Array.from({ length: 18 }, (_, index) => prepareQuestionInput(fixtureQuestion(index)));
    const forward = deterministicStratifiedSample(records, 9, SAMPLE_SEED);
    const reversed = deterministicStratifiedSample([...records].reverse(), 9, SAMPLE_SEED);
    assert.deepEqual(
        forward.map((item) => item.revisionId),
        reversed.map((item) => item.revisionId),
    );
    assert.deepEqual(
        Object.fromEntries([...new Set(forward.map((item) => item.typeStratumKey))]
            .map((key) => [key, forward.filter((item) => item.typeStratumKey === key).length])),
        { "單一選擇題": 3, "填充題": 3, "改錯題": 3 },
    );
    assert.throws(
        () => deterministicStratifiedSample(records, 19),
        (error) => error instanceof QuestionEnrichmentError && error.code === "INVALID_SAMPLE_SIZE",
    );
});

test("the 279-question inventory contract yields a deterministic 32-question sample with at least three per original type", () => {
    const distribution = [
        ["單一選擇題", 182], ["填充題", 11], ["國字注音題", 33], ["改錯題", 21],
        ["注釋題", 14], ["選詞測驗", 5], ["配合題", 3], ["題組", 10],
    ];
    let index = 1000;
    const records = distribution.flatMap(([typeLabel, count]) =>
        Array.from({ length: count }, () => prepareQuestionInput(fixtureQuestion(index++, { typeLabel }))));
    assert.equal(records.length, 279);
    const selected = deterministicStratifiedSample(records, 32, SAMPLE_SEED);
    assert.equal(selected.length, 32);
    for (const [typeLabel] of distribution) {
        assert.ok(selected.filter((item) => item.typeStratumKey === typeLabel).length >= 3, typeLabel);
    }
    assert.deepEqual(
        selected.map((item) => item.revisionId),
        deterministicStratifiedSample([...records].reverse(), 32, SAMPLE_SEED).map((item) => item.revisionId),
    );
});

test("classification validation is strict and normalizes sensitive evidence", () => {
    const normalized = validateModelClassification({
        ...CLASSIFICATION,
        knowledge_point: {
            ...CLASSIFICATION.knowledge_point,
            evidence: ["聯絡 student@example.com，token=super-secret-value"],
        },
    });
    assert.equal(normalized.knowledge_point.evidence[0].includes("student@example.com"), false);
    assert.match(normalized.knowledge_point.evidence[0], /\[REDACTED_EMAIL\]/u);
    assert.match(normalized.knowledge_point.evidence[0], /\[REDACTED_SECRET\]/u);
    assert.throws(
        () => validateModelClassification({ ...CLASSIFICATION, extra: true }),
        (error) => error.code === "INVALID_ENRICHMENT_DATA",
    );
    assert.throws(
        () => validateModelClassification({
            ...CLASSIFICATION,
            fine_question_type: { ...CLASSIFICATION.fine_question_type, key: "invented_type" },
        }),
        (error) => error.code === "INVALID_MODEL_OUTPUT",
    );
});

test("redaction and hashing are stable without retaining common tokens or personal identifiers", () => {
    const source = "student@example.com 0912-345-678 A123456789 password=hunter2 sk-abcdefghijklmnop /Users/alice/private 學號：S12345678";
    const redacted = redactSensitiveText(source);
    assert.doesNotMatch(redacted, /student@example\.com|0912|A123456789|hunter2|abcdefghijklmnop|\/Users\/alice|S12345678/iu);
    assert.match(redacted, /\[REDACTED_EMAIL\]/u);
    assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
    assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
    assert.notEqual(sha256({ a: 1 }), sha256({ a: 2 }));
});

test("JSONL resume validates snapshot hashes and rejects sensitive manually edited results", () => {
    const selected = [prepareQuestionInput(fixtureQuestion(1)), prepareQuestionInput(fixtureQuestion(2))];
    const header = createRunHeader({
        selection: { mode: "all" },
        selected,
        model: MODEL,
        createdAt: "2026-10-16T00:00:00.000Z",
    });
    const results = selected.map((item, index) => createResultRecord(
        item,
        CLASSIFICATION,
        header,
        `2026-10-16T00:00:0${index + 1}.000Z`,
    ));
    const checkpoint = createCheckpoint(results, 2, true, "2026-10-16T00:00:03.000Z");
    const parsed = parseJsonlText([header, ...results, checkpoint].map(JSON.stringify).join("\n") + "\n");
    const expectedHeader = createRunHeader({
        selection: header.selection,
        selected,
        model: MODEL,
        runId: header.run_id,
        createdAt: "2026-10-17T00:00:00.000Z",
    });
    assert.equal(assertResumeCompatible(parsed, expectedHeader, selected).size, 2);

    const changed = structuredClone(results[0]);
    changed.knowledge_point.evidence[0] = "student@example.com";
    assert.throws(
        () => parseJsonlText([header, changed].map(JSON.stringify).join("\n") + "\n"),
        (error) => error.code === "SENSITIVE_OUTPUT_REJECTED",
    );
    const changedInput = selected.map((item, index) => index === 0 ? { ...item, inputSha256: "b".repeat(64) } : item);
    assert.throws(
        () => assertResumeCompatible(parsed, expectedHeader, changedInput),
        (error) => error.code === "CHECKPOINT_INPUT_CHANGED",
    );
});

test("generation writes strict checkpoints every 16 results and resumes without reclassifying", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-question-enrichment-test-"));
    const output = path.join(temporaryRoot, "results.jsonl");
    const ollama = fakeOllama();
    const options = { mode: "generate", selection: { mode: "all" }, output };
    const questions = Array.from({ length: 17 }, (_, index) => fixtureQuestion(index));
    try {
        const first = await generateJsonl(options, {
            fetchImpl: ollama.fetchImpl,
            loadQuestions: async () => questions,
            environment: {},
        });
        assert.equal(first.processed, 17);
        assert.equal(ollama.state.chats, 17);
        assert.ok(ollama.state.redirects.every((redirect) => redirect === "error"));
        assert.ok(ollama.state.bodies.every((body) => body.think === false && body.options.temperature === 0));
        const lines = (await readFile(output, "utf8")).trim().split("\n").map(JSON.parse);
        const checkpoints = lines.filter((record) => record.record_type === "checkpoint");
        assert.deepEqual(checkpoints.map((record) => [record.processed_count, record.complete]), [[16, false], [17, true]]);
        assert.equal(lines.filter((record) => record.record_type === "result").length, 17);

        const second = await generateJsonl(options, {
            fetchImpl: ollama.fetchImpl,
            loadQuestions: async () => [...questions].reverse(),
            environment: {},
        });
        assert.equal(second.already_complete, true);
        assert.equal(ollama.state.chats, 17);
    }
    finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("generation refuses a model digest drift before publishing the next checkpoint", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-enrichment-digest-"));
    const output = path.join(temporaryRoot, "results.jsonl");
    const stable = fakeOllama();
    let tagReads = 0;
    const fetchImpl = async (url, init) => {
        if (new URL(String(url)).pathname === "/api/tags") {
            tagReads += 1;
            return {
                ok: true,
                status: 200,
                url: String(url),
                json: async () => ({ models: [{
                    name: MODEL.name,
                    digest: (tagReads === 1 ? "a" : "b").repeat(64),
                    details: { family: "qwen3", parameter_size: "27B", quantization_level: "Q4_K_M" },
                }] }),
            };
        }
        return stable.fetchImpl(url, init);
    };
    try {
        await assert.rejects(
            () => generateJsonl(
                { mode: "generate", selection: { mode: "all" }, output },
                { fetchImpl, loadQuestions: async () => Array.from({ length: 16 }, (_, index) => fixtureQuestion(500 + index)), environment: {} },
            ),
            (error) => error.code === "MODEL_DIGEST_CHANGED",
        );
        const recovered = await readJsonlForResume(output);
        assert.equal(recovered.results.length, 0);
    }
    finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("resume trusts only the last durable checkpoint and safely removes a truncated tail", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-enrichment-recovery-"));
    const output = path.join(temporaryRoot, "results.jsonl");
    const selected = Array.from({ length: 17 }, (_, index) => prepareQuestionInput(fixtureQuestion(300 + index)))
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({ selection: { mode: "all" }, selected, model: MODEL });
    const results = selected.slice(0, 16).map((item) => createResultRecord(item, CLASSIFICATION, header));
    const checkpoint = createCheckpoint(results, 17, false);
    const durable = `${[header, ...results, checkpoint].map(JSON.stringify).join("\n")}\n`;
    try {
        await writeFile(output, `${durable}{"record_type":"result"`, { mode: 0o600 });
        const recovered = await readJsonlForResume(output);
        assert.equal(recovered.results.length, 16);
        assert.equal(recovered.lastCheckpoint.processed_count, 16);
        assert.equal(await readFile(output, "utf8"), durable);
    }
    finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("JSONL files reject symlinks and permissive modes, and locks exclude concurrent writers", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-enrichment-files-"));
    const target = path.join(temporaryRoot, "target.jsonl");
    const link = path.join(temporaryRoot, "link.jsonl");
    try {
        await writeFile(target, "{}\n", { mode: 0o600 });
        await symlink(target, link);
        await assert.rejects(() => readJsonlFile(link), (error) => error.code === "UNSAFE_CHECKPOINT_FILE");
        await chmod(target, 0o644);
        await assert.rejects(() => readJsonlFile(target), (error) => error.code === "UNSAFE_CHECKPOINT_PERMISSIONS");
        await chmod(target, 0o600);
        const lock = await acquireJsonlLock(target);
        await assert.rejects(() => acquireJsonlLock(target), (error) => error.code === "CHECKPOINT_LOCKED");
        await lock.release();
    }
    finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});

test("model classification retries once, remains single-request, and never enables thinking", async () => {
    const prepared = prepareQuestionInput(fixtureQuestion(99));
    let attempts = 0;
    const bodies = [];
    const fetchImpl = async (_url, init) => {
        attempts += 1;
        bodies.push(JSON.parse(init.body));
        if (attempts === 1) throw new Error("synthetic transient failure");
        return { ok: true, status: 200, url: "http://127.0.0.1:11434/api/chat", json: async () => ({ model: MODEL.name, message: { content: JSON.stringify(CLASSIFICATION) } }) };
    };
    const output = await classifyWithLocalModel(prepared, { ...MODEL, baseUrl: "http://127.0.0.1:11434" }, { fetchImpl });
    assert.equal(output.knowledge_point.key, CLASSIFICATION.knowledge_point.key);
    assert.equal(attempts, 2);
    assert.ok(bodies.every((body) => body.think === false && body.stream === false));
});

test("model requests reject a final URL outside the fixed loopback origin", async () => {
    const prepared = prepareQuestionInput(fixtureQuestion(199));
    const fetchImpl = async (_url, init) => {
        assert.equal(init.redirect, "error");
        return {
            ok: true,
            status: 200,
            url: "https://example.invalid/api/chat",
            json: async () => ({ model: MODEL.name, message: { content: JSON.stringify(CLASSIFICATION) } }),
        };
    };
    await assert.rejects(
        () => classifyWithLocalModel(prepared, { ...MODEL, baseUrl: "http://127.0.0.1:11434" }, { fetchImpl }),
        (error) => error.code === "MODEL_CLASSIFICATION_FAILED" && error.cause?.code === "OLLAMA_REDIRECT_REJECTED",
    );
});

test("CLI requires an explicit generation scope and isolates persistence from model execution", () => {
    assert.deepEqual(parseArguments(["--sample", "32"], "/repo"), {
        mode: "generate",
        selection: { mode: "sample", size: 32, seed: SAMPLE_SEED },
        output: `/repo/local-data/question-enrichment/sample-32.qwen3-8-27b.${PROMPT_VERSION.split("/").at(-1)}.jsonl`,
    });
    assert.deepEqual(parseArguments(["--persist", "--input", "out.jsonl"], "/repo"), {
        mode: "persist",
        input: "/repo/out.jsonl",
    });
    assert.throws(() => parseArguments(["--all", "--persist", "--input", "out.jsonl"]), /--persist/u);
    assert.throws(() => parseArguments([]), /--all/u);
    assert.equal(CHECKPOINT_INTERVAL, 16);
    assert.equal(PROMPT_VERSION, "question-enrichment-prompt/v1");
    assert.equal(TAXONOMY_VERSION, "lerniqa-school-taxonomy/2026-10-16.1");
});

test("catalog SQL reads only current published system question content and never learner or attempt data", () => {
    const sql = [CURRENT_QUESTION_SQL, QUESTION_PART_SQL, QUESTION_OPTION_SQL, QUESTION_ANSWER_SQL, QUESTION_CONTENT_SQL].join("\n");
    assert.match(CURRENT_QUESTION_SQL, /question\.origin = 'system'/u);
    assert.match(CURRENT_QUESTION_SQL, /question\.current_revision_id/u);
    assert.match(CURRENT_QUESTION_SQL, /revision\.status = 'published'/u);
    assert.doesNotMatch(sql, /\b(?:users|learners|learner_access|answer_attempts|answer_part_results|practice_sessions|auth_sessions)\b/iu);
    assert.match(QUESTION_CONTENT_SQL, /block\.placement/u);
    assert.match(QUESTION_ANSWER_SQL, /question_answers/u);
});

test("database filesystem validation rejects a socket directory symlink before connecting", async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "lerniqa-enrichment-db-target-"));
    const localData = path.join(repositoryRoot, "local-data");
    const outside = path.join(repositoryRoot, "outside-socket");
    try {
        await mkdir(path.join(localData, "postgres"), { recursive: true });
        await mkdir(outside);
        await symlink(outside, path.join(localData, "postgres-socket"));
        const configuration = localDatabaseConfiguration(repositoryRoot, { PGUSER: "synthetic_user" });
        await assert.rejects(
            () => assertLocalDatabaseFilesystem(configuration),
            (error) => error.code === "UNSAFE_DATABASE_CONFIG",
        );
    }
    finally {
        await rm(repositoryRoot, { recursive: true, force: true });
    }
});

function schemaTableRows() {
    return ["question_enrichment_runs", "question_revision_enrichment_suggestions"].map((table_name, index) => ({
        relation_oid: String(100 + index),
        table_schema: "public",
        table_name,
        relkind: "r",
    }));
}

function columnRow(table_name, column_name, data_type, nullable, character_maximum_length = null) {
    return {
        table_schema: "public",
        table_name,
        column_name,
        data_type,
        udt_name: data_type === "timestamp with time zone" ? "timestamptz" : data_type,
        is_nullable: nullable ? "YES" : "NO",
        character_maximum_length,
        numeric_precision: data_type === "numeric" ? 4 : null,
        numeric_scale: data_type === "numeric" ? 3 : null,
    };
}

function schemaColumns() {
    return [
        columnRow("question_enrichment_runs", "id", "uuid", false),
        ...["purpose", "engine", "model_name", "model_digest", "prompt_version", "taxonomy_version", "status"]
            .map((column) => columnRow("question_enrichment_runs", column, "text", false)),
        columnRow("question_enrichment_runs", "started_at", "timestamp with time zone", false),
        columnRow("question_enrichment_runs", "finished_at", "timestamp with time zone", true),
        columnRow("question_enrichment_runs", "error_code", "text", true),
        columnRow("question_enrichment_runs", "created_by_user_id", "uuid", true),
        columnRow("question_enrichment_runs", "created_at", "timestamp with time zone", false),
        ...["id", "run_id", "question_revision_id"].map((column) =>
            columnRow("question_revision_enrichment_suggestions", column, "uuid", false)),
        ...["dimension", "suggested_key", "suggested_label", "input_sha256", "status"].map((column) =>
            columnRow("question_revision_enrichment_suggestions", column, "text", false)),
        columnRow("question_revision_enrichment_suggestions", "confidence", "numeric", false),
        columnRow("question_revision_enrichment_suggestions", "evidence", "jsonb", false),
        columnRow("question_revision_enrichment_suggestions", "reviewed_by_user_id", "uuid", true),
        columnRow("question_revision_enrichment_suggestions", "reviewed_at", "timestamp with time zone", true),
        columnRow("question_revision_enrichment_suggestions", "created_at", "timestamp with time zone", false),
    ];
}

function schemaConstraints() {
    return [
        { table_name: "question_enrichment_runs", contype: "p", local_columns: ["id"], definition: "PRIMARY KEY (id)" },
        { table_name: "question_enrichment_runs", contype: "c", local_columns: ["status"], definition: "CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))" },
        { table_name: "question_enrichment_runs", contype: "c", local_columns: ["model_digest"], definition: "CHECK (char_length(model_digest) = 64 AND model_digest ~ '^[0-9a-f]{64}$')" },
        { table_name: "question_revision_enrichment_suggestions", contype: "p", local_columns: ["id"], definition: "PRIMARY KEY (id)" },
        { table_name: "question_revision_enrichment_suggestions", contype: "u", local_columns: ["run_id", "question_revision_id", "dimension"], definition: "UNIQUE (run_id, question_revision_id, dimension)" },
        { table_name: "question_revision_enrichment_suggestions", contype: "c", local_columns: ["status"], definition: "CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))" },
        { table_name: "question_revision_enrichment_suggestions", contype: "c", local_columns: ["dimension"], definition: "CHECK (dimension IN ('fine_question_type', 'knowledge_point', 'solution_method'))" },
        { table_name: "question_revision_enrichment_suggestions", contype: "c", local_columns: ["confidence"], definition: "CHECK (confidence BETWEEN 0 AND 1)" },
        { table_name: "question_revision_enrichment_suggestions", contype: "c", local_columns: ["input_sha256"], definition: "CHECK (char_length(input_sha256) = 64 AND input_sha256 ~ '^[0-9a-f]{64}$')" },
        { table_name: "question_revision_enrichment_suggestions", contype: "f", local_columns: ["run_id"], referenced_schema: "public", referenced_table: "question_enrichment_runs", referenced_columns: ["id"], definition: "FOREIGN KEY (run_id) REFERENCES public.question_enrichment_runs(id)" },
        { table_name: "question_revision_enrichment_suggestions", contype: "f", local_columns: ["question_revision_id"], referenced_schema: "public", referenced_table: "question_revisions", referenced_columns: ["id"], definition: "FOREIGN KEY (question_revision_id) REFERENCES public.question_revisions(id)" },
    ];
}

test("persistence feature detection fails before any write when either sidecar table is unavailable", async () => {
    const queries = [];
    const client = {
        query: async (text) => {
            queries.push(String(text));
            return { rows: schemaTableRows().slice(0, 1) };
        },
    };
    await assert.rejects(
        () => assertPersistenceSchema(client),
        (error) => error.code === "ENRICHMENT_SCHEMA_UNAVAILABLE",
    );
    assert.equal(queries.length, 1);
    assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE)\b/iu.test(query)));
});

test("persistence feature detection rejects tables without the required checks", async () => {
    let call = 0;
    const client = {
        query: async () => {
            call += 1;
            if (call === 1) return { rows: schemaTableRows() };
            if (call === 2) return { rows: schemaColumns() };
            return { rows: [] };
        },
    };
    await assert.rejects(
        () => assertPersistenceSchema(client),
        (error) => error.code === "ENRICHMENT_SCHEMA_INCOMPATIBLE",
    );
    assert.equal(call, 3);
});

test("persistence schema validation enforces nullability and minimum text capacity from the full column spec", async () => {
    const incompatibleColumns = schemaColumns().map((column) =>
        column.table_name === "question_revision_enrichment_suggestions" && column.column_name === "status"
            ? { ...column, is_nullable: "YES" }
            : column.table_name === "question_enrichment_runs" && column.column_name === "model_digest"
                ? { ...column, data_type: "character varying", udt_name: "varchar", character_maximum_length: 32 }
                : column);
    const client = {
        query: async (text) => {
            const sql = String(text);
            if (sql.includes("FROM pg_catalog.pg_class")) return { rows: schemaTableRows() };
            if (sql.includes("information_schema.columns")) return { rows: incompatibleColumns };
            if (sql.includes("pg_catalog.pg_constraint")) return { rows: schemaConstraints() };
            throw new Error(`unexpected schema SQL: ${sql}`);
        },
    };
    await assert.rejects(
        () => assertPersistenceSchema(client),
        (error) => error.code === "ENRICHMENT_SCHEMA_INCOMPATIBLE",
    );
});

test("persistence source verification rejects stale or edited current question input", () => {
    const questions = Array.from({ length: 3 }, (_, index) => fixtureQuestion(700 + index, { typeLabel: "單一選擇題" }));
    const selected = questions.map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({ selection: { mode: "all" }, selected, catalog: selected, model: MODEL });
    const results = selected.map((item) => createResultRecord(item, CLASSIFICATION, header));
    const parsed = parseJsonlText([
        header,
        ...results,
        createCheckpoint(results, results.length, true),
    ].map(JSON.stringify).join("\n") + "\n");
    const changed = structuredClone(questions);
    changed[0].contentBlocks[0].textContent = "已被修改的目前題目";
    assert.throws(
        () => assertJsonlMatchesCurrentPublishedQuestions(parsed, changed),
        (error) => error.code === "PERSISTENCE_SOURCE_MISMATCH",
    );
});

test("persistence verifies the current manifest inside SERIALIZABLE before any main-transaction write", async () => {
    const questions = Array.from({ length: 3 }, (_, index) => fixtureQuestion(750 + index, { typeLabel: "單一選擇題" }));
    const selected = questions.map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({ selection: { mode: "all" }, selected, model: MODEL });
    const results = selected.map((item) => createResultRecord(item, CLASSIFICATION, header));
    const parsed = parseJsonlText([
        header,
        ...results,
        createCheckpoint(results, results.length, true),
    ].map(JSON.stringify).join("\n") + "\n");
    const changed = structuredClone(questions);
    changed[0].contentBlocks[0].textContent = "交易開始後讀到的不同題目內容";
    let phase = "outside";
    let mainWrites = 0;
    let suggestionWrites = 0;
    let rollbacks = 0;
    const client = {
        query: async (text) => {
            const sql = String(text);
            if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE") { phase = "main"; return { rows: [] }; }
            if (sql === "BEGIN") { phase = "failure-record"; return { rows: [] }; }
            if (sql.includes("FROM pg_catalog.pg_class")) return { rows: schemaTableRows() };
            if (sql.includes("information_schema.columns")) return { rows: schemaColumns() };
            if (sql.includes("pg_catalog.pg_constraint")) return { rows: schemaConstraints() };
            if (sql === "ROLLBACK") { rollbacks += 1; phase = "outside"; return { rows: [] }; }
            if (sql === "COMMIT") { phase = "outside"; return { rows: [] }; }
            if (sql.includes("INSERT INTO public.question_enrichment_runs")) {
                if (phase === "main") mainWrites += 1;
                return { rowCount: 1, rows: [] };
            }
            if (sql.includes("SELECT purpose, engine")) {
                return { rows: [{
                    purpose: "question_bank_enrichment", engine: "ollama", model_name: MODEL.name,
                    model_digest: MODEL.digest, prompt_version: PROMPT_VERSION,
                    taxonomy_version: TAXONOMY_VERSION, status: "running",
                }] };
            }
            if (sql.includes("INSERT INTO public.question_revision_enrichment_suggestions")) {
                suggestionWrites += 1;
                if (phase === "main") mainWrites += 1;
                return { rowCount: 1, rows: [] };
            }
            if (sql.includes("SET status = 'failed'")) return { rowCount: 1, rows: [] };
            throw new Error(`unexpected SQL in manifest client: ${sql}`);
        },
    };
    await assert.rejects(
        () => persistPendingSuggestions(client, parsed, { loadQuestions: async () => changed }),
        (error) => error.code === "PERSISTENCE_SOURCE_MISMATCH",
    );
    assert.equal(mainWrites, 0);
    assert.equal(suggestionWrites, 0);
    assert.equal(rollbacks, 1);
});

test("completed JSONL persists three pending dimensions in one atomic transaction", async () => {
    const questions = Array.from({ length: 17 }, (_, index) => fixtureQuestion(index));
    const selected = questions.map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({
        selection: { mode: "all" },
        selected,
        model: MODEL,
        createdAt: "2026-10-16T00:00:00.000Z",
    });
    const lowConfidenceClassification = {
        ...CLASSIFICATION,
        knowledge_point: { ...CLASSIFICATION.knowledge_point, confidence: 0.2 },
    };
    const results = selected.map((item, index) => createResultRecord(
        item,
        lowConfidenceClassification,
        header,
        `2026-10-16T00:01:${String(index).padStart(2, "0")}.000Z`,
    ));
    const parsed = parseJsonlText([
        header,
        ...results,
        createCheckpoint(results, results.length, true, "2026-10-16T00:02:00.000Z"),
    ].map(JSON.stringify).join("\n") + "\n");
    const columns = schemaColumns();
    const constraints = schemaConstraints();
    let runStatus = "running";
    let begins = 0;
    let commits = 0;
    let insertedSuggestions = 0;
    const persistedConfidences = [];
    const events = [];
    const client = {
        query: async (text, params = []) => {
            const sql = String(text);
            if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE") {
                begins += 1;
                events.push("begin-serializable");
                return { rows: [] };
            }
            if (sql.includes("FROM pg_catalog.pg_class")) { events.push("schema"); return { rows: schemaTableRows() }; }
            if (sql.includes("information_schema.columns")) { events.push("schema"); return { rows: columns }; }
            if (sql.includes("pg_catalog.pg_constraint")) { events.push("schema"); return { rows: constraints }; }
            if (sql === "COMMIT") { commits += 1; events.push("commit"); return { rows: [] }; }
            if (sql === "ROLLBACK") return { rows: [] };
            if (sql.includes("INSERT INTO public.question_enrichment_runs")) {
                events.push("write");
                return { rowCount: 1, rows: [] };
            }
            if (sql.includes("SELECT purpose, engine")) {
                return {
                    rows: [{
                        purpose: "question_bank_enrichment",
                        engine: "ollama",
                        model_name: MODEL.name,
                        model_digest: MODEL.digest,
                        prompt_version: PROMPT_VERSION,
                        taxonomy_version: TAXONOMY_VERSION,
                        status: runStatus,
                    }],
                };
            }
            if (sql.includes("INSERT INTO public.question_revision_enrichment_suggestions")) {
                assert.match(sql, /'pending'/u);
                events.push("write");
                insertedSuggestions += 1;
                persistedConfidences.push(params[7]);
                return { rowCount: 1, rows: [{ id: params[0] }] };
            }
            if (sql.includes("COUNT(*)::integer")) return { rows: [{ count: 51 }] };
            if (sql.includes("SET status = 'completed'")) {
                events.push("write");
                runStatus = "completed";
                return { rowCount: 1, rows: [{ id: params[0] }] };
            }
            throw new Error(`unexpected SQL in synthetic client: ${sql}`);
        },
    };
    const summary = await persistPendingSuggestions(client, parsed, {
        loadQuestions: async () => {
            events.push("snapshot");
            return questions;
        },
    });
    assert.equal(summary.suggestions_inserted, 51);
    assert.equal(insertedSuggestions, 51);
    assert.ok(persistedConfidences.includes(0.2));
    assert.equal(PERSIST_BATCH_SIZE, 16);
    assert.equal(begins, 1);
    assert.equal(commits, 1);
    assert.equal(events[0], "begin-serializable");
    assert.ok(events.lastIndexOf("schema") < events.indexOf("snapshot"));
    assert.ok(events.indexOf("snapshot") < events.indexOf("write"));
    assert.equal(events.at(-1), "commit");
});

test("completed run replay is an immutable no-op and rejects different stored suggestion content", async () => {
    const questions = Array.from({ length: 3 }, (_, index) => fixtureQuestion(850 + index, { typeLabel: "單一選擇題" }));
    const selected = questions.map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({ selection: { mode: "all" }, selected, model: MODEL });
    const results = selected.map((item) => createResultRecord(item, CLASSIFICATION, header));
    const parsed = parseJsonlText([
        header,
        ...results,
        createCheckpoint(results, results.length, true),
    ].map(JSON.stringify).join("\n") + "\n");
    const suggestions = new Map();
    let run = null;
    let runInsertStatements = 0;
    let suggestionInsertStatements = 0;
    let completionUpdates = 0;
    const finishedAt = "2026-10-16T08:00:00.000Z";
    const client = {
        query: async (text, params = []) => {
            const sql = String(text);
            if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE" || sql === "BEGIN"
                || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
            if (sql.includes("FROM pg_catalog.pg_class")) return { rows: schemaTableRows() };
            if (sql.includes("information_schema.columns")) return { rows: schemaColumns() };
            if (sql.includes("pg_catalog.pg_constraint")) return { rows: schemaConstraints() };
            if (sql.includes("SELECT purpose, engine")) return { rows: run ? [{ ...run }] : [] };
            if (sql.includes("INSERT INTO public.question_enrichment_runs")) {
                runInsertStatements += 1;
                if (!run) {
                    run = {
                        purpose: "question_bank_enrichment",
                        engine: "ollama",
                        model_name: params[1],
                        model_digest: params[2],
                        prompt_version: params[3],
                        taxonomy_version: params[4],
                        status: "running",
                        finished_at: null,
                    };
                }
                return { rowCount: 1, rows: [] };
            }
            if (sql.includes("INSERT INTO public.question_revision_enrichment_suggestions")) {
                suggestionInsertStatements += 1;
                if (suggestions.has(params[0])) return { rowCount: 0, rows: [] };
                suggestions.set(params[0], {
                    run_id: params[1],
                    question_revision_id: params[2],
                    dimension: params[3],
                    suggested_key: params[4],
                    suggested_label: params[5],
                    input_sha256: params[6],
                    confidence: params[7],
                    evidence: JSON.parse(params[8]),
                    status: "pending",
                });
                return { rowCount: 1, rows: [{ id: params[0] }] };
            }
            if (sql.includes("FROM public.question_revision_enrichment_suggestions") && sql.includes("WHERE id = $1")) {
                const suggestion = suggestions.get(params[0]);
                return { rows: suggestion ? [{ ...suggestion }] : [] };
            }
            if (sql.includes("COUNT(*)::integer")) return { rows: [{ count: suggestions.size }] };
            if (sql.includes("SET status = 'completed'")) {
                completionUpdates += 1;
                if (run?.status !== "running") return { rowCount: 0, rows: [] };
                run.status = "completed";
                run.finished_at = finishedAt;
                return { rowCount: 1, rows: [{ id: header.run_id }] };
            }
            if (sql.includes("SET status = 'failed'")) {
                if (["queued", "running", "failed"].includes(run?.status)) {
                    run.status = "failed";
                    return { rowCount: 1, rows: [] };
                }
                return { rowCount: 0, rows: [] };
            }
            throw new Error(`unexpected SQL in completed replay client: ${sql}`);
        },
    };

    const first = await persistPendingSuggestions(client, parsed, { loadQuestions: async () => questions });
    assert.equal(first.replayed, false);
    assert.equal(first.suggestions_inserted, 9);
    assert.equal(run.status, "completed");
    assert.equal(run.finished_at, finishedAt);
    const writesAfterFirstRun = {
        runInsertStatements,
        suggestionInsertStatements,
        completionUpdates,
    };

    const replay = await persistPendingSuggestions(client, parsed, { loadQuestions: async () => questions });
    assert.equal(replay.replayed, true);
    assert.equal(replay.suggestions_inserted, 0);
    assert.equal(replay.suggestions_already_present, 9);
    assert.deepEqual({ runInsertStatements, suggestionInsertStatements, completionUpdates }, writesAfterFirstRun);
    assert.equal(run.status, "completed");
    assert.equal(run.finished_at, finishedAt);

    const firstSuggestion = suggestions.values().next().value;
    firstSuggestion.suggested_label = "不相同的既有內容";
    await assert.rejects(
        () => persistPendingSuggestions(client, parsed, { loadQuestions: async () => questions }),
        (error) => error.code === "PERSISTENCE_ID_COLLISION",
    );
    assert.deepEqual({ runInsertStatements, suggestionInsertStatements, completionUpdates }, writesAfterFirstRun);
    assert.equal(run.status, "completed");
    assert.equal(run.finished_at, finishedAt);
});

test("a persistence batch failure rolls back every pending suggestion before recording the failed run", async () => {
    const questions = Array.from({ length: 3 }, (_, index) => fixtureQuestion(900 + index, { typeLabel: "單一選擇題" }));
    const selected = questions.map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({ selection: { mode: "all" }, selected, model: MODEL });
    const results = selected.map((item) => createResultRecord(item, CLASSIFICATION, header));
    const parsed = parseJsonlText([
        header,
        ...results,
        createCheckpoint(results, results.length, true),
    ].map(JSON.stringify).join("\n") + "\n");
    let inTransaction = false;
    let stagedSuggestions = 0;
    let committedSuggestions = 0;
    let insertAttempts = 0;
    let completed = false;
    let serializableBegins = 0;
    let failureRecordBegins = 0;
    const client = {
        query: async (text) => {
            const sql = String(text);
            if (sql.includes("FROM pg_catalog.pg_class")) return { rows: schemaTableRows() };
            if (sql.includes("information_schema.columns")) return { rows: schemaColumns() };
            if (sql.includes("pg_catalog.pg_constraint")) return { rows: schemaConstraints() };
            if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE") {
                serializableBegins += 1;
                inTransaction = true;
                stagedSuggestions = committedSuggestions;
                return { rows: [] };
            }
            if (sql === "BEGIN") {
                failureRecordBegins += 1;
                inTransaction = true;
                stagedSuggestions = committedSuggestions;
                return { rows: [] };
            }
            if (sql === "ROLLBACK") { inTransaction = false; stagedSuggestions = committedSuggestions; return { rows: [] }; }
            if (sql === "COMMIT") { inTransaction = false; committedSuggestions = stagedSuggestions; return { rows: [] }; }
            if (sql.includes("INSERT INTO public.question_enrichment_runs")) return { rowCount: 1, rows: [] };
            if (sql.includes("SELECT purpose, engine")) {
                return { rows: [{
                    purpose: "question_bank_enrichment", engine: "ollama", model_name: MODEL.name,
                    model_digest: MODEL.digest, prompt_version: PROMPT_VERSION,
                    taxonomy_version: TAXONOMY_VERSION, status: "running",
                }] };
            }
            if (sql.includes("INSERT INTO public.question_revision_enrichment_suggestions")) {
                assert.equal(inTransaction, true);
                insertAttempts += 1;
                if (insertAttempts === 5) throw new Error("synthetic insert failure");
                stagedSuggestions += 1;
                return { rowCount: 1, rows: [{ id: "synthetic" }] };
            }
            if (sql.includes("SET status = 'failed'")) return { rowCount: 1, rows: [] };
            if (sql.includes("SET status = 'completed'")) { completed = true; return { rowCount: 1, rows: [] }; }
            throw new Error(`unexpected SQL in rollback client: ${sql}`);
        },
    };
    await assert.rejects(
        () => persistPendingSuggestions(client, parsed, { loadQuestions: async () => questions }),
        (error) => error.code === "PERSISTENCE_FAILED",
    );
    assert.equal(committedSuggestions, 0);
    assert.equal(completed, false);
    assert.equal(serializableBegins, 1);
    assert.equal(failureRecordBegins, 1);
});

test("serialization and deadlock conflicts fail closed without retrying suggestion writes", async () => {
    const questions = Array.from({ length: 3 }, (_, index) => fixtureQuestion(950 + index, { typeLabel: "單一選擇題" }));
    const selected = questions.map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const header = createRunHeader({ selection: { mode: "all" }, selected, model: MODEL });
    const results = selected.map((item) => createResultRecord(item, CLASSIFICATION, header));
    const parsed = parseJsonlText([
        header,
        ...results,
        createCheckpoint(results, results.length, true),
    ].map(JSON.stringify).join("\n") + "\n");

    for (const postgresCode of ["40001", "40P01"]) {
        let serializableBegins = 0;
        let failureRecordBegins = 0;
        let insertAttempts = 0;
        let rollbacks = 0;
        let commits = 0;
        let completed = false;
        const client = {
            query: async (text) => {
                const sql = String(text);
                if (sql.includes("FROM pg_catalog.pg_class")) return { rows: schemaTableRows() };
                if (sql.includes("information_schema.columns")) return { rows: schemaColumns() };
                if (sql.includes("pg_catalog.pg_constraint")) return { rows: schemaConstraints() };
                if (sql === "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE") {
                    serializableBegins += 1;
                    return { rows: [] };
                }
                if (sql === "BEGIN") { failureRecordBegins += 1; return { rows: [] }; }
                if (sql === "ROLLBACK") { rollbacks += 1; return { rows: [] }; }
                if (sql === "COMMIT") { commits += 1; return { rows: [] }; }
                if (sql.includes("INSERT INTO public.question_enrichment_runs")) return { rowCount: 1, rows: [] };
                if (sql.includes("SELECT purpose, engine")) {
                    return { rows: [{
                        purpose: "question_bank_enrichment", engine: "ollama", model_name: MODEL.name,
                        model_digest: MODEL.digest, prompt_version: PROMPT_VERSION,
                        taxonomy_version: TAXONOMY_VERSION, status: "running",
                    }] };
                }
                if (sql.includes("INSERT INTO public.question_revision_enrichment_suggestions")) {
                    insertAttempts += 1;
                    throw Object.assign(new Error(`synthetic PostgreSQL ${postgresCode}`), { code: postgresCode });
                }
                if (sql.includes("SET status = 'failed'")) return { rowCount: 1, rows: [] };
                if (sql.includes("SET status = 'completed'")) { completed = true; return { rowCount: 1, rows: [] }; }
                throw new Error(`unexpected SQL in conflict client: ${sql}`);
            },
        };
        await assert.rejects(
            () => persistPendingSuggestions(client, parsed, { loadQuestions: async () => questions }),
            (error) => error.code === "PERSISTENCE_SERIALIZATION_CONFLICT",
        );
        assert.equal(serializableBegins, 1);
        assert.equal(failureRecordBegins, 1);
        assert.equal(insertAttempts, 1);
        assert.equal(rollbacks, 1);
        assert.equal(commits, 1);
        assert.equal(completed, false);
    }
});
