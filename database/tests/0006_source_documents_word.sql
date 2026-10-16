\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0006'
            AND name = 'source_documents_word'
    ) THEN
        RAISE EXCEPTION '缺少 0006 migration 紀錄';
    END IF;
END;
$$;

INSERT INTO assets (
    id,
    storage_key,
    mime_type,
    byte_size,
    checksum,
    purpose,
    sensitivity,
    scan_status
)
VALUES (
    '06000000-0000-0000-0000-000000000001',
    'tests/0006-source-document.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    128,
    '0006-source-document-checksum',
    'source_document',
    'private',
    'clean'
);

INSERT INTO source_documents (
    id,
    asset_id,
    input_type,
    original_file_name,
    document_title
)
VALUES (
    '06000000-0000-0000-0000-000000000002',
    '06000000-0000-0000-0000-000000000001',
    'document',
    '合成教材.docx',
    '0006 Word 來源文件'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO source_documents (
            id,
            input_type,
            original_file_name
        )
        VALUES (
            '06000000-0000-0000-0000-000000000003',
            'document',
            '缺少檔案.docx'
        );
        RAISE EXCEPTION 'document 來源可缺少 asset_id';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO source_documents (
            id,
            asset_id,
            input_type,
            pasted_text
        )
        VALUES (
            '06000000-0000-0000-0000-000000000004',
            '06000000-0000-0000-0000-000000000001',
            'document',
            '不可同時寫入的貼上文字'
        );
        RAISE EXCEPTION 'document 來源可同時保留 pasted_text';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO source_documents (
            id,
            asset_id,
            input_type
        )
        VALUES (
            '06000000-0000-0000-0000-000000000005',
            '06000000-0000-0000-0000-000000000001',
            'word'
        );
        RAISE EXCEPTION '未定義的 word input_type 可寫入';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

ROLLBACK;
