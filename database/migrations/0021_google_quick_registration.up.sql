BEGIN;

CREATE TABLE google_quick_registrations (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    provider_subject varchar(255) NOT NULL,
    email_normalized varchar(320) NOT NULL,
    display_name varchar(80) NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT google_quick_registrations_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT google_quick_registrations_consumed_check
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX google_quick_registrations_subject_pending_idx
    ON google_quick_registrations(provider_subject, expires_at)
    WHERE consumed_at IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('0021', 'google_quick_registration');

COMMIT;
