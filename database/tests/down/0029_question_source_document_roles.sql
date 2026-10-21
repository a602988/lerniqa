\set ON_ERROR_STOP on

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'import_batch_documents'
          AND column_name IN ('document_role', 'role_source', 'role_confidence', 'role_reason')
    ) THEN
        RAISE EXCEPTION 'question source role columns still exist';
    END IF;
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0029') THEN
        RAISE EXCEPTION '0029 migration record still exists';
    END IF;
END;
$$;
