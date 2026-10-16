BEGIN;

DELETE FROM schema_migrations WHERE version = '0003';

DROP TABLE question_collection_items;
DROP TABLE question_collections;
DELETE FROM question_identifiers WHERE identifier_type = 'source_document_question';
DROP INDEX question_identifiers_source_document_unique;
ALTER TABLE question_identifiers
    DROP CONSTRAINT question_identifiers_type_check,
    DROP CONSTRAINT question_identifiers_scope_check,
    DROP COLUMN source_document_id,
    ADD CONSTRAINT question_identifiers_type_check
        CHECK (identifier_type IN ('legacy', 'publisher_question')),
    ADD CONSTRAINT question_identifiers_scope_check
        CHECK (
            (identifier_type = 'legacy' AND publisher_id IS NULL AND book_version_id IS NULL)
            OR (identifier_type = 'publisher_question' AND publisher_id IS NOT NULL)
        );
DROP TABLE question_revision_sources;
DROP FUNCTION lerniqa_validate_revision_source_crop();
DROP TABLE import_items;
DROP TABLE import_batch_documents;
DROP TABLE import_batches;
DROP TABLE source_document_classification_candidates;
DROP TABLE source_documents;
DROP FUNCTION lerniqa_validate_source_document_asset();

COMMIT;
