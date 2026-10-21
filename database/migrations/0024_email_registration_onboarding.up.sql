BEGIN;

CREATE TABLE email_registration_onboarding (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    email_normalized varchar(320) NOT NULL,
    password_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_registration_onboarding_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT email_registration_onboarding_consumed_check
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX email_registration_onboarding_pending_email_idx
    ON email_registration_onboarding(email_normalized)
    WHERE consumed_at IS NULL;

INSERT INTO schema_migrations (version, name)
VALUES ('0024', 'email_registration_onboarding');

COMMIT;
