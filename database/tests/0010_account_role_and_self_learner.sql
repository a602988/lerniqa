\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    trigger_name text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0010'
            AND name = 'account_role_and_self_learner'
    ) THEN
        RAISE EXCEPTION '缺少 0010 migration 紀錄';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_account_role_check'
            AND pg_get_constraintdef(oid) LIKE '%parent%learner%tutor%'
    ) THEN
        RAISE EXCEPTION '缺少 users.account_role 白名單限制';
    END IF;

    IF to_regclass('public.learner_access_active_self_user_unique') IS NULL THEN
        RAISE EXCEPTION '缺少每帳號唯一未撤銷 self learner 索引';
    END IF;

    FOREACH trigger_name IN ARRAY ARRAY[
        'users_account_identity_role_check',
        'account_identities_account_role_check',
        'user_roles_account_identity_role_check',
        'learners_account_identity_role_check',
        'learner_access_account_identity_role_check',
        'users_self_learner_check',
        'learners_self_learner_check',
        'learner_access_self_learner_check'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = trigger_name
                AND NOT tgisinternal
                AND tgdeferrable
                AND tginitdeferred
        ) THEN
            RAISE EXCEPTION '缺少 deferred invariant trigger：%', trigger_name;
        END IF;
    END LOOP;

    FOREACH trigger_name IN ARRAY ARRAY[
        'account_identities_account_role_user_lock',
        'users_account_invariants_user_lock',
        'learner_access_account_self_lock',
        'learners_account_self_lock'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = trigger_name
                AND NOT tgisinternal
        ) THEN
            RAISE EXCEPTION '缺少 invariant serialization trigger：%', trigger_name;
        END IF;
    END LOOP;

    IF position(
        'lerniqa_lock_auth_user'
        IN pg_get_functiondef('lerniqa_lock_self_learner_change()'::regprocedure)
    ) = 0 OR position(
        'lerniqa_lock_auth_learner'
        IN pg_get_functiondef('lerniqa_lock_self_learner_change()'::regprocedure)
    ) = 0 THEN
        RAISE EXCEPTION 'self learner invariant 未共用 user/learner transaction lock';
    END IF;
END;
$$;

-- A valid interactive account used by the negative role tests.
INSERT INTO users (id, display_name, account_role)
VALUES (
    '10000000-0000-4000-8000-000000000001',
    '0010 parent',
    'parent'
);

INSERT INTO account_identities (
    id,
    user_id,
    provider,
    provider_subject,
    email_normalized,
    password_hash,
    verified_at
)
VALUES (
    '10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000001',
    'email',
    '0010-parent@example.invalid',
    '0010-parent@example.invalid',
    'synthetic-password-hash',
    transaction_timestamp()
);

INSERT INTO user_roles (id, user_id, role, granted_by_type)
VALUES (
    '10000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000001',
    'parent',
    'bootstrap_admin'
);

-- An account may create the matching grant and select that identity in either
-- order inside one transaction; the final state is what the invariant checks.
INSERT INTO users (id, display_name, account_role)
VALUES (
    '10000000-0000-4000-8000-000000000002',
    '0010 tutor',
    'tutor'
);

INSERT INTO account_identities (
    id,
    user_id,
    provider,
    provider_subject,
    email_normalized,
    password_hash,
    verified_at
)
VALUES (
    '10000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000002',
    'email',
    '0010-tutor@example.invalid',
    '0010-tutor@example.invalid',
    'synthetic-password-hash',
    transaction_timestamp()
);

INSERT INTO user_roles (id, user_id, role, granted_by_type)
VALUES (
    '10000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000002',
    'tutor',
    'bootstrap_admin'
);

SET CONSTRAINTS
    users_account_identity_role_check,
    account_identities_account_role_check,
    user_roles_account_identity_role_check
IMMEDIATE;
SET CONSTRAINTS
    users_account_identity_role_check,
    account_identities_account_role_check,
    user_roles_account_identity_role_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        UPDATE users
        SET account_role = 'tutor'
        WHERE id = '10000000-0000-4000-8000-000000000001';
        SET CONSTRAINTS users_account_identity_role_check IMMEDIATE;
        RAISE EXCEPTION 'account_role 可切到沒有有效 grant 的角色';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS users_account_identity_role_check DEFERRED;
    END;

    BEGIN
        UPDATE user_roles
        SET revoked_by_type = 'bootstrap_admin',
            revoked_at = transaction_timestamp()
        WHERE id = '10000000-0000-4000-8000-000000000021';
        SET CONSTRAINTS user_roles_account_identity_role_check IMMEDIATE;
        RAISE EXCEPTION '目前 account_role 的有效 grant 可被單獨撤銷';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS user_roles_account_identity_role_check DEFERRED;
    END;

    BEGIN
        UPDATE users
        SET account_role = NULL
        WHERE id = '10000000-0000-4000-8000-000000000001';
        SET CONSTRAINTS users_account_identity_role_check IMMEDIATE;
        RAISE EXCEPTION '有有效登入身分的帳號可將 account_role 清空';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS users_account_identity_role_check DEFERRED;
    END;

    BEGIN
        INSERT INTO users (id, display_name)
        VALUES (
            '10000000-0000-4000-8000-000000000003',
            '0010 invalid identity'
        );
        INSERT INTO account_identities (
            id,
            user_id,
            provider,
            provider_subject,
            email_normalized,
            password_hash
        )
        VALUES (
            '10000000-0000-4000-8000-000000000013',
            '10000000-0000-4000-8000-000000000003',
            'email',
            '0010-invalid@example.invalid',
            '0010-invalid@example.invalid',
            'synthetic-password-hash'
        );
        SET CONSTRAINTS account_identities_account_role_check IMMEDIATE;
        RAISE EXCEPTION 'account_role 為 NULL 的帳號可建立有效登入身分';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS account_identities_account_role_check DEFERRED;
    END;

    BEGIN
        UPDATE users
        SET account_role = 'system_admin'
        WHERE id = '10000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'users.account_role 可寫入 system_admin';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- Synthetic self learner fixture. The name and settings permission deliberately
-- start valid so each failing mutation can isolate one invariant.
INSERT INTO users (id, display_name, account_role)
VALUES (
    '10000000-0000-4000-8000-000000000004',
    '0010 self learner',
    'learner'
);

INSERT INTO account_identities (
    id,
    user_id,
    provider,
    provider_subject,
    email_normalized,
    password_hash,
    verified_at
)
VALUES (
    '10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000004',
    'email',
    '0010-self@example.invalid',
    '0010-self@example.invalid',
    'synthetic-password-hash',
    transaction_timestamp()
);

INSERT INTO user_roles (id, user_id, role, granted_by_type)
VALUES (
    '10000000-0000-4000-8000-000000000024',
    '10000000-0000-4000-8000-000000000004',
    'learner',
    'bootstrap_admin'
);

INSERT INTO learners (
    id,
    display_name,
    education_status,
    grade_id,
    status
)
SELECT
    '10000000-0000-4000-8000-000000000031',
    '0010 self learner',
    'enrolled',
    grade.id,
    'active'
FROM grades AS grade
WHERE grade.status = 'active'
ORDER BY grade.sort_order, grade.id
LIMIT 1;

INSERT INTO learners (
    id,
    display_name,
    education_status,
    grade_id,
    status
)
SELECT
    '10000000-0000-4000-8000-000000000032',
    '0010 self learner',
    'enrolled',
    grade.id,
    'active'
FROM grades AS grade
WHERE grade.status = 'active'
ORDER BY grade.sort_order, grade.id
LIMIT 1;

INSERT INTO learner_access (
    id,
    learner_id,
    user_id,
    access_role,
    can_manage_settings,
    accepted_at
)
VALUES (
    '10000000-0000-4000-8000-000000000041',
    '10000000-0000-4000-8000-000000000031',
    '10000000-0000-4000-8000-000000000004',
    'learner',
    true,
    transaction_timestamp()
);

SET CONSTRAINTS
    users_account_identity_role_check,
    account_identities_account_role_check,
    user_roles_account_identity_role_check,
    learner_access_self_learner_check
IMMEDIATE;
SET CONSTRAINTS
    users_account_identity_role_check,
    account_identities_account_role_check,
    user_roles_account_identity_role_check,
    learner_access_self_learner_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        INSERT INTO learner_access (
            id,
            learner_id,
            user_id,
            access_role,
            can_manage_settings,
            accepted_at
        )
        VALUES (
            '10000000-0000-4000-8000-000000000042',
            '10000000-0000-4000-8000-000000000032',
            '10000000-0000-4000-8000-000000000004',
            'learner',
            true,
            transaction_timestamp()
        );
        RAISE EXCEPTION '同一帳號可建立第二筆未撤銷 self learner';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        UPDATE learners
        SET display_name = '0010 drifted learner'
        WHERE id = '10000000-0000-4000-8000-000000000031';
        SET CONSTRAINTS learners_self_learner_check IMMEDIATE;
        RAISE EXCEPTION 'self learner 名稱可偏離 users.display_name';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learners_self_learner_check DEFERRED;
    END;

    BEGIN
        UPDATE learner_access
        SET can_manage_settings = false
        WHERE id = '10000000-0000-4000-8000-000000000041';
        SET CONSTRAINTS learner_access_self_learner_check IMMEDIATE;
        RAISE EXCEPTION '有效 self learner 可失去設定管理權限';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learner_access_self_learner_check DEFERRED;
    END;

    BEGIN
        UPDATE learner_access
        SET revoked_at = transaction_timestamp()
        WHERE id = '10000000-0000-4000-8000-000000000041';
        SET CONSTRAINTS learner_access_account_identity_role_check IMMEDIATE;
        RAISE EXCEPTION 'learner identity 可撤銷唯一的 active accepted self access';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learner_access_account_identity_role_check DEFERRED;
    END;

    BEGIN
        UPDATE learners
        SET status = 'archived'
        WHERE id = '10000000-0000-4000-8000-000000000031';
        SET CONSTRAINTS learners_account_identity_role_check IMMEDIATE;
        RAISE EXCEPTION 'learner identity 可封存唯一的 active accepted self learner';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS learners_account_identity_role_check DEFERRED;
    END;
END;
$$;

-- Both sides may be renamed in one transaction; only their final agreement is
-- constrained.
UPDATE users
SET display_name = '0010 synchronized learner'
WHERE id = '10000000-0000-4000-8000-000000000004';

UPDATE learners
SET display_name = '0010 synchronized learner'
WHERE id = '10000000-0000-4000-8000-000000000031';

SET CONSTRAINTS users_self_learner_check, learners_self_learner_check IMMEDIATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM users AS app_user
        JOIN learner_access AS access
            ON access.user_id = app_user.id
            AND access.access_role = 'learner'
            AND access.revoked_at IS NULL
            AND access.accepted_at IS NOT NULL
        JOIN learners AS learner ON learner.id = access.learner_id
        WHERE app_user.id = '10000000-0000-4000-8000-000000000004'
            AND learner.display_name = app_user.display_name
            AND access.can_manage_settings
    ) THEN
        RAISE EXCEPTION '同交易同步 self learner 名稱後未維持有效狀態';
    END IF;
END;
$$;

ROLLBACK;
