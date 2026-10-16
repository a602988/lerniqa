BEGIN;

-- Migration 0008 installed the learner-status/session trigger after its own
-- preflight. A concurrent archive in that historical install window could have
-- committed first. Freeze every table that participates in auth validity, then
-- re-check before adding or repairing any 0010 state. SHARE ROW EXCLUSIVE still
-- permits reads but blocks all concurrent writers until this transaction ends.
LOCK TABLE
    users,
    account_identities,
    user_roles,
    learners,
    learner_access,
    auth_sessions
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        JOIN learners AS learner ON learner.id = session.active_learner_id
        WHERE session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND learner.status = 'archived'
    ) THEN
        RAISE EXCEPTION 'an active auth session references an archived learner; revoke it before migration'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auth_sessions AS session
        WHERE session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND NOT lerniqa_auth_session_is_valid(
                session.user_id,
                session.active_role,
                session.active_learner_id
            )
    ) THEN
        RAISE EXCEPTION 'an existing active auth session has no valid role or learner access'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

-- A single user cannot safely own two self learner records. Stop the whole
-- migration instead of guessing which durable learner record should survive.
DO $$
BEGIN
    IF EXISTS (
        SELECT access.user_id
        FROM learner_access AS access
        WHERE access.access_role = 'learner'
            AND access.revoked_at IS NULL
        GROUP BY access.user_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION '同一帳號已有多筆未撤銷的本人學習者關聯，無法建立唯一限制'
            USING ERRCODE = '23514';
    END IF;

    -- A learner could historically have been labelled as "self" by more than
    -- one account. Equal names are repairable; conflicting names are not.
    IF EXISTS (
        SELECT access.learner_id
        FROM learner_access AS access
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        JOIN users AS app_user ON app_user.id = access.user_id
        WHERE access.access_role = 'learner'
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        GROUP BY access.learner_id
        HAVING count(DISTINCT app_user.display_name) > 1
    ) THEN
        RAISE EXCEPTION '同一啟用學習者對應多個不同名稱的本人帳號，無法安全同步名稱'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE users
ADD COLUMN account_role varchar(30),
ADD CONSTRAINT users_account_role_check
    CHECK (account_role IN ('parent', 'learner', 'tutor'));

-- Only users with a live login identity are interactive accounts. Prefer the
-- most recently used still-valid session role, then deterministic active
-- learner-relationship and non-admin grant fallbacks. System/import principals
-- intentionally stay NULL when they have no active account identity.
UPDATE users AS app_user
SET account_role = COALESCE(
    (
        SELECT session.active_role
        FROM auth_sessions AS session
        WHERE session.user_id = app_user.id
            AND session.active_role IN ('parent', 'learner', 'tutor')
            AND session.revoked_at IS NULL
            AND session.expires_at > CURRENT_TIMESTAMP
            AND lerniqa_auth_session_is_valid(
                session.user_id,
                session.active_role,
                session.active_learner_id
            )
            -- active_role historically mixed account identity and temporary
            -- learner mode. Treat it as identity evidence only when an active,
            -- accepted relationship of the same role supports it.
            AND EXISTS (
                SELECT 1
                FROM learner_access AS session_access
                JOIN learners AS session_learner
                    ON session_learner.id = session_access.learner_id
                    AND session_learner.status = 'active'
                WHERE session_access.user_id = session.user_id
                    AND session_access.access_role = session.active_role
                    AND session_access.accepted_at IS NOT NULL
                    AND session_access.revoked_at IS NULL
                    AND (
                        session.active_learner_id IS NULL
                        OR session_access.learner_id = session.active_learner_id
                    )
            )
        ORDER BY
            session.last_seen_at DESC,
            session.created_at DESC,
            session.id DESC
        LIMIT 1
    ),
    (
        SELECT access.access_role
        FROM learner_access AS access
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        JOIN user_roles AS role
            ON role.user_id = access.user_id
            AND role.role = access.access_role
            AND role.revoked_at IS NULL
        WHERE access.user_id = app_user.id
            AND access.access_role IN ('parent', 'learner', 'tutor')
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
        ORDER BY
            CASE access.access_role
                WHEN 'learner' THEN 1
                WHEN 'parent' THEN 2
                WHEN 'tutor' THEN 3
            END,
            access.accepted_at DESC,
            access.learner_id,
            access.id
        LIMIT 1
    ),
    (
        -- An adult login identity can legitimately exist before its first
        -- learner is accepted. In that case, use the newest active adult
        -- grant; ties are stable. A learner identity cannot be inferred without
        -- its accepted active self relationship.
        SELECT role.role
        FROM user_roles AS role
        WHERE role.user_id = app_user.id
            AND role.role IN ('parent', 'tutor')
            AND role.revoked_at IS NULL
        ORDER BY
            role.granted_at DESC,
            CASE role.role
                WHEN 'parent' THEN 1
                WHEN 'tutor' THEN 2
            END,
            role.id
        LIMIT 1
    )
)
WHERE EXISTS (
    SELECT 1
    FROM account_identities AS identity
    WHERE identity.user_id = app_user.id
        AND identity.revoked_at IS NULL
);

-- Every interactive account must finish the migration with an explicit
-- identity role and a matching unrevoked grant. Abort atomically if an old row
-- cannot be mapped without inventing product data.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users AS app_user
        WHERE EXISTS (
            SELECT 1
            FROM account_identities AS identity
            WHERE identity.user_id = app_user.id
                AND identity.revoked_at IS NULL
        )
            AND (
                app_user.account_role IS NULL
                OR NOT EXISTS (
                    SELECT 1
                    FROM user_roles AS role
                    WHERE role.user_id = app_user.id
                        AND role.role = app_user.account_role
                        AND role.revoked_at IS NULL
                )
                OR (
                    app_user.account_role = 'learner'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM learner_access AS self_access
                        JOIN learners AS self_learner
                            ON self_learner.id = self_access.learner_id
                            AND self_learner.status = 'active'
                        WHERE self_access.user_id = app_user.id
                            AND self_access.access_role = 'learner'
                            AND self_access.accepted_at IS NOT NULL
                            AND self_access.revoked_at IS NULL
                    )
                )
            )
    ) THEN
        RAISE EXCEPTION '存在無法對應有效一般角色的登入帳號，無法回填 users.account_role'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

-- Repair existing self identities before installing their deferred invariant.
-- A registration-created tutor relationship is creator-owned; an invited tutor
-- must keep its narrower permissions.
UPDATE learners AS learner
SET display_name = self_owner.display_name,
    updated_at = transaction_timestamp()
FROM (
    SELECT
        access.learner_id,
        min(app_user.display_name) AS display_name
    FROM learner_access AS access
    JOIN learners AS active_learner
        ON active_learner.id = access.learner_id
        AND active_learner.status = 'active'
    JOIN users AS app_user ON app_user.id = access.user_id
    WHERE access.access_role = 'learner'
        AND access.accepted_at IS NOT NULL
        AND access.revoked_at IS NULL
    GROUP BY access.learner_id
) AS self_owner
WHERE learner.id = self_owner.learner_id
    AND learner.display_name IS DISTINCT FROM self_owner.display_name;

CREATE UNIQUE INDEX learner_access_active_self_user_unique
    ON learner_access(user_id)
    WHERE access_role = 'learner' AND revoked_at IS NULL;

-- Account-role and self-learner writers share the same per-user transaction
-- lock already used by sessions, grants, and learner access. Learner-affecting
-- paths always lock user UUIDs first and learner UUIDs second.
CREATE TRIGGER account_identities_account_role_user_lock
BEFORE INSERT OR UPDATE OR DELETE ON account_identities
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_auth_change_user();

CREATE TRIGGER users_account_invariants_user_lock
BEFORE UPDATE OF account_role, display_name ON users
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_auth_change_user();

CREATE FUNCTION lerniqa_lock_self_learner_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_user_ids uuid[] := ARRAY[]::uuid[];
    candidate_learner_ids uuid[] := ARRAY[]::uuid[];
    locked_user_id uuid;
    locked_learner_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'learner_access' THEN
        IF TG_OP <> 'INSERT' THEN
            candidate_user_ids := array_append(candidate_user_ids, OLD.user_id);
            candidate_learner_ids := array_append(candidate_learner_ids, OLD.learner_id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_user_ids := array_append(candidate_user_ids, NEW.user_id);
            candidate_learner_ids := array_append(candidate_learner_ids, NEW.learner_id);
        END IF;
    ELSE
        candidate_learner_ids := ARRAY[OLD.id, NEW.id]::uuid[];
        SELECT coalesce(array_agg(DISTINCT access.user_id), ARRAY[]::uuid[])
        INTO candidate_user_ids
        FROM learner_access AS access
        WHERE access.learner_id = ANY(candidate_learner_ids)
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL;
    END IF;

    FOR locked_user_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(candidate_user_ids) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
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

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- This trigger sorts before learner_access_auth_user_lock, so a path requiring
-- both namespaces always acquires user locks before learner locks.
CREATE TRIGGER learner_access_account_self_lock
BEFORE INSERT OR UPDATE OR DELETE ON learner_access
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_self_learner_change();

-- Likewise, this sorts before learners_auth_user_lock from migration 0008.
CREATE TRIGGER learners_account_self_lock
BEFORE UPDATE OF display_name, status ON learners
FOR EACH ROW
WHEN (
    OLD.display_name IS DISTINCT FROM NEW.display_name
    OR OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION lerniqa_lock_self_learner_change();

CREATE FUNCTION lerniqa_validate_account_identity_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_user_ids uuid[] := ARRAY[]::uuid[];
    candidate_learner_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        IF TG_OP <> 'INSERT' THEN
            candidate_user_ids := array_append(candidate_user_ids, OLD.id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_user_ids := array_append(candidate_user_ids, NEW.id);
        END IF;
    ELSIF TG_TABLE_NAME = 'learners' THEN
        IF TG_OP <> 'INSERT' THEN
            candidate_learner_ids := array_append(candidate_learner_ids, OLD.id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_learner_ids := array_append(candidate_learner_ids, NEW.id);
        END IF;

        SELECT coalesce(array_agg(DISTINCT access.user_id), ARRAY[]::uuid[])
        INTO candidate_user_ids
        FROM learner_access AS access
        WHERE access.learner_id = ANY(candidate_learner_ids)
            AND access.access_role = 'learner'
            AND access.revoked_at IS NULL;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            candidate_user_ids := array_append(candidate_user_ids, OLD.user_id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_user_ids := array_append(candidate_user_ids, NEW.user_id);
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM users AS app_user
        WHERE app_user.id = ANY(candidate_user_ids)
            AND EXISTS (
                SELECT 1
                FROM account_identities AS identity
                WHERE identity.user_id = app_user.id
                    AND identity.revoked_at IS NULL
            )
            AND (
                app_user.account_role IS NULL
                OR NOT EXISTS (
                    SELECT 1
                    FROM user_roles AS role
                    WHERE role.user_id = app_user.id
                        AND role.role = app_user.account_role
                        AND role.revoked_at IS NULL
                )
                OR (
                    app_user.account_role = 'learner'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM learner_access AS self_access
                        JOIN learners AS self_learner
                            ON self_learner.id = self_access.learner_id
                            AND self_learner.status = 'active'
                        WHERE self_access.user_id = app_user.id
                            AND self_access.access_role = 'learner'
                            AND self_access.accepted_at IS NOT NULL
                            AND self_access.revoked_at IS NULL
                    )
                )
            )
    ) THEN
        RAISE EXCEPTION '有效登入身分必須具有 account_role 與相符角色；learner 身分另須有效本人學習者關聯'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_account_identity_role_check
AFTER UPDATE OF account_role ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_account_identity_role();

CREATE CONSTRAINT TRIGGER account_identities_account_role_check
AFTER INSERT OR UPDATE OR DELETE ON account_identities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_account_identity_role();

CREATE CONSTRAINT TRIGGER user_roles_account_identity_role_check
AFTER INSERT OR UPDATE OR DELETE ON user_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_account_identity_role();

CREATE CONSTRAINT TRIGGER learners_account_identity_role_check
AFTER UPDATE OF status ON learners
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_account_identity_role();

CREATE CONSTRAINT TRIGGER learner_access_account_identity_role_check
AFTER INSERT OR UPDATE OR DELETE ON learner_access
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_account_identity_role();

CREATE FUNCTION lerniqa_validate_self_learner_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_user_ids uuid[] := ARRAY[]::uuid[];
    candidate_learner_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        IF TG_OP <> 'INSERT' THEN
            candidate_user_ids := array_append(candidate_user_ids, OLD.id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_user_ids := array_append(candidate_user_ids, NEW.id);
        END IF;
    ELSIF TG_TABLE_NAME = 'learners' THEN
        IF TG_OP <> 'INSERT' THEN
            candidate_learner_ids := array_append(candidate_learner_ids, OLD.id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_learner_ids := array_append(candidate_learner_ids, NEW.id);
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            candidate_user_ids := array_append(candidate_user_ids, OLD.user_id);
            candidate_learner_ids := array_append(candidate_learner_ids, OLD.learner_id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_user_ids := array_append(candidate_user_ids, NEW.user_id);
            candidate_learner_ids := array_append(candidate_learner_ids, NEW.learner_id);
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM learner_access AS access
        JOIN users AS app_user ON app_user.id = access.user_id
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        WHERE access.access_role = 'learner'
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
            AND (
                access.user_id = ANY(candidate_user_ids)
                OR access.learner_id = ANY(candidate_learner_ids)
            )
            AND (
                NOT access.can_manage_settings
                OR learner.display_name IS DISTINCT FROM app_user.display_name
            )
    ) THEN
        RAISE EXCEPTION '啟用且已接受的本人學習者關聯必須同步帳號名稱並可管理設定'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_self_learner_check
AFTER UPDATE OF display_name ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_self_learner_identity();

CREATE CONSTRAINT TRIGGER learners_self_learner_check
AFTER UPDATE OF display_name, status ON learners
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_self_learner_identity();

CREATE CONSTRAINT TRIGGER learner_access_self_learner_check
AFTER INSERT OR UPDATE OR DELETE ON learner_access
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_self_learner_identity();

-- Run the permission repair only after every learner_access schema change is
-- installed. Its deferred auth/session events can then drain normally at this
-- transaction's commit instead of blocking CREATE INDEX / CREATE TRIGGER.
UPDATE learner_access
SET can_manage_settings = true
WHERE revoked_at IS NULL
    AND (
        access_role = 'learner'
        OR (
            access_role = 'tutor'
            AND invited_by_user_id IS NULL
            AND accepted_at IS NOT NULL
        )
    )
    AND NOT can_manage_settings;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM learner_access AS access
        JOIN users AS app_user ON app_user.id = access.user_id
        JOIN learners AS learner
            ON learner.id = access.learner_id
            AND learner.status = 'active'
        WHERE access.access_role = 'learner'
            AND access.accepted_at IS NOT NULL
            AND access.revoked_at IS NULL
            AND (
                NOT access.can_manage_settings
                OR learner.display_name IS DISTINCT FROM app_user.display_name
            )
    ) THEN
        RAISE EXCEPTION 'existing active self learner identities could not be repaired safely'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

INSERT INTO schema_migrations (version, name)
VALUES ('0010', 'account_role_and_self_learner');

COMMIT;
