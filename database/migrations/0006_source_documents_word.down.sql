BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM source_documents
        WHERE input_type = 'document'
    ) THEN
        RAISE EXCEPTION '0006 contains document source rows; migrate or remove them before rollback'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

DELETE FROM schema_migrations WHERE version = '0006';

ALTER TABLE source_documents
    DROP CONSTRAINT source_documents_input_type_check,
    DROP CONSTRAINT source_documents_input_check,
    ADD CONSTRAINT source_documents_input_type_check
        CHECK (input_type IN ('image', 'pdf', 'text')),
    ADD CONSTRAINT source_documents_input_check
        CHECK (
            (input_type = 'text' AND pasted_text IS NOT NULL AND asset_id IS NULL)
            OR (input_type IN ('image', 'pdf') AND asset_id IS NOT NULL AND pasted_text IS NULL)
        );

COMMIT;
