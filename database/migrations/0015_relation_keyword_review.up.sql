BEGIN;

ALTER TABLE relation_keywords
    ADD COLUMN created_source varchar(20) NOT NULL DEFAULT 'manual',
    ADD COLUMN method_version varchar(80),
    ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN reviewed_by_user_id uuid REFERENCES users(id),
    ADD COLUMN reviewed_at timestamptz,
    DROP CONSTRAINT relation_keywords_status_check,
    ADD CONSTRAINT relation_keywords_status_check
        CHECK (status IN ('pending', 'active', 'inactive')),
    ADD CONSTRAINT relation_keywords_source_check
        CHECK (created_source IN ('manual', 'rule', 'ai')),
    ADD CONSTRAINT relation_keywords_method_check
        CHECK (
            (created_source = 'manual' AND method_version IS NULL)
            OR (
                created_source IN ('rule', 'ai')
                AND method_version IS NOT NULL
                AND btrim(method_version) <> ''
            )
        ),
    ADD CONSTRAINT relation_keywords_evidence_check
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND pg_column_size(evidence) <= 32768
        ),
    ADD CONSTRAINT relation_keywords_review_check
        CHECK (
            (
                status = 'pending'
                AND created_source IN ('rule', 'ai')
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status IN ('active', 'inactive')
                AND created_source IN ('rule', 'ai')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
            OR created_source = 'manual'
        ),
    ADD CONSTRAINT relation_keywords_review_time_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at);

INSERT INTO schema_migrations (version, name)
VALUES ('0015', 'relation_keyword_review');

COMMIT;
