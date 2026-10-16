\set ON_ERROR_STOP on

DO $$
DECLARE
    expected_tables text[] := ARRAY[
        'import_batch_documents',
        'import_batches',
        'import_items',
        'question_collection_items',
        'question_collections',
        'question_revision_sources',
        'source_document_classification_candidates',
        'source_documents'
    ];
    missing_tables text[];
BEGIN
    SELECT array_agg(expected_table ORDER BY expected_table)
    INTO missing_tables
    FROM unnest(expected_tables) AS expected_table
    WHERE to_regclass('public.' || expected_table) IS NULL;

    IF missing_tables IS NOT NULL THEN
        RAISE EXCEPTION '缺少資料表：%', missing_tables;
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
    scan_status
)
VALUES
    (
        'a0000000-0000-0000-0000-000000000001',
        'tests/source.pdf',
        'application/pdf',
        1024,
        'source-checksum',
        'source_document',
        'clean'
    ),
    (
        'a0000000-0000-0000-0000-000000000002',
        'tests/question.png',
        'image/png',
        512,
        'question-checksum',
        'question_content',
        'clean'
    ),
    (
        'a0000000-0000-0000-0000-000000000003',
        'tests/crop.png',
        'image/png',
        256,
        'crop-checksum',
        'page_crop',
        'clean'
    );

INSERT INTO source_documents (
    id,
    owner_user_id,
    asset_id,
    input_type,
    original_file_name
)
VALUES (
    'a1000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'pdf',
    '測試考卷.pdf'
);

INSERT INTO source_documents (
    id,
    owner_user_id,
    input_type,
    pasted_text
)
VALUES (
    'a1000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'text',
    '第二份來源文字'
);

INSERT INTO source_document_classification_candidates (
    id,
    source_document_id,
    dimension,
    raw_value,
    subject_id,
    parser_version,
    confidence,
    review_status,
    reviewed_by_user_id,
    reviewed_at
)
VALUES (
    'a2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'subject',
    '數學',
    '50000000-0000-0000-0000-000000000001',
    'test-parser-1',
    0.95,
    'approved',
    '00000000-0000-0000-0000-000000000001',
    CURRENT_TIMESTAMP
);

INSERT INTO question_banks (
    id,
    name,
    origin,
    owner_user_id,
    created_role,
    is_default
)
VALUES (
    'a3000000-0000-0000-0000-000000000001',
    '測試匯入題庫',
    'account',
    '00000000-0000-0000-0000-000000000001',
    'tutor',
    true
);

INSERT INTO import_batches (
    id,
    question_bank_id,
    learner_id,
    created_by_user_id,
    status,
    idempotency_key
)
VALUES (
    'a4000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'review',
    'test-import-1'
);

INSERT INTO import_batch_documents (
    import_batch_id,
    source_document_id,
    position
)
VALUES (
    'a4000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    0
);

INSERT INTO import_items (
    id,
    import_batch_id,
    source_document_id,
    source_page,
    source_question_number,
    source_order,
    draft_payload,
    recognition_confidence,
    review_status,
    question_id,
    question_revision_id,
    reviewed_by_user_id,
    reviewed_at
)
VALUES (
    'a5000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    1,
    '1',
    0,
    '{"prompt":"1 + 1 = ?"}'::jsonb,
    0.99,
    'approved',
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    CURRENT_TIMESTAMP
);

INSERT INTO question_revision_sources (
    id,
    question_revision_id,
    source_document_id,
    import_item_id,
    source_page,
    source_question_number,
    crop_asset_id
)
VALUES (
    'a6000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'a5000000-0000-0000-0000-000000000001',
    1,
    '1',
    'a0000000-0000-0000-0000-000000000003'
);

INSERT INTO question_identifiers (
    id,
    question_id,
    identifier_type,
    source_document_id,
    value,
    normalized_value
)
VALUES (
    'a7000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    'source_document_question',
    'a1000000-0000-0000-0000-000000000001',
    '1',
    '1'
);

INSERT INTO question_collections (
    id,
    learner_id,
    name,
    created_by_user_id
)
VALUES (
    'a8000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '考前複習',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO question_collection_items (
    collection_id,
    question_id,
    added_by_user_id
)
VALUES (
    'a8000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO source_documents (
            id,
            asset_id,
            input_type
        )
        VALUES (
            'a1000000-0000-0000-0000-000000000003',
            'a0000000-0000-0000-0000-000000000002',
            'image'
        );
        RAISE EXCEPTION '來源文件可引用題目內容用途的檔案';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO source_document_classification_candidates (
            id,
            source_document_id,
            dimension,
            raw_value,
            grade_id,
            parser_version
        )
        VALUES (
            'a2000000-0000-0000-0000-000000000002',
            'a1000000-0000-0000-0000-000000000001',
            'subject',
            '國一',
            '10000000-0000-0000-0000-000000000001',
            'test-parser-1'
        );
        RAISE EXCEPTION '分類候選維度與正式外鍵不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO source_document_classification_candidates (
            id,
            source_document_id,
            dimension,
            raw_value,
            parser_version,
            review_status,
            reviewed_by_user_id,
            reviewed_at
        )
        VALUES (
            'a2000000-0000-0000-0000-000000000003',
            'a1000000-0000-0000-0000-000000000001',
            'subject',
            '未知科目',
            'test-parser-1',
            'approved',
            '00000000-0000-0000-0000-000000000001',
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION '沒有正式對照的分類候選可被核准';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO import_items (
            id,
            import_batch_id,
            source_document_id,
            source_order,
            draft_payload
        )
        VALUES (
            'a5000000-0000-0000-0000-000000000002',
            'a4000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000002',
            1,
            '{}'::jsonb
        );
        RAISE EXCEPTION '匯入項目可引用不屬於批次的來源文件';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO import_batches (
            id,
            question_bank_id,
            created_by_user_id,
            idempotency_key
        )
        VALUES (
            'a4000000-0000-0000-0000-000000000002',
            'a3000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001',
            'test-import-1'
        );
        RAISE EXCEPTION '同一帳號可重複使用匯入冪等鍵';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO import_batches (
            id,
            question_bank_id,
            created_by_user_id,
            status,
            idempotency_key
        )
        VALUES (
            'a4000000-0000-0000-0000-000000000003',
            'a3000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001',
            'confirmed',
            'test-import-2'
        );
        RAISE EXCEPTION '已確認批次缺少確認時間時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO import_items (
            id,
            import_batch_id,
            source_document_id,
            source_order,
            draft_payload
        )
        VALUES (
            'a5000000-0000-0000-0000-000000000003',
            'a4000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000001',
            1,
            '[]'::jsonb
        );
        RAISE EXCEPTION '匯入草稿可使用非物件 JSON';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revision_sources (
            id,
            question_revision_id,
            source_document_id,
            import_item_id,
            is_primary
        )
        VALUES (
            'a6000000-0000-0000-0000-000000000002',
            '84000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000002',
            'a5000000-0000-0000-0000-000000000001',
            false
        );
        RAISE EXCEPTION '正式來源可與匯入項目的來源文件不一致';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_identifiers (
            id,
            question_id,
            identifier_type,
            publisher_id,
            source_document_id,
            value,
            normalized_value
        )
        VALUES (
            'a7000000-0000-0000-0000-000000000002',
            '83000000-0000-0000-0000-000000000001',
            'source_document_question',
            '94000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000001',
            '2',
            '2'
        );
        RAISE EXCEPTION '文件題號可同時保存出版社範圍';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revision_sources (
            id,
            question_revision_id,
            source_document_id,
            crop_asset_id,
            is_primary
        )
        VALUES (
            'a6000000-0000-0000-0000-000000000003',
            '84000000-0000-0000-0000-000000000001',
            'a1000000-0000-0000-0000-000000000001',
            'a0000000-0000-0000-0000-000000000002',
            false
        );
        RAISE EXCEPTION '來源裁切圖可引用題目內容用途的檔案';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_collections (
            id,
            learner_id,
            name,
            created_by_user_id
        )
        VALUES (
            'a8000000-0000-0000-0000-000000000002',
            '30000000-0000-0000-0000-000000000001',
            '考前複習',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '同一學習者可建立同名有效收藏';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END;
$$;

DO $$
DECLARE
    migration_count integer;
BEGIN
    SELECT count(*)
    INTO migration_count
    FROM schema_migrations
    WHERE version = '0003' AND name = 'import_and_collections';

    IF migration_count <> 1 THEN
        RAISE EXCEPTION '0003 migration 紀錄不正確';
    END IF;
END;
$$;
