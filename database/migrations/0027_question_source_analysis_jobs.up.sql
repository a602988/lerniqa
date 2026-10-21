BEGIN;

CREATE TABLE question_source_analysis_jobs (
    id uuid PRIMARY KEY,
    import_batch_id uuid NOT NULL REFERENCES import_batches(id),
    analyze_questions boolean NOT NULL DEFAULT true,
    settings jsonb NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'queued',
    available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_expires_at timestamptz,
    lease_owner varchar(120),
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 2,
    last_error_code varchar(80),
    result_payload jsonb,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at timestamptz,
    CONSTRAINT question_source_analysis_jobs_status_check
        CHECK (status IN ('queued', 'retry', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT question_source_analysis_jobs_attempts_check
        CHECK (max_attempts BETWEEN 1 AND 5 AND attempt_count BETWEEN 0 AND max_attempts),
    CONSTRAINT question_source_analysis_jobs_settings_check
        CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT question_source_analysis_jobs_worker_check
        CHECK (lease_owner IS NULL OR btrim(lease_owner) <> ''),
    CONSTRAINT question_source_analysis_jobs_error_check
        CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,79}$'),
    CONSTRAINT question_source_analysis_jobs_state_check
        CHECK (
            (status = 'queued' AND attempt_count = 0 AND lease_owner IS NULL AND lease_expires_at IS NULL AND finished_at IS NULL AND last_error_code IS NULL AND result_payload IS NULL)
            OR (status = 'retry' AND attempt_count > 0 AND attempt_count < max_attempts AND lease_owner IS NULL AND lease_expires_at IS NULL AND finished_at IS NULL AND last_error_code IS NOT NULL AND result_payload IS NULL)
            OR (status = 'running' AND attempt_count > 0 AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND finished_at IS NULL AND last_error_code IS NULL AND result_payload IS NULL)
            OR (status = 'completed' AND attempt_count > 0 AND lease_owner IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL AND last_error_code IS NULL AND result_payload IS NOT NULL)
            OR (status = 'failed' AND attempt_count > 0 AND lease_owner IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL AND last_error_code IS NOT NULL AND result_payload IS NULL)
            OR (status = 'cancelled' AND lease_owner IS NULL AND lease_expires_at IS NULL AND finished_at IS NOT NULL AND result_payload IS NULL)
        )
);

CREATE UNIQUE INDEX question_source_analysis_jobs_active_batch_unique
    ON question_source_analysis_jobs(import_batch_id)
    WHERE status IN ('queued', 'retry', 'running');

CREATE INDEX question_source_analysis_jobs_claim_index
    ON question_source_analysis_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'retry', 'running');

CREATE TABLE question_source_analysis_runs (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES question_source_analysis_jobs(id),
    attempt_number integer NOT NULL,
    status varchar(20) NOT NULL,
    worker_id varchar(120) NOT NULL,
    processor_version varchar(80),
    error_code varchar(80),
    started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at timestamptz,
    CONSTRAINT question_source_analysis_runs_attempt_unique UNIQUE (job_id, attempt_number),
    CONSTRAINT question_source_analysis_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
    CONSTRAINT question_source_analysis_runs_attempt_check CHECK (attempt_number BETWEEN 1 AND 5),
    CONSTRAINT question_source_analysis_runs_worker_check CHECK (btrim(worker_id) <> ''),
    CONSTRAINT question_source_analysis_runs_error_check
        CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,79}$'),
    CONSTRAINT question_source_analysis_runs_state_check
        CHECK (
            (status = 'running' AND finished_at IS NULL AND error_code IS NULL)
            OR (status = 'completed' AND finished_at IS NOT NULL AND error_code IS NULL)
            OR (status = 'failed' AND finished_at IS NOT NULL AND error_code IS NOT NULL)
        )
);

INSERT INTO schema_migrations (version, name)
VALUES ('0027', 'question_source_analysis_jobs');

COMMIT;
