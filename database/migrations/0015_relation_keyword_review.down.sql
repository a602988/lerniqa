BEGIN;

UPDATE relation_keywords
SET status = 'inactive'
WHERE status = 'pending';

ALTER TABLE relation_keywords
    DROP CONSTRAINT relation_keywords_review_time_check,
    DROP CONSTRAINT relation_keywords_review_check,
    DROP CONSTRAINT relation_keywords_evidence_check,
    DROP CONSTRAINT relation_keywords_method_check,
    DROP CONSTRAINT relation_keywords_source_check,
    DROP CONSTRAINT relation_keywords_status_check,
    DROP COLUMN reviewed_at,
    DROP COLUMN reviewed_by_user_id,
    DROP COLUMN evidence,
    DROP COLUMN method_version,
    DROP COLUMN created_source,
    ADD CONSTRAINT relation_keywords_status_check
        CHECK (status IN ('active', 'inactive'));

DELETE FROM schema_migrations WHERE version = '0015';

COMMIT;
