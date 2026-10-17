import os from "node:os";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { Client } from "pg";

import {
    HANDWRITING_MODEL_DIGEST,
    HANDWRITING_MODEL_NAME,
    HANDWRITING_PROMPT_VERSION,
    HANDWRITING_SCHEMA_VERSION,
    HandwritingAnalysisError,
} from "../../app/lib/handwriting-analysis.mjs";

export const HANDWRITING_JOBS_TABLE = "handwriting_analysis_jobs";
export const HANDWRITING_RUNS_TABLE = "handwriting_analysis_runs";
export const HANDWRITING_LEASE_SECONDS = 600;
export const HANDWRITING_GLOBAL_LOCK_KEY = "lerniqa:handwriting-analysis-worker:v1";

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
const REQUIRED_COLUMNS = Object.freeze({
    [HANDWRITING_JOBS_TABLE]: Object.freeze([
        "id", "answer_part_result_id", "asset_id", "question_revision_id", "question_part_id",
        "asset_checksum", "reference_sha256", "status", "available_at", "lease_owner",
        "lease_expires_at", "attempt_count", "max_attempts", "last_error_code", "created_at",
        "updated_at", "finished_at",
    ]),
    [HANDWRITING_RUNS_TABLE]: Object.freeze([
        "id", "job_id", "attempt_number", "status", "engine", "model_name", "model_version",
        "model_digest", "prompt_version", "schema_version", "asset_checksum", "reference_sha256",
        "recognized_text", "transcription_confidence", "legibility", "proposed_result",
        "result_confidence", "uncertainty_reasons", "evidence", "error_code", "started_at", "finished_at",
    ]),
});

function fail(code, message, options = undefined) {
    throw new HandwritingAnalysisError(code, message, options);
}

function readPort(value) {
    if (!/^\d+$/u.test(value ?? "")) fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL port 無效。 ");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL port 無效。 ");
    return parsed;
}

function safeIdentifier(value, label) {
    if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) fail("UNSAFE_DATABASE_CONFIG", `${label} 無效。`);
    return value;
}

function isInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function handwritingDatabaseConfiguration(repositoryRoot, environment = process.env) {
    if (environment.LERNIQA_HANDWRITING_PGPASSWORD || environment.PGPASSWORD) {
        fail("UNSAFE_DATABASE_CONFIG", "手寫 worker 不接受資料庫密碼，只允許專案本機 Unix socket。 ");
    }
    const localDataDirectory = path.resolve(repositoryRoot, "local-data");
    const host = path.resolve(environment.LERNIQA_HANDWRITING_PGHOST ?? path.join(localDataDirectory, "postgres-socket"));
    if (!isInside(localDataDirectory, host)) fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL socket 必須位於專案 local-data。 ");
    return Object.freeze({
        host,
        port: readPort(environment.LERNIQA_HANDWRITING_PGPORT ?? "55432"),
        database: safeIdentifier(environment.LERNIQA_HANDWRITING_PGDATABASE ?? "lerniqa_local", "database"),
        user: safeIdentifier(environment.LERNIQA_HANDWRITING_PGUSER ?? environment.PGUSER ?? os.userInfo().username, "user"),
        localDataDirectory,
        expectedDataDirectory: path.join(localDataDirectory, "postgres"),
    });
}

async function realOrdinaryDirectory(directory, label) {
    const metadata = await lstat(directory).catch((cause) => fail("UNSAFE_DATABASE_CONFIG", `${label} 不存在或無法檢查。`, { cause }));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("UNSAFE_DATABASE_CONFIG", `${label} 必須是一般目錄且不可為 symlink。`);
    return realpath(directory);
}

export async function assertHandwritingDatabaseFilesystem(configuration) {
    const [localDataRealpath, hostRealpath, dataRealpath] = await Promise.all([
        realOrdinaryDirectory(configuration.localDataDirectory, "local-data"),
        realOrdinaryDirectory(configuration.host, "PostgreSQL socket 目錄"),
        realOrdinaryDirectory(configuration.expectedDataDirectory, "PostgreSQL data_directory"),
    ]);
    if (!isInside(localDataRealpath, hostRealpath) || !isInside(localDataRealpath, dataRealpath)) {
        fail("UNSAFE_DATABASE_CONFIG", "PostgreSQL socket 或 data_directory 不在專案 local-data。 ");
    }
    return Object.freeze({ dataRealpath });
}

export function createHandwritingDatabaseClient(configuration) {
    const { localDataDirectory: _localDataDirectory, expectedDataDirectory: _expectedDataDirectory, ...connection } = configuration;
    return new Client({
        ...connection,
        password: async () => fail("UNSAFE_DATABASE_CONFIG", "本機手寫 worker 資料庫不應要求密碼。 "),
        ssl: false,
        application_name: "lerniqa-handwriting-analysis-worker",
        options: "-c search_path=pg_catalog,public -c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000",
        connectionTimeoutMillis: 5_000,
        query_timeout: 35_000,
    });
}

export async function assertConnectedHandwritingDatabase(client, configuration, filesystem) {
    const identity = await client.query(`
        SELECT pg_catalog.current_database() AS database_name,
               pg_catalog.inet_server_addr()::text AS server_address,
               pg_catalog.current_setting('data_directory') AS data_directory,
               pg_catalog.current_setting('port') AS server_port
    `);
    const row = identity.rows[0];
    const serverDataRealpath = await realpath(String(row?.data_directory ?? ""))
        .catch((cause) => fail("UNSAFE_DATABASE_TARGET", "無法驗證 PostgreSQL data_directory。", { cause }));
    if (row?.database_name !== configuration.database || row?.server_address !== null
        || readPort(String(row?.server_port ?? "")) !== configuration.port
        || serverDataRealpath !== filesystem.dataRealpath) {
        fail("UNSAFE_DATABASE_TARGET", "PostgreSQL 不是預期的專案本機隔離資料庫。 ");
    }
}

export async function assertHandwritingAnalysisSchema(client) {
    const tables = Object.keys(REQUIRED_COLUMNS);
    const result = await client.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [tables]);
    const available = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        for (const column of columns) {
            if (!available.has(`${table}.${column}`)) {
                fail("HANDWRITING_SCHEMA_INCOMPATIBLE", `${table}.${column} 尚未由 migration 提供；拒絕執行。`);
            }
        }
    }
}

export async function acquireHandwritingWorkerLock(client) {
    const result = await client.query(
        "SELECT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) AS acquired",
        [HANDWRITING_GLOBAL_LOCK_KEY],
    );
    return result.rows[0]?.acquired === true;
}

export async function releaseHandwritingWorkerLock(client) {
    await client.query(
        "SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0))",
        [HANDWRITING_GLOBAL_LOCK_KEY],
    );
}

const ELIGIBLE_JOB_FROM = `
FROM public.handwriting_analysis_jobs AS job
JOIN public.answer_part_results AS result ON result.id = job.answer_part_result_id
JOIN public.answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
JOIN public.practice_session_items AS item ON item.id = attempt.practice_session_item_id
JOIN public.practice_sessions AS session ON session.id = item.practice_session_id
JOIN public.question_parts AS part
    ON part.id = result.question_part_id
    AND part.question_revision_id = item.question_revision_id
JOIN public.answer_part_assets AS answer_asset
    ON answer_asset.answer_part_result_id = result.id
    AND answer_asset.asset_id = job.asset_id
    AND answer_asset.asset_role = 'handwriting'
JOIN public.assets AS asset
    ON asset.id = answer_asset.asset_id
    AND asset.purpose = 'handwriting'
    AND asset.sensitivity = 'private'
    AND asset.scan_status = 'clean'
    AND asset.deleted_at IS NULL
    AND asset.mime_type = 'image/png'
    AND asset.byte_size BETWEEN 1 AND 4194304
    AND asset.checksum ~ '^[0-9a-f]{64}$'
WHERE job.status IN ('queued', 'retry')
  AND job.available_at <= CURRENT_TIMESTAMP
  AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= CURRENT_TIMESTAMP)
  AND job.attempt_count < job.max_attempts
  AND job.question_revision_id = item.question_revision_id
  AND job.question_part_id = result.question_part_id
  AND job.asset_checksum = asset.checksum
  AND result.answer_payload = '{"value":null}'::jsonb
  AND result.current_result = 'pending'
  AND result.grading_source = 'manual_review'
  AND part.answer_mode = 'text'
  AND session.check_mode IN ('instant', 'complete')`;

const CANDIDATE_COLUMNS = `
    job.id AS job_id,
    job.answer_part_result_id,
    job.asset_id,
    job.question_revision_id,
    job.question_part_id,
    job.asset_checksum,
    job.reference_sha256,
    job.attempt_count,
    job.max_attempts,
    result.answer_payload,
    result.current_result,
    result.grading_source,
    part.answer_mode,
    asset.storage_key,
    asset.purpose AS asset_purpose,
    asset.sensitivity AS asset_sensitivity,
    asset.scan_status AS asset_scan_status,
    asset.deleted_at AS asset_deleted_at`;

function mapCandidate(row, extra = {}) {
    return Object.freeze({
        jobId: row.job_id,
        answerPartResultId: row.answer_part_result_id,
        assetId: row.asset_id,
        questionRevisionId: row.question_revision_id,
        questionPartId: row.question_part_id,
        assetChecksum: row.asset_checksum,
        referenceSha256: row.reference_sha256,
        attemptNumber: Number(row.attempt_count),
        maxAttempts: Number(row.max_attempts),
        answerPayload: row.answer_payload,
        currentResult: row.current_result,
        gradingSource: row.grading_source,
        answerMode: row.answer_mode,
        storageKey: row.storage_key,
        assetPurpose: row.asset_purpose,
        assetSensitivity: row.asset_sensitivity,
        assetScanStatus: row.asset_scan_status,
        assetDeletedAt: row.asset_deleted_at,
        ...extra,
    });
}

export async function previewEligibleHandwritingJob(client) {
    const result = await client.query(`
        SELECT ${CANDIDATE_COLUMNS}
        ${ELIGIBLE_JOB_FROM}
        ORDER BY job.available_at, job.created_at, job.id
        LIMIT 1
    `);
    return result.rows[0] ? mapCandidate(result.rows[0]) : null;
}

async function inTransaction(client, operation) {
    await client.query("BEGIN");
    try {
        const value = await operation();
        await client.query("COMMIT");
        return value;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
}

export async function claimEligibleHandwritingJob(client, { workerId, runId, model }) {
    return inTransaction(client, async () => {
        await client.query(`
            UPDATE public.handwriting_analysis_runs AS run
            SET status = 'failed',
                error_code = 'LEASE_EXPIRED',
                finished_at = CURRENT_TIMESTAMP
            FROM public.handwriting_analysis_jobs AS job
            WHERE run.job_id = job.id
              AND run.status = 'running'
              AND job.status = 'running'
              AND job.lease_expires_at <= CURRENT_TIMESTAMP
        `);
        await client.query(`
            UPDATE public.handwriting_analysis_jobs
            SET status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'retry' END,
                available_at = CASE
                    WHEN attempt_count >= max_attempts THEN available_at
                    ELSE CURRENT_TIMESTAMP
                END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = 'LEASE_EXPIRED',
                finished_at = CASE WHEN attempt_count >= max_attempts THEN CURRENT_TIMESTAMP ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            WHERE status = 'running' AND lease_expires_at <= CURRENT_TIMESTAMP
        `);
        const selected = await client.query(`
            SELECT ${CANDIDATE_COLUMNS}
            ${ELIGIBLE_JOB_FROM}
            ORDER BY job.available_at, job.created_at, job.id
            FOR UPDATE OF job SKIP LOCKED
            LIMIT 1
        `);
        const row = selected.rows[0];
        if (!row) return null;
        const claimed = await client.query(`
            UPDATE public.handwriting_analysis_jobs
            SET status = 'running',
                lease_owner = $2,
                lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => $3),
                attempt_count = attempt_count + 1,
                last_error_code = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status IN ('queued', 'retry')
            RETURNING attempt_count
        `, [row.job_id, workerId, HANDWRITING_LEASE_SECONDS]);
        if (claimed.rowCount !== 1) fail("JOB_CLAIM_RACE", "手寫 job claim 發生競態。", { retryable: true });
        const attemptNumber = Number(claimed.rows[0].attempt_count);
        await client.query(`
            INSERT INTO public.handwriting_analysis_runs (
                id, job_id, attempt_number, status, engine, model_name, model_version, model_digest,
                prompt_version, schema_version, asset_checksum, reference_sha256,
                recognized_text, transcription_confidence, legibility, proposed_result,
                result_confidence, uncertainty_reasons, evidence, error_code, started_at, finished_at
            ) VALUES (
                $1, $2, $3, 'running', 'ollama', $4, $5, $6, $7, $8, $9, $10,
                NULL, NULL, NULL, NULL, NULL, '[]'::jsonb, '{}'::jsonb, NULL, CURRENT_TIMESTAMP, NULL
            )
        `, [
            runId, row.job_id, attemptNumber, HANDWRITING_MODEL_NAME, model.version,
            HANDWRITING_MODEL_DIGEST, HANDWRITING_PROMPT_VERSION, HANDWRITING_SCHEMA_VERSION,
            row.asset_checksum, row.reference_sha256,
        ]);
        return mapCandidate(row, { runId, attemptNumber });
    });
}

const STILL_ELIGIBLE = `
EXISTS (
    SELECT 1
    FROM public.answer_part_results AS result
    JOIN public.answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN public.practice_session_items AS item ON item.id = attempt.practice_session_item_id
    JOIN public.practice_sessions AS session ON session.id = item.practice_session_id
    JOIN public.question_parts AS part
      ON part.id = result.question_part_id AND part.question_revision_id = item.question_revision_id
    JOIN public.answer_part_assets AS answer_asset
      ON answer_asset.answer_part_result_id = result.id
      AND answer_asset.asset_id = job.asset_id
      AND answer_asset.asset_role = 'handwriting'
    JOIN public.assets AS asset ON asset.id = answer_asset.asset_id
    WHERE result.id = job.answer_part_result_id
      AND item.question_revision_id = job.question_revision_id
      AND result.question_part_id = job.question_part_id
      AND result.answer_payload = '{"value":null}'::jsonb
      AND result.current_result = 'pending'
      AND result.grading_source = 'manual_review'
      AND part.answer_mode = 'text'
      AND session.check_mode IN ('instant', 'complete')
      AND asset.purpose = 'handwriting'
      AND asset.sensitivity = 'private'
      AND asset.scan_status = 'clean'
      AND asset.deleted_at IS NULL
      AND asset.mime_type = 'image/png'
      AND asset.checksum = job.asset_checksum
)`;

export async function completeHandwritingJob(client, { workerId, candidate, transcription }) {
    return inTransaction(client, async () => {
        const eligible = await client.query(`
            SELECT job.id
            FROM public.handwriting_analysis_jobs AS job
            WHERE job.id = $1 AND job.status = 'running' AND job.lease_owner = $2
              AND job.lease_expires_at > CURRENT_TIMESTAMP
              AND ${STILL_ELIGIBLE}
            FOR UPDATE OF job
        `, [candidate.jobId, workerId]);
        if (eligible.rowCount !== 1) {
            await client.query(`
                UPDATE public.handwriting_analysis_runs
                SET status = 'failed', error_code = 'STALE_OR_EXPIRED_JOB', finished_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND job_id = $2 AND status = 'running'
            `, [candidate.runId, candidate.jobId]);
            await client.query(`
                UPDATE public.handwriting_analysis_jobs
                SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
                    last_error_code = 'STALE_OR_EXPIRED_JOB', finished_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND status = 'running' AND lease_owner = $2
            `, [candidate.jobId, workerId]);
            fail("STALE_OR_EXPIRED_JOB", "手寫作答、資產或 lease 已變更；拒絕保存辨識結果。 ");
        }
        const completedRun = await client.query(`
            UPDATE public.handwriting_analysis_runs
            SET status = 'completed', recognized_text = $3,
                transcription_confidence = $4, legibility = $5,
                proposed_result = $6, result_confidence = $7,
                uncertainty_reasons = $8::jsonb, evidence = $9::jsonb,
                error_code = NULL, finished_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND job_id = $2 AND status = 'running'
            RETURNING id
        `, [
            candidate.runId, candidate.jobId, transcription.transcription,
            transcription.transcriptionConfidence, transcription.legibility,
            "pending", 0,
            JSON.stringify(transcription.uncertaintyReasons),
            JSON.stringify({ analysis_kind: "handwriting_transcription_only" }),
        ]);
        if (completedRun.rowCount !== 1) fail("RUN_FINALIZE_FAILED", "手寫 analysis run 無法完成。 ");
        const completedJob = await client.query(`
            UPDATE public.handwriting_analysis_jobs
            SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
                last_error_code = NULL, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'running' AND lease_owner = $2
            RETURNING id
        `, [candidate.jobId, workerId]);
        if (completedJob.rowCount !== 1) fail("JOB_FINALIZE_FAILED", "手寫 job 無法完成。 ");
        return true;
    });
}

export function retryBackoffSeconds(attemptNumber) {
    if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) return 30;
    return Math.min(3_600, 30 * (2 ** Math.min(attemptNumber - 1, 7)));
}

export async function failHandwritingJob(client, { workerId, candidate, errorCode, retryable }) {
    const backoff = retryBackoffSeconds(candidate.attemptNumber);
    return inTransaction(client, async () => {
        await client.query(`
            UPDATE public.handwriting_analysis_runs
            SET status = 'failed', error_code = $3, finished_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND job_id = $2 AND status = 'running'
        `, [candidate.runId, candidate.jobId, errorCode]);
        const result = await client.query(`
            UPDATE public.handwriting_analysis_jobs
            SET status = CASE WHEN $4 AND attempt_count < max_attempts THEN 'retry' ELSE 'failed' END,
                available_at = CASE
                    WHEN $4 AND attempt_count < max_attempts
                    THEN CURRENT_TIMESTAMP + make_interval(secs => $5)
                    ELSE available_at
                END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = $3,
                finished_at = CASE WHEN $4 AND attempt_count < max_attempts THEN NULL ELSE CURRENT_TIMESTAMP END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'running' AND lease_owner = $2
            RETURNING status
        `, [candidate.jobId, workerId, errorCode, retryable, backoff]);
        return result.rows[0]?.status ?? "not_owned";
    });
}
