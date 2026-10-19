\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0021'
            AND name = 'google_quick_registration'
    ) THEN
        RAISE EXCEPTION '0021 migration 紀錄不存在';
    END IF;

    IF to_regclass('public.google_quick_registrations') IS NULL THEN
        RAISE EXCEPTION 'google_quick_registrations 資料表不存在';
    END IF;
END;
$$;

INSERT INTO google_quick_registrations (
    id,
    token_hash,
    provider_subject,
    email_normalized,
    display_name,
    expires_at
)
VALUES (
    '21000000-0000-4000-8000-000000000001',
    '0021-test-token-hash',
    'google-subject-0021',
    'google-quick-registration@example.test',
    'Google 測試帳號',
    CURRENT_TIMESTAMP + interval '10 minutes'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM google_quick_registrations
        WHERE provider_subject = 'google-subject-0021'
            AND consumed_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP
    ) THEN
        RAISE EXCEPTION 'Google 快速註冊狀態無法保存';
    END IF;
END;
$$;
