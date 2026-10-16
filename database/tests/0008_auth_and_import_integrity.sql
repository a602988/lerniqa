\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    validity_definition text;
    validator_definition text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0008'
            AND name = 'auth_and_import_integrity'
    ) THEN
        RAISE EXCEPTION '缺少 0008 migration 紀錄';
    END IF;

    IF to_regclass('public.auth_sessions_active_learner_expiry_index') IS NULL THEN
        RAISE EXCEPTION '缺少 active learner session 查詢索引';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        WHERE trigger.tgname = 'learners_auth_sessions_check'
            AND trigger.tgdeferrable
            AND trigger.tginitdeferred
    ) THEN
        RAISE EXCEPTION '缺少可延後的 learner status session 限制 trigger';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        WHERE trigger.tgname = 'learners_auth_user_lock'
            AND NOT trigger.tgdeferrable
    ) THEN
        RAISE EXCEPTION '缺少 learner status advisory lock trigger';
    END IF;

    SELECT pg_get_functiondef(
        'lerniqa_auth_session_is_valid(uuid,character varying,uuid)'::regprocedure
    ) INTO validity_definition;
    IF validity_definition NOT LIKE '%learner.status = ''active''%'
        OR validity_definition LIKE '%access.access_role%'
        OR validity_definition NOT LIKE '%session_learner_id IS NULL%' THEN
        RAISE EXCEPTION 'auth session validity 未保持 active/optional learner 與 access role 邊界';
    END IF;

    SELECT pg_get_functiondef('lerniqa_validate_auth_session()'::regprocedure)
    INTO validator_definition;
    IF validator_definition NOT LIKE '%lerniqa_lock_auth_user%'
        OR validator_definition NOT LIKE '%lerniqa_lock_auth_learner%'
        OR strpos(validator_definition, 'lerniqa_lock_auth_user')
            > strpos(validator_definition, 'lerniqa_lock_auth_learner') THEN
        RAISE EXCEPTION 'auth session validator 未依 user 後 learner 的順序取得鎖';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_revision_units AS revision_unit
        JOIN question_revisions AS revision
            ON revision.id = revision_unit.question_revision_id
        JOIN source_categories AS source_category
            ON source_category.id = revision.source_category_id
        JOIN import_items AS import_item
            ON import_item.question_revision_id = revision.id
        JOIN import_batches AS import_batch
            ON import_batch.id = import_item.import_batch_id
        WHERE import_batch.id = '2d1ff794-f6f4-5e59-baaa-8d1c767438be'
            AND import_batch.status = 'confirmed'
            AND source_category.code = 'publisher-test-bank'
            AND revision_unit.assignment_type = 'manual_classification'
            AND revision_unit.value_source = 'user'
    ) THEN
        RAISE EXCEPTION 'publisher-test-bank 仍有舊的 manual/user 單元分類';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '07800000-0000-0000-0000-000000000009'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'native'
            AND value_source = 'document'
    ) THEN
        RAISE EXCEPTION '0008 沒有實際升級既有 confirmed Hanlin batch 的 manual/user 單元分類';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '07800000-0000-0000-0000-000000000014'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'native'
            AND value_source = 'document'
    ) THEN
        RAISE EXCEPTION '0008 改寫了同一 confirmed Hanlin batch 中既有的 native/document 分類';
    END IF;

    -- Both fixture rows were inserted by the same pre-0008 transaction. Only
    -- the legacy row should receive a new tuple version during the repair.
    IF EXISTS (
        SELECT 1
        FROM question_revision_units AS repaired
        CROSS JOIN question_revision_units AS existing_native
        WHERE repaired.question_revision_id = '07800000-0000-0000-0000-000000000009'
            AND repaired.curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND existing_native.question_revision_id = '07800000-0000-0000-0000-000000000014'
            AND existing_native.curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND repaired.xmin = existing_native.xmin
    ) THEN
        RAISE EXCEPTION '0008 對同批次既有 native/document 分類執行了不必要的 UPDATE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '07800000-0000-0000-0000-000000000011'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'manual_classification'
            AND value_source = 'user'
    ) THEN
        RAISE EXCEPTION '0008 改寫了 confirmed Hanlin batch 以外的分類';
    END IF;
END;
$$;

INSERT INTO users (id, display_name)
VALUES ('08000000-0000-0000-0000-000000000001', '0008 登入驗證帳號');

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type
)
VALUES (
    '08000000-0000-0000-0000-000000000002',
    '08000000-0000-0000-0000-000000000001',
    'learner',
    'bootstrap_admin'
);

INSERT INTO learners (
    id,
    display_name,
    education_status
)
VALUES (
    '08000000-0000-0000-0000-000000000003',
    '0008 狀態驗證學習者',
    'not_enrolled'
);

-- access_role describes the relationship to the learner. It is deliberately
-- different from the active application role and must not invalidate login.
INSERT INTO learner_access (
    id,
    learner_id,
    user_id,
    access_role,
    accepted_at
)
VALUES (
    '08000000-0000-0000-0000-000000000004',
    '08000000-0000-0000-0000-000000000003',
    '08000000-0000-0000-0000-000000000001',
    'tutor',
    CURRENT_TIMESTAMP
);

INSERT INTO auth_sessions (
    id,
    user_id,
    token_hash,
    active_role,
    active_learner_id,
    expires_at
)
VALUES
    (
        '08000000-0000-0000-0000-000000000005',
        '08000000-0000-0000-0000-000000000001',
        '0008-active-learner-session',
        'learner',
        '08000000-0000-0000-0000-000000000003',
        CURRENT_TIMESTAMP + interval '1 day'
    ),
    (
        '08000000-0000-0000-0000-000000000006',
        '08000000-0000-0000-0000-000000000001',
        '0008-optional-learner-session',
        'learner',
        NULL,
        CURRENT_TIMESTAMP + interval '1 day'
    );

DO $$
BEGIN
    IF NOT lerniqa_auth_session_is_valid(
        '08000000-0000-0000-0000-000000000001',
        'learner',
        '08000000-0000-0000-0000-000000000003'
    ) THEN
        RAISE EXCEPTION 'access role 不同時有效 learner session 被拒絕';
    END IF;

    IF NOT lerniqa_auth_session_is_valid(
        '08000000-0000-0000-0000-000000000001',
        'learner',
        NULL
    ) THEN
        RAISE EXCEPTION 'active_learner_id 的 optional 契約被移除';
    END IF;

    BEGIN
        UPDATE learners
        SET status = 'archived'
        WHERE id = '08000000-0000-0000-0000-000000000003';

        SET CONSTRAINTS learners_auth_sessions_check IMMEDIATE;
        RAISE EXCEPTION '學習者封存時可保留指向該學習者的有效 session';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learners_auth_sessions_check DEFERRED;
    END;
END;
$$;

UPDATE auth_sessions
SET revoked_at = CURRENT_TIMESTAMP
WHERE id = '08000000-0000-0000-0000-000000000005';

UPDATE learners
SET status = 'archived'
WHERE id = '08000000-0000-0000-0000-000000000003';

SET CONSTRAINTS learners_auth_sessions_check IMMEDIATE;
SET CONSTRAINTS learners_auth_sessions_check DEFERRED;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        WHERE session.id = '08000000-0000-0000-0000-000000000006'
            AND session.active_learner_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'optional learner session 被非預期改寫';
    END IF;

    BEGIN
        INSERT INTO auth_sessions (
            id,
            user_id,
            token_hash,
            active_role,
            active_learner_id,
            expires_at
        )
        VALUES (
            '08000000-0000-0000-0000-000000000007',
            '08000000-0000-0000-0000-000000000001',
            '0008-archived-learner-session',
            'learner',
            '08000000-0000-0000-0000-000000000003',
            CURRENT_TIMESTAMP + interval '1 day'
        );
        RAISE EXCEPTION '封存學習者仍可建立有效 session';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

ROLLBACK;

-- Simulate a native/document classification created after 0008 was applied.
-- Its row must survive a later schema rollback unchanged.
BEGIN;

INSERT INTO questions (
    id,
    origin,
    status,
    created_method,
    created_by_user_id
)
VALUES (
    '08000000-0000-0000-0000-000000000008',
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
VALUES (
    '08000000-0000-0000-0000-000000000009',
    '08000000-0000-0000-0000-000000000008',
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
VALUES (
    '08000000-0000-0000-0000-000000000010',
    '2d1ff794-f6f4-5e59-baaa-8d1c767438be',
    '07800000-0000-0000-0000-000000000007',
    2,
    '{}'::jsonb,
    'approved',
    '08000000-0000-0000-0000-000000000008',
    '08000000-0000-0000-0000-000000000009',
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
VALUES (
    '08000000-0000-0000-0000-000000000009',
    '07800000-0000-0000-0000-000000000003',
    'native',
    true,
    'document',
    1
);

COMMIT;
