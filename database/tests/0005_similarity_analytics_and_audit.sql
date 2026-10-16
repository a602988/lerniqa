\set ON_ERROR_STOP on

DO $$
DECLARE
    expected_tables text[] := ARRAY[
        'admin_audit_logs',
        'analytics_jobs',
        'analytics_outbox',
        'analytics_privacy_policies',
        'data_erasure_requests',
        'learner_daily_stats',
        'learner_part_stats',
        'learner_question_stats',
        'learner_similarity_group_stats',
        'question_daily_stats',
        'question_generation_relations',
        'question_similarity_candidates',
        'question_similarity_groups',
        'question_similarity_memberships'
    ];
    missing_tables text[];
    migration_count integer;
BEGIN
    SELECT array_agg(expected_table ORDER BY expected_table)
    INTO missing_tables
    FROM unnest(expected_tables) AS expected_table
    WHERE to_regclass('public.' || expected_table) IS NULL;

    IF missing_tables IS NOT NULL THEN
        RAISE EXCEPTION '缺少 0005 資料表：%', missing_tables;
    END IF;

    IF to_regclass('public.question_similarity_candidates_right_revision_index') IS NULL THEN
        RAISE EXCEPTION '缺少相近題候選 right revision 查詢索引';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'learner_practice_queue_items'
            AND column_name = 'similarity_group_id'
            AND is_nullable = 'YES'
            AND data_type = 'uuid'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'practice_session_item_origins'
            AND column_name = 'similarity_group_id'
            AND is_nullable = 'YES'
            AND data_type = 'uuid'
    ) THEN
        RAISE EXCEPTION '相近題佇列或來源追溯欄位不完整';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'curriculum_units'
            AND column_name = 'origin'
            AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'curriculum_units'
            AND column_name = 'owner_user_id'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'source_categories'
            AND column_name = 'origin'
            AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'source_categories'
            AND column_name = 'owner_user_id'
    ) THEN
        RAISE EXCEPTION '教材單元或題目來源的所有權欄位不完整';
    END IF;

    SELECT count(*)
    INTO migration_count
    FROM schema_migrations
    WHERE version = '0005'
        AND name = 'similarity_analytics_and_audit';

    IF migration_count <> 1 THEN
        RAISE EXCEPTION '0005 migration 紀錄不正確';
    END IF;
END;
$$;

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM learner_practice_queue_items AS queue
        JOIN practice_session_item_origins AS origin
            ON origin.queue_item_id = queue.id
        JOIN practice_session_items AS item
            ON item.id = origin.practice_session_item_id
        WHERE queue.id = 'bd000000-0000-0000-0000-000000000001'
            AND origin.id = 'be000000-0000-0000-0000-000000000001'
            AND queue.status = 'consumed'
            AND queue.consumed_at = origin.created_at
            AND item.selection_reason = origin.relation_kind
    ) THEN
        RAISE EXCEPTION '0004 待處理佇列與練習來源未被正確升級';
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
    'f1000000-0000-0000-0000-000000000001',
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
    status,
    created_by_type,
    published_at
)
VALUES (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    1,
    '80000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'draft',
    'migration',
    NULL
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
    'f3000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'root',
    0,
    'text',
    'manual_review'
);

INSERT INTO question_revision_topics (
    question_revision_id,
    topic_id,
    is_primary,
    value_source
)
VALUES (
    'f2000000-0000-0000-0000-000000000001',
    '82000000-0000-0000-0000-000000000001',
    true,
    'migration'
);

INSERT INTO question_revision_reviews (
    id,
    question_revision_id,
    reviewer_type,
    decision,
    from_status,
    to_status
)
VALUES (
    'f2500000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'bootstrap_admin',
    'approved',
    'draft',
    'published'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    action,
    target_type,
    target_id,
    before_data,
    after_data,
    request_id
)
VALUES (
    'f2600000-0000-0000-0000-000000000001',
    'bootstrap_admin',
    'system_question_revision_status_changed',
    'question_revision',
    'f2000000-0000-0000-0000-000000000001',
    '{"status":"draft"}'::jsonb,
    '{"status":"published"}'::jsonb,
    '0005-system-revision-publish'
);

UPDATE question_revisions
SET status = 'published', published_at = CURRENT_TIMESTAMP
WHERE id = 'f2000000-0000-0000-0000-000000000001';

UPDATE questions
SET current_revision_id = 'f2000000-0000-0000-0000-000000000001',
    status = 'published'
WHERE id = 'f1000000-0000-0000-0000-000000000001';

INSERT INTO question_similarity_groups (
    id,
    name,
    status,
    created_source,
    method_version,
    created_by_user_id,
    confirmed_by_user_id,
    confirmed_at
)
VALUES (
    'f4000000-0000-0000-0000-000000000001',
    '合成相近題群組',
    'confirmed',
    'rule',
    'test-rule-v1',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    CURRENT_TIMESTAMP
);

INSERT INTO question_similarity_memberships (
    similarity_group_id,
    question_id,
    based_on_revision_id,
    status,
    evidence,
    confidence,
    reviewed_by_user_id,
    reviewed_at
)
VALUES
    (
        'f4000000-0000-0000-0000-000000000001',
        '83000000-0000-0000-0000-000000000001',
        '84000000-0000-0000-0000-000000000001',
        'confirmed',
        '{"reason":"same_topic"}'::jsonb,
        0.900,
        '00000000-0000-0000-0000-000000000001',
        CURRENT_TIMESTAMP
    ),
    (
        'f4000000-0000-0000-0000-000000000001',
        'f1000000-0000-0000-0000-000000000001',
        'f2000000-0000-0000-0000-000000000001',
        'confirmed',
        '{"reason":"same_topic"}'::jsonb,
        0.900,
        '00000000-0000-0000-0000-000000000001',
        CURRENT_TIMESTAMP
    );

INSERT INTO question_similarity_candidates (
    id,
    left_question_revision_id,
    right_question_revision_id,
    method_key,
    method_version,
    similarity_score,
    evidence
)
VALUES (
    'f5000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'same-topic-rule',
    '1',
    0.75000,
    '{"topic":"82000000-0000-0000-0000-000000000001"}'::jsonb
);

INSERT INTO question_generation_relations (
    source_question_id,
    generated_question_id,
    method_version
)
VALUES (
    '83000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'test-generator-v1'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO question_similarity_groups (
            id,
            status,
            created_source
        )
        VALUES (
            'f4000000-0000-0000-0000-000000000002',
            'pending',
            'ai'
        );
        RAISE EXCEPTION 'AI 群組缺少 method_version 時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_similarity_groups (
            id,
            status,
            created_source,
            confirmed_by_user_id,
            confirmed_at
        )
        VALUES (
            'f4000000-0000-0000-0000-000000000003',
            'confirmed',
            'manual',
            NULL,
            NULL
        );
        RAISE EXCEPTION '已確認群組缺少確認者與時間時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_similarity_candidates (
            id,
            left_question_revision_id,
            right_question_revision_id,
            method_key,
            method_version,
            similarity_score,
            evidence
        )
        VALUES (
            'f5000000-0000-0000-0000-000000000002',
            'f2000000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000001',
            'reverse-pair',
            '1',
            0.5,
            '{}'::jsonb
        );
        RAISE EXCEPTION '相近題候選 UUID 順序錯誤時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_similarity_candidates (
            id,
            left_question_revision_id,
            right_question_revision_id,
            method_key,
            method_version,
            similarity_score,
            evidence
        )
        VALUES (
            'f5000000-0000-0000-0000-000000000003',
            '84000000-0000-0000-0000-000000000001',
            'f2000000-0000-0000-0000-000000000001',
            'review-state',
            '1',
            1.2,
            '{}'::jsonb
        );
        RAISE EXCEPTION '相近題候選分數超出範圍時未被拒絕';
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
            change_note,
            status,
            created_by_type
        )
        VALUES (
            '84000000-0000-0000-0000-000000000002',
            '83000000-0000-0000-0000-000000000001',
            2,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '驗證同一穩定題目不可建立相近候選',
            'draft',
            'migration'
        );

        INSERT INTO question_similarity_candidates (
            id,
            left_question_revision_id,
            right_question_revision_id,
            method_key,
            method_version,
            evidence
        )
        VALUES (
            'f5000000-0000-0000-0000-000000000004',
            '84000000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000002',
            'same-question-revisions',
            '1',
            '{}'::jsonb
        );
        RAISE EXCEPTION '同一題目的兩個版本可被建立為相近題候選';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_similarity_memberships (
            similarity_group_id,
            question_id,
            based_on_revision_id,
            status,
            reviewed_by_user_id,
            reviewed_at
        )
        VALUES (
            'f4000000-0000-0000-0000-000000000001',
            '83000000-0000-0000-0000-000000000002',
            '84000000-0000-0000-0000-000000000001',
            'confirmed',
            '00000000-0000-0000-0000-000000000001',
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION '成員判定版本屬於其他題目時未被拒絕';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_generation_relations (
            source_question_id,
            generated_question_id,
            method_version
        )
        VALUES (
            '83000000-0000-0000-0000-000000000001',
            '83000000-0000-0000-0000-000000000001',
            'self'
        );
        RAISE EXCEPTION '題目可被記為自己的生成來源';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO users (id, display_name)
VALUES ('f0000000-0000-0000-0000-000000000002', '非管理員測試帳號');

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type
)
VALUES (
    'f0000000-0000-0000-0000-000000000003',
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
    request_id
)
VALUES (
    'f0000000-0000-0000-0000-000000000004',
    'bootstrap_admin',
    'admin_role_granted',
    'user_role',
    'f0000000-0000-0000-0000-000000000003',
    '0005-bootstrap-admin-role'
);

INSERT INTO users (id, display_name)
VALUES
    ('fc100000-0000-0000-0000-000000000001', '管理員授權目標'),
    ('fc100000-0000-0000-0000-000000000005', '管理員授權負向目標');

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type,
    granted_by_user_id
)
VALUES (
    'fc100000-0000-0000-0000-000000000002',
    'fc100000-0000-0000-0000-000000000001',
    'system_admin',
    'user',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    request_id
)
VALUES (
    'fc100000-0000-0000-0000-000000000003',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'admin_role_granted',
    'user_role',
    'fc100000-0000-0000-0000-000000000002',
    '0005-user-admin-grant'
);

DO $$
BEGIN
    BEGIN
        UPDATE user_roles
        SET granted_at = granted_at + INTERVAL '1 second'
        WHERE id = 'fc100000-0000-0000-0000-000000000002';
        RAISE EXCEPTION 'system_admin 授權證據可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE user_roles
        SET revoked_by_type = 'user',
            revoked_by_user_id = 'f0000000-0000-0000-0000-000000000002',
            revoked_at = CURRENT_TIMESTAMP
        WHERE id = 'fc100000-0000-0000-0000-000000000002';
        RAISE EXCEPTION '非 system_admin 可撤銷 system_admin';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO user_roles (
            id,
            user_id,
            role,
            granted_by_type,
            granted_by_user_id
        )
        VALUES (
            'fc100000-0000-0000-0000-000000000006',
            'fc100000-0000-0000-0000-000000000005',
            'system_admin',
            'user',
            'f0000000-0000-0000-0000-000000000002'
        );
        RAISE EXCEPTION '非 system_admin 可授予 system_admin';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO user_roles (
            id,
            user_id,
            role,
            granted_by_type
        )
        VALUES (
            'fc100000-0000-0000-0000-000000000007',
            'fc100000-0000-0000-0000-000000000005',
            'system_admin',
            'bootstrap_admin'
        );
        SET CONSTRAINTS user_roles_system_admin_audit_check IMMEDIATE;
        RAISE EXCEPTION 'system_admin 授權可缺少同交易管理員稽核';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS user_roles_system_admin_audit_check DEFERRED;
    END;

    BEGIN
        INSERT INTO user_roles (
            id,
            user_id,
            role,
            granted_by_type,
            revoked_by_type,
            revoked_at
        )
        VALUES (
            'fc100000-0000-0000-0000-000000000008',
            'fc100000-0000-0000-0000-000000000005',
            'parent',
            'bootstrap_admin',
            'bootstrap_admin',
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION '角色授權可直接以已撤銷狀態建立';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE user_roles
        SET revoked_by_type = 'user',
            revoked_by_user_id = '00000000-0000-0000-0000-000000000001',
            revoked_at = CURRENT_TIMESTAMP
        WHERE id = 'fc100000-0000-0000-0000-000000000002';
        SET CONSTRAINTS user_roles_system_admin_audit_check IMMEDIATE;
        RAISE EXCEPTION 'system_admin 撤銷可缺少同交易管理員稽核';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS user_roles_system_admin_audit_check DEFERRED;
    END;
END;
$$;

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    request_id
)
VALUES (
    'fc100000-0000-0000-0000-000000000004',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'admin_role_revoked',
    'user_role',
    'fc100000-0000-0000-0000-000000000002',
    '0005-user-admin-revoke'
);

UPDATE user_roles
SET revoked_by_type = 'user',
    revoked_by_user_id = '00000000-0000-0000-0000-000000000001',
    revoked_at = CURRENT_TIMESTAMP
WHERE id = 'fc100000-0000-0000-0000-000000000002';

DO $$
BEGIN
    BEGIN
        UPDATE user_roles
        SET revoked_by_type = NULL,
            revoked_by_user_id = NULL,
            revoked_at = NULL
        WHERE id = 'fc100000-0000-0000-0000-000000000002';
        RAISE EXCEPTION '已撤銷的 system_admin 可恢復';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM user_roles
        WHERE id = 'fc100000-0000-0000-0000-000000000002';
        RAISE EXCEPTION '角色授權歷史可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'user_roles_auth_user_lock'
            AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'learner_access_auth_user_lock'
            AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'users_auth_user_lock'
            AND NOT tgisinternal
    ) OR position(
        'lerniqa_lock_auth_user'
        IN pg_get_functiondef('lerniqa_validate_auth_session()'::regprocedure)
    ) = 0 THEN
        RAISE EXCEPTION 'auth session 與權限異動未共用 user-key transaction lock';
    END IF;
END;
$$;

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type
)
VALUES (
    'fc000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'parent',
    'bootstrap_admin'
);

INSERT INTO learner_access (
    id,
    learner_id,
    user_id,
    access_role,
    accepted_at
)
VALUES (
    'fc000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'parent',
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
VALUES (
    'fc000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '0005-valid-session-token-hash',
    'parent',
    '30000000-0000-0000-0000-000000000001',
    CURRENT_TIMESTAMP + INTERVAL '1 hour'
);

INSERT INTO users (id, display_name, status)
VALUES (
    'fc000000-0000-0000-0000-000000000005',
    '停權工作階段測試帳號',
    'suspended'
);

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type
)
VALUES (
    'fc000000-0000-0000-0000-000000000006',
    'fc000000-0000-0000-0000-000000000005',
    'learner',
    'bootstrap_admin'
);

INSERT INTO learner_access (
    id,
    learner_id,
    user_id,
    access_role,
    accepted_at
)
VALUES (
    'fc000000-0000-0000-0000-000000000007',
    '30000000-0000-0000-0000-000000000003',
    'fc000000-0000-0000-0000-000000000005',
    'learner',
    CURRENT_TIMESTAMP
);

DO $$
BEGIN
    BEGIN
        INSERT INTO auth_sessions (
            id,
            user_id,
            token_hash,
            active_role,
            expires_at
        )
        VALUES (
            'fc000000-0000-0000-0000-000000000004',
            'f0000000-0000-0000-0000-000000000002',
            '0005-invalid-session-token-hash',
            'parent',
            CURRENT_TIMESTAMP + INTERVAL '1 hour'
        );
        RAISE EXCEPTION '登入工作階段可使用帳號未持有的角色';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

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
            'fc000000-0000-0000-0000-000000000008',
            '00000000-0000-0000-0000-000000000001',
            '0005-expired-session-token-hash',
            'parent',
            '30000000-0000-0000-0000-000000000001',
            CURRENT_TIMESTAMP - INTERVAL '1 second'
        );
        RAISE EXCEPTION '未撤銷但已過期的工作階段可被建立';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

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
            'fc000000-0000-0000-0000-000000000009',
            'fc000000-0000-0000-0000-000000000005',
            '0005-suspended-session-token-hash',
            'learner',
            '30000000-0000-0000-0000-000000000003',
            CURRENT_TIMESTAMP + INTERVAL '1 hour'
        );
        RAISE EXCEPTION '停權帳號可建立有效工作階段';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE learner_access
    SET access_role = 'tutor'
    WHERE id = 'fc000000-0000-0000-0000-000000000002';
    SET CONSTRAINTS learner_access_auth_sessions_check IMMEDIATE;
    UPDATE learner_access
    SET access_role = 'parent'
    WHERE id = 'fc000000-0000-0000-0000-000000000002';
    SET CONSTRAINTS learner_access_auth_sessions_check IMMEDIATE;
    SET CONSTRAINTS learner_access_auth_sessions_check DEFERRED;

    BEGIN
        UPDATE user_roles
        SET revoked_by_type = 'bootstrap_admin',
            revoked_at = CURRENT_TIMESTAMP
        WHERE id = 'fc000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS user_roles_auth_sessions_check IMMEDIATE;
        RAISE EXCEPTION '撤銷使用中的角色時未要求同交易撤銷工作階段';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS user_roles_auth_sessions_check DEFERRED;
    END;

    BEGIN
        UPDATE learner_access
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = 'fc000000-0000-0000-0000-000000000002';
        SET CONSTRAINTS learner_access_auth_sessions_check IMMEDIATE;
        RAISE EXCEPTION '撤銷使用中的學習者權限時未要求同交易撤銷工作階段';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learner_access_auth_sessions_check DEFERRED;
    END;

    BEGIN
        UPDATE users
        SET status = 'suspended'
        WHERE id = '00000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS users_auth_sessions_check IMMEDIATE;
        RAISE EXCEPTION '停權有有效工作階段的帳號時未要求同交易撤銷工作階段';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS users_auth_sessions_check DEFERRED;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        UPDATE practice_plan_difficulty_mix
        SET percentage = 99
        WHERE practice_plan_id = 'b3000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS practice_plan_difficulty_mix_total_check IMMEDIATE;
        RAISE EXCEPTION '啟用的難易度比例合計不為 100 時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS practice_plan_difficulty_mix_total_check DEFERRED;
    END;

    BEGIN
        DELETE FROM practice_plan_difficulty_mix
        WHERE practice_plan_id = 'b3000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS practice_plan_difficulty_mix_total_check IMMEDIATE;
        RAISE EXCEPTION '啟用的難易度比例沒有任何資料列時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS practice_plan_difficulty_mix_total_check DEFERRED;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO curriculum_units (
            id,
            subject_id,
            unit_type,
            name,
            position,
            origin
        )
        VALUES (
            'fd000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            'chapter',
            '缺少擁有者的帳號單元',
            10,
            'account'
        );
        RAISE EXCEPTION '帳號自訂教材單元缺少 owner_user_id 時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO source_categories (
            id,
            code,
            name,
            status,
            sort_order,
            origin,
            owner_user_id
        )
        VALUES (
            'fd000000-0000-0000-0000-000000000002',
            'invalid-system-owner',
            '錯誤系統來源',
            'active',
            999,
            'system',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '系統題目來源可設定 owner_user_id';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO exam_program_levels (
            id,
            exam_program_id,
            parent_level_id,
            code,
            name,
            sort_order
        )
        VALUES
            (
                'fd100000-0000-0000-0000-000000000001',
                '82500000-0000-0000-0000-000000000001',
                NULL,
                'cycle_two_a',
                '二節點 A',
                20
            ),
            (
                'fd100000-0000-0000-0000-000000000002',
                '82500000-0000-0000-0000-000000000001',
                'fd100000-0000-0000-0000-000000000001',
                'cycle_two_b',
                '二節點 B',
                21
            );

        UPDATE exam_program_levels
        SET parent_level_id = 'fd100000-0000-0000-0000-000000000002'
        WHERE id = 'fd100000-0000-0000-0000-000000000001';
        SET CONSTRAINTS exam_program_levels_ancestry_check IMMEDIATE;
        RAISE EXCEPTION '考試級別可形成二節點循環';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS exam_program_levels_ancestry_check DEFERRED;
    END;

    BEGIN
        INSERT INTO exam_program_levels (
            id,
            exam_program_id,
            parent_level_id,
            code,
            name,
            sort_order
        )
        VALUES
            (
                'fd100000-0000-0000-0000-000000000003',
                '82500000-0000-0000-0000-000000000001',
                NULL,
                'cycle_three_a',
                '三節點 A',
                22
            ),
            (
                'fd100000-0000-0000-0000-000000000004',
                '82500000-0000-0000-0000-000000000001',
                'fd100000-0000-0000-0000-000000000003',
                'cycle_three_b',
                '三節點 B',
                23
            ),
            (
                'fd100000-0000-0000-0000-000000000005',
                '82500000-0000-0000-0000-000000000001',
                'fd100000-0000-0000-0000-000000000004',
                'cycle_three_c',
                '三節點 C',
                24
            );

        UPDATE exam_program_levels
        SET parent_level_id = 'fd100000-0000-0000-0000-000000000005'
        WHERE id = 'fd100000-0000-0000-0000-000000000003';
        SET CONSTRAINTS exam_program_levels_ancestry_check IMMEDIATE;
        RAISE EXCEPTION '考試級別可形成三節點循環';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS exam_program_levels_ancestry_check DEFERRED;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO subjects (
            id,
            code,
            name,
            normalized_name,
            origin,
            owner_user_id
        )
        VALUES (
            'fd200000-0000-0000-0000-000000000001',
            'account_alias_target',
            '帳號別名目標',
            '帳號別名目標',
            'account',
            '00000000-0000-0000-0000-000000000001'
        );

        INSERT INTO subject_aliases (
            id,
            subject_id,
            alias,
            normalized_alias
        )
        VALUES (
            'fd200000-0000-0000-0000-000000000002',
            'fd200000-0000-0000-0000-000000000001',
            '帳號科目別名',
            '帳號科目別名'
        );
        RAISE EXCEPTION '帳號自訂科目可建立全域別名';
    EXCEPTION
        WHEN check_violation THEN NULL;
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
            'fd200000-0000-0000-0000-000000000003',
            'system_alias_target',
            '系統別名目標',
            '系統別名目標',
            'system'
        );

        INSERT INTO subject_aliases (
            id,
            subject_id,
            alias,
            normalized_alias
        )
        VALUES (
            'fd200000-0000-0000-0000-000000000004',
            'fd200000-0000-0000-0000-000000000003',
            '系統科目別名',
            '系統科目別名'
        );

        UPDATE subjects
        SET origin = 'account',
            owner_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = 'fd200000-0000-0000-0000-000000000003';
        SET CONSTRAINTS subjects_aliases_origin_check IMMEDIATE;
        RAISE EXCEPTION '已有別名的系統科目可改為帳號自訂科目';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subjects_aliases_origin_check DEFERRED;
    END;
END;
$$;

INSERT INTO seed_manifests (
    id,
    catalog_key,
    version,
    source_reference,
    content_checksum,
    item_count,
    status,
    migration_name
)
VALUES (
    'fd300000-0000-0000-0000-000000000001',
    'test_catalog',
    'v1',
    'synthetic fixture',
    'seed-checksum-v1',
    3,
    'pending',
    '0005 test'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO seed_manifests (
            id,
            catalog_key,
            version,
            source_reference,
            content_checksum,
            item_count,
            status,
            applied_at,
            migration_name
        )
        VALUES (
            'fd300000-0000-0000-0000-000000000002',
            'test_catalog_direct_applied',
            'v1',
            'synthetic fixture',
            'seed-direct-applied',
            1,
            'applied',
            CURRENT_TIMESTAMP,
            '0005 test'
        );
        RAISE EXCEPTION '種子版本可直接以 applied 建立';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO seed_manifests (
            id,
            catalog_key,
            version,
            source_reference,
            content_checksum,
            item_count,
            status,
            applied_at,
            migration_name
        )
        VALUES (
            'fd300000-0000-0000-0000-000000000003',
            'test_catalog_direct_superseded',
            'v1',
            'synthetic fixture',
            'seed-direct-superseded',
            1,
            'superseded',
            CURRENT_TIMESTAMP,
            '0005 test'
        );
        RAISE EXCEPTION '種子版本可直接以 superseded 建立';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO seed_manifests (
            id,
            catalog_key,
            version,
            source_reference,
            content_checksum,
            item_count,
            status,
            migration_name
        )
        VALUES (
            'fd300000-0000-0000-0000-000000000004',
            'test_catalog_failed_transition',
            'v1',
            'synthetic fixture',
            'seed-failed-transition',
            1,
            'failed',
            '0005 test'
        );
        UPDATE seed_manifests
        SET status = 'applied', applied_at = CURRENT_TIMESTAMP
        WHERE id = 'fd300000-0000-0000-0000-000000000004';
        RAISE EXCEPTION 'failed 種子版本可直接變成 applied';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO seed_manifests (
            id,
            catalog_key,
            version,
            source_reference,
            content_checksum,
            item_count,
            migration_name
        )
        VALUES (
            'fd300000-0000-0000-0000-000000000005',
            'test_catalog_pending_superseded',
            'v1',
            'synthetic fixture',
            'seed-pending-superseded',
            1,
            '0005 test'
        );
        UPDATE seed_manifests
        SET status = 'superseded', applied_at = CURRENT_TIMESTAMP
        WHERE id = 'fd300000-0000-0000-0000-000000000005';
        RAISE EXCEPTION 'pending 種子版本可偽造為 superseded';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

UPDATE seed_manifests
SET status = 'applied', applied_at = CURRENT_TIMESTAMP - INTERVAL '1 year'
WHERE id = 'fd300000-0000-0000-0000-000000000001';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE id = 'fd300000-0000-0000-0000-000000000001'
            AND applied_at = transaction_timestamp()
    ) THEN
        RAISE EXCEPTION 'applied_at 未由資料庫固定為實際套用交易時間';
    END IF;
END;
$$;

DO $$
BEGIN
    BEGIN
        UPDATE seed_manifests
        SET content_checksum = 'rewritten-checksum'
        WHERE id = 'fd300000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已套用種子版本的 checksum 可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE seed_manifests
        SET status = 'failed', applied_at = NULL
        WHERE id = 'fd300000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已套用種子版本可倒退為 failed';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE seed_manifests
    SET status = 'superseded'
    WHERE id = 'fd300000-0000-0000-0000-000000000001';

    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE id = 'fd300000-0000-0000-0000-000000000001'
            AND status = 'superseded'
            AND applied_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'superseded 種子版本未保留 applied_at';
    END IF;

    BEGIN
        UPDATE seed_manifests
        SET applied_at = NULL
        WHERE id = 'fd300000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'superseded 種子版本可清除 applied_at';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM seed_manifests
        WHERE id = 'fd300000-0000-0000-0000-000000000001';
        RAISE EXCEPTION 'superseded 種子版本可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO analytics_privacy_policies (
    id,
    policy_key,
    aggregation_scope,
    min_distinct_learners,
    status,
    effective_at,
    created_by_user_id
)
VALUES (
    'fb000000-0000-0000-0000-000000000001',
    'community_question_ranking',
    'platform',
    5,
    'active',
    CURRENT_TIMESTAMP,
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO analytics_outbox (
    id,
    event_type,
    source_record_id,
    aggregate_key,
    occurred_at
)
VALUES (
    'fb000000-0000-0000-0000-000000000002',
    'attempt_submitted',
    'b9000000-0000-0000-0000-000000000001',
    'learner:30000000-0000-0000-0000-000000000001',
    CURRENT_TIMESTAMP
);

INSERT INTO analytics_jobs (
    id,
    job_type,
    range_start,
    range_end,
    aggregation_version
)
VALUES (
    'fb000000-0000-0000-0000-000000000003',
    'date_range',
    CURRENT_DATE - 7,
    CURRENT_DATE,
    'test-v1'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data,
    request_id
)
VALUES (
    'fb000000-0000-0000-0000-000000000004',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'privacy_policy_enabled',
    'analytics_privacy_policy',
    'fb000000-0000-0000-0000-000000000001',
    '{"status":"draft"}'::jsonb,
    '{"status":"active"}'::jsonb,
    'test-request-0005'
);

INSERT INTO data_erasure_requests (
    id,
    requested_by_user_id,
    target_learner_id,
    request_type
)
VALUES (
    'fb000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'learner_erasure'
);

UPDATE data_erasure_requests
SET status = 'approved',
    reviewed_by_user_id = '00000000-0000-0000-0000-000000000001',
    decision_reason = '合成測試核准'
WHERE id = 'fb000000-0000-0000-0000-000000000005';

DO $$
BEGIN
    BEGIN
        INSERT INTO analytics_privacy_policies (
            id,
            policy_key,
            aggregation_scope,
            min_distinct_learners,
            status,
            created_by_user_id
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000010',
            'invalid-threshold',
            'platform',
            1,
            'draft',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '統計隱私門檻小於等於一時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO analytics_privacy_policies (
            id,
            policy_key,
            aggregation_scope,
            min_distinct_learners,
            status,
            effective_at,
            created_by_user_id
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000011',
            'non-admin-policy',
            'platform',
            5,
            'active',
            CURRENT_TIMESTAMP,
            'f0000000-0000-0000-0000-000000000002'
        );
        RAISE EXCEPTION '非系統管理員可建立統計隱私政策';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO analytics_privacy_policies (
            id,
            policy_key,
            aggregation_scope,
            min_distinct_learners,
            status,
            created_by_user_id
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000017',
            'missing-activation-audit',
            'platform',
            5,
            'draft',
            '00000000-0000-0000-0000-000000000001'
        );

        UPDATE analytics_privacy_policies
        SET status = 'active', effective_at = CURRENT_TIMESTAMP
        WHERE id = 'fb000000-0000-0000-0000-000000000017';
        SET CONSTRAINTS analytics_privacy_policies_audit_check IMMEDIATE;
        RAISE EXCEPTION '統計隱私政策可在沒有同交易稽核時啟用';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS analytics_privacy_policies_audit_check DEFERRED;
    END;

    BEGIN
        INSERT INTO analytics_outbox (
            id,
            event_type,
            source_record_id,
            aggregate_key,
            occurred_at
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000012',
            'attempt_submitted',
            'b9000000-0000-0000-0000-000000000001',
            'duplicate',
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION '統計 outbox 可重複寫入相同來源事件';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO analytics_jobs (
            id,
            job_type,
            range_start,
            range_end,
            aggregation_version
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000013',
            'date_range',
            CURRENT_DATE,
            CURRENT_DATE - 1,
            'test-v1'
        );
        RAISE EXCEPTION '統計工作可使用反向日期範圍';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO admin_audit_logs (
            id,
            actor_type,
            actor_user_id,
            action,
            target_type,
            before_data,
            request_id
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000014',
            'user',
            'f0000000-0000-0000-0000-000000000002',
            'invalid_admin_action',
            'test',
            '{}'::jsonb,
            'test-non-admin-audit'
        );
        RAISE EXCEPTION '非系統管理員可建立管理員稽核資料';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE admin_audit_logs
        SET action = 'rewritten_action'
        WHERE id = 'fb000000-0000-0000-0000-000000000004';
        RAISE EXCEPTION '管理員稽核紀錄可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO data_erasure_requests (
            id,
            requested_by_user_id,
            target_user_id,
            request_type
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000015',
            '00000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002',
            'account_closure'
        );

        UPDATE data_erasure_requests
        SET status = 'rejected',
            reviewed_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = 'fb000000-0000-0000-0000-000000000015';
        RAISE EXCEPTION '拒絕刪除要求時可缺少決定原因';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO data_erasure_requests (
            id,
            requested_by_user_id,
            target_user_id,
            request_type
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000016',
            '00000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002',
            'account_closure'
        );

        UPDATE data_erasure_requests
        SET status = 'rejected',
            reviewed_by_user_id = 'f0000000-0000-0000-0000-000000000002',
            decision_reason = '合成測試拒絕'
        WHERE id = 'fb000000-0000-0000-0000-000000000016';
        RAISE EXCEPTION '非系統管理員可審核刪除要求';
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
    checksum,
    purpose,
    sensitivity,
    scan_status,
    deleted_at
)
VALUES
    (
        'fa000000-0000-0000-0000-000000000001',
        'tests/0005-handwriting-clean.png',
        'image/png',
        100,
        '0005-handwriting-clean',
        'handwriting',
        'private',
        'clean',
        NULL
    ),
    (
        'fa000000-0000-0000-0000-000000000002',
        'tests/0005-attachment-clean.pdf',
        'application/pdf',
        100,
        '0005-attachment-clean',
        'answer_attachment',
        'private',
        'clean',
        NULL
    ),
    (
        'fa000000-0000-0000-0000-000000000003',
        'tests/0005-handwriting-pending.png',
        'image/png',
        100,
        '0005-handwriting-pending',
        'handwriting',
        'private',
        'pending',
        NULL
    ),
    (
        'fa000000-0000-0000-0000-000000000004',
        'tests/0005-question-content.png',
        'image/png',
        100,
        '0005-question-content',
        'question_content',
        'private',
        'clean',
        NULL
    ),
    (
        'fa000000-0000-0000-0000-000000000005',
        'tests/0005-attachment-deleted.pdf',
        'application/pdf',
        100,
        '0005-attachment-deleted',
        'answer_attachment',
        'private',
        'clean',
        CURRENT_TIMESTAMP
    );

INSERT INTO answer_part_assets (
    answer_part_result_id,
    asset_id,
    asset_role,
    position
)
VALUES
    (
        'ba000000-0000-0000-0000-000000000001',
        'fa000000-0000-0000-0000-000000000001',
        'handwriting',
        1
    ),
    (
        'ba000000-0000-0000-0000-000000000001',
        'fa000000-0000-0000-0000-000000000002',
        'attachment',
        0
    );

DO $$
DECLARE
    evidence_mutation text;
BEGIN
    BEGIN
        INSERT INTO answer_part_assets (
            answer_part_result_id,
            asset_id,
            asset_role
        )
        VALUES (
            'ba000000-0000-0000-0000-000000000001',
            'fa000000-0000-0000-0000-000000000003',
            'handwriting'
        );
        RAISE EXCEPTION 'pending handwriting 檔案可被作答引用';
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
            'fa000000-0000-0000-0000-000000000004',
            'attachment'
        );
        RAISE EXCEPTION 'attachment 可引用 question_content 用途檔案';
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
            'fa000000-0000-0000-0000-000000000005',
            'attachment'
        );
        RAISE EXCEPTION '已軟刪除 attachment 檔案可被作答引用';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE assets
        SET scan_status = 'rejected'
        WHERE id = 'fa000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '被作答引用的 handwriting 可改成 rejected';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE assets
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = 'fa000000-0000-0000-0000-000000000002';
        RAISE EXCEPTION '被作答引用的 attachment 可被軟刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    FOREACH evidence_mutation IN ARRAY ARRAY[
        'storage_key = storage_key || ''-changed''',
        'mime_type = ''application/octet-stream''',
        'byte_size = byte_size + 1',
        'width = 1',
        'height = 1',
        'checksum = checksum || ''-changed''',
        'created_by_user_id = ''00000000-0000-0000-0000-000000000001''::uuid',
        'created_at = created_at + interval ''1 second'''
    ] LOOP
        BEGIN
            EXECUTE
                'UPDATE assets SET ' || evidence_mutation
                || ' WHERE id = ''fa000000-0000-0000-0000-000000000002''';
            RAISE EXCEPTION '被作答引用的 asset 證據欄位可改寫：%', evidence_mutation;
        EXCEPTION
            WHEN check_violation THEN NULL;
        END;
    END LOOP;

    UPDATE answer_part_assets
    SET position = 2
    WHERE answer_part_result_id = 'ba000000-0000-0000-0000-000000000001'
        AND asset_id = 'fa000000-0000-0000-0000-000000000002'
        AND asset_role = 'attachment';

    DELETE FROM answer_part_assets
    WHERE answer_part_result_id = 'ba000000-0000-0000-0000-000000000001'
        AND asset_id = 'fa000000-0000-0000-0000-000000000002'
        AND asset_role = 'attachment';

    UPDATE assets
    SET checksum = '0005-attachment-clean-relinked'
    WHERE id = 'fa000000-0000-0000-0000-000000000002';

    INSERT INTO answer_part_assets (
        answer_part_result_id,
        asset_id,
        asset_role,
        position
    )
    VALUES (
        'ba000000-0000-0000-0000-000000000001',
        'fa000000-0000-0000-0000-000000000002',
        'attachment',
        0
    );
END;
$$;

INSERT INTO learner_question_stats (
    learner_id,
    question_id,
    total_attempts,
    graded_attempts,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    first_attempted_at,
    last_attempted_at,
    last_result,
    last_revision_id
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    3,
    2,
    1,
    1,
    1,
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    CURRENT_TIMESTAMP,
    'pending',
    '84000000-0000-0000-0000-000000000001'
);

INSERT INTO learner_part_stats (
    learner_id,
    question_part_id,
    total_attempts,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    last_result,
    last_attempted_at
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    3,
    1,
    1,
    1,
    'pending',
    CURRENT_TIMESTAMP
);

INSERT INTO learner_similarity_group_stats (
    learner_id,
    similarity_group_id,
    attempted_question_count,
    correct_question_count,
    wrong_question_count,
    is_mastered
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    3,
    2,
    0,
    true
);

INSERT INTO learner_daily_stats (
    stat_date,
    learner_id,
    session_count,
    attempt_count,
    correct_part_count,
    wrong_part_count,
    pending_part_count,
    total_duration_seconds
)
VALUES (
    CURRENT_DATE,
    '30000000-0000-0000-0000-000000000001',
    1,
    3,
    1,
    1,
    1,
    54
);

INSERT INTO question_daily_stats (
    stat_date,
    question_id,
    question_revision_id,
    total_attempts,
    unique_learner_count,
    wrong_learner_count,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    total_duration_seconds
)
VALUES (
    CURRENT_DATE,
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    3,
    1,
    1,
    1,
    1,
    1,
    54
);

DO $$
BEGIN
    BEGIN
        INSERT INTO learner_question_stats (
            learner_id,
            question_id,
            total_attempts,
            graded_attempts,
            correct_attempts,
            wrong_attempts,
            pending_attempts,
            first_attempted_at,
            last_attempted_at,
            last_result,
            last_revision_id
        )
        VALUES (
            '30000000-0000-0000-0000-000000000003',
            '83000000-0000-0000-0000-000000000001',
            2,
            2,
            2,
            1,
            0,
            CURRENT_TIMESTAMP - INTERVAL '1 hour',
            CURRENT_TIMESTAMP,
            'correct',
            '84000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '題目統計計數不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_daily_stats (
            stat_date,
            question_id,
            question_revision_id,
            total_attempts,
            unique_learner_count,
            wrong_learner_count,
            correct_attempts,
            wrong_attempts
        )
        VALUES (
            CURRENT_DATE - 1,
            '83000000-0000-0000-0000-000000000001',
            '84000000-0000-0000-0000-000000000001',
            2,
            2,
            2,
            1,
            1
        );
        RAISE EXCEPTION '每日題目統計的答錯人數可超過答錯次數';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_similarity_groups (
            id,
            status,
            created_source
        )
        VALUES (
            'f4000000-0000-0000-0000-000000000010',
            'pending',
            'manual'
        );

        INSERT INTO learner_similarity_group_stats (
            learner_id,
            similarity_group_id
        )
        VALUES (
            '30000000-0000-0000-0000-000000000003',
            'f4000000-0000-0000-0000-000000000010'
        );
        RAISE EXCEPTION 'pending 相近題群組可建立掌握統計';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO practice_session_items (
    id,
    practice_session_id,
    question_id,
    question_revision_id,
    question_part_id,
    position,
    selection_reason
)
VALUES
    (
        'f6000000-0000-0000-0000-000000000001',
        'b7000000-0000-0000-0000-000000000001',
        'f1000000-0000-0000-0000-000000000001',
        'f2000000-0000-0000-0000-000000000001',
        'f3000000-0000-0000-0000-000000000001',
        1,
        'similar_review'
    ),
    (
        'f6000000-0000-0000-0000-000000000002',
        'b7000000-0000-0000-0000-000000000001',
        'f1000000-0000-0000-0000-000000000001',
        'f2000000-0000-0000-0000-000000000001',
        'f3000000-0000-0000-0000-000000000001',
        2,
        'similar_review'
    );

INSERT INTO learner_practice_queue_items (
    id,
    learner_id,
    question_id,
    question_revision_id,
    question_part_id,
    reason,
    source_answer_part_result_id,
    match_basis,
    similarity_group_id,
    status,
    consumed_at
)
VALUES (
    'f7000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'f3000000-0000-0000-0000-000000000001',
    'similar_review',
    'ba000000-0000-0000-0000-000000000001',
    'confirmed_group',
    'f4000000-0000-0000-0000-000000000001',
    'consumed',
    CURRENT_TIMESTAMP
);

INSERT INTO practice_session_item_origins (
    id,
    practice_session_item_id,
    source_answer_part_result_id,
    queue_item_id,
    relation_kind,
    match_basis,
    similarity_group_id
)
VALUES (
    'f8000000-0000-0000-0000-000000000001',
    'f6000000-0000-0000-0000-000000000001',
    'ba000000-0000-0000-0000-000000000001',
    'f7000000-0000-0000-0000-000000000001',
    'similar_review',
    'confirmed_group',
    'f4000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO learner_practice_queue_items (
            id,
            learner_id,
            question_id,
            question_revision_id,
            question_part_id,
            reason,
            source_answer_part_result_id,
            match_basis,
            similarity_group_id,
            status,
            consumed_at
        )
        VALUES (
            'f7000000-0000-0000-0000-000000000005',
            '30000000-0000-0000-0000-000000000001',
            'f1000000-0000-0000-0000-000000000001',
            'f2000000-0000-0000-0000-000000000001',
            'f3000000-0000-0000-0000-000000000001',
            'similar_review',
            'ba000000-0000-0000-0000-000000000001',
            'confirmed_group',
            'f4000000-0000-0000-0000-000000000001',
            'consumed',
            CURRENT_TIMESTAMP
        );
        SET CONSTRAINTS learner_practice_queue_items_consumed_origin_check IMMEDIATE;
        RAISE EXCEPTION '已消耗的相近題佇列項目沒有來源追溯時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learner_practice_queue_items_consumed_origin_check DEFERRED;
    END;

    BEGIN
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
            'f7000000-0000-0000-0000-000000000002',
            '30000000-0000-0000-0000-000000000001',
            'f1000000-0000-0000-0000-000000000001',
            'f2000000-0000-0000-0000-000000000001',
            'f3000000-0000-0000-0000-000000000001',
            'wrong_review',
            'ba000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '錯題複習目標與原始錯題不一致時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO learner_practice_queue_items (
            id,
            learner_id,
            question_id,
            question_revision_id,
            question_part_id,
            reason,
            source_answer_part_result_id,
            match_basis,
            similarity_group_id
        )
        VALUES (
            'f7000000-0000-0000-0000-000000000003',
            '30000000-0000-0000-0000-000000000001',
            'f1000000-0000-0000-0000-000000000001',
            'f2000000-0000-0000-0000-000000000001',
            'f3000000-0000-0000-0000-000000000001',
            'similar_review',
            'ba000000-0000-0000-0000-000000000001',
            'confirmed_group',
            'f4000000-0000-0000-0000-000000000099'
        );
        RAISE EXCEPTION '不存在的已確認相近題群組未被拒絕';
    EXCEPTION
        WHEN check_violation OR foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO practice_session_item_origins (
            id,
            practice_session_item_id,
            source_answer_part_result_id,
            queue_item_id,
            relation_kind,
            match_basis,
            similarity_group_id
        )
        VALUES (
            'f8000000-0000-0000-0000-000000000002',
            'f6000000-0000-0000-0000-000000000002',
            'ba000000-0000-0000-0000-000000000001',
            'f7000000-0000-0000-0000-000000000001',
            'similar_review',
            'confirmed_group',
            'f4000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '同一佇列項目被重複消耗時未被拒絕';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO learner_practice_queue_items (
            id,
            learner_id,
            question_id,
            question_revision_id,
            question_part_id,
            reason,
            source_answer_part_result_id,
            match_basis,
            matched_topic_id
        )
        VALUES (
            'f7000000-0000-0000-0000-000000000004',
            '30000000-0000-0000-0000-000000000001',
            'f1000000-0000-0000-0000-000000000001',
            'f2000000-0000-0000-0000-000000000001',
            'f3000000-0000-0000-0000-000000000001',
            'similar_review',
            'ba000000-0000-0000-0000-000000000001',
            'same_topic',
            '82000000-0000-0000-0000-000000000001'
        );
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION '有效的 same_topic 相近題依據被拒絕：%', SQLERRM;
    END;

    BEGIN
        INSERT INTO practice_session_item_origins (
            id,
            practice_session_item_id,
            source_answer_part_result_id,
            relation_kind,
            match_basis,
            matched_subject_id
        )
        VALUES (
            'f8000000-0000-0000-0000-000000000003',
            'f6000000-0000-0000-0000-000000000002',
            'ba000000-0000-0000-0000-000000000001',
            'similar_review',
            'same_subject',
            '50000000-0000-0000-0000-000000000002'
        );
        RAISE EXCEPTION '來源與目標不屬於指定科目時未被拒絕';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- System revision 1 and account-owned later revisions may omit change_note.
INSERT INTO questions (id, origin, status, created_method)
VALUES (
    'fd400000-0000-0000-0000-000000000001',
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
    created_by_type
)
VALUES (
    'fd400000-0000-0000-0000-000000000002',
    'fd400000-0000-0000-0000-000000000001',
    1,
    '80000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    'migration'
);

DO $$
BEGIN
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
            'fd400000-0000-0000-0000-000000000003',
            'fd400000-0000-0000-0000-000000000001',
            2,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            'migration'
        );
        RAISE EXCEPTION '系統題目後續版本可缺少 change_note';
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
            change_note,
            created_by_type
        )
        VALUES (
            'fd400000-0000-0000-0000-000000000004',
            'fd400000-0000-0000-0000-000000000001',
            2,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '   ',
            'migration'
        );
        RAISE EXCEPTION '系統題目後續版本可使用空白 change_note';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    subject_id,
    change_note,
    created_by_type
)
VALUES (
    'fd400000-0000-0000-0000-000000000005',
    'fd400000-0000-0000-0000-000000000001',
    2,
    '80000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '調整系統題目解題文字',
    'migration'
);

DO $$
BEGIN
    BEGIN
        UPDATE question_revisions
        SET change_note = '   '
        WHERE id = 'fd400000-0000-0000-0000-000000000005';
        RAISE EXCEPTION '系統題目後續版本可清空 change_note';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO questions (
    id,
    origin,
    owner_user_id,
    status,
    created_method
)
VALUES (
    'fd500000-0000-0000-0000-000000000001',
    'account',
    '00000000-0000-0000-0000-000000000001',
    'draft',
    'manual'
);

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    subject_id,
    created_by_type,
    created_by_user_id
)
VALUES (
    'fd500000-0000-0000-0000-000000000002',
    'fd500000-0000-0000-0000-000000000001',
    2,
    '80000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    'user',
    '00000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
    BEGIN
        UPDATE questions
        SET origin = 'system', owner_user_id = NULL
        WHERE id = 'fd500000-0000-0000-0000-000000000001';
        SET CONSTRAINTS questions_system_revision_change_note_check IMMEDIATE;
        RAISE EXCEPTION 'account 題目可帶著空白後續版本轉為 system';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS questions_system_revision_change_note_check DEFERRED;
    END;

    UPDATE question_revisions
    SET change_note = '轉入系統題庫'
    WHERE id = 'fd500000-0000-0000-0000-000000000002';

    UPDATE questions
    SET origin = 'system', owner_user_id = NULL
    WHERE id = 'fd500000-0000-0000-0000-000000000001';
    SET CONSTRAINTS questions_system_revision_change_note_check IMMEDIATE;
    SET CONSTRAINTS questions_system_revision_change_note_check DEFERRED;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            subject_id,
            change_note,
            status,
            created_by_type,
            published_at
        )
        VALUES (
            'fe200000-0000-0000-0000-000000000020',
            'f1000000-0000-0000-0000-000000000001',
            20,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '驗證新版本不可跳過 draft',
            'published',
            'migration',
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION '新題目版本可跳過 draft 直接建立為 published';
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
            change_note,
            created_by_type
        )
        VALUES (
            'fe200000-0000-0000-0000-000000000021',
            'f1000000-0000-0000-0000-000000000001',
            21,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '驗證 draft 不可直接轉 superseded',
            'migration'
        );
        UPDATE question_revisions
        SET status = 'superseded', published_at = CURRENT_TIMESTAMP
        WHERE id = 'fe200000-0000-0000-0000-000000000021';
        RAISE EXCEPTION 'draft 題目版本可直接變成 superseded';
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
            change_note,
            created_by_type
        )
        VALUES (
            'fe200000-0000-0000-0000-000000000022',
            'f1000000-0000-0000-0000-000000000001',
            22,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '驗證系統版本發布稽核',
            'migration'
        );

        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            decision,
            from_status,
            to_status
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000020',
            'fe200000-0000-0000-0000-000000000022',
            'bootstrap_admin',
            'approved',
            'draft',
            'published'
        );

        UPDATE question_revisions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = 'fe200000-0000-0000-0000-000000000022';
        SET CONSTRAINTS question_revisions_review_check IMMEDIATE;
        RAISE EXCEPTION '系統題目版本可在沒有同交易管理員稽核時發布';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_review_check DEFERRED;
    END;

    BEGIN
        INSERT INTO question_revisions (
            id,
            question_id,
            revision_number,
            question_type_id,
            subject_id,
            change_note,
            created_by_type
        )
        VALUES (
            'fe200000-0000-0000-0000-000000000023',
            'f1000000-0000-0000-0000-000000000001',
            23,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '驗證審核與稽核操作者必須一致',
            'migration'
        );

        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            reviewer_user_id,
            decision,
            from_status,
            to_status
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000021',
            'fe200000-0000-0000-0000-000000000023',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'approved',
            'draft',
            'published'
        );

        INSERT INTO admin_audit_logs (
            id,
            actor_type,
            action,
            target_type,
            target_id,
            before_data,
            after_data,
            request_id
        )
        VALUES (
            'fe400000-0000-0000-0000-000000000021',
            'bootstrap_admin',
            'system_question_revision_status_changed',
            'question_revision',
            'fe200000-0000-0000-0000-000000000023',
            '{"status":"draft"}'::jsonb,
            '{"status":"published"}'::jsonb,
            '0005-revision-actor-mismatch'
        );

        UPDATE question_revisions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = 'fe200000-0000-0000-0000-000000000023';
        SET CONSTRAINTS question_revisions_review_check IMMEDIATE;
        RAISE EXCEPTION '系統題目版本審核與稽核操作者可不一致';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_review_check DEFERRED;
    END;

    BEGIN
        UPDATE question_revisions
        SET status = 'superseded'
        WHERE id = '84000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS question_revisions_current_status_check IMMEDIATE;
        RAISE EXCEPTION '目前題目版本可被直接改成 superseded';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_current_status_check DEFERRED;
    END;

    BEGIN
        UPDATE questions
        SET current_revision_id = NULL
        WHERE id = '83000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS questions_current_revision_status_check IMMEDIATE;
        RAISE EXCEPTION '已發布題目可缺少目前版本';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS questions_current_revision_status_check DEFERRED;
    END;

    BEGIN
        UPDATE questions
        SET current_revision_id = NULL
        WHERE id = '83000000-0000-0000-0000-000000000001';
        UPDATE questions
        SET current_revision_id = '84000000-0000-0000-0000-000000000001'
        WHERE id = '83000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS questions_current_revision_status_check IMMEDIATE;
        SET CONSTRAINTS questions_current_revision_status_check DEFERRED;
    END;

    BEGIN
        UPDATE question_revisions
        SET published_at = NULL
        WHERE id = '84000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已發布版本可清除原發布時間';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE question_revisions
        SET search_text = '不可覆寫的發布內容'
        WHERE id = '84000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已發布版本的核心欄位可原地修改';
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
            text_content
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000010',
            '84000000-0000-0000-0000-000000000001',
            'prompt',
            'text',
            99,
            '不得新增至已發布版本'
        );
        RAISE EXCEPTION '可新增內容至已發布版本';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO question_answers (
            id,
            question_part_id,
            accepted_value,
            position
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000011',
            '85000000-0000-0000-0000-000000000002',
            '不得新增至已發布版本',
            99
        );
        RAISE EXCEPTION '可新增答案至已發布版本';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE question_revision_topics
        SET value_source = 'user'
        WHERE question_revision_id = '84000000-0000-0000-0000-000000000001'
            AND topic_id = '82000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '可修改已發布版本的分類';
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
            'fe300000-0000-0000-0000-000000000012',
            '84000000-0000-0000-0000-000000000001',
            'bootstrap_admin',
            'approved',
            'published',
            'superseded'
        );

        UPDATE question_revision_reviews
        SET reason = '不可覆寫歷史審核'
        WHERE id = 'fe300000-0000-0000-0000-000000000012';
        RAISE EXCEPTION '題目版本審核紀錄可被覆寫';
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
            change_note,
            status,
            created_by_type
        )
        VALUES (
            'fe200000-0000-0000-0000-000000000010',
            '83000000-0000-0000-0000-000000000001',
            2,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            '建立新版本以驗證發布與取代流程',
            'draft',
            'migration'
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
            'fe300000-0000-0000-0000-000000000013',
            'fe200000-0000-0000-0000-000000000010',
            'prompt',
            'text',
            0,
            '合法的新版本'
        );

        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            decision,
            from_status,
            to_status
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000014',
            'fe200000-0000-0000-0000-000000000010',
            'bootstrap_admin',
            'approved',
            'draft',
            'published'
        );

        INSERT INTO admin_audit_logs (
            id,
            actor_type,
            action,
            target_type,
            target_id,
            before_data,
            after_data,
            request_id
        )
        VALUES (
            'fe400000-0000-0000-0000-000000000014',
            'bootstrap_admin',
            'system_question_revision_status_changed',
            'question_revision',
            'fe200000-0000-0000-0000-000000000010',
            '{"status":"draft"}'::jsonb,
            '{"status":"published"}'::jsonb,
            '0005-revision-publish-14'
        );

        UPDATE question_revisions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = 'fe200000-0000-0000-0000-000000000010';

        UPDATE questions
        SET current_revision_id = 'fe200000-0000-0000-0000-000000000010'
        WHERE id = '83000000-0000-0000-0000-000000000001';

        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            decision,
            from_status,
            to_status
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000015',
            '84000000-0000-0000-0000-000000000001',
            'bootstrap_admin',
            'approved',
            'published',
            'superseded'
        );

        INSERT INTO admin_audit_logs (
            id,
            actor_type,
            action,
            target_type,
            target_id,
            before_data,
            after_data,
            request_id
        )
        VALUES (
            'fe400000-0000-0000-0000-000000000015',
            'bootstrap_admin',
            'system_question_revision_status_changed',
            'question_revision',
            '84000000-0000-0000-0000-000000000001',
            '{"status":"published"}'::jsonb,
            '{"status":"superseded"}'::jsonb,
            '0005-revision-supersede-15'
        );

        UPDATE question_revisions
        SET status = 'superseded'
        WHERE id = '84000000-0000-0000-0000-000000000001';

        SET CONSTRAINTS questions_current_revision_fk IMMEDIATE;
        SET CONSTRAINTS questions_current_revision_status_check IMMEDIATE;
        SET CONSTRAINTS question_revisions_current_status_check IMMEDIATE;
        SET CONSTRAINTS question_revisions_review_check IMMEDIATE;
        RAISE EXCEPTION '回滾合法多步改版測試' USING ERRCODE = 'P0001';
    EXCEPTION
        WHEN raise_exception THEN
            SET CONSTRAINTS questions_current_revision_fk DEFERRED;
            SET CONSTRAINTS questions_current_revision_status_check DEFERRED;
            SET CONSTRAINTS question_revisions_current_status_check DEFERRED;
            SET CONSTRAINTS question_revisions_review_check DEFERRED;
    END;

    BEGIN
        INSERT INTO questions (id, origin, status, created_method)
        VALUES
            (
                'fe100000-0000-0000-0000-000000000001',
                'system',
                'draft',
                'migration'
            ),
            (
                'fe100000-0000-0000-0000-000000000002',
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
            status,
            created_by_type,
            published_at
        )
        VALUES (
            'fe200000-0000-0000-0000-000000000001',
            'fe100000-0000-0000-0000-000000000001',
            1,
            '80000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001',
            'draft',
            'migration',
            NULL
        );

        INSERT INTO question_revision_reviews (
            id,
            question_revision_id,
            reviewer_type,
            decision,
            from_status,
            to_status
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000016',
            'fe200000-0000-0000-0000-000000000001',
            'bootstrap_admin',
            'approved',
            'draft',
            'published'
        );

        INSERT INTO admin_audit_logs (
            id,
            actor_type,
            action,
            target_type,
            target_id,
            before_data,
            after_data,
            request_id
        )
        VALUES (
            'fe400000-0000-0000-0000-000000000016',
            'bootstrap_admin',
            'system_question_revision_status_changed',
            'question_revision',
            'fe200000-0000-0000-0000-000000000001',
            '{"status":"draft"}'::jsonb,
            '{"status":"published"}'::jsonb,
            '0005-revision-publish-16'
        );

        UPDATE question_revisions
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE id = 'fe200000-0000-0000-0000-000000000001';

        UPDATE questions
        SET current_revision_id = 'fe200000-0000-0000-0000-000000000001',
            status = 'published'
        WHERE id = 'fe100000-0000-0000-0000-000000000001';

        UPDATE question_revisions
        SET question_id = 'fe100000-0000-0000-0000-000000000002'
        WHERE id = 'fe200000-0000-0000-0000-000000000001';
        SET CONSTRAINTS question_revisions_current_status_check IMMEDIATE;
        RAISE EXCEPTION '目前題目版本可被移到其他題目';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS question_revisions_current_status_check DEFERRED;
    END;
END;
$$;

-- This fixture deliberately has answer history but no queue/session origin.
-- It proves answer provenance is protected independently from queue provenance.
INSERT INTO practice_sessions (
    id,
    learner_id,
    created_by_user_id,
    mode,
    check_mode
)
VALUES
    (
        'fc200000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'practice',
        'complete'
    ),
    (
        'fc200000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'practice',
        'complete'
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
    'fc200000-0000-0000-0000-000000000003',
    'fc200000-0000-0000-0000-000000000001',
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
    grading_source
)
VALUES (
    'fc200000-0000-0000-0000-000000000004',
    'fc200000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000001',
    1,
    '0005-attempt-only-provenance',
    'wrong',
    'automatic'
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
    'fc200000-0000-0000-0000-000000000005',
    'fc200000-0000-0000-0000-000000000004',
    '85000000-0000-0000-0000-000000000001',
    '{"optionKey":"B"}'::jsonb,
    'wrong',
    'wrong',
    'automatic'
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM practice_session_item_origins
        WHERE practice_session_item_id =
            'fc200000-0000-0000-0000-000000000003'
    ) THEN
        RAISE EXCEPTION '作答來源鎖定測試不應依賴 queue origin';
    END IF;

    BEGIN
        UPDATE practice_session_items
        SET practice_session_id =
            'fc200000-0000-0000-0000-000000000002'
        WHERE id = 'fc200000-0000-0000-0000-000000000003';
        RAISE EXCEPTION '已作答練習項目可改換工作階段';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_session_items
        SET question_id = 'f1000000-0000-0000-0000-000000000001'
        WHERE id = 'fc200000-0000-0000-0000-000000000003';
        RAISE EXCEPTION '已作答練習項目可改換穩定題目';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_session_items
        SET question_revision_id =
            'f2000000-0000-0000-0000-000000000001'
        WHERE id = 'fc200000-0000-0000-0000-000000000003';
        RAISE EXCEPTION '已作答練習項目可改換題目版本';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_session_items
        SET question_part_id = 'f3000000-0000-0000-0000-000000000001'
        WHERE id = 'fc200000-0000-0000-0000-000000000003';
        RAISE EXCEPTION '已作答練習項目可改換小題';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_sessions
        SET learner_id = '30000000-0000-0000-0000-000000000003'
        WHERE id = 'fc200000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已作答練習工作階段可改換學習者';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    IF position(
        'for share of item, session'
        IN lower(
            pg_get_functiondef(
                'lerniqa_validate_answer_attempt_learner()'::regprocedure
            )
        )
    ) = 0 THEN
        RAISE EXCEPTION '作答建立時未鎖定練習項目與工作階段';
    END IF;
END;
$$;

DO $$
BEGIN
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
            'f9000000-0000-0000-0000-000000000001',
            'b8000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000001',
            2,
            '0005-initial-current-test',
            'pending',
            'manual_review'
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
            'f9000000-0000-0000-0000-000000000002',
            'f9000000-0000-0000-0000-000000000001',
            '85000000-0000-0000-0000-000000000001',
            '{"text":"answer"}'::jsonb,
            'pending',
            'wrong',
            'manual_review'
        );
        RAISE EXCEPTION '小題結果建立時 initial_result 與 current_result 可不同';
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
            'f9000000-0000-0000-0000-000000000003',
            'b8000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000001',
            2,
            '0005-initial-overall-test',
            'correct',
            'automatic'
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
            'f9000000-0000-0000-0000-000000000004',
            'f9000000-0000-0000-0000-000000000003',
            '85000000-0000-0000-0000-000000000001',
            '{"optionKey":"B"}'::jsonb,
            'wrong',
            'wrong',
            'automatic'
        );
        SET CONSTRAINTS answer_part_results_attempt_overall_check IMMEDIATE;
        RAISE EXCEPTION '初次作答整題結果可與小題結果不一致';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS answer_part_results_attempt_overall_check DEFERRED;
    END;

    BEGIN
        UPDATE answer_part_results
        SET current_result = 'correct',
            grading_source = 'manual_review'
        WHERE id = 'ba000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS answer_part_results_review_transaction_check IMMEDIATE;
        RAISE EXCEPTION '小題目前結果可在沒有新審核與 outbox 時直接改寫';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS answer_part_results_review_transaction_check DEFERRED;
    END;

    BEGIN
        INSERT INTO answer_reviews (
            id,
            answer_part_result_id,
            reviewer_user_id,
            result,
            reason,
            created_at
        )
        VALUES (
            'fe300000-0000-0000-0000-000000000003',
            'ba000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001',
            'wrong',
            '缺少同交易結果更新與 outbox',
            CURRENT_TIMESTAMP + INTERVAL '1 day'
        );
        SET CONSTRAINTS answer_reviews_transaction_check IMMEDIATE;
        RAISE EXCEPTION '可只新增審核而不更新目前結果與 outbox';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS answer_reviews_transaction_check DEFERRED;
    END;

    BEGIN
        UPDATE answer_attempts
        SET overall_result = 'correct'
        WHERE id = 'b9000000-0000-0000-0000-000000000001';
        SET CONSTRAINTS answer_attempts_overall_result_check IMMEDIATE;
        RAISE EXCEPTION '整題結果可與小題目前結果不一致';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS answer_attempts_overall_result_check DEFERRED;
    END;

    BEGIN
        UPDATE answer_attempts
        SET idempotency_key = 'rewritten-attempt'
        WHERE id = 'b9000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '作答冪等鍵可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    INSERT INTO answer_reviews (
        id,
        answer_part_result_id,
        reviewer_user_id,
        result,
        reason
    )
    VALUES (
        'fe300000-0000-0000-0000-000000000001',
        'ba000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'correct',
        '0005 合成改判'
    );

    INSERT INTO analytics_outbox (
        id,
        event_type,
        source_record_id,
        aggregate_key,
        occurred_at
    )
    VALUES (
        'fe300000-0000-0000-0000-000000000002',
        'answer_reviewed',
        'fe300000-0000-0000-0000-000000000001',
        'answer-part-result:ba000000-0000-0000-0000-000000000001',
        CURRENT_TIMESTAMP
    );

    UPDATE answer_attempts
    SET overall_result = 'correct'
    WHERE id = 'b9000000-0000-0000-0000-000000000001';

    UPDATE answer_part_results
    SET current_result = 'correct',
        grading_source = 'manual_review',
        recognized_text = '2',
        recognition_confidence = 0.900
    WHERE id = 'ba000000-0000-0000-0000-000000000001';

    SET CONSTRAINTS answer_part_results_review_transaction_check IMMEDIATE;
    SET CONSTRAINTS answer_reviews_transaction_check IMMEDIATE;
    SET CONSTRAINTS answer_attempts_overall_result_check IMMEDIATE;
    SET CONSTRAINTS answer_part_results_attempt_overall_check IMMEDIATE;
    SET CONSTRAINTS answer_part_results_review_transaction_check DEFERRED;
    SET CONSTRAINTS answer_reviews_transaction_check DEFERRED;
    SET CONSTRAINTS answer_attempts_overall_result_check DEFERRED;
    SET CONSTRAINTS answer_part_results_attempt_overall_check DEFERRED;

    BEGIN
        UPDATE answer_part_results
        SET answer_payload = '{"optionKey":"A"}'::jsonb
        WHERE id = 'ba000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '小題原始答案可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE answer_reviews
        SET reason = 'rewritten review'
        WHERE id = 'bc000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '作答審核紀錄可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_session_item_origins
        SET match_basis = 'same_topic',
            similarity_group_id = NULL,
            matched_topic_id = '82000000-0000-0000-0000-000000000001'
        WHERE id = 'f8000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '練習來源追溯可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO practice_sessions (
            id,
            learner_id,
            created_by_user_id,
            mode,
            check_mode
        )
        VALUES (
            'fe400000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000001',
            'practice',
            'instant'
        );

        UPDATE practice_session_items
        SET practice_session_id = 'fe400000-0000-0000-0000-000000000001'
        WHERE id = 'f6000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已有來源追溯的練習項目可移到其他工作階段';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_sessions
        SET learner_id = '30000000-0000-0000-0000-000000000003'
        WHERE id = 'b7000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已有來源追溯的練習工作階段可改換學習者';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE learner_practice_queue_items
        SET status = 'removed',
            consumed_at = NULL
        WHERE id = 'f7000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已有來源追溯的佇列項目可被改成 removed';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE analytics_privacy_policies
        SET min_distinct_learners = 10
        WHERE id = 'fb000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已生效統計隱私政策可原地修改門檻';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM analytics_privacy_policies
        WHERE id = 'fb000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已生效統計隱私政策可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE data_erasure_requests
    SET status = 'processing'
    WHERE id = 'fb000000-0000-0000-0000-000000000005';

    BEGIN
        UPDATE data_erasure_requests
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            result_summary = NULL
        WHERE id = 'fb000000-0000-0000-0000-000000000005';
        RAISE EXCEPTION '完成資料刪除要求時可缺少處理摘要';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data,
    request_id
)
VALUES (
    'fb000000-0000-0000-0000-000000000020',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'data_erasure_completed',
    'data_erasure_request',
    'fb000000-0000-0000-0000-000000000005',
    '{"status":"processing"}'::jsonb,
    '{"status":"completed"}'::jsonb,
    '0005-erasure-completed'
);

UPDATE data_erasure_requests
SET status = 'completed',
    completed_at = CURRENT_TIMESTAMP,
    result_summary = '{"deleted_records":3}'::jsonb
WHERE id = 'fb000000-0000-0000-0000-000000000005';

DO $$
BEGIN
    BEGIN
        INSERT INTO data_erasure_requests (
            id,
            requested_by_user_id,
            target_user_id,
            request_type,
            status,
            reviewed_by_user_id,
            decision_reason
        )
        VALUES (
            'fb000000-0000-0000-0000-000000000017',
            '00000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002',
            'account_closure',
            'approved',
            '00000000-0000-0000-0000-000000000001',
            '不得直接核准'
        );
        RAISE EXCEPTION '資料刪除要求可直接以 approved 建立';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    INSERT INTO data_erasure_requests (
        id,
        requested_by_user_id,
        target_user_id,
        request_type
    )
    VALUES (
        'fb000000-0000-0000-0000-000000000018',
        '00000000-0000-0000-0000-000000000001',
        'f0000000-0000-0000-0000-000000000002',
        'account_closure'
    );

    BEGIN
        UPDATE data_erasure_requests
        SET target_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = 'fb000000-0000-0000-0000-000000000018';
        RAISE EXCEPTION '資料刪除要求目標可被改寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE data_erasure_requests
        SET status = 'processing',
            reviewed_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = 'fb000000-0000-0000-0000-000000000018';
        RAISE EXCEPTION '資料刪除要求可從 pending 跳到 processing';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE data_erasure_requests
    SET status = 'approved',
        reviewed_by_user_id = '00000000-0000-0000-0000-000000000001',
        decision_reason = '合成測試核准'
    WHERE id = 'fb000000-0000-0000-0000-000000000018';

    UPDATE data_erasure_requests
    SET status = 'processing'
    WHERE id = 'fb000000-0000-0000-0000-000000000018';

    BEGIN
        UPDATE data_erasure_requests
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            result_summary = '{"deleted_records":1}'::jsonb
        WHERE id = 'fb000000-0000-0000-0000-000000000018';
        SET CONSTRAINTS data_erasure_requests_completion_audit_check IMMEDIATE;
        RAISE EXCEPTION '資料刪除要求可在沒有同交易管理員稽核時完成';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS data_erasure_requests_completion_audit_check DEFERRED;
    END;

    BEGIN
        UPDATE data_erasure_requests
        SET decision_reason = '不可覆寫完成紀錄'
        WHERE id = 'fb000000-0000-0000-0000-000000000005';
        RAISE EXCEPTION '已完成資料刪除要求可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM data_erasure_requests
        WHERE id = 'fb000000-0000-0000-0000-000000000005';
        RAISE EXCEPTION '資料刪除要求歷史可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

ROLLBACK;
