BEGIN;

-- Existing plans, schedules and sessions remain intact. Legacy rows are not
-- assigned a revision because their original publication snapshot is unknown.
CREATE TABLE practice_plan_revisions (
    id uuid PRIMARY KEY,
    practice_plan_id uuid NOT NULL REFERENCES practice_plans(id),
    revision_number integer NOT NULL CHECK (revision_number > 0),
    status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    name varchar(140) NOT NULL CHECK (btrim(name) <> ''),
    check_mode varchar(20) NOT NULL CHECK (check_mode IN ('complete', 'instant', 'score')),
    question_limit smallint NOT NULL CHECK (question_limit BETWEEN 1 AND 500),
    selection_mode varchar(20) NOT NULL CHECK (selection_mode IN ('dynamic', 'fixed')),
    settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings_snapshot) = 'object'),
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    published_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at timestamptz,
    CONSTRAINT practice_plan_revisions_identity_plan_unique UNIQUE (id, practice_plan_id),
    CONSTRAINT practice_plan_revisions_number_unique UNIQUE (practice_plan_id, revision_number),
    CONSTRAINT practice_plan_revisions_publication_check CHECK (
        (status = 'draft' AND published_at IS NULL AND published_by_user_id IS NULL)
        OR (status = 'published' AND published_at IS NOT NULL AND published_by_user_id IS NOT NULL
            AND published_at >= created_at)
    )
);

CREATE UNIQUE INDEX practice_plan_revisions_one_draft_unique
    ON practice_plan_revisions(practice_plan_id) WHERE status = 'draft';

CREATE TABLE practice_plan_revision_items (
    id uuid PRIMARY KEY,
    practice_plan_revision_id uuid NOT NULL REFERENCES practice_plan_revisions(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    question_revision_id uuid NOT NULL,
    question_part_id uuid,
    position integer NOT NULL CHECK (position >= 0),
    reason varchar(30) NOT NULL DEFAULT 'selected'
        CHECK (reason IN ('selected', 'wrong_review', 'similar_review', 'manual')),
    CONSTRAINT practice_plan_revision_items_position_unique UNIQUE (practice_plan_revision_id, position),
    CONSTRAINT practice_plan_revision_items_revision_fk FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT practice_plan_revision_items_part_fk FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id)
);

ALTER TABLE practice_plans
    ADD COLUMN draft_revision_id uuid,
    ADD COLUMN current_published_revision_id uuid,
    ADD CONSTRAINT practice_plans_draft_revision_fk
        FOREIGN KEY (draft_revision_id, id) REFERENCES practice_plan_revisions(id, practice_plan_id)
        DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT practice_plans_published_revision_fk
        FOREIGN KEY (current_published_revision_id, id) REFERENCES practice_plan_revisions(id, practice_plan_id)
        DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE practice_plan_share_invites (
    id uuid PRIMARY KEY,
    source_plan_id uuid NOT NULL REFERENCES practice_plans(id),
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    redeemed_by_user_id uuid REFERENCES users(id),
    redeemed_learner_id uuid REFERENCES learners(id),
    redeemed_at timestamptz,
    revoked_at timestamptz,
    CONSTRAINT practice_plan_share_invites_expiry_check
        CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
    CONSTRAINT practice_plan_share_invites_redemption_check CHECK (
        (redeemed_at IS NULL AND redeemed_by_user_id IS NULL AND redeemed_learner_id IS NULL)
        OR (redeemed_at IS NOT NULL AND redeemed_by_user_id IS NOT NULL AND redeemed_learner_id IS NOT NULL
            AND redeemed_at >= created_at AND redeemed_at < expires_at)
    ),
    CONSTRAINT practice_plan_share_invites_revocation_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX practice_plan_share_invites_source_index
    ON practice_plan_share_invites(source_plan_id, created_at DESC);

CREATE TABLE practice_plan_subscriptions (
    id uuid PRIMARY KEY,
    source_plan_id uuid NOT NULL REFERENCES practice_plans(id),
    recipient_learner_id uuid NOT NULL REFERENCES learners(id),
    shared_by_user_id uuid NOT NULL REFERENCES users(id),
    invite_id uuid NOT NULL UNIQUE REFERENCES practice_plan_share_invites(id),
    current_revision_id uuid NOT NULL,
    sync_mode varchar(20) NOT NULL DEFAULT 'auto' CHECK (sync_mode = 'auto'),
    status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    accepted_by_user_id uuid NOT NULL REFERENCES users(id),
    accepted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz,
    CONSTRAINT practice_plan_subscriptions_revision_fk
        FOREIGN KEY (current_revision_id, source_plan_id) REFERENCES practice_plan_revisions(id, practice_plan_id),
    CONSTRAINT practice_plan_subscriptions_identity_learner_unique UNIQUE (id, recipient_learner_id),
    CONSTRAINT practice_plan_subscriptions_revocation_check CHECK (
        (status = 'active' AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_at >= accepted_at)
    )
);

CREATE UNIQUE INDEX practice_plan_subscriptions_active_unique
    ON practice_plan_subscriptions(source_plan_id, recipient_learner_id) WHERE status = 'active';
CREATE INDEX practice_plan_subscriptions_library_index
    ON practice_plan_subscriptions(recipient_learner_id, status, accepted_at DESC);

ALTER TABLE practice_schedules
    ADD COLUMN practice_plan_revision_id uuid REFERENCES practice_plan_revisions(id),
    ADD COLUMN practice_plan_subscription_id uuid,
    ADD CONSTRAINT practice_schedules_subscription_learner_fk
        FOREIGN KEY (practice_plan_subscription_id, learner_id)
        REFERENCES practice_plan_subscriptions(id, recipient_learner_id),
    ADD CONSTRAINT practice_schedules_plan_source_check
        CHECK (practice_plan_id IS NULL OR practice_plan_subscription_id IS NULL);

ALTER TABLE practice_sessions
    ADD COLUMN practice_plan_revision_id uuid REFERENCES practice_plan_revisions(id),
    ADD COLUMN practice_plan_subscription_id uuid,
    ADD CONSTRAINT practice_sessions_subscription_learner_fk
        FOREIGN KEY (practice_plan_subscription_id, learner_id)
        REFERENCES practice_plan_subscriptions(id, recipient_learner_id),
    ADD CONSTRAINT practice_sessions_plan_source_check
        CHECK (practice_plan_id IS NULL OR practice_plan_subscription_id IS NULL);

CREATE INDEX practice_schedules_plan_status_index
    ON practice_schedules(practice_plan_id, status, scheduled_for);
CREATE INDEX practice_schedules_subscription_status_index
    ON practice_schedules(practice_plan_subscription_id, status, scheduled_for)
    WHERE practice_plan_subscription_id IS NOT NULL;
CREATE INDEX practice_sessions_plan_revision_index
    ON practice_sessions(practice_plan_revision_id) WHERE practice_plan_revision_id IS NOT NULL;

CREATE TABLE practice_plan_notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    learner_id uuid REFERENCES learners(id),
    kind varchar(30) NOT NULL CHECK (kind IN ('share_received', 'revision_published', 'share_revoked')),
    practice_plan_id uuid REFERENCES practice_plans(id),
    subscription_id uuid REFERENCES practice_plan_subscriptions(id),
    revision_id uuid REFERENCES practice_plan_revisions(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at timestamptz,
    CONSTRAINT practice_plan_notifications_read_time_check CHECK (read_at IS NULL OR read_at >= created_at)
);
CREATE INDEX practice_plan_notifications_inbox_index
    ON practice_plan_notifications(user_id, created_at DESC, id);

CREATE TABLE practice_plan_audit_events (
    id uuid PRIMARY KEY,
    actor_user_id uuid NOT NULL REFERENCES users(id),
    learner_id uuid REFERENCES learners(id),
    practice_plan_id uuid REFERENCES practice_plans(id),
    subscription_id uuid REFERENCES practice_plan_subscriptions(id),
    event_type varchar(60) NOT NULL CHECK (btrim(event_type) <> ''),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX practice_plan_audit_events_plan_index
    ON practice_plan_audit_events(practice_plan_id, created_at DESC);
CREATE INDEX practice_plan_audit_events_actor_index
    ON practice_plan_audit_events(actor_user_id, event_type, created_at DESC);

CREATE TABLE practice_plan_mutation_receipts (
    actor_user_id uuid NOT NULL REFERENCES users(id),
    action varchar(100) NOT NULL CHECK (btrim(action) <> ''),
    idempotency_key varchar(200) NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (actor_user_id, action, idempotency_key)
);

CREATE FUNCTION lerniqa_guard_plan_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'Learning-book revisions must be assembled as drafts before publication' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'Published learning-book revisions are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'published' OR NEW.id <> OLD.id
        OR NEW.practice_plan_id <> OLD.practice_plan_id OR NEW.revision_number <> OLD.revision_number
        OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Learning-book revision provenance is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'published' AND NEW.selection_mode = 'fixed' AND NOT EXISTS (
        SELECT 1 FROM practice_plan_revision_items i WHERE i.practice_plan_revision_id = NEW.id
        HAVING count(*) = NEW.question_limit AND min(position) = 0 AND max(position) = NEW.question_limit - 1
    ) THEN
        RAISE EXCEPTION 'Published fixed learning books require a complete ordered item snapshot' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'published' AND EXISTS (
        SELECT 1 FROM practice_plan_revision_items i JOIN question_revisions q ON q.id = i.question_revision_id
        WHERE i.practice_plan_revision_id = NEW.id AND q.status NOT IN ('published', 'superseded')
    ) THEN
        RAISE EXCEPTION 'Published learning books cannot reference mutable question drafts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER practice_plan_revisions_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON practice_plan_revisions FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_revision();

CREATE FUNCTION lerniqa_guard_plan_revision_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    revision_id uuid;
    revision_status text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        SELECT status INTO revision_status FROM practice_plan_revisions
        WHERE id = OLD.practice_plan_revision_id FOR UPDATE;
        IF revision_status = 'published' THEN
            RAISE EXCEPTION 'Published learning-book items are immutable' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        revision_id := NEW.practice_plan_revision_id;
        SELECT status INTO revision_status FROM practice_plan_revisions WHERE id = revision_id FOR UPDATE;
        IF revision_status = 'published' THEN
            RAISE EXCEPTION 'Published learning-book items are immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER practice_plan_revision_items_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON practice_plan_revision_items
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_revision_item();

CREATE FUNCTION lerniqa_validate_plan_revision_pointers()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    plan_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'practice_plans' THEN plan_id := NEW.id;
    ELSE plan_id := NEW.practice_plan_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM practice_plans p
        LEFT JOIN practice_plan_revisions published ON published.id = p.current_published_revision_id
        LEFT JOIN practice_plan_revisions draft ON draft.id = p.draft_revision_id
        WHERE p.id = plan_id AND (
            (p.current_published_revision_id IS NOT NULL AND published.status <> 'published')
            OR (p.draft_revision_id IS NOT NULL AND draft.status <> 'draft')
        )
    ) THEN
        RAISE EXCEPTION 'Learning-book pointers must reference the matching revision state' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER practice_plans_revision_state_check
    AFTER INSERT OR UPDATE ON practice_plans DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_plan_revision_pointers();
CREATE CONSTRAINT TRIGGER practice_plan_revisions_pointer_state_check
    AFTER INSERT OR UPDATE ON practice_plan_revisions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_plan_revision_pointers();

CREATE FUNCTION lerniqa_guard_plan_share_invite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Share invitation evidence cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.redeemed_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
            RAISE EXCEPTION 'Share invitations must start unclaimed and active' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM practice_plans p WHERE p.id = NEW.source_plan_id
                AND p.created_by_user_id = NEW.created_by_user_id AND p.status = 'active'
                AND p.current_published_revision_id IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Only the owner of a published active learning book may create an invitation' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF ROW(NEW.id, NEW.source_plan_id, NEW.created_by_user_id, NEW.token_hash, NEW.created_at, NEW.expires_at)
            IS DISTINCT FROM ROW(OLD.id, OLD.source_plan_id, OLD.created_by_user_id, OLD.token_hash, OLD.created_at, OLD.expires_at)
            OR (OLD.redeemed_at IS NOT NULL AND ROW(NEW.redeemed_at, NEW.redeemed_by_user_id, NEW.redeemed_learner_id)
                IS DISTINCT FROM ROW(OLD.redeemed_at, OLD.redeemed_by_user_id, OLD.redeemed_learner_id))
            OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
            RAISE EXCEPTION 'Share invitation provenance and redemption are immutable' USING ERRCODE = '23514';
        END IF;
        IF OLD.redeemed_at IS NULL AND NEW.redeemed_at IS NOT NULL THEN
            IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NOT NULL OR clock_timestamp() >= OLD.expires_at
                OR NOT EXISTS (
                    SELECT 1 FROM learner_access a JOIN learners l ON l.id = a.learner_id
                    WHERE a.learner_id = NEW.redeemed_learner_id AND a.user_id = NEW.redeemed_by_user_id
                        AND a.accepted_at IS NOT NULL AND a.revoked_at IS NULL AND l.status = 'active'
                ) THEN
                RAISE EXCEPTION 'Share invitation is unavailable or recipient lacks learner access' USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER practice_plan_share_invites_lifecycle_check
    BEFORE INSERT OR UPDATE OR DELETE ON practice_plan_share_invites
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_share_invite();

CREATE FUNCTION lerniqa_guard_plan_subscription()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Shared learning-book subscriptions must be revoked, not deleted' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
        ROW(NEW.id, NEW.source_plan_id, NEW.recipient_learner_id, NEW.shared_by_user_id, NEW.invite_id,
            NEW.accepted_by_user_id, NEW.accepted_at, NEW.sync_mode)
        IS DISTINCT FROM ROW(OLD.id, OLD.source_plan_id, OLD.recipient_learner_id, OLD.shared_by_user_id, OLD.invite_id,
            OLD.accepted_by_user_id, OLD.accepted_at, OLD.sync_mode)
        OR (OLD.status = 'revoked' AND NEW IS DISTINCT FROM OLD)
    ) THEN
        RAISE EXCEPTION 'Shared learning-book provenance and revocation are immutable' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM practice_plan_revisions WHERE id = NEW.current_revision_id AND status = 'published') THEN
        RAISE EXCEPTION 'Shared learning books require a published revision' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER practice_plan_subscriptions_lifecycle_check
    BEFORE INSERT OR UPDATE OR DELETE ON practice_plan_subscriptions
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_subscription();

CREATE FUNCTION lerniqa_validate_plan_subscription_invite()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    checked_invite_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'practice_plan_share_invites' THEN checked_invite_id := NEW.id;
    ELSE checked_invite_id := NEW.invite_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM practice_plan_subscriptions s JOIN practice_plan_share_invites i ON i.id = s.invite_id
        WHERE i.id = checked_invite_id AND (
            s.source_plan_id <> i.source_plan_id OR s.shared_by_user_id <> i.created_by_user_id
            OR s.recipient_learner_id IS DISTINCT FROM i.redeemed_learner_id
            OR s.accepted_by_user_id IS DISTINCT FROM i.redeemed_by_user_id OR i.redeemed_at IS NULL
            OR (i.revoked_at IS NOT NULL AND s.status <> 'revoked')
        )
    ) THEN
        RAISE EXCEPTION 'Shared learning-book subscription must match its redeemed invitation' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM practice_plan_share_invites i WHERE i.id = checked_invite_id AND i.redeemed_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM practice_plan_subscriptions s WHERE s.invite_id = i.id)
    ) THEN
        RAISE EXCEPTION 'Invitation redemption and its subscription must be committed together' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER practice_plan_subscriptions_invite_check
    AFTER INSERT OR UPDATE ON practice_plan_subscriptions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_plan_subscription_invite();
CREATE CONSTRAINT TRIGGER practice_plan_share_invites_subscription_check
    AFTER INSERT OR UPDATE ON practice_plan_share_invites DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_plan_subscription_invite();

CREATE FUNCTION lerniqa_validate_plan_practice_pin()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    revision_plan_id uuid;
    schedule_row practice_schedules%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.practice_plan_id, NEW.practice_plan_revision_id, NEW.practice_plan_subscription_id, NEW.learner_id)
            IS DISTINCT FROM ROW(OLD.practice_plan_id, OLD.practice_plan_revision_id, OLD.practice_plan_subscription_id, OLD.learner_id) THEN
            RAISE EXCEPTION 'Practice learning-book version and source are pinned' USING ERRCODE = '23514';
        END IF;
        IF OLD.practice_plan_revision_id IS NOT NULL AND NEW.check_mode <> OLD.check_mode THEN
            RAISE EXCEPTION 'Version-pinned practice check mode is immutable' USING ERRCODE = '23514';
        END IF;
        IF TG_TABLE_NAME = 'practice_sessions' THEN
            IF NEW.practice_schedule_id IS DISTINCT FROM OLD.practice_schedule_id THEN
                RAISE EXCEPTION 'Practice schedule source is pinned' USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.practice_plan_revision_id IS NULL THEN
        IF NEW.practice_plan_id IS NOT NULL OR NEW.practice_plan_subscription_id IS NOT NULL THEN
            RAISE EXCEPTION 'New learning-book practice requires a pinned revision' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT practice_plan_id INTO revision_plan_id FROM practice_plan_revisions
        WHERE id = NEW.practice_plan_revision_id AND status = 'published' AND check_mode = NEW.check_mode;
        IF revision_plan_id IS NULL THEN
            RAISE EXCEPTION 'Practice requires a published learning-book revision' USING ERRCODE = '23514';
        END IF;
        IF NEW.practice_plan_subscription_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM practice_plan_subscriptions s JOIN practice_plans p ON p.id = s.source_plan_id
                WHERE s.id = NEW.practice_plan_subscription_id AND s.recipient_learner_id = NEW.learner_id
                    AND s.source_plan_id = revision_plan_id AND s.status = 'active' AND p.status = 'active'
            ) THEN
                RAISE EXCEPTION 'Shared learning-book practice is unavailable' USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.practice_plan_id IS DISTINCT FROM revision_plan_id THEN
            RAISE EXCEPTION 'Practice revision must match its learning book' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'practice_sessions' THEN
        IF NEW.practice_schedule_id IS NOT NULL THEN
            SELECT * INTO schedule_row FROM practice_schedules WHERE id = NEW.practice_schedule_id;
            IF ROW(NEW.practice_plan_id, NEW.practice_plan_revision_id, NEW.practice_plan_subscription_id)
                IS DISTINCT FROM ROW(schedule_row.practice_plan_id, schedule_row.practice_plan_revision_id,
                    schedule_row.practice_plan_subscription_id) THEN
                RAISE EXCEPTION 'Session must preserve its schedule learning-book revision' USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER practice_schedules_revision_pin_check BEFORE INSERT OR UPDATE ON practice_schedules
    FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_plan_practice_pin();
CREATE TRIGGER practice_sessions_revision_pin_check BEFORE INSERT OR UPDATE ON practice_sessions
    FOR EACH ROW EXECUTE FUNCTION lerniqa_validate_plan_practice_pin();

CREATE FUNCTION lerniqa_guard_plan_practice_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    pinned_revision_id uuid;
    destination_revision_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'practice_schedule_items' THEN
        IF TG_OP = 'INSERT' THEN
            SELECT practice_plan_revision_id INTO pinned_revision_id FROM practice_schedules WHERE id = NEW.practice_schedule_id;
        ELSE
            SELECT practice_plan_revision_id INTO pinned_revision_id FROM practice_schedules WHERE id = OLD.practice_schedule_id;
        END IF;
    ELSE
        IF TG_OP = 'INSERT' THEN
            SELECT practice_plan_revision_id INTO pinned_revision_id FROM practice_sessions WHERE id = NEW.practice_session_id;
        ELSE
            SELECT practice_plan_revision_id INTO pinned_revision_id FROM practice_sessions WHERE id = OLD.practice_session_id;
        END IF;
    END IF;
    IF pinned_revision_id IS NOT NULL AND TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Version-pinned practice items are immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'practice_schedule_items' THEN
            SELECT practice_plan_revision_id INTO destination_revision_id FROM practice_schedules WHERE id = NEW.practice_schedule_id;
        ELSE
            SELECT practice_plan_revision_id INTO destination_revision_id FROM practice_sessions WHERE id = NEW.practice_session_id;
        END IF;
        IF destination_revision_id IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot move existing items into version-pinned practice' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        IF pinned_revision_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM practice_plan_revision_items i
            WHERE i.practice_plan_revision_id = pinned_revision_id AND i.question_id = NEW.question_id
                AND i.question_revision_id = NEW.question_revision_id
                AND i.question_part_id IS NOT DISTINCT FROM NEW.question_part_id AND i.position = NEW.position
        ) THEN
            RAISE EXCEPTION 'Practice item must preserve its learning-book revision item' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER practice_schedule_items_revision_pin_check BEFORE INSERT OR UPDATE OR DELETE ON practice_schedule_items
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_practice_item();
CREATE TRIGGER practice_session_items_revision_pin_check BEFORE INSERT OR UPDATE OR DELETE ON practice_session_items
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_practice_item();

CREATE FUNCTION lerniqa_guard_plan_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.user_id,NEW.learner_id,NEW.kind,NEW.practice_plan_id,NEW.subscription_id,NEW.revision_id,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.learner_id,OLD.kind,OLD.practice_plan_id,OLD.subscription_id,OLD.revision_id,OLD.created_at)
        OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
        RAISE EXCEPTION 'Learning-book notification provenance and read receipt are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER practice_plan_notifications_provenance_check BEFORE UPDATE ON practice_plan_notifications
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_notification();

CREATE FUNCTION lerniqa_guard_plan_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Learning-book audit and mutation receipts are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER practice_plan_audit_events_append_only BEFORE UPDATE OR DELETE ON practice_plan_audit_events
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_append_only();
CREATE TRIGGER practice_plan_mutation_receipts_append_only BEFORE UPDATE OR DELETE ON practice_plan_mutation_receipts
    FOR EACH ROW EXECUTE FUNCTION lerniqa_guard_plan_append_only();

INSERT INTO schema_migrations (version, name) VALUES ('0017', 'learning_book_plans');
COMMIT;
