\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.question_source_analysis_jobs') IS NULL
        OR to_regclass('public.question_source_analysis_runs') IS NULL THEN
        RAISE EXCEPTION 'question source analysis job tables are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0027' AND name = 'question_source_analysis_jobs'
    ) THEN
        RAISE EXCEPTION '0027 migration record is missing';
    END IF;
END;
$$;

INSERT INTO question_source_analysis_jobs(
    id, import_batch_id, analyze_questions, settings, status
)
VALUES (
    '27000000-0000-4000-8000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    true,
    '{"dewarp":true,"corners":{}}'::jsonb,
    'queued'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO question_source_analysis_jobs(
            id, import_batch_id, analyze_questions, settings, status
        )
        VALUES (
            '27000000-0000-4000-8000-000000000002',
            'a4000000-0000-0000-0000-000000000001',
            true,
            '{}'::jsonb,
            'queued'
        );
        RAISE EXCEPTION 'multiple active jobs for one batch were accepted';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        UPDATE question_source_analysis_jobs
        SET status = 'completed', finished_at = CURRENT_TIMESTAMP
        WHERE id = '27000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'completed job without attempt and result was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

UPDATE question_source_analysis_jobs
SET status = 'running',
    attempt_count = 1,
    lease_owner = 'migration-test-worker',
    lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
WHERE id = '27000000-0000-4000-8000-000000000001';

INSERT INTO question_source_analysis_runs(
    id, job_id, attempt_number, status, worker_id
)
VALUES (
    '27000000-0000-4000-8000-000000000010',
    '27000000-0000-4000-8000-000000000001',
    1,
    'running',
    'migration-test-worker'
);

UPDATE question_source_analysis_runs
SET status = 'completed', processor_version = 'migration-test/v1', finished_at = CURRENT_TIMESTAMP
WHERE id = '27000000-0000-4000-8000-000000000010';

UPDATE question_source_analysis_jobs
SET status = 'completed',
    lease_owner = NULL,
    lease_expires_at = NULL,
    result_payload = '{"pages":[]}'::jsonb,
    finished_at = CURRENT_TIMESTAMP
WHERE id = '27000000-0000-4000-8000-000000000001';
