BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM practice_quota_events)
        OR EXISTS (SELECT 1 FROM account_daily_feature_usage WHERE used_count > 0)
        OR EXISTS (
            SELECT 1 FROM account_plan_assignments WHERE assignment_source = 'manual'
        ) THEN
        RAISE EXCEPTION '0023 contains durable plan or quota data; use a forward migration';
    END IF;
END;
$$;

DROP TABLE practice_quota_events;
DROP TABLE account_daily_feature_usage;
DROP TRIGGER users_default_plan ON users;
DROP FUNCTION lerniqa_assign_default_plan();
DROP TABLE account_plan_assignments;
DROP TRIGGER subscription_plans_history_check ON subscription_plans;
DROP TRIGGER subscription_plans_audit_check ON subscription_plans;
DROP TRIGGER subscription_features_history_check ON subscription_feature_definitions;
DROP TRIGGER subscription_features_audit_check ON subscription_feature_definitions;
DROP TRIGGER subscription_limits_history_check ON subscription_plan_feature_limits;
DROP TRIGGER subscription_limits_audit_check ON subscription_plan_feature_limits;
ALTER TABLE subscription_plan_feature_limits
    DROP CONSTRAINT subscription_limits_system_actor_check;
DELETE FROM subscription_plan_feature_limits
WHERE id IN (
    '23000000-0000-4000-8000-000000000004',
    '23000000-0000-4000-8000-000000000005'
);
DELETE FROM subscription_feature_definitions
WHERE id IN (
    '23000000-0000-4000-8000-000000000002',
    '23000000-0000-4000-8000-000000000003'
);
DELETE FROM subscription_plans
WHERE id = '23000000-0000-4000-8000-000000000001';
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE subscription_plan_feature_limits
    ALTER COLUMN created_by_user_id SET NOT NULL,
    ALTER COLUMN updated_by_user_id SET NOT NULL;
ALTER TABLE subscription_feature_definitions
    DROP CONSTRAINT subscription_features_system_actor_check,
    DROP COLUMN system_managed,
    ALTER COLUMN created_by_user_id SET NOT NULL,
    ALTER COLUMN updated_by_user_id SET NOT NULL;
ALTER TABLE subscription_plans
    DROP CONSTRAINT subscription_plans_system_actor_check,
    DROP COLUMN system_managed,
    ALTER COLUMN created_by_user_id SET NOT NULL,
    ALTER COLUMN updated_by_user_id SET NOT NULL;
CREATE TRIGGER subscription_plans_history_check BEFORE INSERT OR UPDATE OR DELETE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();
CREATE CONSTRAINT TRIGGER subscription_plans_audit_check AFTER INSERT OR UPDATE ON subscription_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();
CREATE TRIGGER subscription_features_history_check BEFORE INSERT OR UPDATE OR DELETE ON subscription_feature_definitions FOR EACH ROW EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();
CREATE CONSTRAINT TRIGGER subscription_features_audit_check AFTER INSERT OR UPDATE ON subscription_feature_definitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();
CREATE TRIGGER subscription_limits_history_check BEFORE INSERT OR UPDATE OR DELETE ON subscription_plan_feature_limits FOR EACH ROW EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();
CREATE CONSTRAINT TRIGGER subscription_limits_audit_check AFTER INSERT OR UPDATE ON subscription_plan_feature_limits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();
DELETE FROM schema_migrations WHERE version = '0023';

COMMIT;
