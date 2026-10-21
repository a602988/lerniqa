\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0022' AND name = 'social_quick_registration'
    ) THEN
        RAISE EXCEPTION '0022 migration 紀錄不存在';
    END IF;

    IF to_regclass('public.social_quick_registrations') IS NULL
        OR to_regclass('public.social_oauth_attempts') IS NULL THEN
        RAISE EXCEPTION '社群快速註冊資料表不存在';
    END IF;

    IF to_regclass('public.google_quick_registrations') IS NOT NULL THEN
        RAISE EXCEPTION 'Google 專用短效註冊資料表仍存在';
    END IF;
END;
$$;

INSERT INTO social_quick_registrations (
    id, token_hash, provider, provider_subject,
    email_normalized, display_name, expires_at
)
VALUES
    ('22000000-0000-4000-8000-000000000001', '0022-line-token', 'line', 'line-subject', 'line@example.test', 'LINE 測試帳號', CURRENT_TIMESTAMP + interval '10 minutes'),
    ('22000000-0000-4000-8000-000000000002', '0022-facebook-token', 'facebook', 'facebook-subject', 'facebook@example.test', 'Facebook 測試帳號', CURRENT_TIMESTAMP + interval '10 minutes');

INSERT INTO social_oauth_attempts (
    id, provider, token_hash, state_hash, nonce_hash, expires_at
)
VALUES
    ('22000000-0000-4000-8000-000000000003', 'line', '0022-line-attempt', '0022-line-state', '0022-line-nonce', CURRENT_TIMESTAMP + interval '10 minutes'),
    ('22000000-0000-4000-8000-000000000004', 'facebook', '0022-facebook-attempt', '0022-facebook-state', NULL, CURRENT_TIMESTAMP + interval '10 minutes');
