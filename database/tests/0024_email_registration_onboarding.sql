\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0024' AND name = 'email_registration_onboarding'
    ) THEN
        RAISE EXCEPTION '0024 migration 紀錄不存在';
    END IF;
END;
$$;

INSERT INTO email_registration_onboarding (
    id, token_hash, email_normalized, password_hash, expires_at
)
VALUES (
    '24000000-0000-4000-8000-000000000001',
    '0024-test-token-hash',
    'onboarding@example.test',
    'one-way-password-hash',
    CURRENT_TIMESTAMP + interval '10 minutes'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM email_registration_onboarding
        WHERE email_normalized = 'onboarding@example.test'
            AND consumed_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP
    ) THEN
        RAISE EXCEPTION '電子郵件註冊引導狀態無法保存';
    END IF;
END;
$$;
