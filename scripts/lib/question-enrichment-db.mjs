import os from "node:os";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import {
    createRunHeader,
    deterministicStratifiedSample,
    deterministicUuid,
    importIdentity,
    prepareQuestionInput,
    QuestionEnrichmentError,
    SAMPLE_SEED,
    sha256,
    stableJson,
} from "./question-enrichment.mjs";

export const ENRICHMENT_RUNS_TABLE = "question_enrichment_runs";
export const ENRICHMENT_SUGGESTIONS_TABLE = "question_revision_enrichment_suggestions";
export const PERSIST_BATCH_SIZE = 16;

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REQUIRED_COLUMNS = Object.freeze({
    [ENRICHMENT_RUNS_TABLE]: Object.freeze({
        id: { type: "uuid", nullable: false },
        purpose: { type: "text", nullable: false, minimumLength: 24 },
        engine: { type: "text", nullable: false, minimumLength: 6 },
        model_name: { type: "text", nullable: false, minimumLength: 160 },
        model_digest: { type: "text", nullable: false, minimumLength: 64 },
        prompt_version: { type: "text", nullable: false, minimumLength: 160 },
        taxonomy_version: { type: "text", nullable: false, minimumLength: 160 },
        status: { type: "text", nullable: false, minimumLength: 16 },
        started_at: { type: "timestamp", nullable: false },
        finished_at: { type: "timestamp", nullable: true },
        error_code: { type: "text", nullable: true, minimumLength: 80 },
        created_by_user_id: { type: "uuid", nullable: true },
        created_at: { type: "timestamp", nullable: false },
    }),
    [ENRICHMENT_SUGGESTIONS_TABLE]: Object.freeze({
        id: { type: "uuid", nullable: false },
        run_id: { type: "uuid", nullable: false },
        question_revision_id: { type: "uuid", nullable: false },
        dimension: { type: "text", nullable: false, minimumLength: 24 },
        suggested_key: { type: "text", nullable: false, minimumLength: 160 },
        suggested_label: { type: "text", nullable: false, minimumLength: 160 },
        input_sha256: { type: "text", nullable: false, minimumLength: 64 },
        confidence: { type: "numeric", nullable: false },
        evidence: { type: "jsonb", nullable: false },
        status: { type: "text", nullable: false, minimumLength: 16 },
        reviewed_by_user_id: { type: "uuid", nullable: true },
        reviewed_at: { type: "timestamp", nullable: true },
        created_at: { type: "timestamp", nullable: false },
    }),
});

const REQUIRED_RUN_STATUSES = Object.freeze(["queued", "running", "completed", "failed", "cancelled"]);
const REQUIRED_SUGGESTION_STATUSES = Object.freeze(["pending", "approved", "rejected", "expired"]);
const REQUIRED_DIMENSIONS = Object.freeze(["fine_question_type", "knowledge_point", "solution_method"]);

export const CURRENT_QUESTION_SQL = `
SELECT
    question.id AS question_id,
    revision.id AS revision_id,
    revision.original_question_type_label,
    question_type.code AS question_type_code,
    question_type.name AS question_type_name,
    subject.code AS subject_code,
    subject.name AS subject_name,
    grade.code AS grade_code,
    grade.name AS grade_name,
    semester.code AS semester_code,
    semester.name AS semester_name,
    difficulty.code AS difficulty_code,
    difficulty.name AS difficulty_name
FROM public.questions AS question
JOIN public.question_revisions AS revision
    ON revision.id = question.current_revision_id
    AND revision.question_id = question.id
JOIN public.question_types AS question_type ON question_type.id = revision.question_type_id
LEFT JOIN public.subjects AS subject ON subject.id = revision.subject_id
LEFT JOIN public.grades AS grade ON grade.id = revision.grade_id
LEFT JOIN public.semesters AS semester ON semester.id = revision.semester_id
LEFT JOIN public.difficulty_levels AS difficulty ON difficulty.id = revision.difficulty_level_id
WHERE question.origin = 'system'
    AND question.status = 'published'
    AND revision.status = 'published'
ORDER BY revision.id`;

export const QUESTION_PART_SQL = `
SELECT
    part.id,
    part.question_revision_id,
    part.stable_key,
    part.position,
    part.answer_mode,
    part.grading_policy,
    part.is_independently_gradable
FROM public.question_parts AS part
WHERE part.question_revision_id = ANY($1::uuid[])
ORDER BY part.question_revision_id, part.position, part.id`;

export const QUESTION_OPTION_SQL = `
SELECT
    option.id,
    option.question_part_id,
    option.option_key,
    option.position
FROM public.question_options AS option
JOIN public.question_parts AS part ON part.id = option.question_part_id
WHERE part.question_revision_id = ANY($1::uuid[])
ORDER BY part.question_revision_id, option.position, option.id`;

export const QUESTION_ANSWER_SQL = `
SELECT
    answer.id,
    answer.question_part_id,
    answer.answer_key,
    answer.accepted_value,
    answer.position
FROM public.question_answers AS answer
JOIN public.question_parts AS part ON part.id = answer.question_part_id
WHERE part.question_revision_id = ANY($1::uuid[])
ORDER BY part.question_revision_id, answer.position, answer.id`;

export const QUESTION_CONTENT_SQL = `
SELECT
    block.id,
    block.question_revision_id,
    block.question_part_id,
    block.question_option_id,
    block.parent_block_id,
    block.placement,
    block.content_type,
    block.position,
    block.text_content,
    block.alt_text
FROM public.question_content_blocks AS block
WHERE block.question_revision_id = ANY($1::uuid[])
ORDER BY block.question_revision_id, block.placement, block.position, block.id`;

function fail(code, message, cause = undefined) {
    throw new QuestionEnrichmentError(code, message, cause);
}

function assertSafeIdentifier(value, label) {
    if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
        fail("UNSAFE_DATABASE_CONFIG", `${label} 不是安全的 PostgreSQL identifier。`);
    }
    return value;
}

function readPort(value) {
    if (!/^\d+$/u.test(value)) fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL port 無效。 ");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
        fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL port 無效。 ");
    }
    return parsed;
}

export function localDatabaseConfiguration(repositoryRoot, environment = process.env) {
    if (environment.LERNIQA_ENRICHMENT_PGPASSWORD || environment.PGPASSWORD) {
        fail("UNSAFE_DATABASE_CONFIG", "Enrichment pipeline 不接受資料庫密碼，只允許專案本機 Unix socket。 ");
    }
    const localDataDirectory = path.resolve(repositoryRoot, "local-data");
    const localDataRoot = `${localDataDirectory}${path.sep}`;
    const host = path.resolve(
        environment.LERNIQA_ENRICHMENT_PGHOST
            ?? path.join(repositoryRoot, "local-data", "postgres-socket"),
    );
    if (!`${host}${path.sep}`.startsWith(localDataRoot)) {
        fail("UNSAFE_DATABASE_CONFIG", "Enrichment pipeline 只允許專案 local-data 內的 Unix socket。 ");
    }
    return Object.freeze({
        host,
        port: readPort(environment.LERNIQA_ENRICHMENT_PGPORT ?? "55432"),
        database: assertSafeIdentifier(environment.LERNIQA_ENRICHMENT_PGDATABASE ?? "lerniqa_local", "database"),
        user: assertSafeIdentifier(environment.LERNIQA_ENRICHMENT_PGUSER ?? environment.PGUSER ?? os.userInfo().username, "user"),
        localDataDirectory,
        expectedDataDirectory: path.join(localDataDirectory, "postgres"),
    });
}

export function createLocalDatabaseClient(configuration, { readOnly, applicationName }) {
    const {
        localDataDirectory: _localDataDirectory,
        expectedDataDirectory: _expectedDataDirectory,
        ...connection
    } = configuration;
    return new Client({
        ...connection,
        password: async () => fail("UNSAFE_DATABASE_CONFIG", "本機 enrichment 資料庫不應要求密碼。 "),
        ssl: false,
        application_name: applicationName,
        options: readOnly
            ? "-c search_path=pg_catalog,public -c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000"
            : "-c search_path=pg_catalog,public -c statement_timeout=30000 -c lock_timeout=5000",
        connectionTimeoutMillis: 5_000,
        query_timeout: 35_000,
    });
}

function isPathInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function realDirectoryWithoutSymlink(directory, label) {
    let metadata;
    try {
        metadata = await lstat(directory);
    }
    catch (error) {
        fail("UNSAFE_DATABASE_CONFIG", `${label} 不存在或無法檢查。`, error);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        fail("UNSAFE_DATABASE_CONFIG", `${label} 必須是一般目錄且不可為 symlink。`);
    }
    return realpath(directory);
}

export async function assertLocalDatabaseFilesystem(configuration) {
    const localDataRealpath = await realDirectoryWithoutSymlink(configuration.localDataDirectory, "local-data");
    const hostRealpath = await realDirectoryWithoutSymlink(configuration.host, "PostgreSQL socket 目錄");
    const dataRealpath = await realDirectoryWithoutSymlink(configuration.expectedDataDirectory, "PostgreSQL data_directory");
    if (!isPathInside(localDataRealpath, hostRealpath) || !isPathInside(localDataRealpath, dataRealpath)) {
        fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL socket 或 data_directory 不在專案 local-data 內。 ");
    }
    return Object.freeze({ localDataRealpath, hostRealpath, dataRealpath });
}

export async function assertConnectedLocalDatabaseIdentity(client, configuration, filesystem) {
    const identity = await client.query(`
        SELECT
            pg_catalog.current_database() AS database_name,
            pg_catalog.inet_server_addr()::text AS server_address,
            pg_catalog.current_setting('data_directory') AS data_directory,
            pg_catalog.current_setting('port') AS server_port
    `);
    const row = identity.rows[0];
    let serverDataRealpath;
    try {
        serverDataRealpath = await realpath(String(row?.data_directory ?? ""));
    }
    catch (error) {
        fail("UNSAFE_DATABASE_TARGET", "無法驗證連線中的 PostgreSQL data_directory。", error);
    }
    if (row?.database_name !== configuration.database || row?.server_address !== null
        || readPort(String(row?.server_port ?? "")) !== configuration.port
        || serverDataRealpath !== filesystem.dataRealpath) {
        fail("UNSAFE_DATABASE_TARGET", "PostgreSQL 連線不是預期的專案本機隔離資料庫。 ");
    }
    return true;
}

function attachRows(questionRows, partRows, optionRows, answerRows, contentRows) {
    const questions = questionRows.map((row) => ({
        questionId: row.question_id,
        revisionId: row.revision_id,
        originalQuestionTypeLabel: row.original_question_type_label,
        questionTypeCode: row.question_type_code,
        questionTypeName: row.question_type_name,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        gradeCode: row.grade_code,
        gradeName: row.grade_name,
        semesterCode: row.semester_code,
        semesterName: row.semester_name,
        difficultyCode: row.difficulty_code,
        difficultyName: row.difficulty_name,
        parts: [],
        contentBlocks: [],
    }));
    const byRevision = new Map(questions.map((question) => [question.revisionId, question]));
    const byPart = new Map();
    for (const row of partRows) {
        const question = byRevision.get(row.question_revision_id);
        if (!question) fail("DATABASE_SNAPSHOT_INVALID", "題目部件指向快照外的版本。 ");
        const part = {
            id: row.id,
            stableKey: row.stable_key,
            position: Number(row.position),
            answerMode: row.answer_mode,
            gradingPolicy: row.grading_policy,
            isIndependentlyGradable: row.is_independently_gradable,
            options: [],
            answers: [],
        };
        question.parts.push(part);
        byPart.set(part.id, part);
    }
    for (const row of optionRows) {
        const part = byPart.get(row.question_part_id);
        if (!part) fail("DATABASE_SNAPSHOT_INVALID", "題目選項指向快照外的部件。 ");
        part.options.push({ id: row.id, optionKey: row.option_key, position: Number(row.position) });
    }
    for (const row of answerRows) {
        const part = byPart.get(row.question_part_id);
        if (!part) fail("DATABASE_SNAPSHOT_INVALID", "題目答案指向快照外的部件。 ");
        part.answers.push({
            id: row.id,
            answerKey: row.answer_key,
            acceptedValue: row.accepted_value,
            position: Number(row.position),
        });
    }
    for (const row of contentRows) {
        const question = byRevision.get(row.question_revision_id);
        if (!question) fail("DATABASE_SNAPSHOT_INVALID", "題目內容指向快照外的版本。 ");
        question.contentBlocks.push({
            id: row.id,
            questionPartId: row.question_part_id,
            questionOptionId: row.question_option_id,
            parentBlockId: row.parent_block_id,
            placement: row.placement,
            contentType: row.content_type,
            position: Number(row.position),
            textContent: row.text_content,
            altText: row.alt_text,
        });
    }
    return questions;
}

export async function readCurrentPublishedQuestionsInTransaction(client) {
    const questionResult = await client.query(CURRENT_QUESTION_SQL);
    if (questionResult.rows.length === 0) fail("EMPTY_QUESTION_CATALOG", "沒有可分類的目前已發布系統題目。 ");
    const revisionIds = questionResult.rows.map((row) => row.revision_id);
    const parts = await client.query(QUESTION_PART_SQL, [revisionIds]);
    const options = await client.query(QUESTION_OPTION_SQL, [revisionIds]);
    const answers = await client.query(QUESTION_ANSWER_SQL, [revisionIds]);
    const content = await client.query(QUESTION_CONTENT_SQL, [revisionIds]);
    return attachRows(questionResult.rows, parts.rows, options.rows, answers.rows, content.rows);
}

export async function readCurrentPublishedQuestions(client) {
    let transactionOpen = false;
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        transactionOpen = true;
        const readOnly = await client.query("SELECT current_setting('transaction_read_only') AS value");
        if (readOnly.rows[0]?.value !== "on") {
            fail("READ_ONLY_TRANSACTION_REQUIRED", "題庫讀取未進入唯讀交易，拒絕繼續。 ");
        }
        const questions = await readCurrentPublishedQuestionsInTransaction(client);
        await client.query("COMMIT");
        transactionOpen = false;
        return questions;
    }
    catch (error) {
        if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
        if (error instanceof QuestionEnrichmentError) throw error;
        fail("QUESTION_SNAPSHOT_READ_FAILED", "無法讀取本機題庫快照。", error);
    }
}

export function assertJsonlMatchesCurrentPublishedQuestions(parsedJsonl, questions) {
    const { header, results } = parsedJsonl;
    const catalog = questions
        .map(prepareQuestionInput)
        .sort((left, right) => left.revisionId.localeCompare(right.revisionId, "en"));
    const selected = header.selection.mode === "all"
        ? catalog
        : deterministicStratifiedSample(catalog, header.selection.size, header.selection.seed ?? SAMPLE_SEED);
    const expectedHeader = createRunHeader({
        selection: header.selection,
        selected,
        catalog,
        model: header.model,
        runId: header.run_id,
        createdAt: header.created_at,
    });
    for (const key of [
        "catalog_snapshot_sha256",
        "selected_count",
        "source_catalog_count",
        "source_catalog_sha256",
        "sample_coverage",
    ]) {
        if (stableJson(header[key]) !== stableJson(expectedHeader[key])) {
            fail("PERSISTENCE_SOURCE_MISMATCH", `JSONL ${key} 與目前已發布系統題庫不一致；拒絕寫入。`);
        }
    }
    const expectedManifest = selected.map((item) => ({
        question_id: item.questionId,
        question_revision_id: item.revisionId,
        input_sha256: item.inputSha256,
    }));
    const resultManifest = results.map((result) => ({
        question_id: result.question_id,
        question_revision_id: result.question_revision_id,
        input_sha256: result.input_sha256,
    }));
    if (stableJson(resultManifest) !== stableJson(expectedManifest)) {
        fail("PERSISTENCE_SOURCE_MISMATCH", "JSONL 結果未精確對應目前已發布系統題目的 question、revision 與 canonical input hash。 ");
    }
    return true;
}

function compatibleType(actual, expected) {
    const normalized = `${actual.data_type ?? ""}|${actual.udt_name ?? ""}`.toLowerCase();
    let typeCompatible = false;
    if (expected.type === "uuid") typeCompatible = normalized.includes("uuid");
    if (expected.type === "text") {
        typeCompatible = normalized.includes("text") || normalized.includes("varchar") || normalized.includes("character varying");
    }
    if (expected.type === "timestamp") typeCompatible = normalized.includes("timestamp") || normalized.includes("timestamptz");
    if (expected.type === "numeric") typeCompatible = normalized.includes("numeric") || normalized.includes("decimal");
    if (expected.type === "jsonb") typeCompatible = normalized.includes("jsonb") && !normalized.includes("|json|");
    if (!typeCompatible || !["YES", "NO"].includes(actual.is_nullable)
        || (actual.is_nullable === "YES") !== expected.nullable) return false;
    if (expected.minimumLength) {
        if (actual.character_maximum_length === undefined) return false;
        if (actual.character_maximum_length !== null
            && Number(actual.character_maximum_length) < expected.minimumLength) return false;
    }
    return true;
}

function sameColumns(actual, expected) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return [...actual].sort().every((column, index) => column === [...expected].sort()[index]);
}

function checkContainsExactValues(checks, column, expectedValues) {
    return checks.some((constraint) => {
        if (!constraint.local_columns?.includes(column)) return false;
        const actualValues = [...String(constraint.definition).matchAll(/'([^']+)'/gu)].map((match) => match[1]);
        return actualValues.length === expectedValues.length
            && [...actualValues].sort().every((value, index) => value === [...expectedValues].sort()[index]);
    });
}

function hasSha256Check(checks, column) {
    const definitions = checks
        .filter((constraint) => constraint.local_columns?.includes(column))
        .map((constraint) => String(constraint.definition).toLowerCase())
        .join(" ");
    return definitions.includes("64") && definitions.includes("~") && definitions.includes("0-9a-f");
}

export async function assertPersistenceSchema(client) {
    const tableResult = await client.query(`
        SELECT relation.oid::text AS relation_oid, namespace.nspname AS table_schema,
               relation.relname AS table_name, relation.relkind
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
            AND relation.relname = ANY($1::text[])
    `, [[ENRICHMENT_RUNS_TABLE, ENRICHMENT_SUGGESTIONS_TABLE]]);
    if (![ENRICHMENT_RUNS_TABLE, ENRICHMENT_SUGGESTIONS_TABLE].every((table) =>
        tableResult.rows.some((row) => row.table_schema === "public" && row.table_name === table
            && ["r", "p"].includes(row.relkind) && /^\d+$/u.test(String(row.relation_oid))))) {
        fail("ENRICHMENT_SCHEMA_UNAVAILABLE", "Enrichment sidecar 兩表尚未可用；拒絕寫入。 ");
    }

    const columns = await client.query(`
        SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
    `, [[ENRICHMENT_RUNS_TABLE, ENRICHMENT_SUGGESTIONS_TABLE]]);
    const columnMap = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
        for (const [column, expectedType] of Object.entries(required)) {
            const actual = columnMap.get(`${table}.${column}`);
            if (!actual || actual.table_schema !== "public" || !compatibleType(actual, expectedType)) {
                fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", `${table}.${column} 缺少或型別不相容；拒絕寫入。`);
            }
        }
    }

    const constraints = await client.query(`
        SELECT relation.relname AS table_name, constraint.conname, constraint.contype,
               pg_catalog.pg_get_constraintdef(constraint.oid, true) AS definition,
               ARRAY(
                   SELECT attribute.attname
                   FROM unnest(constraint.conkey) WITH ORDINALITY AS key(attnum, position)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = constraint.conrelid AND attribute.attnum = key.attnum
                   ORDER BY key.position
               ) AS local_columns,
               referenced_namespace.nspname AS referenced_schema,
               referenced_relation.relname AS referenced_table,
               ARRAY(
                   SELECT attribute.attname
                   FROM unnest(constraint.confkey) WITH ORDINALITY AS key(attnum, position)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = constraint.confrelid AND attribute.attnum = key.attnum
                   ORDER BY key.position
               ) AS referenced_columns
        FROM pg_catalog.pg_constraint AS constraint
        JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint.conrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_catalog.pg_class AS referenced_relation ON referenced_relation.oid = constraint.confrelid
        LEFT JOIN pg_catalog.pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
        WHERE namespace.nspname = 'public'
            AND relation.relname = ANY($1::text[])
    `, [[ENRICHMENT_RUNS_TABLE, ENRICHMENT_SUGGESTIONS_TABLE]]);
    const byTable = (table, type) => constraints.rows
        .filter((row) => row.table_name === table && row.contype === type);
    const runChecks = byTable(ENRICHMENT_RUNS_TABLE, "c");
    const suggestionChecks = byTable(ENRICHMENT_SUGGESTIONS_TABLE, "c");
    if (!checkContainsExactValues(runChecks, "status", REQUIRED_RUN_STATUSES)
        || !checkContainsExactValues(suggestionChecks, "status", REQUIRED_SUGGESTION_STATUSES)
        || !checkContainsExactValues(suggestionChecks, "dimension", REQUIRED_DIMENSIONS)) {
        fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", "Enrichment sidecar 缺少固定 run status、suggestion status 或 dimension CHECK；拒絕寫入。 ");
    }
    const confidenceChecks = suggestionChecks
        .filter((constraint) => constraint.local_columns?.includes("confidence"))
        .map((constraint) => String(constraint.definition).toLowerCase());
    if (!confidenceChecks.some((definition) => {
        const normalized = definition.replace(/[()]/gu, " ").replace(/\s+/gu, " ");
        return /\b0\b/u.test(normalized) && /\b1\b/u.test(normalized)
            && (normalized.includes("between") || (normalized.includes(">=") && normalized.includes("<=")));
    })) {
        fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", "Enrichment suggestion 缺少 confidence CHECK；拒絕寫入。 ");
    }
    if (!hasSha256Check(runChecks, "model_digest") || !hasSha256Check(suggestionChecks, "input_sha256")) {
        fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", "Enrichment sidecar 缺少 SHA-256 格式 CHECK；拒絕寫入。 ");
    }
    const suggestionForeignKeys = byTable(ENRICHMENT_SUGGESTIONS_TABLE, "f");
    const hasForeignKey = (localColumn, referencedTable) => suggestionForeignKeys.some((constraint) =>
        sameColumns(constraint.local_columns, [localColumn])
        && constraint.referenced_schema === "public"
        && constraint.referenced_table === referencedTable
        && sameColumns(constraint.referenced_columns, ["id"]));
    if (!hasForeignKey("run_id", ENRICHMENT_RUNS_TABLE)
        || !hasForeignKey("question_revision_id", "question_revisions")) {
        fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", "Enrichment suggestion 缺少 run 或 question revision 外鍵；拒絕寫入。 ");
    }
    const primaryKeys = constraints.rows.filter((row) => row.contype === "p");
    if (![ENRICHMENT_RUNS_TABLE, ENRICHMENT_SUGGESTIONS_TABLE].every((table) =>
        primaryKeys.some((row) => row.table_name === table && sameColumns(row.local_columns, ["id"])))) {
        fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", "Enrichment sidecar 必須以 id 作主鍵；拒絕寫入。 ");
    }
    if (!byTable(ENRICHMENT_SUGGESTIONS_TABLE, "u").some((constraint) =>
        sameColumns(constraint.local_columns, ["run_id", "question_revision_id", "dimension"]))) {
        fail("ENRICHMENT_SCHEMA_INCOMPATIBLE", "Enrichment suggestion 缺少 run、revision、dimension 唯一約束；拒絕寫入。 ");
    }
    return true;
}

function suggestionRows(runId, importId, result) {
    return REQUIRED_DIMENSIONS.map((dimension) => {
        const suggestion = result[dimension];
        return Object.freeze({
            id: deterministicUuid(`question-enrichment-suggestion:${runId}:${result.question_revision_id}:${dimension}`),
            runId,
            questionRevisionId: result.question_revision_id,
            dimension,
            suggestedKey: suggestion.key,
            suggestedLabel: suggestion.label,
            inputSha256: result.input_sha256,
            confidence: suggestion.confidence,
            evidence: {
                statements: suggestion.evidence,
                import_id: importId,
                question_id: result.question_id,
                model: result.model,
                prompt_version: result.prompt_version,
                taxonomy_version: result.taxonomy_version,
            },
        });
    });
}

async function inTransaction(client, operation, { serializable = false } = {}) {
    await client.query(serializable
        ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE"
        : "BEGIN");
    try {
        const result = await operation();
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
}

async function readRun(client, runId) {
    const existing = await client.query(`
        SELECT purpose, engine, model_name, model_digest, prompt_version, taxonomy_version, status
        FROM public.question_enrichment_runs
        WHERE id = $1
    `, [runId]);
    return existing.rows[0] ?? null;
}

function assertRunMatchesHeader(row, header) {
    if (!row || row.purpose !== "question_bank_enrichment" || row.engine !== "ollama"
        || row.model_name !== header.model.name || row.model_digest !== header.model.digest
        || row.prompt_version !== header.prompt_version || row.taxonomy_version !== header.taxonomy_version) {
        fail("PERSISTENCE_ID_COLLISION", "既有 enrichment run 與 JSONL metadata 不一致。 ");
    }
}

async function ensureRun(client, runId, header) {
    let row = await readRun(client, runId);
    if (!row) {
        await client.query(`
            INSERT INTO public.question_enrichment_runs (
                id, purpose, engine, model_name, model_digest, prompt_version, taxonomy_version,
                status, started_at, finished_at, error_code, created_by_user_id, created_at
            ) VALUES ($1, 'question_bank_enrichment', 'ollama', $2, $3, $4, $5, 'running', CURRENT_TIMESTAMP, NULL, NULL, NULL, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO NOTHING
        `, [runId, header.model.name, header.model.digest, header.prompt_version, header.taxonomy_version]);
        row = await readRun(client, runId);
    }
    assertRunMatchesHeader(row, header);
    if (["failed", "cancelled", "queued"].includes(row.status)) {
        const resumed = await client.query(`
            UPDATE public.question_enrichment_runs
            SET status = 'running', started_at = CURRENT_TIMESTAMP, finished_at = NULL, error_code = NULL
            WHERE id = $1 AND status IN ('failed', 'cancelled', 'queued')
            RETURNING status
        `, [runId]);
        if (resumed.rowCount !== 1 || resumed.rows[0]?.status !== "running") {
            fail("PERSISTENCE_RUN_STATE_CHANGED", "Enrichment run 狀態已變更；拒絕繼續寫入。 ");
        }
        return "running";
    }
    return row.status;
}

async function assertExistingSuggestionMatches(client, row) {
    const existing = await client.query(`
        SELECT run_id, question_revision_id, dimension, suggested_key, suggested_label,
               input_sha256, confidence, evidence, status
        FROM public.question_revision_enrichment_suggestions
        WHERE id = $1
    `, [row.id]);
    const actual = existing.rows[0];
    const expected = {
        run_id: row.runId,
        question_revision_id: row.questionRevisionId,
        dimension: row.dimension,
        suggested_key: row.suggestedKey,
        suggested_label: row.suggestedLabel,
        input_sha256: row.inputSha256,
        confidence: String(row.confidence),
        evidence: row.evidence,
    };
    const comparable = actual && {
        run_id: actual.run_id,
        question_revision_id: actual.question_revision_id,
        dimension: actual.dimension,
        suggested_key: actual.suggested_key,
        suggested_label: actual.suggested_label,
        input_sha256: actual.input_sha256,
        confidence: Number(actual.confidence),
        evidence: actual.evidence,
    };
    expected.confidence = Number(expected.confidence);
    if (!actual || stableJson(comparable) !== stableJson(expected)) {
        fail("PERSISTENCE_ID_COLLISION", "既有 enrichment suggestion 與 JSONL 結果不一致。 ");
    }
}

async function insertSuggestion(client, row) {
    const inserted = await client.query(`
        INSERT INTO public.question_revision_enrichment_suggestions (
            id, run_id, question_revision_id, dimension, suggested_key, suggested_label,
            input_sha256, confidence, evidence, status, reviewed_by_user_id, reviewed_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'pending', NULL, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
    `, [
        row.id, row.runId, row.questionRevisionId, row.dimension, row.suggestedKey,
        row.suggestedLabel, row.inputSha256, row.confidence, JSON.stringify(row.evidence),
    ]);
    if (inserted.rowCount === 1) return "inserted";
    await assertExistingSuggestionMatches(client, row);
    return "existing";
}

function compactErrorCode(error) {
    const raw = error instanceof QuestionEnrichmentError
        ? error.code
        : ["40001", "40P01"].includes(error?.code)
            ? `PG_${error.code}`
            : "PERSISTENCE_FAILED";
    return String(raw).replace(/[^A-Z0-9_]/gu, "_").slice(0, 80) || "PERSISTENCE_FAILED";
}

export async function persistPendingSuggestions(client, parsedJsonl, {
    loadQuestions = readCurrentPublishedQuestionsInTransaction,
} = {}) {
    const { header, results, lastCheckpoint } = parsedJsonl;
    if (!lastCheckpoint?.complete || results.length !== header.selected_count) {
        fail("INCOMPLETE_ENRICHMENT_FILE", "只有具完整 final checkpoint 的 JSONL 可以匯入。 ");
    }
    const runId = header.run_id;
    const importId = importIdentity(header, results);
    const rows = results.flatMap((result) => suggestionRows(runId, importId, result));
    let counts;
    try {
        counts = await inTransaction(client, async () => {
            await assertPersistenceSchema(client);
            const currentQuestions = await loadQuestions(client);
            assertJsonlMatchesCurrentPublishedQuestions(parsedJsonl, currentQuestions);
            const runStatus = await ensureRun(client, runId, header);
            let inserted = 0;
            let existing = 0;
            for (let offset = 0; offset < rows.length; offset += PERSIST_BATCH_SIZE) {
                const batch = rows.slice(offset, offset + PERSIST_BATCH_SIZE);
                for (const row of batch) {
                    if (runStatus === "completed") {
                        await assertExistingSuggestionMatches(client, row);
                        existing += 1;
                        continue;
                    }
                    const outcome = await insertSuggestion(client, row);
                    if (outcome === "inserted") inserted += 1;
                    else existing += 1;
                }
            }
            const persistedCount = await client.query(`
                SELECT COUNT(*)::integer AS count
                FROM public.question_revision_enrichment_suggestions
                WHERE run_id = $1
            `, [runId]);
            if (Number(persistedCount.rows[0]?.count) !== rows.length) {
                fail("PERSISTENCE_INCOMPLETE", "Enrichment run 的 suggestion 數量不完整；整筆回滾。 ");
            }
            if (runStatus === "completed") {
                return { inserted, existing, replayed: true };
            }
            const completed = await client.query(`
                UPDATE public.question_enrichment_runs
                SET status = 'completed', finished_at = CURRENT_TIMESTAMP, error_code = NULL
                WHERE id = $1 AND status = 'running'
                RETURNING id
            `, [runId]);
            if (completed.rowCount !== 1) fail("PERSISTENCE_INCOMPLETE", "Enrichment run 無法原子完成；整筆回滾。 ");
            return { inserted, existing, replayed: false };
        }, { serializable: true });
    }
    catch (error) {
        await inTransaction(client, async () => {
            await ensureRun(client, runId, header);
            await client.query(`
                UPDATE public.question_enrichment_runs
                SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_code = $2
                WHERE id = $1 AND status IN ('queued', 'running', 'failed')
            `, [runId, compactErrorCode(error)]);
        }).catch(() => undefined);
        if (error instanceof QuestionEnrichmentError) throw error;
        if (["40001", "40P01"].includes(error?.code)) {
            fail(
                "PERSISTENCE_SERIALIZATION_CONFLICT",
                "題庫在匯入期間變更或發生交易衝突；未留下 suggestions，請重新產生並驗證後再執行。",
                error,
            );
        }
        fail("PERSISTENCE_FAILED", "Enrichment pending suggestions 匯入失敗。", error);
    }
    return Object.freeze({
        ok: true,
        persisted: true,
        run_id: runId,
        import_id: importId,
        results: results.length,
        suggestions_inserted: counts.inserted,
        suggestions_already_present: counts.existing,
        replayed: counts.replayed,
        output_sha256: sha256(parsedJsonl),
    });
}
