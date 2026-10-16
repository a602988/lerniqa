\set ON_ERROR_STOP on

DO $$
DECLARE
    expected_tables text[] := ARRAY[
        'answer_attempts',
        'answer_part_assets',
        'answer_part_results',
        'answer_reviews',
        'exam_subject_ranges',
        'exams',
        'learner_practice_queue_items',
        'practice_plan_difficulty_mix',
        'practice_plan_items',
        'practice_plans',
        'practice_schedule_items',
        'practice_schedules',
        'practice_session_item_origins',
        'practice_session_items',
        'practice_sessions'
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

DO $$
DECLARE
    migration_count integer;
BEGIN
    SELECT count(*)
    INTO migration_count
    FROM schema_migrations
    WHERE version = '0004'
      AND name = 'practice_and_attempts';

    IF migration_count <> 1 THEN
        RAISE EXCEPTION '0004 migration 紀錄不正確';
    END IF;
END;
$$;

INSERT INTO curriculum_units (
    id,
    subject_id,
    grade_id,
    semester_id,
    book_version_id,
    unit_type,
    code,
    name,
    position
)
VALUES
    (
        'b0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001',
        'chapter',
        'chapter-1',
        '第一章',
        0
    ),
    (
        'b0000000-0000-0000-0000-000000000003',
        '50000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '60000000-0000-0000-0000-000000000001',
        'chapter',
        'chapter-2',
        '第二章',
        1
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
    position
)
VALUES (
    'b0000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'section',
    'section-1',
    '第一節',
    0
);

INSERT INTO exams (
    id,
    learner_id,
    name,
    exam_date,
    created_by_user_id
)
VALUES
    (
        'b1000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        '期中考',
        CURRENT_DATE + 14,
        '00000000-0000-0000-0000-000000000001'
    ),
    (
        'b1000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000003',
        '其他學習者考試',
        CURRENT_DATE + 21,
        '00000000-0000-0000-0000-000000000001'
    );

UPDATE learner_preferences
SET active_exam_id = 'b1000000-0000-0000-0000-000000000001'
WHERE learner_id = '30000000-0000-0000-0000-000000000001';

INSERT INTO exam_subject_ranges (
    id,
    exam_id,
    subject_id,
    book_version_id,
    start_unit_id,
    end_unit_id
)
VALUES (
    'b2000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000002'
);

INSERT INTO practice_plans (
    id,
    learner_id,
    created_by_user_id,
    created_role,
    name,
    is_default,
    basis,
    exam_id,
    check_mode,
    question_limit,
    selection_mode,
    difficulty_mix_enabled
)
VALUES (
    'b3000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'tutor',
    '期中考練習',
    true,
    'assessment',
    'b1000000-0000-0000-0000-000000000001',
    'instant',
    10,
    'fixed',
    true
);

INSERT INTO practice_plan_difficulty_mix (
    practice_plan_id,
    difficulty_level_id,
    percentage
)
VALUES (
    'b3000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    100
);

INSERT INTO practice_plan_items (
    id,
    practice_plan_id,
    question_id,
    question_revision_id,
    question_part_id,
    position
)
VALUES (
    'b4000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    0
);

INSERT INTO practice_schedules (
    id,
    learner_id,
    practice_plan_id,
    name,
    scheduled_for,
    check_mode,
    created_by_user_id
)
VALUES (
    'b5000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    '週末練習',
    CURRENT_TIMESTAMP + INTERVAL '2 days',
    'instant',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO practice_schedule_items (
    id,
    practice_schedule_id,
    question_id,
    question_revision_id,
    question_part_id,
    position,
    reason
)
VALUES (
    'b6000000-0000-0000-0000-000000000001',
    'b5000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    0,
    'selected'
);

INSERT INTO practice_sessions (
    id,
    practice_plan_id,
    practice_schedule_id,
    learner_id,
    created_by_user_id,
    mode,
    check_mode
)
VALUES (
    'b7000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000001',
    'b5000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'practice',
    'instant'
);

INSERT INTO practice_session_items (
    id,
    practice_session_id,
    question_id,
    question_revision_id,
    question_part_id,
    position,
    selection_reason
)
VALUES (
    'b8000000-0000-0000-0000-000000000001',
    'b7000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    0,
    'fixed'
);

INSERT INTO answer_attempts (
    id,
    practice_session_item_id,
    learner_id,
    attempt_number,
    idempotency_key,
    overall_result,
    grading_source,
    duration_seconds
)
VALUES (
    'b9000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    1,
    'attempt-1',
    'wrong',
    'automatic',
    18
);

INSERT INTO answer_part_results (
    id,
    answer_attempt_id,
    question_part_id,
    answer_payload,
    initial_result,
    current_result,
    grading_source
)
VALUES (
    'ba000000-0000-0000-0000-000000000001',
    'b9000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    '{"optionKey":"B"}'::jsonb,
    'wrong',
    'wrong',
    'automatic'
);

INSERT INTO assets (
    id,
    storage_key,
    mime_type,
    byte_size,
    checksum,
    purpose,
    scan_status
)
VALUES (
    'bb000000-0000-0000-0000-000000000001',
    'tests/handwriting.png',
    'image/png',
    400,
    'handwriting-checksum',
    'handwriting',
    'clean'
);

INSERT INTO answer_part_assets (
    answer_part_result_id,
    asset_id,
    asset_role
)
VALUES (
    'ba000000-0000-0000-0000-000000000001',
    'bb000000-0000-0000-0000-000000000001',
    'handwriting'
);

INSERT INTO answer_reviews (
    id,
    answer_part_result_id,
    reviewer_user_id,
    result,
    reason
)
VALUES (
    'bc000000-0000-0000-0000-000000000001',
    'ba000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'wrong',
    '答案與參考答案不符'
);

INSERT INTO learner_practice_queue_items (
    id,
    learner_id,
    question_id,
    question_revision_id,
    question_part_id,
    reason,
    source_answer_part_result_id
)
VALUES (
    'bd000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    'wrong_review',
    'ba000000-0000-0000-0000-000000000001'
);

INSERT INTO practice_session_item_origins (
    id,
    practice_session_item_id,
    source_answer_part_result_id,
    queue_item_id,
    relation_kind
)
VALUES (
    'be000000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000001',
    'ba000000-0000-0000-0000-000000000001',
    'bd000000-0000-0000-0000-000000000001',
    'wrong_review'
);

DO $$
BEGIN
    BEGIN
        UPDATE learner_preferences
        SET active_exam_id = 'b1000000-0000-0000-0000-000000000002'
        WHERE learner_id = '30000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '學習偏好引用其他學習者考試時未被拒絕';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO exam_subject_ranges (
            id,
            exam_id,
            subject_id,
            book_version_id,
            start_unit_id,
            end_unit_id
        )
        VALUES (
            'b2000000-0000-0000-0000-000000000002',
            'b1000000-0000-0000-0000-000000000002',
            '50000000-0000-0000-0000-000000000001',
            '60000000-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-000000000003'
        );
        RAISE EXCEPTION '考試起訖單元跨教材樹時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO answer_attempts (
            id,
            practice_session_item_id,
            learner_id,
            attempt_number,
            idempotency_key,
            overall_result,
            grading_source
        )
        VALUES (
            'b9000000-0000-0000-0000-000000000002',
            'b8000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000003',
            2,
            'attempt-invalid-learner',
            'pending',
            'manual_review'
        );
        RAISE EXCEPTION '作答學習者與練習工作階段不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO answer_part_results (
            id,
            answer_attempt_id,
            question_part_id,
            answer_payload,
            initial_result,
            current_result,
            grading_source
        )
        VALUES (
            'ba000000-0000-0000-0000-000000000002',
            'b9000000-0000-0000-0000-000000000001',
            '85000000-0000-0000-0000-000000000002',
            '{"text":"測試"}'::jsonb,
            'pending',
            'pending',
            'manual_review'
        );
        RAISE EXCEPTION '作答超出練習項目指定小題時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO answer_part_assets (
            answer_part_result_id,
            asset_id,
            asset_role
        )
        VALUES (
            'ba000000-0000-0000-0000-000000000001',
            'a0000000-0000-0000-0000-000000000002',
            'handwriting'
        );
        RAISE EXCEPTION '手寫角色引用非手寫檔案時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO learner_practice_queue_items (
            id,
            learner_id,
            question_id,
            question_revision_id,
            reason,
            source_answer_part_result_id,
            match_basis,
            matched_subject_id
        )
        VALUES (
            'bd000000-0000-0000-0000-000000000002',
            '30000000-0000-0000-0000-000000000001',
            '83000000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000001',
            'similar_review',
            'ba000000-0000-0000-0000-000000000001',
            'same_topic',
            '50000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '相近題依據與對應外鍵不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO learner_practice_queue_items (
            id,
            learner_id,
            question_id,
            question_revision_id,
            reason,
            source_answer_part_result_id
        )
        VALUES (
            'bd000000-0000-0000-0000-000000000003',
            '30000000-0000-0000-0000-000000000003',
            '83000000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000001',
            'wrong_review',
            'ba000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '後續練習引用其他學習者作答時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO answer_attempts (
            id,
            practice_session_item_id,
            learner_id,
            attempt_number,
            idempotency_key,
            overall_result,
            grading_source
        )
        VALUES (
            'b9000000-0000-0000-0000-000000000003',
            'b8000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000001',
            2,
            'attempt-invalid-source',
            'pending',
            'ai_assisted'
        );
        RAISE EXCEPTION '舊 grading_source 字串未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;
