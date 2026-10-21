\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.email_registration_onboarding') IS NOT NULL THEN
        RAISE EXCEPTION 'email_registration_onboarding 資料表仍存在';
    END IF;
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0024') THEN
        RAISE EXCEPTION '0024 migration 紀錄仍存在';
    END IF;
END;
$$;
