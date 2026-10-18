BEGIN;

-- This rollback is for disposable migration tests only. Durable learning-book
-- versions, sharing evidence, notifications or receipts must never be dropped.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM practice_plan_revisions)
        OR EXISTS (SELECT 1 FROM practice_plan_share_invites)
        OR EXISTS (SELECT 1 FROM practice_plan_subscriptions)
        OR EXISTS (SELECT 1 FROM practice_plan_notifications)
        OR EXISTS (SELECT 1 FROM practice_plan_audit_events)
        OR EXISTS (SELECT 1 FROM practice_plan_mutation_receipts) THEN
        RAISE EXCEPTION 'Learning-book data exists; use a preserving forward migration instead';
    END IF;
END;
$$;

DROP TRIGGER practice_sessions_revision_pin_check ON practice_sessions;
DROP TRIGGER practice_schedules_revision_pin_check ON practice_schedules;
DROP FUNCTION lerniqa_validate_plan_practice_pin();
DROP TRIGGER practice_schedule_items_revision_pin_check ON practice_schedule_items;
DROP TRIGGER practice_session_items_revision_pin_check ON practice_session_items;
DROP FUNCTION lerniqa_guard_plan_practice_item();
DROP TRIGGER practice_plan_share_invites_subscription_check ON practice_plan_share_invites;
DROP TRIGGER practice_plan_subscriptions_invite_check ON practice_plan_subscriptions;
DROP FUNCTION lerniqa_validate_plan_subscription_invite();
DROP TRIGGER practice_plans_revision_state_check ON practice_plans;
DROP TRIGGER practice_plan_revisions_pointer_state_check ON practice_plan_revisions;
DROP FUNCTION lerniqa_validate_plan_revision_pointers();

DROP INDEX practice_sessions_plan_revision_index;
DROP INDEX practice_schedules_subscription_status_index;
DROP INDEX practice_schedules_plan_status_index;
ALTER TABLE practice_sessions DROP CONSTRAINT practice_sessions_plan_source_check,
    DROP CONSTRAINT practice_sessions_subscription_learner_fk,
    DROP COLUMN practice_plan_revision_id, DROP COLUMN practice_plan_subscription_id;
ALTER TABLE practice_schedules DROP CONSTRAINT practice_schedules_plan_source_check,
    DROP CONSTRAINT practice_schedules_subscription_learner_fk,
    DROP COLUMN practice_plan_revision_id, DROP COLUMN practice_plan_subscription_id;
ALTER TABLE practice_plans DROP CONSTRAINT practice_plans_draft_revision_fk,
    DROP CONSTRAINT practice_plans_published_revision_fk,
    DROP COLUMN draft_revision_id, DROP COLUMN current_published_revision_id;

DROP TABLE practice_plan_mutation_receipts;
DROP TABLE practice_plan_audit_events;
DROP FUNCTION lerniqa_guard_plan_append_only();
DROP TABLE practice_plan_notifications;
DROP FUNCTION lerniqa_guard_plan_notification();
DROP TABLE practice_plan_subscriptions;
DROP FUNCTION lerniqa_guard_plan_subscription();
DROP TABLE practice_plan_share_invites;
DROP FUNCTION lerniqa_guard_plan_share_invite();
DROP TABLE practice_plan_revision_items;
DROP FUNCTION lerniqa_guard_plan_revision_item();
DROP TABLE practice_plan_revisions;
DROP FUNCTION lerniqa_guard_plan_revision();

DELETE FROM schema_migrations WHERE version = '0017';
COMMIT;
