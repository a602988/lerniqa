BEGIN;

ALTER TABLE source_documents
    DROP CONSTRAINT source_documents_input_type_check,
    DROP CONSTRAINT source_documents_input_check,
    ADD CONSTRAINT source_documents_input_type_check
        CHECK (input_type IN ('image', 'pdf', 'document', 'text')),
    ADD CONSTRAINT source_documents_input_check
        CHECK (
            (input_type = 'text' AND pasted_text IS NOT NULL AND asset_id IS NULL)
            OR (
                input_type IN ('image', 'pdf', 'document')
                AND asset_id IS NOT NULL
                AND pasted_text IS NULL
            )
        );

INSERT INTO schema_migrations (version, name)
VALUES ('0006', 'source_documents_word');

COMMIT;
