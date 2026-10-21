\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'question_content_blocks'
            AND column_name = 'hint_index'
    ) THEN
        RAISE EXCEPTION 'question_content_blocks.hint_index is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0026' AND name = 'question_hints'
    ) THEN
        RAISE EXCEPTION '0026 migration record is missing';
    END IF;
END;
$$;

BEGIN;

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    subject_id,
    grade_id,
    semester_id,
    book_version_id,
    difficulty_level_id,
    created_by_type
)
VALUES (
    '26000000-0000-4000-8000-000000000010',
    '83000000-0000-0000-0000-000000000002',
    1,
    '80000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
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
VALUES (
    '26000000-0000-4000-8000-000000000011',
    '26000000-0000-4000-8000-000000000010',
    'main',
    0,
    'text',
    'manual_review'
);

INSERT INTO question_content_blocks (
    id,
    question_revision_id,
    question_part_id,
    placement,
    content_type,
    position,
    text_content,
    hint_index
)
VALUES (
    '26000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000010',
    '26000000-0000-4000-8000-000000000011',
    'hint',
    'text',
    0,
    '先找出算式中的已知數。',
    0
);

DO $$
BEGIN
    BEGIN
        INSERT INTO question_content_blocks (
            id,
            question_revision_id,
            question_part_id,
            placement,
            content_type,
            position,
            text_content
        )
        VALUES (
            '26000000-0000-4000-8000-000000000002',
            '26000000-0000-4000-8000-000000000010',
            '26000000-0000-4000-8000-000000000011',
            'hint',
            'text',
            0,
            '缺少提示序號'
        );
        RAISE EXCEPTION 'hint block without hint_index was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_content_blocks (
            id,
            question_revision_id,
            placement,
            content_type,
            position,
            text_content,
            hint_index
        )
        VALUES (
            '26000000-0000-4000-8000-000000000003',
            '26000000-0000-4000-8000-000000000010',
            'prompt',
            'text',
            0,
            '題目內容不能帶提示序號',
            0
        );
        RAISE EXCEPTION 'non-hint block with hint_index was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

ROLLBACK;
