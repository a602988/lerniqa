\set ON_ERROR_STOP on

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0021'
    ) THEN
        RAISE EXCEPTION '0021 down 沒有移除 migration 紀錄';
    END IF;

    IF to_regclass('public.google_quick_registrations') IS NOT NULL THEN
        RAISE EXCEPTION '0021 down 留下 google_quick_registrations 資料表';
    END IF;
END;
$$;
