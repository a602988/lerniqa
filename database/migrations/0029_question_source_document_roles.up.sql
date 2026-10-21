BEGIN;

ALTER TABLE import_batch_documents
    ADD COLUMN document_role varchar(20) NOT NULL DEFAULT 'auto',
    ADD COLUMN role_source varchar(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN role_confidence numeric(5,4),
    ADD COLUMN role_reason varchar(500),
    ADD CONSTRAINT import_batch_documents_role_check
        CHECK (document_role IN ('auto', 'question', 'answer', 'explanation', 'supplement')),
    ADD CONSTRAINT import_batch_documents_role_source_check
        CHECK (role_source IN ('pending', 'ai', 'user')),
    ADD CONSTRAINT import_batch_documents_role_confidence_check
        CHECK (role_confidence IS NULL OR (role_confidence >= 0 AND role_confidence <= 1)),
    ADD CONSTRAINT import_batch_documents_role_state_check
        CHECK (
            (role_source = 'pending' AND document_role = 'auto' AND role_confidence IS NULL AND role_reason IS NULL)
            OR (role_source = 'ai' AND document_role <> 'auto' AND role_confidence IS NOT NULL AND btrim(role_reason) <> '')
            OR (role_source = 'user' AND document_role <> 'auto' AND role_confidence IS NULL AND role_reason IS NULL)
        );

INSERT INTO schema_migrations (version, name)
VALUES ('0029', 'question_source_document_roles');

COMMIT;
