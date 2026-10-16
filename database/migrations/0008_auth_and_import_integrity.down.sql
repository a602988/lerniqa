BEGIN;

-- The unit-classification repair in the up migration is intentionally
-- forward-only. There is no durable marker that distinguishes a row repaired
-- by 0008 from one that was already correct or was added after 0008, so a
-- reverse UPDATE could corrupt valid native/document provenance.

DROP TRIGGER learners_auth_sessions_check ON learners;
DROP TRIGGER learners_auth_user_lock ON learners;
DROP FUNCTION lerniqa_validate_sessions_after_learner_status_change();
DROP FUNCTION lerniqa_lock_learner_auth_change();

CREATE OR REPLACE FUNCTION lerniqa_validate_auth_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    locked_user_id uuid;
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
            RAISE EXCEPTION '有效登入工作階段必須使用啟用帳號、有效角色與已接受的學習者權限'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
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
            WHERE access.user_id = session_user_id
                AND access.learner_id = session_learner_id
                AND access.accepted_at IS NOT NULL
                AND access.revoked_at IS NULL
        )
    );
$$;

DROP FUNCTION lerniqa_lock_auth_learner(uuid);
DROP FUNCTION lerniqa_auth_learner_lock_key(uuid);
DROP INDEX auth_sessions_active_learner_expiry_index;

DELETE FROM schema_migrations WHERE version = '0008';

COMMIT;
