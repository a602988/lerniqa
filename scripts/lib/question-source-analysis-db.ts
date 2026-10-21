import { randomUUID } from "node:crypto";
import type { Client, QueryResultRow } from "pg";

export const QUESTION_SOURCE_LEASE_SECONDS = 1_200;

export interface QuestionSourceCandidate {
    analyze: boolean;
    batchId: string;
    jobId: string;
    ownerUserId: string;
    runId: string;
    settings: {
        corners: Record<string, Array<{ x: number; y: number }>>;
        dewarp: boolean;
    };
}

interface CandidateRow extends QueryResultRow {
    analyze_questions: boolean;
    attempt_count: number;
    batch_id: string;
    job_id: string;
    owner_user_id: string;
    settings: QuestionSourceCandidate["settings"];
}

async function transaction<T>(client: Client, operation: () => Promise<T>): Promise<T> {
    await client.query("BEGIN");
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

export async function claimQuestionSourceAnalysis(client: Client, workerId: string): Promise<QuestionSourceCandidate | null> {
    return transaction(client, async () => {
        const expired = await client.query<{ batch_id: string; job_id: string; status: "failed" | "retry" } & QueryResultRow>(`
            UPDATE question_source_analysis_jobs
            SET status = CASE WHEN attempt_count < max_attempts THEN 'retry' ELSE 'failed' END,
                available_at = CASE WHEN attempt_count < max_attempts THEN CURRENT_TIMESTAMP ELSE available_at END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = 'WORKER_LEASE_EXPIRED',
                finished_at = CASE WHEN attempt_count < max_attempts THEN NULL ELSE CURRENT_TIMESTAMP END,
                updated_at = CURRENT_TIMESTAMP
            WHERE status = 'running' AND lease_expires_at <= CURRENT_TIMESTAMP
            RETURNING id AS job_id, import_batch_id AS batch_id, status
        `);
        if (expired.rowCount) {
            const expiredJobIds = expired.rows.map((row) => row.job_id);
            await client.query(`
                UPDATE question_source_analysis_runs
                SET status = 'failed', error_code = 'WORKER_LEASE_EXPIRED', finished_at = CURRENT_TIMESTAMP
                WHERE job_id = ANY($1::uuid[]) AND status = 'running'
            `, [expiredJobIds]);
            const retryBatchIds = expired.rows.filter((row) => row.status === "retry").map((row) => row.batch_id);
            if (retryBatchIds.length) {
                await client.query(`
                    UPDATE import_batches SET status = 'draft' WHERE id = ANY($1::uuid[]) AND status = 'recognizing'
                `, [retryBatchIds]);
                await client.query(`
                    UPDATE source_documents AS document
                    SET status = 'uploaded'
                    FROM import_batch_documents AS link
                    WHERE link.import_batch_id = ANY($1::uuid[])
                      AND link.source_document_id = document.id
                `, [retryBatchIds]);
            }
            const failedBatchIds = expired.rows.filter((row) => row.status === "failed").map((row) => row.batch_id);
            if (failedBatchIds.length) {
                await client.query(`
                    UPDATE source_documents AS document
                    SET status = 'failed'
                    FROM import_batch_documents AS link
                    WHERE link.import_batch_id = ANY($1::uuid[])
                      AND link.source_document_id = document.id
                `, [failedBatchIds]);
            }
        }
        await client.query(`
            UPDATE import_batches AS batch
            SET status = 'failed'
            FROM question_source_analysis_jobs AS job
            WHERE job.import_batch_id = batch.id
              AND job.status = 'failed'
              AND job.last_error_code = 'WORKER_LEASE_EXPIRED'
              AND batch.status = 'recognizing'
        `);
        const selected = await client.query<CandidateRow>(`
            SELECT job.id AS job_id,
                   job.import_batch_id AS batch_id,
                   job.analyze_questions,
                   job.settings,
                   job.attempt_count,
                   batch.created_by_user_id AS owner_user_id
            FROM question_source_analysis_jobs AS job
            JOIN import_batches AS batch ON batch.id = job.import_batch_id
            WHERE job.status IN ('queued', 'retry')
              AND job.available_at <= CURRENT_TIMESTAMP
              AND job.attempt_count < job.max_attempts
              AND batch.status IN ('draft', 'failed')
            ORDER BY job.available_at, job.created_at, job.id
            FOR UPDATE OF job SKIP LOCKED
            LIMIT 1
        `);
        const row = selected.rows[0];
        if (!row) return null;
        const runId = randomUUID();
        const attemptNumber = row.attempt_count + 1;
        await client.query(`
            UPDATE question_source_analysis_jobs
            SET status = 'running', attempt_count = $2, lease_owner = $3,
                lease_expires_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
                last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status IN ('queued', 'retry')
        `, [row.job_id, attemptNumber, workerId, QUESTION_SOURCE_LEASE_SECONDS]);
        await client.query(`
            INSERT INTO question_source_analysis_runs(
                id, job_id, attempt_number, status, worker_id
            ) VALUES($1,$2,$3,'running',$4)
        `, [runId, row.job_id, attemptNumber, workerId]);
        return {
            analyze: row.analyze_questions,
            batchId: row.batch_id,
            jobId: row.job_id,
            ownerUserId: row.owner_user_id,
            runId,
            settings: row.settings,
        };
    });
}

export async function previewQuestionSourceAnalysis(client: Client): Promise<boolean> {
    const result = await client.query(`
        SELECT 1
        FROM question_source_analysis_jobs AS job
        JOIN import_batches AS batch ON batch.id = job.import_batch_id
        WHERE job.status IN ('queued', 'retry')
          AND job.available_at <= CURRENT_TIMESTAMP
          AND job.attempt_count < job.max_attempts
          AND batch.status IN ('draft', 'failed')
        LIMIT 1
    `);
    return result.rowCount === 1;
}

export async function renewQuestionSourceAnalysisLease(
    client: Client,
    candidate: QuestionSourceCandidate,
    workerId: string,
): Promise<boolean> {
    const result = await client.query(`
        UPDATE question_source_analysis_jobs
        SET lease_expires_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'running' AND lease_owner = $2
    `, [candidate.jobId, workerId, QUESTION_SOURCE_LEASE_SECONDS]);
    return result.rowCount === 1;
}

export async function assertQuestionSourceAnalysisSchema(client: Client): Promise<void> {
    const result = await client.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('question_source_analysis_jobs', 'question_source_analysis_runs')
    `);
    const available = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const required = [
        "question_source_analysis_jobs.id",
        "question_source_analysis_jobs.import_batch_id",
        "question_source_analysis_jobs.status",
        "question_source_analysis_jobs.lease_owner",
        "question_source_analysis_jobs.lease_expires_at",
        "question_source_analysis_jobs.result_payload",
        "question_source_analysis_runs.id",
        "question_source_analysis_runs.job_id",
        "question_source_analysis_runs.status",
    ];
    const missing = required.filter((column) => !available.has(column));
    if (missing.length) throw new Error(`QUESTION_SOURCE_SCHEMA_INCOMPATIBLE:${missing.join(",")}`);
}

export async function reconcileQuestionSourceAnalysisQueue(client: Client): Promise<number> {
    return transaction(client, async () => {
        const batches = await client.query<{ batch_id: string } & QueryResultRow>(`
            SELECT batch.id AS batch_id
            FROM import_batches AS batch
            JOIN import_batch_documents AS link
              ON link.import_batch_id = batch.id
             AND link.position = 0
            JOIN source_documents AS document ON document.id = link.source_document_id
            WHERE batch.status = 'draft'
              AND document.status = 'uploaded'
              AND document.input_type IN ('image', 'pdf')
              AND NOT EXISTS (
                  SELECT 1 FROM question_source_analysis_jobs AS job
                  WHERE job.import_batch_id = batch.id
              )
            ORDER BY batch.created_at, batch.id
            FOR UPDATE OF batch SKIP LOCKED
        `);
        for (const row of batches.rows) {
            await client.query(`
                INSERT INTO question_source_analysis_jobs(
                    id, import_batch_id, analyze_questions, settings, status
                ) VALUES($1,$2,true,$3::jsonb,'queued')
                ON CONFLICT DO NOTHING
            `, [randomUUID(), row.batch_id, JSON.stringify({ dewarp: true, corners: {} })]);
        }
        return batches.rowCount ?? 0;
    });
}

export async function completeQuestionSourceAnalysis(
    client: Client,
    candidate: QuestionSourceCandidate,
    processorVersion: string,
    result: unknown,
    workerId: string,
): Promise<void> {
    const completed = await client.query(`
        UPDATE question_source_analysis_jobs
        SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
            result_payload = $3::jsonb, finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'running' AND lease_owner = $2
    `, [candidate.jobId, workerId, JSON.stringify(result)]);
    if (completed.rowCount !== 1) throw new Error("QUESTION_SOURCE_JOB_LEASE_LOST");
    await client.query(`
        UPDATE question_source_analysis_runs
        SET status = 'completed', processor_version = $2, finished_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND job_id = $3 AND status = 'running'
    `, [candidate.runId, processorVersion, candidate.jobId]);
}

export async function failQuestionSourceAnalysis(
    client: Client,
    candidate: QuestionSourceCandidate,
    errorCode: string,
    retryable: boolean,
    workerId: string,
): Promise<void> {
    await transaction(client, async () => {
        const result = await client.query<{ attempt_count: number; max_attempts: number } & QueryResultRow>(`
            SELECT attempt_count, max_attempts
            FROM question_source_analysis_jobs
            WHERE id = $1 AND status = 'running' AND lease_owner = $2
            FOR UPDATE
        `, [candidate.jobId, workerId]);
        const row = result.rows[0];
        if (!row) return;
        const retries = retryable && row.attempt_count < row.max_attempts;
        await client.query(`
            UPDATE question_source_analysis_jobs
            SET status = $3::varchar,
                available_at = CASE WHEN $3::varchar = 'retry' THEN CURRENT_TIMESTAMP + INTERVAL '15 seconds' ELSE available_at END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                last_error_code = $4,
                finished_at = CASE WHEN $3::varchar = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND lease_owner = $2
        `, [candidate.jobId, workerId, retries ? "retry" : "failed", errorCode]);
        await client.query(`
            UPDATE question_source_analysis_runs
            SET status = 'failed', error_code = $2, finished_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND job_id = $3 AND status = 'running'
        `, [candidate.runId, errorCode, candidate.jobId]);
        await client.query(`
            UPDATE import_batches
            SET status = $2::varchar
            WHERE id = $1 AND status IN ('recognizing', 'failed')
        `, [candidate.batchId, retries ? "draft" : "failed"]);
        await client.query(`
            UPDATE source_documents AS document
            SET status = $2::varchar
            FROM import_batch_documents AS link
            WHERE link.import_batch_id = $1 AND link.source_document_id = document.id
        `, [candidate.batchId, retries ? "uploaded" : "failed"]);
    });
}
