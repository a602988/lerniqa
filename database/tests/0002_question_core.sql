\set ON_ERROR_STOP on

DO $$
DECLARE
    expected_tables text[] := ARRAY[
        'difficulty_levels',
        'filter_field_option_scopes',
        'filter_field_options',
        'filter_field_scope_book_versions',
        'filter_field_scope_exam_levels',
        'filter_field_scope_grades',
        'filter_field_scope_semesters',
        'filter_field_scope_sources',
        'filter_field_scope_subjects',
        'filter_field_scopes',
        'filter_fields',
        'knowledge_points',
        'question_answers',
        'question_bank_items',
        'question_bank_learners',
        'question_banks',
        'question_content_blocks',
        'question_identifiers',
        'question_options',
        'question_parts',
        'question_revision_curriculum_codes',
        'question_revision_filter_values',
        'question_revision_knowledge_points',
        'question_revision_reviews',
        'question_revision_topics',
        'question_revision_units',
        'question_revisions',
        'question_types',
        'questions',
        'topics',
        'unit_knowledge_points',
        'unit_topics'
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

INSERT INTO question_types (id, code, name, supports_parts)
VALUES ('80000000-0000-0000-0000-000000000001', 'single_choice', '單一選擇題', false);

INSERT INTO difficulty_levels (id, code, name, sort_order)
VALUES ('81000000-0000-0000-0000-000000000001', 'basic', '基礎', 1);

INSERT INTO topics (id, subject_id, name, origin)
VALUES
    (
        '82000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-000000000001',
        '整數運算',
        'system'
    ),
    (
        '82000000-0000-0000-0000-000000000002',
        '50000000-0000-0000-0000-000000000001',
        '數線',
        'system'
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
    '50000000-0000-0000-0000-000000000004',
    'science',
    '自然科學',
    '自然科學',
    'group',
    'system'
);

INSERT INTO exam_programs (
    id,
    code,
    name,
    authority_name,
    source_reference,
    sort_order
)
VALUES
    (
        '82500000-0000-0000-0000-000000000001',
        'program_a',
        '考試體系 A',
        '測試機關',
        '測試來源 A',
        1
    ),
    (
        '82500000-0000-0000-0000-000000000002',
        'program_b',
        '考試體系 B',
        '測試機關',
        '測試來源 B',
        2
    );

INSERT INTO exam_program_levels (
    id,
    exam_program_id,
    code,
    name,
    sort_order
)
VALUES (
    '82600000-0000-0000-0000-000000000001',
    '82500000-0000-0000-0000-000000000001',
    'level_a',
    '級別 A',
    1
);

INSERT INTO source_categories (
    id,
    code,
    name,
    exam_program_id,
    sort_order
)
VALUES (
    '82700000-0000-0000-0000-000000000001',
    'program_b_source',
    '考試體系 B 題目',
    '82500000-0000-0000-0000-000000000002',
    1
);

INSERT INTO questions (
    id,
    origin,
    status,
    created_method
)
VALUES
    (
        '83000000-0000-0000-0000-000000000001',
        'system',
        'draft',
        'migration'
    ),
    (
        '83000000-0000-0000-0000-000000000002',
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
    difficulty_level_id,
    created_by_type
)
VALUES (
    '84000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
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
VALUES
    (
        '85000000-0000-0000-0000-000000000001',
        '84000000-0000-0000-0000-000000000001',
        'root',
        0,
        'single_choice',
        'automatic'
    ),
    (
        '85000000-0000-0000-0000-000000000002',
        '84000000-0000-0000-0000-000000000001',
        'extra',
        1,
        'text',
        'manual_review'
    );

INSERT INTO question_options (id, question_part_id, option_key, position)
VALUES
    (
        '86000000-0000-0000-0000-000000000001',
        '85000000-0000-0000-0000-000000000001',
        'A',
        0
    ),
    (
        '86000000-0000-0000-0000-000000000002',
        '85000000-0000-0000-0000-000000000001',
        'B',
        1
    );

INSERT INTO question_answers (
    id,
    question_part_id,
    answer_key
)
VALUES (
    '87000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    'A'
);

INSERT INTO question_content_blocks (
    id,
    question_revision_id,
    placement,
    content_type,
    position,
    text_content
)
VALUES (
    '88000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    'prompt',
    'text',
    0,
    '1 + 1 = ?'
);

INSERT INTO question_revision_topics (
    question_revision_id,
    topic_id,
    is_primary,
    value_source
)
VALUES (
    '84000000-0000-0000-0000-000000000001',
    '82000000-0000-0000-0000-000000000001',
    true,
    'migration'
);

INSERT INTO filter_fields (
    id,
    key,
    name,
    value_type,
    sort_order
)
VALUES
    (
        '89000000-0000-0000-0000-000000000001',
        'exam_round',
        '回次',
        'option',
        1
    ),
    (
        '89000000-0000-0000-0000-000000000002',
        'paper_variant',
        '卷別',
        'option',
        2
    ),
    (
        '89000000-0000-0000-0000-000000000003',
        'school_year',
        '學年度',
        'year',
        3
    );

INSERT INTO filter_field_scopes (
    id,
    filter_field_id,
    name
)
VALUES (
    '90000000-0000-0000-0000-000000000001',
    '89000000-0000-0000-0000-000000000001',
    '全域回次'
);

INSERT INTO filter_field_options (
    id,
    filter_field_id,
    value,
    label,
    sort_order
)
VALUES
    (
        '91000000-0000-0000-0000-000000000001',
        '89000000-0000-0000-0000-000000000001',
        'round_1',
        '第一回',
        1
    ),
    (
        '91000000-0000-0000-0000-000000000002',
        '89000000-0000-0000-0000-000000000002',
        'a',
        'A 卷',
        1
    );

INSERT INTO filter_field_option_scopes (
    filter_option_id,
    filter_field_scope_id
)
VALUES (
    '91000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001'
);

INSERT INTO question_revision_filter_values (
    id,
    question_revision_id,
    filter_field_id,
    filter_option_id,
    value_source,
    confidence
)
VALUES (
    '92000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    '89000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    'migration',
    1
);

UPDATE question_revisions
SET status = 'published', published_at = CURRENT_TIMESTAMP
WHERE id = '84000000-0000-0000-0000-000000000001';

UPDATE questions
SET
    current_revision_id = '84000000-0000-0000-0000-000000000001',
    status = 'published'
WHERE id = '83000000-0000-0000-0000-000000000001';

DO $$
BEGIN
    BEGIN
        UPDATE questions
        SET current_revision_id = '84000000-0000-0000-0000-000000000001'
        WHERE id = '83000000-0000-0000-0000-000000000002';
        SET CONSTRAINTS questions_current_revision_fk IMMEDIATE;
        RAISE EXCEPTION '其他題目的版本可被設為目前版本';
    EXCEPTION
        WHEN foreign_key_violation THEN
            SET CONSTRAINTS questions_current_revision_fk DEFERRED;
    END;

    BEGIN
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            subject_id,
            book_version_id,
            created_by_type
        )
        VALUES (
            '84000000-0000-0000-0000-000000000002',
            '83000000-0000-0000-0000-000000000002',
            1,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000002',
            '60000000-0000-0000-0000-000000000001',
            'migration'
        );
        RAISE EXCEPTION '題目科目與書籍版本不一致時未被拒絕';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            subject_id,
            created_by_type
        )
        VALUES (
            '84000000-0000-0000-0000-000000000003',
            '83000000-0000-0000-0000-000000000002',
            1,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000004',
            'migration'
        );
        RAISE EXCEPTION '題目版本可直接關聯群組科目';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            subject_id,
            exam_program_level_id,
            source_category_id,
            created_by_type
        )
        VALUES (
            '84000000-0000-0000-0000-000000000004',
            '83000000-0000-0000-0000-000000000002',
            1,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '82600000-0000-0000-0000-000000000001',
            '82700000-0000-0000-0000-000000000001',
            'migration'
        );
        RAISE EXCEPTION '考試級別與來源限定體系不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            subject_id,
            created_by_type
        )
        VALUES (
            '84000000-0000-0000-0000-000000000005',
            '83000000-0000-0000-0000-000000000002',
            1,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            'migration'
        );

        UPDATE questions
        SET current_revision_id = '84000000-0000-0000-0000-000000000005'
        WHERE id = '83000000-0000-0000-0000-000000000002';

        SET CONSTRAINTS questions_current_revision_status_check IMMEDIATE;
        RAISE EXCEPTION '草稿版本可被設為目前版本';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS questions_current_revision_status_check DEFERRED;
    END;

    BEGIN
        INSERT INTO question_answers (
            id,
            question_part_id,
            answer_key,
            accepted_value
        )
        VALUES (
            '87000000-0000-0000-0000-000000000002',
            '85000000-0000-0000-0000-000000000001',
            'A',
            '二'
        );
        RAISE EXCEPTION '參考答案同時使用兩種表示方式時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_content_blocks (
            id,
            question_revision_id,
            question_part_id,
            question_option_id,
            placement,
            content_type,
            position,
            text_content
        )
        VALUES (
            '88000000-0000-0000-0000-000000000002',
            '84000000-0000-0000-0000-000000000001',
            '85000000-0000-0000-0000-000000000002',
            '86000000-0000-0000-0000-000000000001',
            'option',
            'text',
            0,
            '錯誤配對'
        );
        RAISE EXCEPTION '選項內容可連到其他小題時未被拒絕';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revision_topics (
            question_revision_id,
            topic_id,
            is_primary,
            value_source
        )
        VALUES (
            '84000000-0000-0000-0000-000000000001',
            '82000000-0000-0000-0000-000000000002',
            true,
            'migration'
        );
        RAISE EXCEPTION '同一題目版本可設定多個主要主題';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO filter_field_option_scopes (
            filter_option_id,
            filter_field_scope_id
        )
        VALUES (
            '91000000-0000-0000-0000-000000000002',
            '90000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '不同欄位的選項與適用規則可互相連結';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO filter_field_options (
            id,
            filter_field_id,
            value,
            label,
            sort_order
        )
        VALUES (
            '91000000-0000-0000-0000-000000000003',
            '89000000-0000-0000-0000-000000000003',
            '113',
            '113 學年度',
            1
        );
        RAISE EXCEPTION '非選項型欄位可建立選項';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revision_filter_values (
            id,
            question_revision_id,
            filter_field_id,
            normalized_value,
            value_source
        )
        VALUES (
            '92000000-0000-0000-0000-000000000003',
            '84000000-0000-0000-0000-000000000001',
            '89000000-0000-0000-0000-000000000001',
            'round_1',
            'migration'
        );
        RAISE EXCEPTION '選項型欄位可直接保存文字值';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            decision,
            from_status,
            to_status
        )
        VALUES (
            '92500000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000001',
            'bootstrap_admin',
            'approved',
            'draft',
            'rejected'
        );
        RAISE EXCEPTION '審核決定與狀態轉換不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_revision_filter_values (
            id,
            question_revision_id,
            filter_field_id,
            filter_option_id,
            value_source
        )
        VALUES (
            '92000000-0000-0000-0000-000000000002',
            '84000000-0000-0000-0000-000000000001',
            '89000000-0000-0000-0000-000000000001',
            '91000000-0000-0000-0000-000000000002',
            'migration'
        );
        RAISE EXCEPTION '來源欄位值可使用其他欄位的選項';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_identifiers (
            id,
            question_id,
            identifier_type,
            publisher_id,
            value,
            normalized_value
        )
        VALUES (
            '93000000-0000-0000-0000-000000000001',
            '83000000-0000-0000-0000-000000000001',
            'legacy',
            '94000000-0000-0000-0000-000000000001',
            '1',
            '1'
        );
        RAISE EXCEPTION 'legacy 題號可保存出版社範圍';
    EXCEPTION
        WHEN check_violation THEN NULL;
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
    WHERE version = '0002' AND name = 'question_core';

    IF migration_count <> 1 THEN
        RAISE EXCEPTION '0002 migration 紀錄不正確';
    END IF;
END;
$$;
