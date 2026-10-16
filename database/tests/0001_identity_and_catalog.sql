\set ON_ERROR_STOP on

DO $$
DECLARE
    expected_tables text[] := ARRAY[
        'account_identities',
        'assets',
        'auth_sessions',
        'book_versions',
        'curriculum_codes',
        'curriculum_units',
        'exam_program_levels',
        'exam_programs',
        'grade_subjects',
        'grades',
        'learner_access',
        'learner_preferences',
        'learner_subject_settings',
        'learners',
        'publishers',
        'role_pin_credentials',
        'schema_migrations',
        'seed_manifests',
        'semesters',
        'source_categories',
        'source_category_dimensions',
        'subject_aliases',
        'subjects',
        'user_roles',
        'users',
        'verification_challenges'
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

INSERT INTO users (id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', '測試帳號');

INSERT INTO grades (id, stage, code, name, sort_order)
VALUES ('10000000-0000-0000-0000-000000000001', 'junior_high', 'junior_high_1', '國一', 1);

INSERT INTO semesters (id, code, name, sort_order)
VALUES ('20000000-0000-0000-0000-000000000001', 'first', '上學期', 1);

INSERT INTO subjects (
    id,
    code,
    name,
    normalized_name,
    origin
)
VALUES
    (
        '50000000-0000-0000-0000-000000000001',
        'math',
        '數學',
        '數學',
        'system'
    ),
    (
        '50000000-0000-0000-0000-000000000002',
        'chinese',
        '國文',
        '國文',
        'system'
    );

INSERT INTO book_versions (
    id,
    subject_id,
    grade_id,
    name,
    origin
)
VALUES (
    '60000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '數學測試版',
    'system'
);

INSERT INTO learners (
    id,
    display_name,
    education_status,
    grade_id,
    semester_id
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '測試學習者',
    'enrolled',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001'
);

INSERT INTO learners (
    id,
    display_name,
    education_status,
    grade_id,
    semester_id
)
VALUES (
    '30000000-0000-0000-0000-000000000003',
    '題數限制測試',
    'enrolled',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001'
);

INSERT INTO learner_preferences (
    learner_id,
    question_limit_options,
    default_question_limit
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    ARRAY[10, 20, 30]::smallint[],
    20
);

DO $$
BEGIN
    BEGIN
        INSERT INTO learners (
            id,
            display_name,
            education_status
        )
        VALUES (
            '30000000-0000-0000-0000-000000000002',
            '缺少年級',
            'enrolled'
        );
        RAISE EXCEPTION '在學學習者缺少年級時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO learner_subject_settings (
            id,
            learner_id,
            subject_id,
            book_version_id,
            position
        )
        VALUES (
            '70000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000002',
            '60000000-0000-0000-0000-000000000001',
            1
        );
        RAISE EXCEPTION '科目與書籍版本不一致時未被拒絕';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO subjects (
            id,
            code,
            name,
            normalized_name,
            origin
        )
        VALUES (
            '50000000-0000-0000-0000-000000000003',
            'invalid-account-subject',
            '缺少所有者',
            '缺少所有者',
            'account'
        );
        RAISE EXCEPTION '帳號自訂科目缺少所有者時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO learner_preferences (
            learner_id,
            question_limit_options,
            default_question_limit
        )
        VALUES (
            '30000000-0000-0000-0000-000000000003',
            ARRAY[10, 10]::smallint[],
            10
        );
        RAISE EXCEPTION '重複題數選項未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO account_identities (
            id,
            user_id,
            provider,
            provider_subject
        )
        VALUES (
            '40000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001',
            'email',
            'test@example.com'
        );
        RAISE EXCEPTION '缺少密碼雜湊的電子郵件身份未被拒絕';
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
    WHERE version = '0001' AND name = 'identity_and_catalog';

    IF migration_count <> 1 THEN
        RAISE EXCEPTION 'migration 紀錄不正確';
    END IF;
END;
$$;
