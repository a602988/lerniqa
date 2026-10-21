\set ON_ERROR_STOP on

DO $$
DECLARE
    free_plan_id uuid;
    owned_limit bigint;
    daily_limit bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0023' AND name = 'free_plan_quotas'
    ) THEN
        RAISE EXCEPTION '0023 migration 紀錄不存在';
    END IF;

    SELECT id INTO free_plan_id
    FROM subscription_plans
    WHERE code = 'free' AND status = 'active' AND system_managed;
    IF free_plan_id IS NULL THEN
        RAISE EXCEPTION '免費方案不存在';
    END IF;

    SELECT feature_limit.limit_value INTO owned_limit
    FROM subscription_plan_feature_limits AS feature_limit
    JOIN subscription_feature_definitions AS feature
        ON feature.id = feature_limit.feature_definition_id
    WHERE feature_limit.plan_id = free_plan_id
        AND feature.feature_key = 'owned_question_limit';
    SELECT feature_limit.limit_value INTO daily_limit
    FROM subscription_plan_feature_limits AS feature_limit
    JOIN subscription_feature_definitions AS feature
        ON feature.id = feature_limit.feature_definition_id
    WHERE feature_limit.plan_id = free_plan_id
        AND feature.feature_key = 'daily_practice_question_limit';
    IF owned_limit <> 100 OR daily_limit <> 10 THEN
        RAISE EXCEPTION '免費方案額度不正確';
    END IF;

    IF EXISTS (
        SELECT 1 FROM users AS app_user
        LEFT JOIN account_plan_assignments AS assignment ON assignment.user_id = app_user.id
        WHERE assignment.user_id IS NULL
    ) THEN
        RAISE EXCEPTION '既有帳號沒有取得預設方案';
    END IF;
END;
$$;

INSERT INTO users (id, display_name)
VALUES ('23000000-0000-4000-8000-000000000010', '0023 新帳號');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM account_plan_assignments
        WHERE user_id = '23000000-0000-4000-8000-000000000010'
            AND plan_id = '23000000-0000-4000-8000-000000000001'
            AND assignment_source = 'default'
    ) THEN
        RAISE EXCEPTION '新帳號沒有自動取得免費方案';
    END IF;
END;
$$;

DELETE FROM account_plan_assignments
WHERE user_id = '23000000-0000-4000-8000-000000000010';
DELETE FROM users WHERE id = '23000000-0000-4000-8000-000000000010';
