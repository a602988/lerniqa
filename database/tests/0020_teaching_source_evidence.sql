\set ON_ERROR_STOP on

BEGIN;

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type
)
VALUES (
    '16000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'system_admin',
    'bootstrap_admin'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
VALUES (
    '16000000-0000-4000-8000-000000000002',
    'bootstrap_admin',
    'admin_role_granted',
    'user_role',
    '16000000-0000-4000-8000-000000000001',
    '{"role":"system_admin"}'::jsonb,
    '0016-test-admin-grant'
);

SET CONSTRAINTS user_roles_system_admin_audit_check IMMEDIATE;
SET CONSTRAINTS user_roles_system_admin_audit_check DEFERRED;

INSERT INTO users (id, display_name, status)
VALUES ('16000000-0000-4000-8000-000000000003', '一般使用者', 'active');

INSERT INTO grades (id, stage, code, name, sort_order)
VALUES
    (
        '16000000-0000-4000-8000-000000000010',
        'junior_high',
        '0016-junior-one',
        '測試國一',
        1
    ),
    (
        '16000000-0000-4000-8000-000000000011',
        'junior_high',
        '0016-junior-two',
        '測試國二',
        2
    );

INSERT INTO semesters (id, code, name, sort_order)
VALUES
    (
        '16000000-0000-4000-8000-000000000012',
        '0016-first-semester',
        '測試上學期',
        1
    ),
    (
        '16000000-0000-4000-8000-000000000013',
        '0016-second-semester',
        '測試下學期',
        2
    );

INSERT INTO publishers (id, code, name)
VALUES (
    '16000000-0000-4000-8000-000000000014',
    '0016-publisher',
    '測試出版社'
);

INSERT INTO subjects (
    id,
    code,
    name,
    normalized_name,
    subject_kind,
    origin
)
VALUES (
    '16000000-0000-4000-8000-000000000015',
    '0016-chinese',
    '測試國語',
    '測試國語',
    'leaf',
    'system'
);

INSERT INTO book_versions (
    id,
    subject_id,
    grade_id,
    publisher_id,
    name,
    origin
)
VALUES (
    '16000000-0000-4000-8000-000000000016',
    '16000000-0000-4000-8000-000000000015',
    '16000000-0000-4000-8000-000000000010',
    '16000000-0000-4000-8000-000000000014',
    '測試第一冊',
    'system'
);

INSERT INTO curriculum_units (
    id,
    subject_id,
    grade_id,
    semester_id,
    book_version_id,
    unit_type,
    code,
    name,
    position,
    origin
)
VALUES (
    '16000000-0000-4000-8000-000000000017',
    '16000000-0000-4000-8000-000000000015',
    '16000000-0000-4000-8000-000000000010',
    '16000000-0000-4000-8000-000000000012',
    '16000000-0000-4000-8000-000000000016',
    'volume',
    '0016-volume-one',
    '測試第一冊',
    1,
    'system'
);

INSERT INTO curriculum_units (
    id,
    subject_id,
    grade_id,
    semester_id,
    book_version_id,
    parent_unit_id,
    unit_type,
    code,
    name,
    position,
    origin
)
VALUES (
    '16000000-0000-4000-8000-000000000018',
    '16000000-0000-4000-8000-000000000015',
    '16000000-0000-4000-8000-000000000010',
    '16000000-0000-4000-8000-000000000012',
    '16000000-0000-4000-8000-000000000016',
    '16000000-0000-4000-8000-000000000017',
    'lesson',
    '0016-lesson-four',
    '測試第四課',
    4,
    'system'
);

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
    '16000000-0000-4000-8000-000000000020',
    '0016/source/original.pdf',
    'application/pdf',
    1024,
    '0016-source-checksum',
    'source_document',
    'private',
    'clean'
);

INSERT INTO source_documents (
    id,
    asset_id,
    input_type,
    original_file_name,
    document_title,
    status
)
VALUES (
    '16000000-0000-4000-8000-000000000021',
    '16000000-0000-4000-8000-000000000020',
    'pdf',
    '0016測試教材.pdf',
    '0016 測試教材',
    'ready'
);

DO $$
BEGIN
    IF to_regclass('public.source_document_catalog_profiles') IS NULL
        OR to_regclass('public.source_document_processing_runs') IS NULL
        OR to_regclass('public.source_document_pages') IS NULL
        OR to_regclass('public.source_document_blocks') IS NULL
        OR to_regclass('public.question_revision_source_evidence') IS NULL THEN
        RAISE EXCEPTION '0016 教材來源資料表不完整';
    END IF;

    BEGIN
        INSERT INTO source_document_catalog_profiles (
            source_document_id,
            academic_year,
            grade_id,
            subject_id,
            semester_id,
            book_version_id,
            volume_unit_id
        )
        VALUES (
            '16000000-0000-4000-8000-000000000021',
            115,
            '16000000-0000-4000-8000-000000000011',
            '16000000-0000-4000-8000-000000000015',
            '16000000-0000-4000-8000-000000000012',
            '16000000-0000-4000-8000-000000000016',
            '16000000-0000-4000-8000-000000000017'
        );
        RAISE EXCEPTION '教材目錄範圍接受跨年級版本';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO source_document_catalog_profiles (
    source_document_id,
    academic_year,
    grade_id,
    subject_id,
    semester_id,
    book_version_id,
    volume_unit_id
)
VALUES (
    '16000000-0000-4000-8000-000000000021',
    115,
    '16000000-0000-4000-8000-000000000010',
    '16000000-0000-4000-8000-000000000015',
    '16000000-0000-4000-8000-000000000012',
    '16000000-0000-4000-8000-000000000016',
    '16000000-0000-4000-8000-000000000017'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO source_document_processing_runs (
            id,
            source_document_id,
            input_checksum,
            settings_checksum,
            parser_version,
            ocr_engine,
            ocr_model
        )
        VALUES (
            '16000000-0000-4000-8000-000000000022',
            '16000000-0000-4000-8000-000000000021',
            'wrong-checksum',
            '0016-settings-checksum',
            'teaching-source-parser/v1',
            'PaddleOCR',
            'PP-OCRv6-medium-rec'
        );
        RAISE EXCEPTION '教材處理批次接受錯誤來源 checksum';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO source_document_processing_runs (
    id,
    source_document_id,
    input_checksum,
    settings_checksum,
    parser_version,
    ocr_engine,
    ocr_model
)
VALUES (
    '16000000-0000-4000-8000-000000000022',
    '16000000-0000-4000-8000-000000000021',
    '0016-source-checksum',
    '0016-settings-checksum',
    'teaching-source-parser/v1',
    'PaddleOCR',
    'PP-OCRv6-medium-rec'
);

UPDATE source_document_processing_runs
SET
    status = 'processing',
    started_at = CURRENT_TIMESTAMP
WHERE id = '16000000-0000-4000-8000-000000000022';

DO $$
BEGIN
    BEGIN
        INSERT INTO assets (
            id,
            storage_key,
            mime_type,
            byte_size,
            width,
            height,
            checksum,
            purpose,
            sensitivity,
            scan_status
        )
        VALUES (
            '16000000-0000-4000-8000-000000000023',
            '0016/pages/public.webp',
            'image/webp',
            512,
            1200,
            1800,
            '0016-public-page-checksum',
            'source_page',
            'public_content',
            'clean'
        );
        RAISE EXCEPTION 'source_page asset 可被設為 public_content';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO assets (
    id,
    storage_key,
    mime_type,
    byte_size,
    width,
    height,
    checksum,
    purpose,
    sensitivity,
    scan_status
)
VALUES (
    '16000000-0000-4000-8000-000000000023',
    '0016/pages/95.webp',
    'image/webp',
    512,
    1200,
    1800,
    '0016-page-checksum',
    'source_page',
    'private',
    'clean'
);

INSERT INTO source_document_pages (
    id,
    source_document_id,
    pdf_page_number,
    printed_page_number,
    curriculum_unit_id,
    asset_id,
    width,
    height,
    render_version
)
VALUES (
    '16000000-0000-4000-8000-000000000024',
    '16000000-0000-4000-8000-000000000021',
    95,
    93,
    '16000000-0000-4000-8000-000000000018',
    '16000000-0000-4000-8000-000000000023',
    1200,
    1800,
    'pdftoppm-150dpi/v1'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO source_document_blocks (
            id,
            source_document_page_id,
            processing_run_id,
            position,
            block_type,
            bounds_left,
            bounds_top,
            bounds_width,
            bounds_height,
            raw_text,
            ocr_engine,
            ocr_version,
            ocr_model,
            confidence
        )
        VALUES (
            '16000000-0000-4000-8000-000000000025',
            '16000000-0000-4000-8000-000000000024',
            '16000000-0000-4000-8000-000000000022',
            0,
            'body',
            0.8,
            0.1,
            0.3,
            0.2,
            '超出頁面',
            'PaddleOCR',
            '3.7.0',
            'PP-OCRv6-medium-rec',
            0.9
        );
        RAISE EXCEPTION '教材 OCR 區塊接受超出頁面的座標';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO source_document_blocks (
    id,
    source_document_page_id,
    processing_run_id,
    position,
    block_type,
    bounds_left,
    bounds_top,
    bounds_width,
    bounds_height,
    raw_text,
    ocr_engine,
    ocr_version,
    ocr_model,
    confidence
)
VALUES (
    '16000000-0000-4000-8000-000000000025',
    '16000000-0000-4000-8000-000000000024',
    '16000000-0000-4000-8000-000000000022',
    0,
    'body',
    0.6,
    0.1,
    0.3,
    0.2,
    '原始辨識文字',
    'PaddleOCR',
    '3.7.0',
    'PP-OCRv6-medium-rec',
    0.9
);

UPDATE source_document_blocks
SET corrected_text = '人工校正文字'
WHERE id = '16000000-0000-4000-8000-000000000025';

UPDATE source_document_processing_runs
SET
    status = 'completed',
    completed_at = CURRENT_TIMESTAMP
WHERE id = '16000000-0000-4000-8000-000000000022';

DO $$
BEGIN
    BEGIN
        UPDATE source_document_blocks
        SET
            review_status = 'approved',
            reviewed_by_user_id = '16000000-0000-4000-8000-000000000003',
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = '16000000-0000-4000-8000-000000000025';
        RAISE EXCEPTION '一般使用者可以核准教材 OCR 區塊';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

UPDATE source_document_catalog_profiles
SET
    review_status = 'approved',
    reviewed_by_user_id = '00000000-0000-0000-0000-000000000001',
    reviewed_at = CURRENT_TIMESTAMP
WHERE source_document_id = '16000000-0000-4000-8000-000000000021';

UPDATE source_document_blocks
SET
    review_status = 'approved',
    reviewed_by_user_id = '00000000-0000-0000-0000-000000000001',
    reviewed_at = CURRENT_TIMESTAMP
WHERE id = '16000000-0000-4000-8000-000000000025';

DO $$
BEGIN
    BEGIN
        UPDATE source_document_blocks
        SET raw_text = '覆寫後的原始文字'
        WHERE id = '16000000-0000-4000-8000-000000000025';
        RAISE EXCEPTION '核准後可覆寫 OCR 原始文字';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO question_types (id, code, name)
VALUES (
    '16000000-0000-4000-8000-000000000026',
    '0016-single-choice',
    '測試單選題'
);

INSERT INTO questions (
    id,
    origin,
    status,
    created_method
)
VALUES
    (
        '16000000-0000-4000-8000-000000000027',
        'system',
        'draft',
        'migration'
    ),
    (
        '16000000-0000-4000-8000-000000000028',
        'system',
        'draft',
        'migration'
    );

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    subject_id,
    grade_id,
    semester_id,
    book_version_id,
    created_by_type
)
VALUES
    (
        '16000000-0000-4000-8000-000000000029',
        '16000000-0000-4000-8000-000000000027',
        1,
        '16000000-0000-4000-8000-000000000026',
        '16000000-0000-4000-8000-000000000015',
        '16000000-0000-4000-8000-000000000010',
        '16000000-0000-4000-8000-000000000012',
        '16000000-0000-4000-8000-000000000016',
        'migration'
    ),
    (
        '16000000-0000-4000-8000-000000000030',
        '16000000-0000-4000-8000-000000000028',
        1,
        '16000000-0000-4000-8000-000000000026',
        '16000000-0000-4000-8000-000000000015',
        '16000000-0000-4000-8000-000000000010',
        '16000000-0000-4000-8000-000000000013',
        '16000000-0000-4000-8000-000000000016',
        'migration'
    );

DO $$
BEGIN
    BEGIN
        INSERT INTO question_revision_source_evidence (
            id,
            question_revision_id,
            source_document_block_id,
            evidence_role,
            linked_by_user_id
        )
        VALUES (
            '16000000-0000-4000-8000-000000000031',
            '16000000-0000-4000-8000-000000000030',
            '16000000-0000-4000-8000-000000000025',
            'answer_reason',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '題目教材證據接受跨學期題目版本';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO question_revision_source_evidence (
    id,
    question_revision_id,
    source_document_block_id,
    evidence_role,
    linked_by_user_id
)
VALUES (
    '16000000-0000-4000-8000-000000000031',
    '16000000-0000-4000-8000-000000000029',
    '16000000-0000-4000-8000-000000000025',
    'answer_reason',
    '00000000-0000-0000-0000-000000000001'
);

UPDATE question_revision_source_evidence
SET
    review_status = 'approved',
    reviewed_by_user_id = '00000000-0000-0000-0000-000000000001',
    reviewed_at = CURRENT_TIMESTAMP
WHERE id = '16000000-0000-4000-8000-000000000031';

UPDATE question_revision_source_evidence
SET
    revoked_by_user_id = '00000000-0000-0000-0000-000000000001',
    revoked_at = CURRENT_TIMESTAMP
WHERE id = '16000000-0000-4000-8000-000000000031';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_source_evidence AS evidence
        JOIN source_document_blocks AS block
            ON block.id = evidence.source_document_block_id
        JOIN source_document_pages AS page
            ON page.id = block.source_document_page_id
        JOIN source_document_catalog_profiles AS profile
            ON profile.source_document_id = page.source_document_id
        WHERE evidence.id = '16000000-0000-4000-8000-000000000031'
            AND evidence.review_status = 'approved'
            AND evidence.revoked_at IS NOT NULL
            AND block.raw_text = '原始辨識文字'
            AND block.corrected_text = '人工校正文字'
            AND profile.academic_year = 115
    ) THEN
        RAISE EXCEPTION '核准教材證據未完整保存來源、校正與撤回紀錄';
    END IF;
END;
$$;

-- 所有測試資料都只存在交易內，避免影響逐階段 down migration 驗證。
ROLLBACK;
