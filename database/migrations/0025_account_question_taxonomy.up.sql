BEGIN;

ALTER TABLE filter_fields
    DROP CONSTRAINT filter_fields_key_key,
    ADD COLUMN origin varchar(20) NOT NULL DEFAULT 'system',
    ADD COLUMN owner_user_id uuid REFERENCES users(id),
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE filter_fields
    ALTER COLUMN origin DROP DEFAULT,
    ADD CONSTRAINT filter_fields_origin_check CHECK (origin IN ('system', 'account')),
    ADD CONSTRAINT filter_fields_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        );

CREATE UNIQUE INDEX filter_fields_system_key_unique
    ON filter_fields(key)
    WHERE origin = 'system';

CREATE UNIQUE INDEX filter_fields_account_key_unique
    ON filter_fields(owner_user_id, key)
    WHERE origin = 'account';

CREATE INDEX filter_fields_owner_status_index
    ON filter_fields(owner_user_id, status, sort_order)
    WHERE origin = 'account';

INSERT INTO schema_migrations (version, name)
VALUES ('0025', 'account_question_taxonomy');

COMMIT;
