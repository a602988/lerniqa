BEGIN;

ALTER TABLE import_batch_documents
    DROP CONSTRAINT import_batch_documents_role_state_check,
    DROP CONSTRAINT import_batch_documents_role_confidence_check,
    DROP CONSTRAINT import_batch_documents_role_source_check,
    DROP CONSTRAINT import_batch_documents_role_check,
    DROP COLUMN role_reason,
    DROP COLUMN role_confidence,
    DROP COLUMN role_source,
    DROP COLUMN document_role;

DELETE FROM schema_migrations WHERE version = '0029';

COMMIT;
