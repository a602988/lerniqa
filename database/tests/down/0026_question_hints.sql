\set ON_ERROR_STOP on

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'question_content_blocks'
            AND column_name = 'hint_index'
    ) THEN
        RAISE EXCEPTION 'question_content_blocks.hint_index still exists';
    END IF;
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0026') THEN
        RAISE EXCEPTION '0026 migration record still exists';
    END IF;
END;
$$;
