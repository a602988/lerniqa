\set ON_ERROR_STOP on

\if :{?prepare_0009_preflight}

BEGIN;

INSERT INTO users (id, display_name)
VALUES ('09900000-0000-0000-0000-000000000001', '0009 preflight fixture');

INSERT INTO question_types (id, code, name)
VALUES ('09900000-0000-0000-0000-000000000002', 'preflight_text', 'Preflight text');

INSERT INTO questions (id, origin, owner_user_id, status, created_method)
VALUES (
    '09900000-0000-0000-0000-000000000010',
    'account',
    '09900000-0000-0000-0000-000000000001',
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
    '09900000-0000-0000-0000-000000000011',
    '09900000-0000-0000-0000-000000000010',
    1,
    '09900000-0000-0000-0000-000000000002',
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
VALUES (
    '09900000-0000-0000-0000-000000000012',
    '09900000-0000-0000-0000-000000000011',
    'missing-answer',
    0,
    'text',
    'automatic'
);

UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09900000-0000-0000-0000-000000000011';

UPDATE question_revisions
SET status = 'superseded'
WHERE id = '09900000-0000-0000-0000-000000000011'
    AND :'preflight_status' = 'superseded';

COMMIT;

\elif :{?prepare_0009_concurrency}

BEGIN;

INSERT INTO users (id, display_name)
VALUES ('09900000-0000-0000-0000-000000000101', '0009 concurrency fixture');

INSERT INTO question_types (id, code, name)
VALUES ('09900000-0000-0000-0000-000000000102', 'concurrency_choice', 'Concurrency choice');

INSERT INTO questions (id, origin, owner_user_id, status, created_method)
VALUES
    (
        '09900000-0000-0000-0000-000000000110',
        'account',
        '09900000-0000-0000-0000-000000000101',
        'draft',
        'migration'
    ),
    (
        '09900000-0000-0000-0000-000000000120',
        'account',
        '09900000-0000-0000-0000-000000000101',
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
VALUES
    (
        '09900000-0000-0000-0000-000000000111',
        '09900000-0000-0000-0000-000000000110',
        1,
        '09900000-0000-0000-0000-000000000102',
        'draft',
        'migration'
    ),
    (
        '09900000-0000-0000-0000-000000000121',
        '09900000-0000-0000-0000-000000000120',
        1,
        '09900000-0000-0000-0000-000000000102',
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
VALUES (
    '09900000-0000-0000-0000-000000000112',
    '09900000-0000-0000-0000-000000000111',
    'concurrent-answer',
    0,
    'single_choice',
    'automatic'
);

INSERT INTO question_options (id, question_part_id, option_key, position)
VALUES (
    '09900000-0000-0000-0000-000000000113',
    '09900000-0000-0000-0000-000000000112',
    'A',
    0
);

INSERT INTO question_answers (id, question_part_id, answer_key, position)
VALUES
    (
        '09900000-0000-0000-0000-000000000114',
        '09900000-0000-0000-0000-000000000112',
        'A',
        0
    ),
    (
        '09900000-0000-0000-0000-000000000115',
        '09900000-0000-0000-0000-000000000112',
        'A',
        1
    );

COMMIT;

\else

BEGIN;

DO $$
DECLARE
    expected_deferred_trigger_names text[] := ARRAY[
        'question_answers_automatic_answer_check',
        'question_options_automatic_answer_check',
        'question_parts_automatic_answer_check',
        'question_revisions_automatic_answer_check'
    ];
    expected_lock_trigger_names text[] := ARRAY[
        'question_answers_0009_parent_revision_lock',
        'question_content_blocks_0009_parent_revision_lock',
        'question_options_0009_parent_revision_lock',
        'question_parts_0009_parent_revision_lock',
        'question_revision_curriculum_codes_0009_parent_revision_lock',
        'question_revision_filter_values_0009_parent_revision_lock',
        'question_revision_knowledge_points_0009_parent_revision_lock',
        'question_revision_sources_0009_parent_revision_lock',
        'question_revision_topics_0009_parent_revision_lock',
        'question_revision_units_0009_parent_revision_lock'
    ];
    missing_trigger_names text[];
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0009'
            AND name = 'automatic_answer_completeness'
    ) THEN
        RAISE EXCEPTION '缺少 0009 migration 紀錄';
    END IF;

    SELECT array_agg(expected_name ORDER BY expected_name)
    INTO missing_trigger_names
    FROM unnest(expected_deferred_trigger_names) AS expected_name
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        WHERE trigger.tgname = expected_name
            AND trigger.tgdeferrable
            AND trigger.tginitdeferred
    );

    IF missing_trigger_names IS NOT NULL THEN
        RAISE EXCEPTION '缺少可延後且初始延後的 0009 constraint triggers：%', missing_trigger_names;
    END IF;

    SELECT array_agg(expected_name ORDER BY expected_name)
    INTO missing_trigger_names
    FROM unnest(expected_lock_trigger_names) AS expected_name
    WHERE NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        WHERE trigger.tgname = expected_name
            AND trigger.tgrelid = to_regclass(
                'public.' || replace(
                    expected_name,
                    '_0009_parent_revision_lock',
                    ''
                )
            )
            AND NOT trigger.tgdeferrable
            AND pg_get_triggerdef(trigger.oid) LIKE '% BEFORE %'
    );

    IF missing_trigger_names IS NOT NULL THEN
        RAISE EXCEPTION '缺少 0009 child mutation BEFORE lock triggers：%', missing_trigger_names;
    END IF;

    IF to_regclass('public.question_answers_part_index') IS NULL THEN
        RAISE EXCEPTION '缺少 question_answers(question_part_id) 查詢索引';
    END IF;

    IF to_regprocedure('public.lerniqa_text_has_non_whitespace(text)') IS NULL
        OR to_regprocedure('public.lerniqa_automatic_part_has_complete_answer(uuid,character varying)') IS NULL
        OR to_regprocedure('public.lerniqa_lock_frozen_revision_parents()') IS NULL THEN
        RAISE EXCEPTION '缺少 0009 completeness 或 parent-lock helper function';
    END IF;
END;
$$;

INSERT INTO users (id, display_name)
VALUES ('09000000-0000-0000-0000-000000000001', '0009 answer integrity fixture');

INSERT INTO questions (
    id,
    origin,
    owner_user_id,
    status,
    created_method
)
VALUES
    ('09000000-0000-0000-0000-000000000010', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000020', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000030', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000040', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000050', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000060', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000070', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration');

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    status,
    created_by_type
)
VALUES
    ('09000000-0000-0000-0000-000000000011', '09000000-0000-0000-0000-000000000010', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000021', '09000000-0000-0000-0000-000000000020', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000031', '09000000-0000-0000-0000-000000000030', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000041', '09000000-0000-0000-0000-000000000040', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000051', '09000000-0000-0000-0000-000000000050', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000061', '09000000-0000-0000-0000-000000000060', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000071', '09000000-0000-0000-0000-000000000070', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration');

INSERT INTO question_parts (
    id,
    question_revision_id,
    stable_key,
    position,
    answer_mode,
    grading_policy
)
VALUES
    ('09000000-0000-0000-0000-000000000012', '09000000-0000-0000-0000-000000000011', 'single', 0, 'single_choice', 'automatic'),
    ('09000000-0000-0000-0000-000000000022', '09000000-0000-0000-0000-000000000021', 'boolean', 0, 'boolean', 'automatic'),
    ('09000000-0000-0000-0000-000000000032', '09000000-0000-0000-0000-000000000031', 'multiple', 0, 'multiple_choice', 'automatic'),
    ('09000000-0000-0000-0000-000000000042', '09000000-0000-0000-0000-000000000041', 'text', 0, 'text', 'automatic'),
    ('09000000-0000-0000-0000-000000000052', '09000000-0000-0000-0000-000000000051', 'manual', 0, 'text', 'manual_review'),
    ('09000000-0000-0000-0000-000000000053', '09000000-0000-0000-0000-000000000051', 'ai', 1, 'single_choice', 'ai_assisted_review'),
    ('09000000-0000-0000-0000-000000000062', '09000000-0000-0000-0000-000000000061', 'policy', 0, 'text', 'manual_review'),
    ('09000000-0000-0000-0000-000000000072', '09000000-0000-0000-0000-000000000071', 'deferred-order', 0, 'single_choice', 'automatic');

INSERT INTO question_options (id, question_part_id, option_key, position)
VALUES
    ('09000000-0000-0000-0000-000000000013', '09000000-0000-0000-0000-000000000012', 'A', 0),
    ('09000000-0000-0000-0000-000000000014', '09000000-0000-0000-0000-000000000012', 'B', 1),
    ('09000000-0000-0000-0000-000000000023', '09000000-0000-0000-0000-000000000022', 'true', 0),
    ('09000000-0000-0000-0000-000000000024', '09000000-0000-0000-0000-000000000022', 'false', 1),
    ('09000000-0000-0000-0000-000000000033', '09000000-0000-0000-0000-000000000032', 'A', 0),
    ('09000000-0000-0000-0000-000000000034', '09000000-0000-0000-0000-000000000032', 'B', 1),
    ('09000000-0000-0000-0000-000000000035', '09000000-0000-0000-0000-000000000032', 'C', 2);

-- Additional fixtures cover answer cardinality, all-whitespace text, and rows
-- moving between revisions. They remain isolated in this rolled-back test.
INSERT INTO questions (id, origin, owner_user_id, status, created_method)
VALUES
    ('09000000-0000-0000-0000-000000000080', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000090', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000100', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000110', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000120', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000130', 'account', '09000000-0000-0000-0000-000000000001', 'draft', 'migration');

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    status,
    created_by_type
)
VALUES
    ('09000000-0000-0000-0000-000000000081', '09000000-0000-0000-0000-000000000080', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000091', '09000000-0000-0000-0000-000000000090', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000101', '09000000-0000-0000-0000-000000000100', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000111', '09000000-0000-0000-0000-000000000110', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000121', '09000000-0000-0000-0000-000000000120', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration'),
    ('09000000-0000-0000-0000-000000000131', '09000000-0000-0000-0000-000000000130', 1, '80000000-0000-0000-0000-000000000001', 'draft', 'migration');

INSERT INTO question_parts (
    id,
    question_revision_id,
    stable_key,
    position,
    answer_mode,
    grading_policy
)
VALUES
    ('09000000-0000-0000-0000-000000000082', '09000000-0000-0000-0000-000000000081', 'single-cardinality', 0, 'single_choice', 'automatic'),
    ('09000000-0000-0000-0000-000000000092', '09000000-0000-0000-0000-000000000091', 'boolean-cardinality', 0, 'boolean', 'automatic'),
    ('09000000-0000-0000-0000-000000000102', '09000000-0000-0000-0000-000000000101', 'ascii-whitespace', 0, 'text', 'automatic'),
    ('09000000-0000-0000-0000-000000000112', '09000000-0000-0000-0000-000000000111', 'unicode-whitespace', 0, 'text', 'automatic'),
    ('09000000-0000-0000-0000-000000000122', '09000000-0000-0000-0000-000000000121', 'move-source', 0, 'single_choice', 'automatic'),
    ('09000000-0000-0000-0000-000000000132', '09000000-0000-0000-0000-000000000131', 'move-target', 0, 'single_choice', 'automatic');

INSERT INTO question_options (id, question_part_id, option_key, position)
VALUES
    ('09000000-0000-0000-0000-000000000083', '09000000-0000-0000-0000-000000000082', 'A', 0),
    ('09000000-0000-0000-0000-000000000084', '09000000-0000-0000-0000-000000000082', 'B', 1),
    ('09000000-0000-0000-0000-000000000093', '09000000-0000-0000-0000-000000000092', 'true', 0),
    ('09000000-0000-0000-0000-000000000094', '09000000-0000-0000-0000-000000000092', 'false', 1),
    ('09000000-0000-0000-0000-000000000123', '09000000-0000-0000-0000-000000000122', 'A', 0);

INSERT INTO question_answers (id, question_part_id, answer_key, position)
VALUES
    ('09000000-0000-0000-0000-000000000085', '09000000-0000-0000-0000-000000000082', 'A', 0),
    ('09000000-0000-0000-0000-000000000086', '09000000-0000-0000-0000-000000000082', 'B', 1),
    ('09000000-0000-0000-0000-000000000095', '09000000-0000-0000-0000-000000000092', 'true', 0),
    ('09000000-0000-0000-0000-000000000096', '09000000-0000-0000-0000-000000000092', 'false', 1),
    ('09000000-0000-0000-0000-000000000124', '09000000-0000-0000-0000-000000000122', 'A', 0);

INSERT INTO question_answers (id, question_part_id, accepted_value)
VALUES
    ('09000000-0000-0000-0000-000000000103', '09000000-0000-0000-0000-000000000102', E'\t\n\r\f'),
    ('09000000-0000-0000-0000-000000000113', '09000000-0000-0000-0000-000000000112', U&'\00A0\2003\3000');

DO $$
DECLARE
    fixture_revision_id uuid;
    failure_message text;
BEGIN
    FOREACH fixture_revision_id IN ARRAY ARRAY[
        '09000000-0000-0000-0000-000000000081'::uuid,
        '09000000-0000-0000-0000-000000000091'::uuid,
        '09000000-0000-0000-0000-000000000101'::uuid,
        '09000000-0000-0000-0000-000000000111'::uuid
    ]
    LOOP
        BEGIN
            UPDATE question_revisions
            SET status = 'published',
                published_at = transaction_timestamp()
            WHERE id = fixture_revision_id;

            SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
            RAISE EXCEPTION '不完整 cardinality 或空白答案可發布：%', fixture_revision_id;
        EXCEPTION
            WHEN check_violation THEN
                GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
                IF failure_message NOT LIKE '%完整參考答案%' THEN
                    RAISE;
                END IF;
                SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
        END;
    END LOOP;
END;
$$;

-- Move both members of an answer/option pair between draft revisions. The
-- source and target candidates must both be checked from their final state.
UPDATE question_answers
SET question_part_id = '09000000-0000-0000-0000-000000000132'
WHERE id = '09000000-0000-0000-0000-000000000124';
UPDATE question_options
SET question_part_id = '09000000-0000-0000-0000-000000000132'
WHERE id = '09000000-0000-0000-0000-000000000123';

SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check,
    question_answers_automatic_answer_check,
    question_options_automatic_answer_check
IMMEDIATE;
SET CONSTRAINTS
    question_answers_choice_option_check,
    question_options_choice_answer_check,
    question_answers_automatic_answer_check,
    question_options_automatic_answer_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09000000-0000-0000-0000-000000000121';

        SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
        RAISE EXCEPTION '搬走最後答案後的來源版本仍可發布';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
    END;
END;
$$;

UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000131';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

-- An accepted_value does not complete a choice part: it must have a key that
-- references an option in the same part.
INSERT INTO question_answers (id, question_part_id, accepted_value)
VALUES ('09000000-0000-0000-0000-000000000015', '09000000-0000-0000-0000-000000000012', 'A');

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09000000-0000-0000-0000-000000000011';

        SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
        RAISE EXCEPTION '單選題可在沒有有效答案鍵時發布';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
    END;
END;
$$;

DELETE FROM question_answers
WHERE id = '09000000-0000-0000-0000-000000000015';
INSERT INTO question_answers (id, question_part_id, answer_key)
VALUES ('09000000-0000-0000-0000-000000000016', '09000000-0000-0000-0000-000000000012', 'A');
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000011';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09000000-0000-0000-0000-000000000021';

        SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
        RAISE EXCEPTION '是非題可在沒有有效答案鍵時發布';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
    END;
END;
$$;

INSERT INTO question_answers (id, question_part_id, answer_key)
VALUES ('09000000-0000-0000-0000-000000000025', '09000000-0000-0000-0000-000000000022', 'true');
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000021';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09000000-0000-0000-0000-000000000031';

        SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
        RAISE EXCEPTION '複選題可在沒有有效答案鍵時發布';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
    END;
END;
$$;

-- Multiple-choice follows the existing row model: one or more valid keys are
-- accepted, and two rows represent the complete answer set here.
INSERT INTO question_answers (id, question_part_id, answer_key, position)
VALUES
    ('09000000-0000-0000-0000-000000000036', '09000000-0000-0000-0000-000000000032', 'A', 0),
    ('09000000-0000-0000-0000-000000000037', '09000000-0000-0000-0000-000000000032', 'C', 1);
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000031';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

INSERT INTO question_answers (id, question_part_id, accepted_value)
VALUES ('09000000-0000-0000-0000-000000000043', '09000000-0000-0000-0000-000000000042', '   ');

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09000000-0000-0000-0000-000000000041';

        SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
        RAISE EXCEPTION '文字題可把空白 accepted_value 當成完整答案';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
    END;
END;
$$;

UPDATE question_answers
SET accepted_value = '有效文字答案'
WHERE id = '09000000-0000-0000-0000-000000000043';
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000041';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

-- Manual and AI-assisted parts may be published without a reference answer.
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000051';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

-- A draft can be assembled incrementally, but switching it to automatic and
-- publishing without an answer must fail in the transaction's final state.
UPDATE question_parts
SET grading_policy = 'automatic'
WHERE id = '09000000-0000-0000-0000-000000000062';
SET CONSTRAINTS question_parts_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_parts_automatic_answer_check DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET status = 'published',
            published_at = transaction_timestamp()
        WHERE id = '09000000-0000-0000-0000-000000000061';

        SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
        RAISE EXCEPTION '改成 automatic 後可在沒有答案時發布';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;
    END;
END;
$$;

UPDATE question_parts
SET grading_policy = 'manual_review'
WHERE id = '09000000-0000-0000-0000-000000000062';
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000061';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

-- The deferred triggers allow an importer to write the answer before its
-- option as long as the final state is complete before publication.
INSERT INTO question_answers (id, question_part_id, answer_key)
VALUES ('09000000-0000-0000-0000-000000000073', '09000000-0000-0000-0000-000000000072', 'later-option');
INSERT INTO question_options (id, question_part_id, option_key, position)
VALUES ('09000000-0000-0000-0000-000000000074', '09000000-0000-0000-0000-000000000072', 'later-option', 0);
UPDATE question_revisions
SET status = 'published',
    published_at = transaction_timestamp()
WHERE id = '09000000-0000-0000-0000-000000000071';
SET CONSTRAINTS
    question_revisions_automatic_answer_check,
    question_answers_choice_option_check,
    question_options_choice_answer_check
IMMEDIATE;
SET CONSTRAINTS
    question_revisions_automatic_answer_check,
    question_answers_choice_option_check,
    question_options_choice_answer_check
DEFERRED;

-- Superseded is still frozen publication history and remains subject to the
-- same completeness contract.
UPDATE question_revisions
SET status = 'superseded'
WHERE id = '09000000-0000-0000-0000-000000000031';
SET CONSTRAINTS question_revisions_automatic_answer_check IMMEDIATE;
SET CONSTRAINTS question_revisions_automatic_answer_check DEFERRED;

-- Existing frozen-content protection and the new final-state contract together
-- prevent deleting the last reference answer or changing an unanswered frozen
-- part to automatic grading.
DO $$
DECLARE
    failure_message text;
BEGIN
    BEGIN
        DELETE FROM question_answers
        WHERE id = '09000000-0000-0000-0000-000000000016';
        RAISE EXCEPTION '已發布自動判分小題的最後答案可被刪除';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
            IF failure_message <> '已發布或已取代版本的內容、選項與答案不可修改' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        UPDATE question_parts
        SET grading_policy = 'automatic'
        WHERE id = '09000000-0000-0000-0000-000000000052';
        RAISE EXCEPTION '已發布無答案小題可改成 automatic';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
            IF failure_message <> '已發布或已取代版本的內容、選項與答案不可修改' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        UPDATE question_options
        SET position = 9
        WHERE id = '09000000-0000-0000-0000-000000000033';
        RAISE EXCEPTION '已取代版本的選項可被修改';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
            IF failure_message <> '已發布或已取代版本的內容、選項與答案不可修改' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        DELETE FROM question_answers
        WHERE id = '09000000-0000-0000-0000-000000000036';
        RAISE EXCEPTION '已取代版本的答案可被刪除';
    EXCEPTION
        WHEN check_violation THEN
            GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
            IF failure_message <> '已發布或已取代版本的內容、選項與答案不可修改' THEN
                RAISE;
            END IF;
    END;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;

\endif
