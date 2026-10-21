BEGIN;

ALTER TABLE google_quick_registrations RENAME TO social_quick_registrations;

ALTER TABLE social_quick_registrations
    ADD COLUMN provider varchar(30) NOT NULL DEFAULT 'google';

ALTER TABLE social_quick_registrations
    ALTER COLUMN provider DROP DEFAULT,
    ADD CONSTRAINT social_quick_registrations_provider_check
        CHECK (provider IN ('google', 'line', 'facebook'));

DROP INDEX google_quick_registrations_subject_pending_idx;

CREATE INDEX social_quick_registrations_subject_pending_idx
    ON social_quick_registrations(provider, provider_subject, expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE social_oauth_attempts (
    id uuid PRIMARY KEY,
    provider varchar(30) NOT NULL,
    token_hash text NOT NULL UNIQUE,
    state_hash text NOT NULL UNIQUE,
    nonce_hash text,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT social_oauth_attempts_provider_check CHECK (provider IN ('line', 'facebook')),
    CONSTRAINT social_oauth_attempts_nonce_check CHECK (
        (provider = 'line' AND nonce_hash IS NOT NULL)
        OR (provider = 'facebook' AND nonce_hash IS NULL)
    ),
    CONSTRAINT social_oauth_attempts_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT social_oauth_attempts_consumed_check
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX social_oauth_attempts_pending_idx
    ON social_oauth_attempts(provider, expires_at)
    WHERE consumed_at IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('0022', 'social_quick_registration');

COMMIT;
