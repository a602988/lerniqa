\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    owner_id uuid := '17000000-0000-4000-8000-000000000001';
    recipient_id uuid := '17000000-0000-4000-8000-000000000002';
    owner_learner uuid := '17000000-0000-4000-8000-000000000003';
    recipient_learner uuid := '17000000-0000-4000-8000-000000000004';
    plan_id uuid := '17000000-0000-4000-8000-000000000005';
    revision_one uuid := '17000000-0000-4000-8000-000000000006';
    revision_two uuid := '17000000-0000-4000-8000-000000000007';
    invite_id uuid := '17000000-0000-4000-8000-000000000008';
    subscription_id uuid := '17000000-0000-4000-8000-000000000009';
    schedule_id uuid := '17000000-0000-4000-8000-000000000010';
    session_id uuid := '17000000-0000-4000-8000-000000000011';
    question_id uuid;
    question_revision_id uuid;
    original_plan_count bigint;
    original_schedule_count bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0017' AND name = 'learning_book_plans') THEN
        RAISE EXCEPTION 'Learning-book migration registration missing';
    END IF;
    SELECT count(*) INTO original_plan_count FROM practice_plans;
    SELECT count(*) INTO original_schedule_count FROM practice_schedules;
    IF EXISTS (SELECT 1 FROM practice_plans WHERE current_published_revision_id IS NOT NULL OR draft_revision_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM practice_schedules WHERE practice_plan_revision_id IS NOT NULL)
        OR EXISTS (SELECT 1 FROM practice_sessions WHERE practice_plan_revision_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Migration invented a historical publication snapshot';
    END IF;

    INSERT INTO users(id, display_name) VALUES (owner_id, 'Synthetic book owner'), (recipient_id, 'Synthetic book recipient');
    INSERT INTO learners(id, display_name, education_status)
        VALUES (owner_learner, 'Synthetic owner learner', 'not_enrolled'),
            (recipient_learner, 'Synthetic recipient learner', 'not_enrolled');
    INSERT INTO learner_access(id,learner_id,user_id,access_role,can_create_plans,accepted_at)
        VALUES ('17000000-0000-4000-8000-000000000012',recipient_learner,recipient_id,'parent',true,CURRENT_TIMESTAMP);
    INSERT INTO practice_plans(id,learner_id,created_by_user_id,created_role,name,check_mode,question_limit,selection_mode)
        VALUES (plan_id,owner_learner,owner_id,'parent','Synthetic book','instant',1,'fixed');
    INSERT INTO practice_plan_revisions(id,practice_plan_id,revision_number,name,check_mode,question_limit,selection_mode,created_by_user_id)
        VALUES (revision_one,plan_id,1,'Version one','instant',1,'fixed',owner_id);
    UPDATE practice_plans SET draft_revision_id = revision_one WHERE id = plan_id;

    BEGIN
        INSERT INTO practice_plan_revisions(id,practice_plan_id,revision_number,name,check_mode,question_limit,selection_mode,created_by_user_id)
            VALUES ('17000000-0000-4000-8000-000000000013',plan_id,2,'Duplicate draft','instant',1,'fixed',owner_id);
        RAISE EXCEPTION 'Accepted two concurrent drafts';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    SELECT q.id, r.id INTO question_id,question_revision_id FROM questions q
        JOIN question_revisions r ON r.question_id = q.id
        WHERE r.status IN ('published', 'superseded') ORDER BY q.id,r.revision_number LIMIT 1;
    INSERT INTO practice_plan_revision_items(id,practice_plan_revision_id,question_id,question_revision_id,position)
        VALUES ('17000000-0000-4000-8000-000000000014',revision_one,question_id,question_revision_id,0);
    UPDATE practice_plan_revisions SET status = 'published',published_at = CURRENT_TIMESTAMP,published_by_user_id = owner_id
        WHERE id = revision_one;
    UPDATE practice_plans SET draft_revision_id = NULL,current_published_revision_id = revision_one WHERE id = plan_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
        UPDATE practice_plan_revisions SET name = 'Changed history' WHERE id = revision_one;
        RAISE EXCEPTION 'Published revision was overwritten';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        DELETE FROM practice_plan_revisions WHERE id = revision_one;
        RAISE EXCEPTION 'Published revision was deleted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE practice_plan_revision_items SET position = 1 WHERE practice_plan_revision_id = revision_one;
        RAISE EXCEPTION 'Published revision item was overwritten';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO practice_plan_revision_items(id,practice_plan_revision_id,question_id,question_revision_id,position)
            VALUES ('17000000-0000-4000-8000-000000000015',revision_one,question_id,question_revision_id,1);
        RAISE EXCEPTION 'Published revision accepted a new item';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO practice_plan_share_invites(id,source_plan_id,created_by_user_id,token_hash,expires_at)
            VALUES (invite_id,plan_id,owner_id,'plaintext-token',CURRENT_TIMESTAMP + interval '7 days');
        RAISE EXCEPTION 'Share invitation accepted a plaintext token';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO practice_plan_share_invites(id,source_plan_id,created_by_user_id,token_hash,expires_at)
            VALUES (invite_id,plan_id,owner_id,repeat('a',64),CURRENT_TIMESTAMP + interval '8 days');
        RAISE EXCEPTION 'Share invitation accepted an excessive lifetime';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO practice_plan_share_invites(id,source_plan_id,created_by_user_id,token_hash,expires_at)
        VALUES (invite_id,plan_id,owner_id,repeat('a',64),CURRENT_TIMESTAMP + interval '7 days');
    BEGIN
        UPDATE practice_plan_share_invites SET redeemed_at = CURRENT_TIMESTAMP,redeemed_by_user_id = recipient_id,
            redeemed_learner_id = owner_learner WHERE id = invite_id;
        RAISE EXCEPTION 'Invitation was redeemed for an inaccessible learner';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE practice_plan_share_invites SET redeemed_at = CURRENT_TIMESTAMP,redeemed_by_user_id = recipient_id,
        redeemed_learner_id = recipient_learner WHERE id = invite_id;
    INSERT INTO practice_plan_subscriptions(id,source_plan_id,recipient_learner_id,shared_by_user_id,invite_id,
        current_revision_id,accepted_by_user_id)
        VALUES (subscription_id,plan_id,recipient_learner,owner_id,invite_id,revision_one,recipient_id);
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
        UPDATE practice_plan_share_invites SET redeemed_learner_id = owner_learner WHERE id = invite_id;
        RAISE EXCEPTION 'Invitation was redeemed a second time';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO practice_schedules(id,learner_id,practice_plan_id,name,scheduled_for,check_mode,created_by_user_id,
            practice_plan_revision_id)
            VALUES (schedule_id,recipient_learner,plan_id,'Invalid cross-learner plan',CURRENT_TIMESTAMP,'instant',recipient_id,revision_one);
        RAISE EXCEPTION 'Schedule bypassed source learner isolation';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    INSERT INTO practice_schedules(id,learner_id,name,scheduled_for,check_mode,created_by_user_id,
        practice_plan_revision_id,practice_plan_subscription_id)
        VALUES (schedule_id,recipient_learner,'Shared schedule',CURRENT_TIMESTAMP,'instant',recipient_id,revision_one,subscription_id);
    INSERT INTO practice_schedule_items(id,practice_schedule_id,question_id,question_revision_id,position,reason)
        VALUES ('17000000-0000-4000-8000-000000000021',schedule_id,question_id,question_revision_id,0,'selected');
    BEGIN
        INSERT INTO practice_schedule_items(id,practice_schedule_id,question_id,question_revision_id,position,reason)
            VALUES ('17000000-0000-4000-8000-000000000022',schedule_id,question_id,question_revision_id,1,'selected');
        RAISE EXCEPTION 'Schedule accepted an item absent from the pinned version';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        DELETE FROM practice_schedule_items WHERE practice_schedule_id = schedule_id;
        RAISE EXCEPTION 'Schedule lost its pinned items';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO practice_sessions(id,learner_id,created_by_user_id,mode,check_mode,practice_schedule_id,
        practice_plan_revision_id,practice_plan_subscription_id)
        VALUES (session_id,recipient_learner,recipient_id,'practice','instant',schedule_id,revision_one,subscription_id);
    INSERT INTO practice_session_items(id,practice_session_id,question_id,question_revision_id,position,selection_reason)
        VALUES ('17000000-0000-4000-8000-000000000023',session_id,question_id,question_revision_id,0,'fixed');
    BEGIN
        UPDATE practice_session_items SET position = 1 WHERE practice_session_id = session_id;
        RAISE EXCEPTION 'Session lost its pinned item order';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO practice_plan_revisions(id,practice_plan_id,revision_number,name,check_mode,question_limit,selection_mode,created_by_user_id)
        VALUES (revision_two,plan_id,2,'Version two','instant',1,'fixed',owner_id);
    BEGIN
        UPDATE practice_plan_revisions SET status = 'published',published_at = CURRENT_TIMESTAMP,published_by_user_id = owner_id
            WHERE id = revision_two;
        RAISE EXCEPTION 'Empty fixed revision was published';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO practice_plan_revision_items(id,practice_plan_revision_id,question_id,question_revision_id,position)
        VALUES ('17000000-0000-4000-8000-000000000024',revision_two,question_id,question_revision_id,0);
    UPDATE practice_plan_revisions SET status = 'published',published_at = CURRENT_TIMESTAMP,published_by_user_id = owner_id
        WHERE id = revision_two;
    UPDATE practice_plans SET current_published_revision_id = revision_two WHERE id = plan_id;
    UPDATE practice_plan_subscriptions SET current_revision_id = revision_two WHERE id = subscription_id;
    IF (SELECT practice_plan_revision_id FROM practice_schedules WHERE id = schedule_id) <> revision_one
        OR (SELECT practice_plan_revision_id FROM practice_sessions WHERE id = session_id) <> revision_one THEN
        RAISE EXCEPTION 'Publication altered a historical version pin';
    END IF;
    BEGIN
        UPDATE practice_schedules SET practice_plan_revision_id = revision_two WHERE id = schedule_id;
        RAISE EXCEPTION 'Schedule version pin was changed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE practice_sessions SET practice_plan_revision_id = revision_two WHERE id = session_id;
        RAISE EXCEPTION 'Session version pin was changed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO practice_sessions(id,learner_id,created_by_user_id,mode,check_mode,practice_schedule_id,
            practice_plan_revision_id,practice_plan_subscription_id)
            VALUES ('17000000-0000-4000-8000-000000000016',recipient_learner,recipient_id,'practice','instant',schedule_id,revision_two,subscription_id);
        RAISE EXCEPTION 'Session changed its schedule version';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    UPDATE practice_plan_share_invites SET revoked_at = CURRENT_TIMESTAMP WHERE id = invite_id;
    UPDATE practice_plan_subscriptions SET status = 'revoked',revoked_at = CURRENT_TIMESTAMP WHERE id = subscription_id;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    BEGIN
        INSERT INTO practice_schedules(id,learner_id,name,scheduled_for,check_mode,created_by_user_id,
            practice_plan_revision_id,practice_plan_subscription_id)
            VALUES ('17000000-0000-4000-8000-000000000017',recipient_learner,'Revoked schedule',CURRENT_TIMESTAMP,
                'instant',recipient_id,revision_two,subscription_id);
        RAISE EXCEPTION 'Revoked subscription accepted a new schedule';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE practice_sessions SET status = 'completed',completed_at = CURRENT_TIMESTAMP WHERE id = session_id;
    BEGIN
        UPDATE practice_plan_subscriptions SET status = 'active',revoked_at = NULL WHERE id = subscription_id;
        RAISE EXCEPTION 'Revoked subscription was reactivated';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO practice_plan_share_invites(id,source_plan_id,created_by_user_id,token_hash,created_at,expires_at)
        VALUES ('17000000-0000-4000-8000-000000000018',plan_id,owner_id,repeat('b',64),
            CURRENT_TIMESTAMP - interval '8 days',CURRENT_TIMESTAMP - interval '1 day');
    BEGIN
        UPDATE practice_plan_share_invites SET redeemed_at = CURRENT_TIMESTAMP,redeemed_by_user_id = recipient_id,
            redeemed_learner_id = recipient_learner WHERE id = '17000000-0000-4000-8000-000000000018';
        RAISE EXCEPTION 'Expired invitation was redeemed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO practice_plan_audit_events(id,actor_user_id,practice_plan_id,event_type)
        VALUES ('17000000-0000-4000-8000-000000000019',owner_id,plan_id,'published');
    BEGIN
        DELETE FROM practice_plan_audit_events WHERE practice_plan_id = plan_id;
        RAISE EXCEPTION 'Audit event was deleted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO practice_plan_mutation_receipts(actor_user_id,action,idempotency_key,request_hash,response)
        VALUES (owner_id,'create','synthetic-key',repeat('c',64),'{"id":"synthetic-result"}');
    BEGIN
        INSERT INTO practice_plan_mutation_receipts(actor_user_id,action,idempotency_key,request_hash,response)
            VALUES (owner_id,'create','synthetic-key',repeat('d',64),'{}');
        RAISE EXCEPTION 'Mutation receipt idempotency scope accepted a duplicate';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        UPDATE practice_plan_mutation_receipts SET response = '{}' WHERE actor_user_id = owner_id;
        RAISE EXCEPTION 'Mutation receipt was rewritten';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO practice_plan_notifications(id,user_id,learner_id,kind,practice_plan_id,subscription_id,revision_id)
        VALUES ('17000000-0000-4000-8000-000000000020',recipient_id,recipient_learner,'share_revoked',plan_id,subscription_id,revision_two);
    UPDATE practice_plan_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = recipient_id;
    BEGIN
        UPDATE practice_plan_notifications SET user_id = owner_id WHERE user_id = recipient_id;
        RAISE EXCEPTION 'Notification recipient provenance was changed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    IF (SELECT count(*) FROM practice_plans) <> original_plan_count + 1
        OR (SELECT count(*) FROM practice_schedules) <> original_schedule_count + 1 THEN
        RAISE EXCEPTION 'Learning-book workflow unexpectedly removed existing data';
    END IF;
    SET CONSTRAINTS ALL IMMEDIATE;
END;
$$;

-- Test evidence is isolated to this transaction, so ordinary down/up parity
-- can run without deleting durable learning-book records.
ROLLBACK;
