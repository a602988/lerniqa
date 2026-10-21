BEGIN;

DROP TABLE question_source_analysis_runs;
DROP TABLE question_source_analysis_jobs;

DELETE FROM schema_migrations WHERE version = '0027';

COMMIT;
