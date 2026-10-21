BEGIN;

DELETE FROM schema_migrations WHERE version = '0022';
DROP TABLE social_oauth_attempts;
DROP INDEX social_quick_registrations_subject_pending_idx;

ALTER TABLE social_quick_registrations
    DROP CONSTRAINT social_quick_registrations_provider_check,
    DROP COLUMN provider;

ALTER TABLE social_quick_registrations RENAME TO google_quick_registrations;

CREATE INDEX google_quick_registrations_subject_pending_idx
    ON google_quick_registrations(provider_subject, expires_at)
    WHERE consumed_at IS NULL;

COMMIT;
