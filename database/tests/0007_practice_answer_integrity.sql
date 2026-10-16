\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    expected_trigger_names text[] := ARRAY[
        'assets_ready_document_reference_check',
        'question_answers_choice_option_check',
        'question_options_choice_answer_check',
        'question_parts_choice_answer_check',
        'source_documents_ready_document_asset_check'
    ];
    missing_trigger_names text[];
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0007'
            AND name = 'practice_answer_integrity'
    ) THEN
        RAISE EXCEPTION '缺少 0007 migration 紀錄';
    END IF;

    SELECT array_agg(expected_name ORDER BY expected_name)
    INTO missing_trigger_names
    FROM unnest(expected_trigger_names) AS expected_name
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        WHERE trigger.tgname = expected_name
            AND trigger.tgdeferrable
            AND trigger.tginitdeferred
    );

    IF missing_trigger_names IS NOT NULL THEN
        RAISE EXCEPTION '缺少可延後且初始延後的 0007 constraint triggers：%', missing_trigger_names;
    END IF;
END;
$$;

INSERT INTO questions (
    id,
    origin,
    status,
    created_method
)
VALUES (
    '07000000-0000-0000-0000-000000000001',
    'system',
    'draft',
    'migration'
);

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    status,
    created_by_type
)
VALUES (
    '07000000-0000-0000-0000-000000000002',
    '07000000-0000-0000-0000-000000000001',
    1,
    '80000000-0000-0000-0000-000000000001',
    'draft',
    'migration'
);

INSERT INTO question_parts (
    id,
    question_revision_id,
    stable_key,
    position,
    answer_mode,
    grading_policy
)
VALUES
    (
        '07000000-0000-0000-0000-000000000003',
        '07000000-0000-0000-0000-000000000002',
        'choice',
        0,
        'single_choice',
        'automatic'
    ),
    (
        '07000000-0000-0000-0000-000000000004',
        '07000000-0000-0000-0000-000000000002',
        'text',
        1,
        'text',
        'manual_review'
    );

INSERT INTO question_options (id, question_part_id, option_key, position)
VALUES
    (
        '07000000-0000-0000-0000-000000000005',
        '07000000-0000-0000-0000-000000000003',
        'A',
        0
    ),
    (
        '07000000-0000-0000-0000-000000000006',
        '07000000-0000-0000-0000-000000000003',
        'B',
        1
    );

INSERT INTO question_answers (id, question_part_id, answer_key)
VALUES
    (
        '07000000-0000-0000-0000-000000000007',
        '07000000-0000-0000-0000-000000000003',
        'A'
    ),
    (
        '07000000-0000-0000-0000-000000000008',
        '07000000-0000-0000-0000-000000000004',
        'TEXT-KEY'
    );

SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check,
    question_parts_choice_answer_check
IMMEDIATE;
SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check,
    question_parts_choice_answer_check
DEFERRED;

-- A coordinated option-key and answer-key rename may be performed in either
-- order because the final transaction state is valid.
UPDATE question_answers
SET answer_key = 'C'
WHERE id = '07000000-0000-0000-0000-000000000007';

UPDATE question_options
SET option_key = 'C'
WHERE id = '07000000-0000-0000-0000-000000000005';

SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check
IMMEDIATE;
SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE question_answers
        SET answer_key = 'UNKNOWN'
        WHERE id = '07000000-0000-0000-0000-000000000007';

        SET CONSTRAINTS question_answers_choice_option_check IMMEDIATE;
        RAISE EXCEPTION '選擇題答案可引用不存在的選項';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_answers_choice_option_check DEFERRED;
    END;

    BEGIN
        DELETE FROM question_options
        WHERE id = '07000000-0000-0000-0000-000000000005';

        SET CONSTRAINTS question_options_choice_answer_check IMMEDIATE;
        RAISE EXCEPTION '仍被答案引用的選項可被刪除';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_options_choice_answer_check DEFERRED;
    END;

    BEGIN
        UPDATE question_options
        SET option_key = 'RENAMED-WITHOUT-ANSWER'
        WHERE id = '07000000-0000-0000-0000-000000000005';

        SET CONSTRAINTS question_options_choice_answer_check IMMEDIATE;
        RAISE EXCEPTION '選項鍵可在未同步答案鍵時改名';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_options_choice_answer_check DEFERRED;
    END;

    BEGIN
        UPDATE question_answers
        SET question_part_id = '07000000-0000-0000-0000-000000000003'
        WHERE id = '07000000-0000-0000-0000-000000000008';

        SET CONSTRAINTS question_answers_choice_option_check IMMEDIATE;
        RAISE EXCEPTION '答案可被移到沒有相同鍵的選擇題小題';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_answers_choice_option_check DEFERRED;
    END;

    BEGIN
        UPDATE question_options
        SET question_part_id = '07000000-0000-0000-0000-000000000004'
        WHERE id = '07000000-0000-0000-0000-000000000005';

        SET CONSTRAINTS question_options_choice_answer_check IMMEDIATE;
        RAISE EXCEPTION '答案使用中的選項可被移到別的小題';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_options_choice_answer_check DEFERRED;
    END;

    BEGIN
        UPDATE question_parts
        SET answer_mode = 'single_choice'
        WHERE id = '07000000-0000-0000-0000-000000000004';

        SET CONSTRAINTS question_parts_choice_answer_check IMMEDIATE;
        RAISE EXCEPTION '小題可切換成答案鍵沒有對應選項的選擇模式';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_parts_choice_answer_check DEFERRED;
    END;
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
VALUES
    (
        '07000000-0000-0000-0000-000000000010',
        'tests/0007-valid-source.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        128,
        '0007-valid-source',
        'source_document',
        'private',
        'clean'
    ),
    (
        '07000000-0000-0000-0000-000000000011',
        'tests/0007-public-source.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        128,
        '0007-public-source',
        'source_document',
        'public_content',
        'clean'
    ),
    (
        '07000000-0000-0000-0000-000000000012',
        'tests/0007-legacy-source.doc',
        'application/msword',
        128,
        '0007-legacy-source',
        'source_document',
        'private',
        'clean'
    );

INSERT INTO source_documents (
    id,
    asset_id,
    input_type,
    original_file_name,
    status
)
VALUES (
    '07000000-0000-0000-0000-000000000013',
    '07000000-0000-0000-0000-000000000010',
    'document',
    '安全來源.doc',
    'ready'
);

INSERT INTO source_documents (
    id,
    asset_id,
    input_type,
    original_file_name,
    status
)
VALUES (
    '07000000-0000-0000-0000-000000000016',
    '07000000-0000-0000-0000-000000000011',
    'document',
    '尚未就緒來源.doc',
    'uploaded'
);

SET CONSTRAINTS
    source_documents_ready_document_asset_check,
    assets_ready_document_reference_check
IMMEDIATE;
SET CONSTRAINTS
    source_documents_ready_document_asset_check,
    assets_ready_document_reference_check
DEFERRED;

-- Temporary intermediate states are allowed when the transaction restores a
-- valid ready document before deferred constraints are checked.
UPDATE source_documents
SET status = 'processing'
WHERE id = '07000000-0000-0000-0000-000000000013';

UPDATE assets
SET sensitivity = 'public_content',
    mime_type = 'application/msword'
WHERE id = '07000000-0000-0000-0000-000000000010';

UPDATE assets
SET sensitivity = 'private',
    mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
WHERE id = '07000000-0000-0000-0000-000000000010';

UPDATE source_documents
SET status = 'ready'
WHERE id = '07000000-0000-0000-0000-000000000013';

SET CONSTRAINTS
    source_documents_ready_document_asset_check,
    assets_ready_document_reference_check
IMMEDIATE;
SET CONSTRAINTS
    source_documents_ready_document_asset_check,
    assets_ready_document_reference_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE source_documents
        SET status = 'ready'
        WHERE id = '07000000-0000-0000-0000-000000000016';

        SET CONSTRAINTS source_documents_ready_document_asset_check IMMEDIATE;
        RAISE EXCEPTION '引用 public_content 資產的 Word 來源可切換成 ready';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS source_documents_ready_document_asset_check DEFERRED;
    END;

    BEGIN
        INSERT INTO source_documents (
            id,
            asset_id,
            input_type,
            original_file_name,
            status
        )
        VALUES (
            '07000000-0000-0000-0000-000000000014',
            '07000000-0000-0000-0000-000000000011',
            'document',
            '公開來源.doc',
            'ready'
        );

        SET CONSTRAINTS source_documents_ready_document_asset_check IMMEDIATE;
        RAISE EXCEPTION 'ready Word 來源可引用 public_content 資產';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS source_documents_ready_document_asset_check DEFERRED;
    END;

    BEGIN
        INSERT INTO source_documents (
            id,
            asset_id,
            input_type,
            original_file_name,
            status
        )
        VALUES (
            '07000000-0000-0000-0000-000000000015',
            '07000000-0000-0000-0000-000000000012',
            'document',
            '舊格式來源.doc',
            'ready'
        );

        SET CONSTRAINTS source_documents_ready_document_asset_check IMMEDIATE;
        RAISE EXCEPTION 'ready Word 來源可直接引用舊版 Word MIME';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS source_documents_ready_document_asset_check DEFERRED;
    END;

    BEGIN
        UPDATE assets
        SET sensitivity = 'public_content'
        WHERE id = '07000000-0000-0000-0000-000000000010';

        SET CONSTRAINTS assets_ready_document_reference_check IMMEDIATE;
        RAISE EXCEPTION 'ready Word 來源引用後可把資產改成 public_content';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS assets_ready_document_reference_check DEFERRED;
    END;

    BEGIN
        UPDATE assets
        SET mime_type = 'application/msword'
        WHERE id = '07000000-0000-0000-0000-000000000010';

        SET CONSTRAINTS assets_ready_document_reference_check IMMEDIATE;
        RAISE EXCEPTION 'ready Word 來源引用後可把資產改成舊版 Word MIME';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS assets_ready_document_reference_check DEFERRED;
    END;
END;
$$;

-- Delete paths also participate in the deferred final-state checks without
-- preventing a complete coordinated removal.
DELETE FROM question_answers
WHERE question_part_id IN (
    '07000000-0000-0000-0000-000000000003',
    '07000000-0000-0000-0000-000000000004'
);
DELETE FROM question_options
WHERE question_part_id = '07000000-0000-0000-0000-000000000003';
DELETE FROM question_parts
WHERE question_revision_id = '07000000-0000-0000-0000-000000000002';

SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check,
    question_parts_choice_answer_check
IMMEDIATE;

DELETE FROM source_documents
WHERE id = '07000000-0000-0000-0000-000000000013';
UPDATE assets
SET sensitivity = 'public_content',
    mime_type = 'application/msword'
WHERE id = '07000000-0000-0000-0000-000000000010';
DELETE FROM assets
WHERE id = '07000000-0000-0000-0000-000000000010';

SET CONSTRAINTS
    source_documents_ready_document_asset_check,
    assets_ready_document_reference_check
IMMEDIATE;

ROLLBACK;

-- Leave one precise legacy Hanlin row for the next migration to upgrade, an
-- already-correct native row in the same confirmed batch, and an otherwise
-- identical legacy row outside that batch. The next migration must repair only
-- the first row.
BEGIN;

INSERT INTO users (id, display_name)
VALUES ('07800000-0000-0000-0000-000000000001', '0008 upgrade fixture principal');

INSERT INTO subjects (
    id,
    code,
    name,
    normalized_name,
    subject_kind,
    origin
)
VALUES (
    '07800000-0000-0000-0000-000000000002',
    'migration_0008_subject',
    '0008 upgrade fixture subject',
    '0008 upgrade fixture subject',
    'leaf',
    'system'
);

INSERT INTO curriculum_units (
    id,
    subject_id,
    unit_type,
    code,
    name,
    position,
    origin
)
VALUES (
    '07800000-0000-0000-0000-000000000003',
    '07800000-0000-0000-0000-000000000002',
    'lesson',
    'migration-0008-lesson',
    '0008 upgrade fixture unit',
    0,
    'system'
);

INSERT INTO source_categories (
    id,
    code,
    name,
    sort_order,
    origin
)
VALUES (
    '07800000-0000-0000-0000-000000000004',
    'publisher-test-bank',
    '0008 upgrade fixture source',
    0,
    'system'
);

INSERT INTO question_types (
    id,
    code,
    name
)
VALUES (
    '07800000-0000-0000-0000-000000000005',
    'migration-0008-type',
    '0008 upgrade fixture type'
);

INSERT INTO question_banks (
    id,
    name,
    origin,
    is_default
)
VALUES (
    '07800000-0000-0000-0000-000000000006',
    '0008 upgrade fixture bank',
    'system',
    false
);

INSERT INTO source_documents (
    id,
    owner_user_id,
    input_type,
    pasted_text,
    document_title,
    status
)
VALUES (
    '07800000-0000-0000-0000-000000000007',
    '07800000-0000-0000-0000-000000000001',
    'text',
    '0008 upgrade fixture source',
    '0008 upgrade fixture source',
    'ready'
);

INSERT INTO import_batches (
    id,
    question_bank_id,
    learner_id,
    created_by_user_id,
    status,
    idempotency_key,
    recognizer_version,
    confirmed_at
)
VALUES (
    '2d1ff794-f6f4-5e59-baaa-8d1c767438be',
    '07800000-0000-0000-0000-000000000006',
    NULL,
    '07800000-0000-0000-0000-000000000001',
    'confirmed',
    'migration-0008-upgrade-fixture',
    'migration-test',
    CURRENT_TIMESTAMP
);

INSERT INTO import_batch_documents (
    import_batch_id,
    source_document_id,
    position
)
VALUES (
    '2d1ff794-f6f4-5e59-baaa-8d1c767438be',
    '07800000-0000-0000-0000-000000000007',
    0
);

INSERT INTO questions (
    id,
    origin,
    status,
    created_method,
    created_by_user_id
)
VALUES
    (
        '07800000-0000-0000-0000-000000000008',
        'system',
        'draft',
        'import',
        '07800000-0000-0000-0000-000000000001'
    ),
    (
        '07800000-0000-0000-0000-000000000010',
        'system',
        'draft',
        'import',
        '07800000-0000-0000-0000-000000000001'
    ),
    (
        '07800000-0000-0000-0000-000000000013',
        'system',
        'draft',
        'import',
        '07800000-0000-0000-0000-000000000001'
    );

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    source_category_id,
    status,
    created_by_type,
    created_by_user_id
)
VALUES
    (
        '07800000-0000-0000-0000-000000000009',
        '07800000-0000-0000-0000-000000000008',
        1,
        '07800000-0000-0000-0000-000000000005',
        '07800000-0000-0000-0000-000000000004',
        'draft',
        'user',
        '07800000-0000-0000-0000-000000000001'
    ),
    (
        '07800000-0000-0000-0000-000000000011',
        '07800000-0000-0000-0000-000000000010',
        1,
        '07800000-0000-0000-0000-000000000005',
        '07800000-0000-0000-0000-000000000004',
        'draft',
        'user',
        '07800000-0000-0000-0000-000000000001'
    ),
    (
        '07800000-0000-0000-0000-000000000014',
        '07800000-0000-0000-0000-000000000013',
        1,
        '07800000-0000-0000-0000-000000000005',
        '07800000-0000-0000-0000-000000000004',
        'draft',
        'user',
        '07800000-0000-0000-0000-000000000001'
    );

INSERT INTO import_items (
    id,
    import_batch_id,
    source_document_id,
    source_order,
    draft_payload,
    review_status,
    question_id,
    question_revision_id,
    reviewed_by_user_id,
    reviewed_at
)
VALUES
    (
        '07800000-0000-0000-0000-000000000012',
        '2d1ff794-f6f4-5e59-baaa-8d1c767438be',
        '07800000-0000-0000-0000-000000000007',
        0,
        '{}'::jsonb,
        'approved',
        '07800000-0000-0000-0000-000000000008',
        '07800000-0000-0000-0000-000000000009',
        '07800000-0000-0000-0000-000000000001',
        CURRENT_TIMESTAMP
    ),
    (
        '07800000-0000-0000-0000-000000000015',
        '2d1ff794-f6f4-5e59-baaa-8d1c767438be',
        '07800000-0000-0000-0000-000000000007',
        1,
        '{}'::jsonb,
        'approved',
        '07800000-0000-0000-0000-000000000013',
        '07800000-0000-0000-0000-000000000014',
        '07800000-0000-0000-0000-000000000001',
        CURRENT_TIMESTAMP
    );

INSERT INTO question_revision_units (
    question_revision_id,
    curriculum_unit_id,
    assignment_type,
    is_primary,
    value_source,
    confidence
)
VALUES
    (
        '07800000-0000-0000-0000-000000000009',
        '07800000-0000-0000-0000-000000000003',
        'manual_classification',
        true,
        'user',
        1
    ),
    (
        '07800000-0000-0000-0000-000000000011',
        '07800000-0000-0000-0000-000000000003',
        'manual_classification',
        true,
        'user',
        1
    ),
    (
        '07800000-0000-0000-0000-000000000014',
        '07800000-0000-0000-0000-000000000003',
        'native',
        true,
        'document',
        1
    );

COMMIT;
