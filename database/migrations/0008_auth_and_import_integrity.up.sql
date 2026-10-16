BEGIN;

-- Freeze both sides of the learner-status/session invariant before the legacy
-- preflight. Without these locks, an archive that starts after the check but
-- before the learner trigger is installed can leave an active session pointing
-- at an archived learner. SHARE ROW EXCLUSIVE permits ordinary reads while
-- blocking every writer until this migration commits.
LOCK TABLE learners, auth_sessions IN SHARE ROW EXCLUSIVE MODE;

-- Do not silently invalidate a durable login while upgrading. The caller must
-- first revoke any active session that still points at an archived learner.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        JOIN learners AS learner ON learner.id = session.active_learner_id
        WHERE session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND session.active_learner_id IS NOT NULL
            AND learner.status = 'archived'
    ) THEN
        RAISE EXCEPTION 'an active auth session references an archived learner; revoke it before migration'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE INDEX auth_sessions_active_learner_expiry_index
    ON auth_sessions(active_learner_id, expires_at)
    WHERE revoked_at IS NULL;

-- The imported publisher bank is the document's native curriculum placement,
-- not a user-entered classification. Published revisions are normally frozen,
-- so this narrowly scoped data repair temporarily bypasses only that guard.
ALTER TABLE question_revision_units
    DISABLE TRIGGER question_revision_units_frozen_revision_check;

UPDATE question_revision_units AS revision_unit
SET assignment_type = 'native',
    value_source = 'document'
FROM question_revisions AS revision
JOIN source_categories AS source_category
    ON source_category.id = revision.source_category_id
JOIN import_items AS import_item
    ON import_item.question_revision_id = revision.id
JOIN import_batches AS import_batch
    ON import_batch.id = import_item.import_batch_id
WHERE revision.id = revision_unit.question_revision_id
    AND import_batch.id = '2d1ff794-f6f4-5e59-baaa-8d1c767438be'
    AND import_batch.status = 'confirmed'
    AND source_category.code = 'publisher-test-bank'
    AND revision_unit.assignment_type = 'manual_classification'
    AND revision_unit.value_source = 'user';

ALTER TABLE question_revision_units
    ENABLE TRIGGER question_revision_units_frozen_revision_check;

DO $$
BEGIN
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
        RAISE EXCEPTION 'publisher-test-bank native unit repair did not reach a consistent final state'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_auth_learner_lock_key(candidate_learner_id uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT hashtextextended('lerniqa-auth-learner:' || candidate_learner_id::text, 0);
$$;

CREATE FUNCTION lerniqa_lock_auth_learner(candidate_learner_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
STRICT
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        lerniqa_auth_learner_lock_key(candidate_learner_id)
    );
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_auth_session_is_valid(
    session_user_id uuid,
    session_role varchar,
    session_learner_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles AS role
        JOIN users AS app_user ON app_user.id = role.user_id
        WHERE role.user_id = session_user_id
            AND role.role = session_role
            AND role.revoked_at IS NULL
            AND app_user.status = 'active'
    )
    AND (
        session_learner_id IS NULL
        OR EXISTS (
            SELECT 1
            FROM learner_access AS access
            JOIN learners AS learner
                ON learner.id = access.learner_id
                AND learner.status = 'active'
            WHERE access.user_id = session_user_id
                AND access.learner_id = session_learner_id
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
        )
    );
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_auth_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    locked_user_id uuid;
    locked_learner_id uuid;
BEGIN
    FOR locked_user_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(
            CASE
                WHEN TG_OP = 'UPDATE'
                    THEN ARRAY[OLD.user_id, NEW.user_id]::uuid[]
                ELSE ARRAY[NEW.user_id]::uuid[]
            END
        ) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
    LOOP
        PERFORM lerniqa_lock_auth_user(locked_user_id);
    END LOOP;

    -- Every path that needs both namespaces locks all users first and all
    -- learners second, each in UUID order, to avoid user/learner ABBA cycles.
    FOR locked_learner_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(
            CASE
                WHEN TG_OP = 'UPDATE'
                    THEN ARRAY[OLD.active_learner_id, NEW.active_learner_id]::uuid[]
                ELSE ARRAY[NEW.active_learner_id]::uuid[]
            END
        ) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
    LOOP
        PERFORM lerniqa_lock_auth_learner(locked_learner_id);
    END LOOP;

    IF NEW.revoked_at IS NULL THEN
        IF NEW.expires_at <= CURRENT_TIMESTAMP THEN
            RAISE EXCEPTION '未撤銷的登入工作階段到期時間必須晚於目前時間'
                USING ERRCODE = '23514';
        END IF;

        IF NOT lerniqa_auth_session_is_valid(
                NEW.user_id,
                NEW.active_role,
                NEW.active_learner_id
            ) THEN
            RAISE EXCEPTION '有效登入工作階段必須使用啟用帳號、有效角色與已接受的啟用學習者權限'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION lerniqa_lock_learner_auth_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_learner_ids uuid[];
    locked_user_id uuid;
    locked_learner_id uuid;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    candidate_learner_ids := ARRAY[OLD.id, NEW.id]::uuid[];

    FOR locked_user_id IN
        SELECT DISTINCT access.user_id
        FROM learner_access AS access
        WHERE access.learner_id = ANY(candidate_learner_ids)
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        ORDER BY access.user_id
    LOOP
        PERFORM lerniqa_lock_auth_user(locked_user_id);
    END LOOP;

    FOR locked_learner_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(candidate_learner_ids) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
    LOOP
        PERFORM lerniqa_lock_auth_learner(locked_learner_id);
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE TRIGGER learners_auth_user_lock
BEFORE UPDATE OF status ON learners
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION lerniqa_lock_learner_auth_change();

CREATE FUNCTION lerniqa_validate_sessions_after_learner_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        WHERE session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND session.active_learner_id IN (OLD.id, NEW.id)
            AND NOT lerniqa_auth_session_is_valid(
                session.user_id,
                session.active_role,
                session.active_learner_id
            )
    ) THEN
        RAISE EXCEPTION '學習者狀態異動使有效登入工作階段失效；請在同一交易撤銷工作階段'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER learners_auth_sessions_check
AFTER UPDATE OF status ON learners
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION lerniqa_validate_sessions_after_learner_status_change();

INSERT INTO schema_migrations (version, name)
VALUES ('0008', 'auth_and_import_integrity');

COMMIT;
