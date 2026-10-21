BEGIN;

DROP TRIGGER subscription_plans_history_check ON subscription_plans;
DROP TRIGGER subscription_plans_audit_check ON subscription_plans;
DROP TRIGGER subscription_features_history_check ON subscription_feature_definitions;
DROP TRIGGER subscription_features_audit_check ON subscription_feature_definitions;
DROP TRIGGER subscription_limits_history_check ON subscription_plan_feature_limits;
DROP TRIGGER subscription_limits_audit_check ON subscription_plan_feature_limits;

ALTER TABLE subscription_plans
    ALTER COLUMN created_by_user_id DROP NOT NULL,
    ALTER COLUMN updated_by_user_id DROP NOT NULL,
    ADD COLUMN system_managed boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT subscription_plans_system_actor_check CHECK (
        (system_managed AND created_by_user_id IS NULL AND updated_by_user_id IS NULL)
        OR (NOT system_managed AND created_by_user_id IS NOT NULL AND updated_by_user_id IS NOT NULL)
    );

ALTER TABLE subscription_feature_definitions
    ALTER COLUMN created_by_user_id DROP NOT NULL,
    ALTER COLUMN updated_by_user_id DROP NOT NULL,
    ADD COLUMN system_managed boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT subscription_features_system_actor_check CHECK (
        (system_managed AND created_by_user_id IS NULL AND updated_by_user_id IS NULL)
        OR (NOT system_managed AND created_by_user_id IS NOT NULL AND updated_by_user_id IS NOT NULL)
    );

INSERT INTO subscription_plans (id, code, name, description, status, system_managed)
VALUES (
    '23000000-0000-4000-8000-000000000001',
    'free',
    '免費方案',
    '可保留 100 題自建題目，每日可提交 10 題作答。',
    'active',
    true
);

INSERT INTO subscription_feature_definitions (
    id, feature_key, display_name, description, value_type, unit, status, system_managed
)
VALUES
    (
        '23000000-0000-4000-8000-000000000002',
        'owned_question_limit',
        '自建題目上限',
        '帳號目前可保留的非封存自建題目數。',
        'integer',
        '題',
        'active',
        true
    ),
    (
        '23000000-0000-4000-8000-000000000003',
        'daily_practice_question_limit',
        '每日作答上限',
        '帳號依 Asia/Taipei 日曆日可成功提交的題目數。',
        'integer',
        '題／日',
        'active',
        true
    );

ALTER TABLE subscription_plan_feature_limits
    ALTER COLUMN created_by_user_id DROP NOT NULL,
    ALTER COLUMN updated_by_user_id DROP NOT NULL;

ALTER TABLE subscription_plan_feature_limits
    ADD CONSTRAINT subscription_limits_system_actor_check CHECK (
        (created_by_user_id IS NULL AND updated_by_user_id IS NULL)
        OR (created_by_user_id IS NOT NULL AND updated_by_user_id IS NOT NULL)
    );

INSERT INTO subscription_plan_feature_limits (
    id, plan_id, feature_definition_id, included, unlimited, limit_value,
    created_by_user_id, updated_by_user_id
)
VALUES
    (
        '23000000-0000-4000-8000-000000000004',
        '23000000-0000-4000-8000-000000000001',
        '23000000-0000-4000-8000-000000000002',
        true, false, 100, NULL, NULL
    ),
    (
        '23000000-0000-4000-8000-000000000005',
        '23000000-0000-4000-8000-000000000001',
        '23000000-0000-4000-8000-000000000003',
        true, false, 10, NULL, NULL
    );

CREATE TRIGGER subscription_plans_history_check BEFORE INSERT OR UPDATE OR DELETE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();
CREATE CONSTRAINT TRIGGER subscription_plans_audit_check AFTER INSERT OR UPDATE ON subscription_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();
CREATE TRIGGER subscription_features_history_check BEFORE INSERT OR UPDATE OR DELETE ON subscription_feature_definitions FOR EACH ROW EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();
CREATE CONSTRAINT TRIGGER subscription_features_audit_check AFTER INSERT OR UPDATE ON subscription_feature_definitions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();
CREATE TRIGGER subscription_limits_history_check BEFORE INSERT OR UPDATE OR DELETE ON subscription_plan_feature_limits FOR EACH ROW EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();
CREATE CONSTRAINT TRIGGER subscription_limits_audit_check AFTER INSERT OR UPDATE ON subscription_plan_feature_limits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();

CREATE TABLE account_plan_assignments (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    plan_id uuid NOT NULL REFERENCES subscription_plans(id),
    assignment_source varchar(20) NOT NULL DEFAULT 'default',
    assigned_by_user_id uuid REFERENCES users(id),
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT account_plan_assignments_source_check
        CHECK (assignment_source IN ('default', 'manual')),
    CONSTRAINT account_plan_assignments_actor_check CHECK (
        (assignment_source = 'default' AND assigned_by_user_id IS NULL)
        OR (assignment_source = 'manual' AND assigned_by_user_id IS NOT NULL)
    )
);

INSERT INTO account_plan_assignments (user_id, plan_id)
SELECT id, '23000000-0000-4000-8000-000000000001'
FROM users;

CREATE FUNCTION lerniqa_assign_default_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO account_plan_assignments (user_id, plan_id)
    VALUES (NEW.id, '23000000-0000-4000-8000-000000000001');
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_default_plan
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION lerniqa_assign_default_plan();

CREATE TABLE account_daily_feature_usage (
    user_id uuid NOT NULL REFERENCES users(id),
    usage_date date NOT NULL,
    feature_key varchar(80) NOT NULL,
    used_count integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, usage_date, feature_key),
    CONSTRAINT account_daily_usage_count_check CHECK (used_count >= 0)
);

CREATE TABLE practice_quota_events (
    user_id uuid NOT NULL REFERENCES users(id),
    idempotency_key varchar(120) NOT NULL,
    usage_date date NOT NULL,
    practice_session_item_id uuid NOT NULL REFERENCES practice_session_items(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, idempotency_key),
    CONSTRAINT practice_quota_events_item_unique UNIQUE (user_id, practice_session_item_id)
);

INSERT INTO schema_migrations (version, name)
VALUES ('0023', 'free_plan_quotas');

COMMIT;
