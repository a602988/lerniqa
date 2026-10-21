\set ON_ERROR_STOP on

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'filter_fields' AND column_name IN ('origin', 'owner_user_id', 'created_at')
    ) THEN
        RAISE EXCEPTION 'filter_fields 帳號分類欄位仍存在';
    END IF;
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0025') THEN
        RAISE EXCEPTION '0025 migration 紀錄仍存在';
    END IF;
END;
$$;
