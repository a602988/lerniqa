\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.question_source_analysis_jobs') IS NOT NULL
        OR to_regclass('public.question_source_analysis_runs') IS NOT NULL THEN
        RAISE EXCEPTION 'question source analysis job tables still exist';
    END IF;
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0027') THEN
        RAISE EXCEPTION '0027 migration record still exists';
    END IF;
END;
$$;
