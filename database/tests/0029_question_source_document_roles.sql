\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0029' AND name = 'question_source_document_roles'
    ) THEN
        RAISE EXCEPTION '0029 migration record is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'import_batch_documents'
          AND column_name = 'document_role'
    ) THEN
        RAISE EXCEPTION 'document role columns are missing';
    END IF;
END;
$$;

UPDATE import_batch_documents
SET document_role = 'answer',
    role_source = 'ai',
    role_confidence = 0.875,
    role_reason = '頁面主要內容為答案表'
WHERE import_batch_id = 'a4000000-0000-0000-0000-000000000001';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM import_batch_documents
        WHERE import_batch_id = 'a4000000-0000-0000-0000-000000000001'
          AND document_role = 'answer'
          AND role_source = 'ai'
          AND role_confidence = 0.875
    ) THEN
        RAISE EXCEPTION 'AI source role was not saved';
    END IF;

    BEGIN
        UPDATE import_batch_documents
        SET document_role = 'auto',
            role_source = 'user',
            role_confidence = NULL,
            role_reason = NULL
        WHERE import_batch_id = 'a4000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'invalid user source role was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE import_batch_documents
        SET document_role = 'question',
            role_source = 'ai',
            role_confidence = NULL,
            role_reason = NULL
        WHERE import_batch_id = 'a4000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'AI source role without evidence was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;
