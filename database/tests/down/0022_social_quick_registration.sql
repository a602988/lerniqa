\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.social_quick_registrations') IS NOT NULL
        OR to_regclass('public.social_oauth_attempts') IS NOT NULL THEN
        RAISE EXCEPTION '0022 社群快速註冊資料表未移除';
    END IF;

    IF to_regclass('public.google_quick_registrations') IS NULL THEN
        RAISE EXCEPTION '0021 Google 快速註冊資料表未還原';
    END IF;
END;
$$;
