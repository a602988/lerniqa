\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.account_plan_assignments') IS NOT NULL
        OR to_regclass('public.account_daily_feature_usage') IS NOT NULL
        OR to_regclass('public.practice_quota_events') IS NOT NULL THEN
        RAISE EXCEPTION '0023 方案或額度資料表未移除';
    END IF;
    IF EXISTS (SELECT 1 FROM subscription_plans WHERE code = 'free') THEN
        RAISE EXCEPTION '0023 免費方案未移除';
    END IF;
END;
$$;
