BEGIN;

-- Recovery challenges must keep the exact email identity they were issued
-- for. Existing email verification deliberately keeps its current dynamic
-- single-email lookup; only password/PIN recovery receives this binding.
-- The table locks close the upgrade window while legacy rows are reconciled.
LOCK TABLE users, account_identities, verification_challenges
    IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE verification_challenges
    ADD COLUMN account_identity_id uuid;

-- Only unconsumed legacy recovery challenges are backfilled. Each must have
-- exactly one active email identity; ambiguity is an atomic migration error,
-- never an implicit cancellation or guessed identity. Consumed legacy rows may
-- retain NULL because they cannot become usable again.
WITH unconsumed_recovery_identity AS (
    SELECT
        challenge.id AS challenge_id,
        count(identity.id)::integer AS identity_count,
        (array_agg(identity.id ORDER BY identity.id)
            FILTER (WHERE identity.id IS NOT NULL))[1] AS identity_id
    FROM verification_challenges AS challenge
    LEFT JOIN account_identities AS identity
        ON identity.user_id = challenge.user_id
        AND identity.provider = 'email'
        AND identity.revoked_at IS NULL
    WHERE challenge.purpose IN ('password_reset', 'role_pin_reset')
        AND challenge.consumed_at IS NULL
    GROUP BY challenge.id
)
UPDATE verification_challenges AS challenge
SET account_identity_id = candidate.identity_id
FROM unconsumed_recovery_identity AS candidate
WHERE challenge.id = candidate.challenge_id
    AND candidate.identity_count = 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM verification_challenges AS challenge
        LEFT JOIN account_identities AS identity
            ON identity.id = challenge.account_identity_id
            AND identity.user_id = challenge.user_id
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
        LEFT JOIN users AS app_user ON app_user.id = challenge.user_id
        WHERE challenge.purpose IN ('password_reset', 'role_pin_reset')
            AND challenge.consumed_at IS NULL
            AND (
                identity.id IS NULL
                OR app_user.status IS DISTINCT FROM 'active'
                OR (
                    challenge.purpose = 'role_pin_reset'
                    AND identity.verified_at IS NULL
                )
            )
    ) THEN
        RAISE EXCEPTION 'unconsumed legacy recovery challenge lacks one valid bound email identity'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM verification_challenges AS challenge
        WHERE challenge.purpose IN ('password_reset', 'role_pin_reset')
            AND challenge.consumed_at IS NULL
        GROUP BY
            challenge.user_id,
            challenge.purpose,
            CASE
                WHEN challenge.purpose = 'role_pin_reset'
                    THEN challenge.target_role
                ELSE NULL
            END
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'multiple active legacy recovery challenges exist for one recovery scope'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE account_identities
    ADD CONSTRAINT account_identities_id_user_unique UNIQUE (id, user_id);

ALTER TABLE verification_challenges
    ADD CONSTRAINT verification_challenges_account_identity_user_fk
        FOREIGN KEY (account_identity_id, user_id)
        REFERENCES account_identities(id, user_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT verification_challenges_recovery_identity_presence_check
        CHECK (
            (
                purpose IN ('password_reset', 'role_pin_reset')
                AND (
                    account_identity_id IS NOT NULL
                    OR consumed_at IS NOT NULL
                )
            )
            OR (
                purpose NOT IN ('password_reset', 'role_pin_reset')
                AND account_identity_id IS NULL
            )
        );

CREATE UNIQUE INDEX verification_challenges_active_password_reset_user_unique
    ON verification_challenges(user_id)
    WHERE purpose = 'password_reset' AND consumed_at IS NULL;

CREATE UNIQUE INDEX verification_challenges_active_role_pin_reset_unique
    ON verification_challenges(user_id, target_role)
    WHERE purpose = 'role_pin_reset' AND consumed_at IS NULL;

CREATE INDEX verification_challenges_recovery_identity_lookup_index
    ON verification_challenges(
        account_identity_id,
        purpose,
        consumed_at,
        expires_at
    )
    WHERE purpose IN ('password_reset', 'role_pin_reset');

CREATE INDEX verification_challenges_recovery_rate_index
    ON verification_challenges(
        user_id,
        purpose,
        target_role,
        created_at DESC
    );

CREATE FUNCTION lerniqa_recovery_challenge_is_usable(
    candidate_challenge_id uuid,
    candidate_user_id uuid,
    candidate_account_identity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM verification_challenges AS challenge
        JOIN account_identities AS identity
            ON identity.id = challenge.account_identity_id
            AND identity.user_id = challenge.user_id
            AND identity.provider = 'email'
            AND identity.revoked_at IS NULL
        JOIN users AS app_user
            ON app_user.id = challenge.user_id
            AND app_user.status = 'active'
        WHERE challenge.id = candidate_challenge_id
            AND challenge.user_id = candidate_user_id
            AND challenge.account_identity_id = candidate_account_identity_id
            AND challenge.purpose IN ('password_reset', 'role_pin_reset')
            AND challenge.consumed_at IS NULL
            AND challenge.expires_at > transaction_timestamp()
            AND (
                challenge.purpose <> 'role_pin_reset'
                OR identity.verified_at IS NOT NULL
            )
    );
$$;

COMMENT ON FUNCTION lerniqa_recovery_challenge_is_usable(uuid, uuid, uuid) IS
    'Recovery preflight predicate. Call after lerniqa_lock_auth_user(user_id), then consume in the same transaction; the write trigger rechecks the bound active email identity.';

CREATE FUNCTION lerniqa_validate_recovery_challenge_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    identity_user_id uuid;
    identity_provider varchar(30);
    identity_verified_at timestamptz;
    identity_revoked_at timestamptz;
    identity_user_status varchar(20);
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.purpose IN ('password_reset', 'role_pin_reset')
        AND (
            NEW.id IS DISTINCT FROM OLD.id
            OR NEW.user_id IS DISTINCT FROM OLD.user_id
            OR NEW.purpose IS DISTINCT FROM OLD.purpose
            OR NEW.target_role IS DISTINCT FROM OLD.target_role
            OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
            OR NEW.account_identity_id IS DISTINCT FROM OLD.account_identity_id
            OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
            OR NEW.created_at IS DISTINCT FROM OLD.created_at
            OR (
                OLD.consumed_at IS NOT NULL
                AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
            )
        ) THEN
        RAISE EXCEPTION 'recovery challenge identity and issuance evidence are immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.purpose NOT IN ('password_reset', 'role_pin_reset') THEN
        IF NEW.account_identity_id IS NOT NULL THEN
            RAISE EXCEPTION 'only password and role-PIN recovery challenges may bind an account identity'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.account_identity_id IS NULL THEN
        RAISE EXCEPTION 'new recovery challenge requires an account identity'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.purpose IS DISTINCT FROM OLD.purpose
        OR NEW.target_role IS DISTINCT FROM OLD.target_role
        OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
        OR NEW.account_identity_id IS DISTINCT FROM OLD.account_identity_id
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR (
            OLD.consumed_at IS NOT NULL
            AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
        )
    ) THEN
        RAISE EXCEPTION 'recovery challenge identity and issuance evidence are immutable'
            USING ERRCODE = '23514';
    END IF;

    -- A consumed, unbound row can only be a fail-closed legacy challenge that
    -- the upgrade could not map. It may not be made usable again.
    IF NEW.account_identity_id IS NULL THEN
        IF NEW.consumed_at IS NULL THEN
            RAISE EXCEPTION 'unconsumed recovery challenge requires an account identity'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    SELECT
        identity.user_id,
        identity.provider,
        identity.verified_at,
        identity.revoked_at,
        app_user.status
    INTO
        identity_user_id,
        identity_provider,
        identity_verified_at,
        identity_revoked_at,
        identity_user_status
    FROM account_identities AS identity
    JOIN users AS app_user ON app_user.id = identity.user_id
    WHERE identity.id = NEW.account_identity_id
    FOR UPDATE OF identity;

    IF NOT FOUND
        OR identity_user_id IS DISTINCT FROM NEW.user_id
        OR identity_provider IS DISTINCT FROM 'email'
        OR identity_revoked_at IS NOT NULL
        OR identity_user_status IS DISTINCT FROM 'active'
        OR (
            NEW.purpose = 'role_pin_reset'
            AND identity_verified_at IS NULL
        ) THEN
        RAISE EXCEPTION 'recovery challenge requires the same active email identity; role-PIN recovery additionally requires verification'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER verification_challenges_auth_user_lock
BEFORE INSERT OR UPDATE OR DELETE ON verification_challenges
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_auth_change_user();

CREATE TRIGGER verification_challenges_recovery_identity_check
BEFORE INSERT OR UPDATE ON verification_challenges
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_recovery_challenge_identity();

CREATE FUNCTION lerniqa_validate_recovery_challenge_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    candidate_challenge_id uuid;
    candidate_identity_ids uuid[] := ARRAY[]::uuid[];
    candidate_user_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF TG_TABLE_NAME = 'verification_challenges' THEN
        IF TG_OP = 'DELETE' THEN
            candidate_challenge_id := OLD.id;
        ELSE
            candidate_challenge_id := NEW.id;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM verification_challenges AS challenge
            LEFT JOIN account_identities AS identity
                ON identity.id = challenge.account_identity_id
            LEFT JOIN users AS app_user ON app_user.id = challenge.user_id
            WHERE challenge.id = candidate_challenge_id
                AND challenge.purpose IN ('password_reset', 'role_pin_reset')
                AND challenge.consumed_at IS NULL
                AND (
                    identity.id IS NULL
                    OR identity.user_id IS DISTINCT FROM challenge.user_id
                    OR identity.provider IS DISTINCT FROM 'email'
                    OR identity.revoked_at IS NOT NULL
                    OR app_user.status IS DISTINCT FROM 'active'
                    OR (
                        challenge.purpose = 'role_pin_reset'
                        AND identity.verified_at IS NULL
                    )
                )
        ) THEN
            RAISE EXCEPTION 'unconsumed recovery challenge lost its valid bound email identity'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'account_identities' THEN
        IF TG_OP <> 'INSERT' THEN
            candidate_identity_ids := array_append(
                candidate_identity_ids,
                OLD.id
            );
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_identity_ids := array_append(
                candidate_identity_ids,
                NEW.id
            );
        END IF;

        IF EXISTS (
            SELECT 1
            FROM verification_challenges AS challenge
            LEFT JOIN account_identities AS identity
                ON identity.id = challenge.account_identity_id
            LEFT JOIN users AS app_user ON app_user.id = challenge.user_id
            WHERE challenge.account_identity_id = ANY(candidate_identity_ids)
                AND challenge.purpose IN ('password_reset', 'role_pin_reset')
                AND challenge.consumed_at IS NULL
                AND (
                    identity.id IS NULL
                    OR identity.user_id IS DISTINCT FROM challenge.user_id
                    OR identity.provider IS DISTINCT FROM 'email'
                    OR identity.revoked_at IS NOT NULL
                    OR app_user.status IS DISTINCT FROM 'active'
                    OR (
                        challenge.purpose = 'role_pin_reset'
                        AND identity.verified_at IS NULL
                    )
                )
        ) THEN
            RAISE EXCEPTION 'account identity change would invalidate an unconsumed recovery challenge'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            candidate_user_ids := array_append(candidate_user_ids, OLD.id);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            candidate_user_ids := array_append(candidate_user_ids, NEW.id);
        END IF;

        IF EXISTS (
            SELECT 1
            FROM verification_challenges AS challenge
            JOIN account_identities AS identity
                ON identity.id = challenge.account_identity_id
            JOIN users AS app_user ON app_user.id = challenge.user_id
            WHERE challenge.user_id = ANY(candidate_user_ids)
                AND challenge.purpose IN ('password_reset', 'role_pin_reset')
                AND challenge.consumed_at IS NULL
                AND app_user.status <> 'active'
        ) THEN
            RAISE EXCEPTION 'account status change would invalidate an unconsumed recovery challenge'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER verification_challenges_recovery_final_state
AFTER INSERT OR UPDATE OR DELETE ON verification_challenges
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_recovery_challenge_final_state();

CREATE CONSTRAINT TRIGGER account_identities_recovery_final_state
AFTER INSERT OR UPDATE OR DELETE ON account_identities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_recovery_challenge_final_state();

CREATE CONSTRAINT TRIGGER users_recovery_final_state
AFTER UPDATE OF status ON users
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_recovery_challenge_final_state();

-- Extend review provenance with a classifier-backed same-question-type basis.
-- This remains a distinct basis: it does not borrow any topic, knowledge,
-- unit, subject, or confirmed-group discriminator column.
-- The database validates each selected source/target pair. The selector must
-- still enumerate the complete eligible same-type set in one transaction and
-- may fall back to confirmed_group only when that set is empty; a row-level
-- constraint cannot prove that candidate-set priority.
ALTER TABLE practice_session_items
    DROP CONSTRAINT practice_session_items_reason_check,
    ADD CONSTRAINT practice_session_items_reason_check
        CHECK (
            selection_reason IN (
                'filter',
                'fixed',
                'wrong_review',
                'similar_review',
                'same_type_review',
                'difficulty_fill'
            )
        );

ALTER TABLE learner_practice_queue_items
    DROP CONSTRAINT learner_practice_queue_items_match_basis_check,
    DROP CONSTRAINT learner_practice_queue_items_origin_check,
    ADD CONSTRAINT learner_practice_queue_items_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN (
                'confirmed_group',
                'same_topic',
                'same_knowledge_point',
                'same_unit',
                'same_subject',
                'same_question_type'
            )
        ),
    ADD CONSTRAINT learner_practice_queue_items_origin_check
        CHECK (
            (
                reason = 'wrong_review'
                AND source_answer_part_result_id IS NOT NULL
                AND match_basis IS NULL
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
            )
            OR (
                reason = 'similar_review'
                AND source_answer_part_result_id IS NOT NULL
                AND (
                    (
                        match_basis = 'same_question_type'
                        AND num_nonnulls(
                            similarity_group_id,
                            matched_topic_id,
                            matched_knowledge_point_id,
                            matched_curriculum_unit_id,
                            matched_subject_id
                        ) = 0
                    )
                    OR (
                        (
                            (match_basis = 'confirmed_group' AND similarity_group_id IS NOT NULL)
                            OR (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                            OR (
                                match_basis = 'same_knowledge_point'
                                AND matched_knowledge_point_id IS NOT NULL
                            )
                            OR (
                                match_basis = 'same_unit'
                                AND matched_curriculum_unit_id IS NOT NULL
                            )
                            OR (
                                match_basis = 'same_subject'
                                AND matched_subject_id IS NOT NULL
                            )
                        )
                        AND num_nonnulls(
                            similarity_group_id,
                            matched_topic_id,
                            matched_knowledge_point_id,
                            matched_curriculum_unit_id,
                            matched_subject_id
                        ) = 1
                    )
                )
            )
            OR (
                reason IN ('manual', 'legacy_migration')
                AND match_basis IS NULL
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
                AND (reason = 'manual' OR source_answer_part_result_id IS NULL)
            )
        );

ALTER TABLE practice_session_item_origins
    DROP CONSTRAINT practice_session_item_origins_match_basis_check,
    DROP CONSTRAINT practice_session_item_origins_basis_check,
    ADD CONSTRAINT practice_session_item_origins_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN (
                'confirmed_group',
                'same_topic',
                'same_knowledge_point',
                'same_unit',
                'same_subject',
                'same_question_type'
            )
        ),
    ADD CONSTRAINT practice_session_item_origins_basis_check
        CHECK (
            (
                relation_kind = 'wrong_review'
                AND match_basis IS NULL
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
            )
            OR (
                relation_kind = 'similar_review'
                AND (
                    (
                        match_basis = 'same_question_type'
                        AND num_nonnulls(
                            similarity_group_id,
                            matched_topic_id,
                            matched_knowledge_point_id,
                            matched_curriculum_unit_id,
                            matched_subject_id
                        ) = 0
                    )
                    OR (
                        (
                            (match_basis = 'confirmed_group' AND similarity_group_id IS NOT NULL)
                            OR (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                            OR (
                                match_basis = 'same_knowledge_point'
                                AND matched_knowledge_point_id IS NOT NULL
                            )
                            OR (
                                match_basis = 'same_unit'
                                AND matched_curriculum_unit_id IS NOT NULL
                            )
                            OR (
                                match_basis = 'same_subject'
                                AND matched_subject_id IS NOT NULL
                            )
                        )
                        AND num_nonnulls(
                            similarity_group_id,
                            matched_topic_id,
                            matched_knowledge_point_id,
                            matched_curriculum_unit_id,
                            matched_subject_id
                        ) = 1
                    )
                )
            )
        );

CREATE OR REPLACE FUNCTION lerniqa_similarity_match_is_valid(
    source_result_id uuid,
    target_question_id uuid,
    target_revision_id uuid,
    selected_match_basis varchar,
    selected_similarity_group_id uuid,
    selected_topic_id uuid,
    selected_knowledge_point_id uuid,
    selected_curriculum_unit_id uuid,
    selected_subject_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    source_question_id uuid;
    source_revision_id uuid;
    source_current_result varchar(20);
BEGIN
    SELECT item.question_id, item.question_revision_id, result.current_result
    INTO source_question_id, source_revision_id, source_current_result
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
    WHERE result.id = source_result_id;

    IF source_question_id IS NULL OR source_current_result <> 'wrong' THEN
        RETURN false;
    END IF;

    CASE selected_match_basis
        WHEN 'confirmed_group' THEN
            RETURN selected_similarity_group_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM question_similarity_groups AS similarity_group
                    WHERE similarity_group.id = selected_similarity_group_id
                        AND similarity_group.status = 'confirmed'
                )
                AND EXISTS (
                    SELECT 1
                    FROM question_similarity_memberships AS membership
                    WHERE membership.similarity_group_id = selected_similarity_group_id
                        AND membership.question_id = source_question_id
                        AND membership.based_on_revision_id = source_revision_id
                        AND membership.status = 'confirmed'
                )
                AND EXISTS (
                    SELECT 1
                    FROM question_similarity_memberships AS membership
                    WHERE membership.similarity_group_id = selected_similarity_group_id
                        AND membership.question_id = target_question_id
                        AND membership.based_on_revision_id = target_revision_id
                        AND membership.status = 'confirmed'
                );

        WHEN 'same_topic' THEN
            RETURN selected_topic_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revision_topics
                    WHERE question_revision_id = source_revision_id
                        AND topic_id = selected_topic_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revision_topics
                    WHERE question_revision_id = target_revision_id
                        AND topic_id = selected_topic_id
                );

        WHEN 'same_knowledge_point' THEN
            RETURN selected_knowledge_point_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revision_knowledge_points
                    WHERE question_revision_id = source_revision_id
                        AND knowledge_point_id = selected_knowledge_point_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revision_knowledge_points
                    WHERE question_revision_id = target_revision_id
                        AND knowledge_point_id = selected_knowledge_point_id
                );

        WHEN 'same_unit' THEN
            RETURN selected_curriculum_unit_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revision_units
                    WHERE question_revision_id = source_revision_id
                        AND curriculum_unit_id = selected_curriculum_unit_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revision_units
                    WHERE question_revision_id = target_revision_id
                        AND curriculum_unit_id = selected_curriculum_unit_id
                );

        WHEN 'same_subject' THEN
            RETURN selected_subject_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM question_revisions
                    WHERE id = source_revision_id
                        AND subject_id = selected_subject_id
                )
                AND EXISTS (
                    SELECT 1 FROM question_revisions
                    WHERE id = target_revision_id
                        AND question_id = target_question_id
                        AND subject_id = selected_subject_id
                );

        WHEN 'same_question_type' THEN
            RETURN EXISTS (
                SELECT 1
                FROM question_revisions AS source_revision
                JOIN question_types AS source_type
                    ON source_type.id = source_revision.question_type_id
                JOIN question_revisions AS target_revision
                    ON target_revision.id = target_revision_id
                    AND target_revision.question_id = target_question_id
                WHERE source_revision.id = source_revision_id
                    AND source_revision.question_id = source_question_id
                    AND source_revision.source_category_id IS NOT NULL
                    AND target_revision.source_category_id IS NOT NULL
                    AND target_revision.source_category_id = source_revision.source_category_id
                    AND target_revision.question_type_id = source_revision.question_type_id
                    AND (
                        source_type.code NOT IN (
                            'single-choice',
                            'multi-choice',
                            'written'
                        )
                        OR (
                            source_revision.original_question_type_label IS NOT NULL
                            AND btrim(source_revision.original_question_type_label) <> ''
                            AND target_revision.original_question_type_label IS NOT NULL
                            AND btrim(target_revision.original_question_type_label) <> ''
                            AND target_revision.original_question_type_label
                                = source_revision.original_question_type_label
                        )
                    )
            );

        ELSE
            RETURN false;
    END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_session_item_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    session_learner_id uuid;
    session_check_mode varchar(20);
    item_question_id uuid;
    item_revision_id uuid;
    item_part_id uuid;
    item_selection_reason varchar(30);
    expected_selection_reason varchar(30);
    source_learner_id uuid;
    source_result varchar(20);
    source_question_id uuid;
    source_revision_id uuid;
    source_part_id uuid;
    queue_row learner_practice_queue_items%ROWTYPE;
BEGIN
    SELECT
        session.learner_id,
        session.check_mode,
        item.question_id,
        item.question_revision_id,
        item.question_part_id,
        item.selection_reason
    INTO
        session_learner_id,
        session_check_mode,
        item_question_id,
        item_revision_id,
        item_part_id,
        item_selection_reason
    FROM practice_session_items AS item
    JOIN practice_sessions AS session ON session.id = item.practice_session_id
    WHERE item.id = NEW.practice_session_item_id;

    IF session_check_mode IS DISTINCT FROM 'instant'
        AND session_check_mode IS DISTINCT FROM 'complete' THEN
        RAISE EXCEPTION '練習來源追溯只允許 instant 或 complete 工作階段'
            USING ERRCODE = '23514';
    END IF;

    SELECT
        attempt.learner_id,
        result.current_result,
        source_item.question_id,
        source_item.question_revision_id,
        result.question_part_id
    INTO
        source_learner_id,
        source_result,
        source_question_id,
        source_revision_id,
        source_part_id
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS source_item
        ON source_item.id = attempt.practice_session_item_id
    WHERE result.id = NEW.source_answer_part_result_id;

    IF session_learner_id IS DISTINCT FROM source_learner_id THEN
        RAISE EXCEPTION '練習來源作答必須屬於同一學習者'
            USING ERRCODE = '23514';
    END IF;

    expected_selection_reason := CASE
        WHEN NEW.relation_kind = 'similar_review'
            AND NEW.match_basis = 'same_question_type'
            THEN 'same_type_review'
        ELSE NEW.relation_kind
    END;

    IF item_selection_reason IS DISTINCT FROM expected_selection_reason THEN
        RAISE EXCEPTION '練習項目的選入原因必須與來源追溯關係及比對依據一致'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.relation_kind = 'wrong_review' AND (
        source_result IS DISTINCT FROM 'wrong'
        OR item_question_id IS DISTINCT FROM source_question_id
        OR item_revision_id IS DISTINCT FROM source_revision_id
        OR item_part_id IS DISTINCT FROM source_part_id
    ) THEN
        RAISE EXCEPTION '錯題練習來源與練習項目的題目、版本或小題不一致'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.relation_kind = 'similar_review'
        AND NOT lerniqa_similarity_match_is_valid(
            NEW.source_answer_part_result_id,
            item_question_id,
            item_revision_id,
            NEW.match_basis,
            NEW.similarity_group_id,
            NEW.matched_topic_id,
            NEW.matched_knowledge_point_id,
            NEW.matched_curriculum_unit_id,
            NEW.matched_subject_id
        ) THEN
        RAISE EXCEPTION '相近題練習來源與練習項目的比對依據不成立'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.queue_item_id IS NOT NULL THEN
        SELECT *
        INTO queue_row
        FROM learner_practice_queue_items
        WHERE id = NEW.queue_item_id;

        IF NOT FOUND
            OR queue_row.learner_id IS DISTINCT FROM session_learner_id
            OR queue_row.status <> 'consumed'
            OR queue_row.consumed_at IS NULL
            OR queue_row.source_answer_part_result_id IS DISTINCT FROM NEW.source_answer_part_result_id
            OR queue_row.reason IS DISTINCT FROM NEW.relation_kind
            OR queue_row.question_id IS DISTINCT FROM item_question_id
            OR queue_row.question_revision_id IS DISTINCT FROM item_revision_id
            OR queue_row.question_part_id IS DISTINCT FROM item_part_id
            OR queue_row.match_basis IS DISTINCT FROM NEW.match_basis
            OR queue_row.similarity_group_id IS DISTINCT FROM NEW.similarity_group_id
            OR queue_row.matched_topic_id IS DISTINCT FROM NEW.matched_topic_id
            OR queue_row.matched_knowledge_point_id IS DISTINCT FROM NEW.matched_knowledge_point_id
            OR queue_row.matched_curriculum_unit_id IS DISTINCT FROM NEW.matched_curriculum_unit_id
            OR queue_row.matched_subject_id IS DISTINCT FROM NEW.matched_subject_id THEN
            RAISE EXCEPTION '練習來源與消耗的後續練習項目不一致'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- This receipt is the durable identity of one recommendation request. The
-- session primary key is the only idempotency key: different sessions may
-- legitimately have the same canonical request hash when a learner retries.
-- The producer owns canonical-v1 SHA-256 preimage construction and must first
-- look up this row by practice_session_id, returning 409 on a different replay.
-- LOCAL_PRACTICE_MAX_RECOMMENDATIONS is 100 in the front-end contract.
CREATE FUNCTION lerniqa_uuid_array_is_canonical_unique(candidate_ids uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT array_ndims(candidate_ids) = 1
        AND array_lower(candidate_ids, 1) = 1
        AND cardinality(candidate_ids) = (
            SELECT count(DISTINCT candidate_id)
            FROM unnest(candidate_ids) AS candidate(candidate_id)
        )
        AND array_position(candidate_ids, NULL) IS NULL
        AND candidate_ids = ARRAY(
            SELECT candidate_id
            FROM unnest(candidate_ids) AS candidate(candidate_id)
            ORDER BY candidate_id
        );
$$;

CREATE TABLE practice_recommendation_requests (
    practice_session_id uuid PRIMARY KEY
        REFERENCES practice_sessions(id) ON DELETE RESTRICT,
    learner_id uuid NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
    created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    check_mode varchar(20) NOT NULL,
    request_hash varchar(64) NOT NULL,
    source_queue_item_ids uuid[] NOT NULL,
    source_answer_part_result_ids uuid[] NOT NULL,
    requested_limit smallint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT practice_recommendation_requests_check_mode_check
        CHECK (check_mode IN ('instant', 'complete')),
    CONSTRAINT practice_recommendation_requests_hash_check
        CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT practice_recommendation_requests_sources_check
        CHECK (
            cardinality(source_queue_item_ids) BETWEEN 1 AND 100
            AND cardinality(source_answer_part_result_ids)
                = cardinality(source_queue_item_ids)
            AND lerniqa_uuid_array_is_canonical_unique(source_queue_item_ids)
            AND array_ndims(source_answer_part_result_ids) = 1
            AND array_lower(source_answer_part_result_ids, 1) = 1
            AND array_position(source_answer_part_result_ids, NULL) IS NULL
        ),
    CONSTRAINT practice_recommendation_requests_limit_check
        CHECK (requested_limit BETWEEN 1 AND 100)
);

CREATE INDEX practice_recommendation_requests_learner_created_index
    ON practice_recommendation_requests(learner_id, created_at DESC);

CREATE INDEX practice_recommendation_requests_hash_index
    ON practice_recommendation_requests(request_hash);

CREATE INDEX practice_recommendation_requests_queue_items_gin
    ON practice_recommendation_requests USING gin(source_queue_item_ids);

CREATE INDEX practice_recommendation_requests_results_gin
    ON practice_recommendation_requests
    USING gin(source_answer_part_result_ids);

CREATE FUNCTION lerniqa_prepare_practice_recommendation_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'practice recommendation request evidence is append-only'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM practice_sessions AS session
        WHERE session.id = NEW.practice_session_id
            AND session.learner_id = NEW.learner_id
            AND session.created_by_user_id = NEW.created_by_user_id
            AND session.check_mode = NEW.check_mode
            AND session.check_mode IN ('instant', 'complete')
    ) THEN
        RAISE EXCEPTION 'practice recommendation request must match one non-score session, learner, creator, and check mode'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM unnest(
            NEW.source_queue_item_ids,
            NEW.source_answer_part_result_ids
        ) WITH ORDINALITY AS source_pair(
            queue_item_id,
            answer_part_result_id,
            pair_position
        )
        LEFT JOIN learner_practice_queue_items AS queue_item
            ON queue_item.id = source_pair.queue_item_id
        LEFT JOIN answer_part_results AS result
            ON result.id = source_pair.answer_part_result_id
        LEFT JOIN answer_attempts AS attempt
            ON attempt.id = result.answer_attempt_id
        WHERE queue_item.id IS NULL
            OR result.id IS NULL
            OR queue_item.learner_id IS DISTINCT FROM NEW.learner_id
            OR attempt.learner_id IS DISTINCT FROM NEW.learner_id
            OR queue_item.source_answer_part_result_id
                IS DISTINCT FROM source_pair.answer_part_result_id
    ) THEN
        RAISE EXCEPTION 'each recommendation source pair must bind one queue item to its exact same-learner answer result'
            USING ERRCODE = '23514';
    END IF;

    NEW.created_at := transaction_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER practice_recommendation_requests_append_only
BEFORE INSERT OR UPDATE OR DELETE ON practice_recommendation_requests
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_practice_recommendation_request();

-- Extend 0011's provenance guard without changing its trigger name. Score
-- sessions cannot acquire answer-detail origins, and a durable recommendation
-- receipt freezes the parent session identity saved in that receipt.
CREATE OR REPLACE FUNCTION lerniqa_protect_score_receipt_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'practice_sessions' THEN
        IF NEW.check_mode = 'score'
            AND NEW.check_mode IS DISTINCT FROM OLD.check_mode
            AND EXISTS (
                SELECT 1
                FROM practice_session_items AS item
                JOIN answer_attempts AS attempt
                    ON attempt.practice_session_item_id = item.id
                WHERE item.practice_session_id = OLD.id
            ) THEN
            RAISE EXCEPTION '已有逐題作答的練習不可改成 score 模式'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.check_mode = 'score'
            AND NEW.check_mode IS DISTINCT FROM OLD.check_mode
            AND EXISTS (
                SELECT 1
                FROM practice_session_items AS item
                JOIN practice_session_item_origins AS origin
                    ON origin.practice_session_item_id = item.id
                WHERE item.practice_session_id = OLD.id
            ) THEN
            RAISE EXCEPTION '已有逐題來源追溯的練習不可改成 score 模式'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM practice_score_receipts AS receipt
            JOIN practice_session_items AS item
                ON item.id = receipt.practice_session_item_id
            WHERE item.practice_session_id = OLD.id
        ) AND (
            NEW.learner_id IS DISTINCT FROM OLD.learner_id
            OR NEW.check_mode IS DISTINCT FROM OLD.check_mode
        ) THEN
            RAISE EXCEPTION '已有 score 收據的練習不可改換學習者或檢查模式'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM practice_recommendation_requests AS request
            WHERE request.practice_session_id = OLD.id
        ) AND (
            NEW.learner_id IS DISTINCT FROM OLD.learner_id
            OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
            OR NEW.check_mode IS DISTINCT FROM OLD.check_mode
        ) THEN
            RAISE EXCEPTION '已有推薦請求收據的練習不可改換學習者、建立者或檢查模式'
                USING ERRCODE = '23514';
        END IF;
    ELSIF EXISTS (
        SELECT 1
        FROM practice_score_receipts
        WHERE practice_session_item_id = OLD.id
    ) AND (
        NEW.practice_session_id IS DISTINCT FROM OLD.practice_session_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
        OR NEW.question_revision_id IS DISTINCT FROM OLD.question_revision_id
        OR NEW.question_part_id IS DISTINCT FROM OLD.question_part_id
    ) THEN
        RAISE EXCEPTION '已有 score 收據的練習項目不可改寫題目或工作階段'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER practice_sessions_score_receipt_immutable
    ON practice_sessions;

CREATE TRIGGER practice_sessions_score_receipt_immutable
BEFORE UPDATE OF learner_id, created_by_user_id, check_mode ON practice_sessions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_score_receipt_provenance();

-- Enrichment is a batch sidecar over frozen revisions. The run keeps the
-- model identity; each pending suggestion pins its own revision input hash.
CREATE TABLE question_enrichment_runs (
    id uuid PRIMARY KEY,
    purpose varchar(80) NOT NULL,
    engine varchar(40) NOT NULL,
    model_name varchar(160) NOT NULL,
    model_digest varchar(64) NOT NULL,
    prompt_version varchar(160) NOT NULL,
    taxonomy_version varchar(160) NOT NULL,
    status varchar(20) NOT NULL,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    error_code varchar(80),
    created_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT question_enrichment_runs_identity_check
        CHECK (
            btrim(purpose) <> ''
            AND btrim(engine) <> ''
            AND btrim(model_name) <> ''
            AND btrim(prompt_version) <> ''
            AND btrim(taxonomy_version) <> ''
        ),
    CONSTRAINT question_enrichment_runs_digest_check
        CHECK (model_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT question_enrichment_runs_status_check
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT question_enrichment_runs_error_check
        CHECK (
            error_code IS NULL
            OR error_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,79}$'
        ),
    CONSTRAINT question_enrichment_runs_state_check
        CHECK (
            (status IN ('queued', 'running') AND finished_at IS NULL AND error_code IS NULL)
            OR (status = 'completed' AND finished_at IS NOT NULL AND error_code IS NULL)
            OR (status = 'failed' AND finished_at IS NOT NULL AND error_code IS NOT NULL)
            OR (status = 'cancelled' AND finished_at IS NOT NULL AND error_code IS NULL)
        ),
    CONSTRAINT question_enrichment_runs_timestamps_check
        CHECK (
            started_at >= created_at
            AND (finished_at IS NULL OR finished_at >= started_at)
        )
);

CREATE INDEX question_enrichment_runs_status_index
    ON question_enrichment_runs(status, started_at, id);

CREATE TABLE question_revision_enrichment_suggestions (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES question_enrichment_runs(id),
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    dimension varchar(30) NOT NULL,
    suggested_key varchar(160) NOT NULL,
    suggested_label varchar(160) NOT NULL,
    input_sha256 varchar(64) NOT NULL,
    confidence numeric(5, 4) NOT NULL,
    evidence jsonb NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT question_enrichment_suggestions_run_revision_dimension_unique
        UNIQUE (run_id, question_revision_id, dimension),
    CONSTRAINT question_revision_enrichment_suggestions_dimension_check
        CHECK (dimension IN ('fine_question_type', 'knowledge_point', 'solution_method')),
    CONSTRAINT question_revision_enrichment_suggestions_text_check
        CHECK (btrim(suggested_key) <> '' AND btrim(suggested_label) <> ''),
    CONSTRAINT question_revision_enrichment_suggestions_input_hash_check
        CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT question_revision_enrichment_suggestions_evidence_check
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND pg_column_size(evidence) <= 32768
        ),
    CONSTRAINT question_revision_enrichment_suggestions_confidence_check
        CHECK (confidence BETWEEN 0 AND 1),
    CONSTRAINT question_revision_enrichment_suggestions_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    CONSTRAINT question_revision_enrichment_suggestions_review_check
        CHECK (
            (
                status = 'pending'
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status IN ('approved', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
            OR (
                status = 'expired'
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
        ),
    CONSTRAINT question_revision_enrichment_suggestions_timestamps_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);

CREATE INDEX question_revision_enrichment_suggestions_revision_index
    ON question_revision_enrichment_suggestions(
        question_revision_id,
        dimension,
        status,
        created_at DESC,
        id
    );

CREATE FUNCTION lerniqa_prepare_question_enrichment_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'question enrichment run evidence cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('queued', 'running')
            OR NEW.finished_at IS NOT NULL
            OR NEW.error_code IS NOT NULL THEN
            RAISE EXCEPTION 'question enrichment run must start queued or running'
                USING ERRCODE = '23514';
        END IF;
        NEW.created_at := transaction_timestamp();
        NEW.started_at := NEW.created_at;
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.purpose IS DISTINCT FROM OLD.purpose
        OR NEW.engine IS DISTINCT FROM OLD.engine
        OR NEW.model_name IS DISTINCT FROM OLD.model_name
        OR NEW.model_digest IS DISTINCT FROM OLD.model_digest
        OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
        OR NEW.taxonomy_version IS DISTINCT FROM OLD.taxonomy_version
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'question enrichment run identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status IN ('queued', 'failed', 'cancelled') AND NEW.status = 'running' THEN
        NEW.started_at := transaction_timestamp();
        NEW.finished_at := NULL;
        NEW.error_code := NULL;
    ELSIF OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled') THEN
        NEW.finished_at := transaction_timestamp();
    ELSE
        RAISE EXCEPTION 'question enrichment run status transition is invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_enrichment_runs_history_check
BEFORE INSERT OR UPDATE OR DELETE ON question_enrichment_runs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_question_enrichment_run();

CREATE FUNCTION lerniqa_prepare_question_revision_enrichment_suggestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'question revision enrichment suggestion evidence cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending'
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'question revision enrichment suggestion must start pending'
                USING ERRCODE = '23514';
        END IF;
        NEW.created_at := transaction_timestamp();
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.run_id IS DISTINCT FROM OLD.run_id
        OR NEW.question_revision_id IS DISTINCT FROM OLD.question_revision_id
        OR NEW.dimension IS DISTINCT FROM OLD.dimension
        OR NEW.suggested_key IS DISTINCT FROM OLD.suggested_key
        OR NEW.suggested_label IS DISTINCT FROM OLD.suggested_label
        OR NEW.input_sha256 IS DISTINCT FROM OLD.input_sha256
        OR NEW.confidence IS DISTINCT FROM OLD.confidence
        OR NEW.evidence IS DISTINCT FROM OLD.evidence
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'question revision enrichment suggestion evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status <> 'pending'
        OR NEW.status NOT IN ('approved', 'rejected', 'expired') THEN
        RAISE EXCEPTION 'question revision enrichment suggestion status transition is invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status IN ('approved', 'rejected')
        AND NOT lerniqa_user_is_system_admin(NEW.reviewed_by_user_id) THEN
        RAISE EXCEPTION 'enrichment suggestion review requires an active system_admin user'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status IN ('approved', 'rejected') THEN
        NEW.reviewed_at := transaction_timestamp();
    ELSE
        NEW.reviewed_by_user_id := NULL;
        NEW.reviewed_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER question_revision_enrichment_suggestions_history_check
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_enrichment_suggestions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_question_revision_enrichment_suggestion();

CREATE FUNCTION lerniqa_validate_enrichment_suggestion_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_run_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'question_enrichment_runs' THEN
        affected_run_id := NEW.id;
    ELSE
        affected_run_id := NEW.run_id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_revision_enrichment_suggestions AS suggestion
        JOIN question_enrichment_runs AS enrichment_run
            ON enrichment_run.id = suggestion.run_id
        WHERE suggestion.run_id = affected_run_id
            AND enrichment_run.status <> 'completed'
    ) THEN
        RAISE EXCEPTION 'enrichment suggestions require a completed parent run at transaction end'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER question_enrichment_runs_suggestion_check
AFTER INSERT OR UPDATE OF status ON question_enrichment_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_enrichment_suggestion_run();

CREATE CONSTRAINT TRIGGER question_revision_enrichment_suggestions_run_check
AFTER INSERT OR UPDATE OF run_id, question_revision_id
ON question_revision_enrichment_suggestions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_enrichment_suggestion_run();

-- Handwriting analysis is a durable transactional queue plus immutable attempt
-- evidence. Neither table updates answer_part_results, review queues, or
-- aggregates. A human decision still enters through answer_reviews and its
-- existing audit/outbox workflow. The producer must keep recognized text and
-- structured evidence free of unrelated PII; no raw image, base64 payload,
-- full prompt, or reasoning-trace column exists here.
CREATE TABLE handwriting_analysis_jobs (
    id uuid PRIMARY KEY,
    answer_part_result_id uuid NOT NULL REFERENCES answer_part_results(id),
    asset_id uuid NOT NULL,
    question_revision_id uuid NOT NULL,
    question_part_id uuid NOT NULL,
    handwriting_asset_role varchar(20) NOT NULL DEFAULT 'handwriting',
    asset_checksum varchar(64) NOT NULL,
    reference_sha256 varchar(64),
    status varchar(20) NOT NULL DEFAULT 'queued',
    available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_expires_at timestamptz,
    lease_owner varchar(120),
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    last_error_code varchar(80),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at timestamptz,
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    CONSTRAINT handwriting_analysis_jobs_part_revision_fk
        FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT handwriting_analysis_jobs_handwriting_asset_fk
        FOREIGN KEY (
            answer_part_result_id,
            asset_id,
            handwriting_asset_role
        )
        REFERENCES answer_part_assets(
            answer_part_result_id,
            asset_id,
            asset_role
        ),
    CONSTRAINT handwriting_analysis_jobs_input_unique
        UNIQUE (
            answer_part_result_id,
            asset_id,
            asset_checksum,
            reference_sha256
        ),
    CONSTRAINT handwriting_analysis_jobs_asset_role_check
        CHECK (handwriting_asset_role = 'handwriting'),
    CONSTRAINT handwriting_analysis_jobs_hashes_check
        CHECK (
            asset_checksum ~ '^[0-9a-f]{64}$'
            AND (
                reference_sha256 IS NULL
                OR reference_sha256 ~ '^[0-9a-f]{64}$'
            )
        ),
    CONSTRAINT handwriting_analysis_jobs_status_check
        CHECK (
            status IN (
                'queued',
                'retry',
                'running',
                'completed',
                'failed',
                'reviewed',
                'cancelled'
            )
        ),
    CONSTRAINT handwriting_analysis_jobs_attempts_check
        CHECK (
            max_attempts BETWEEN 1 AND 20
            AND attempt_count BETWEEN 0 AND max_attempts
        ),
    CONSTRAINT handwriting_analysis_jobs_worker_check
        CHECK (lease_owner IS NULL OR btrim(lease_owner) <> ''),
    CONSTRAINT handwriting_analysis_jobs_error_code_check
        CHECK (
            last_error_code IS NULL
            OR last_error_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,79}$'
        ),
    CONSTRAINT handwriting_analysis_jobs_state_check
        CHECK (
            (
                status = 'queued'
                AND attempt_count = 0
                AND lease_expires_at IS NULL
                AND lease_owner IS NULL
                AND finished_at IS NULL
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
                AND last_error_code IS NULL
            )
            OR (
                status = 'retry'
                AND attempt_count > 0
                AND attempt_count < max_attempts
                AND lease_expires_at IS NULL
                AND lease_owner IS NULL
                AND finished_at IS NULL
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
                AND last_error_code IS NOT NULL
            )
            OR (
                status = 'running'
                AND attempt_count > 0
                AND finished_at IS NULL
                AND lease_expires_at IS NOT NULL
                AND lease_owner IS NOT NULL
                AND last_error_code IS NULL
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status = 'completed'
                AND attempt_count > 0
                AND finished_at IS NOT NULL
                AND lease_expires_at IS NULL
                AND lease_owner IS NULL
                AND last_error_code IS NULL
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status = 'failed'
                AND attempt_count > 0
                AND finished_at IS NOT NULL
                AND lease_expires_at IS NULL
                AND lease_owner IS NULL
                AND last_error_code IS NOT NULL
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status = 'reviewed'
                AND attempt_count > 0
                AND finished_at IS NOT NULL
                AND lease_expires_at IS NULL
                AND lease_owner IS NULL
                AND last_error_code IS NULL
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
            OR (
                status = 'cancelled'
                AND finished_at IS NOT NULL
                AND lease_expires_at IS NULL
                AND lease_owner IS NULL
                AND last_error_code IS NULL
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
        ),
    CONSTRAINT handwriting_analysis_jobs_timestamps_check
        CHECK (
            available_at >= created_at
            AND updated_at >= created_at
            AND (finished_at IS NULL OR finished_at >= created_at)
            AND (
                lease_expires_at IS NULL
                OR lease_expires_at > updated_at
            )
            AND (reviewed_at IS NULL OR reviewed_at >= finished_at)
        )
);

CREATE INDEX handwriting_analysis_jobs_worker_index
    ON handwriting_analysis_jobs(available_at, created_at, id)
    WHERE status IN ('queued', 'retry');

CREATE INDEX handwriting_analysis_jobs_lease_index
    ON handwriting_analysis_jobs(lease_expires_at, id)
    WHERE status = 'running';

CREATE INDEX handwriting_analysis_jobs_result_index
    ON handwriting_analysis_jobs(
        answer_part_result_id,
        status,
        created_at DESC,
        id
    );

CREATE TABLE handwriting_analysis_runs (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES handwriting_analysis_jobs(id),
    attempt_number integer NOT NULL,
    status varchar(20) NOT NULL,
    engine varchar(80) NOT NULL,
    model_name varchar(120) NOT NULL,
    model_version varchar(120) NOT NULL,
    model_digest varchar(64) NOT NULL,
    prompt_version varchar(80) NOT NULL,
    schema_version varchar(80) NOT NULL,
    rubric_version varchar(80),
    asset_checksum varchar(64) NOT NULL,
    reference_sha256 varchar(64),
    recognized_text text,
    transcription_confidence numeric(5, 4),
    legibility varchar(20),
    proposed_result varchar(20),
    result_confidence numeric(5, 4),
    uncertainty_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence jsonb,
    error_code varchar(80),
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT handwriting_analysis_runs_job_attempt_unique
        UNIQUE (job_id, attempt_number),
    CONSTRAINT handwriting_analysis_runs_status_check
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT handwriting_analysis_runs_attempt_check
        CHECK (attempt_number > 0),
    CONSTRAINT handwriting_analysis_runs_model_check
        CHECK (
            btrim(engine) <> ''
            AND btrim(model_name) <> ''
            AND btrim(model_version) <> ''
            AND model_digest ~ '^[0-9a-f]{64}$'
            AND btrim(prompt_version) <> ''
            AND btrim(schema_version) <> ''
            AND (rubric_version IS NULL OR btrim(rubric_version) <> '')
        ),
    CONSTRAINT handwriting_analysis_runs_hashes_check
        CHECK (
            asset_checksum ~ '^[0-9a-f]{64}$'
            AND (
                reference_sha256 IS NULL
                OR reference_sha256 ~ '^[0-9a-f]{64}$'
            )
        ),
    CONSTRAINT handwriting_analysis_runs_transcription_confidence_check
        CHECK (
            transcription_confidence IS NULL
            OR (
                recognized_text IS NOT NULL
                AND transcription_confidence BETWEEN 0 AND 1
            )
        ),
    CONSTRAINT handwriting_analysis_runs_legibility_check
        CHECK (legibility IS NULL OR legibility IN ('clear', 'uncertain', 'unreadable')),
    CONSTRAINT handwriting_analysis_runs_proposed_result_check
        CHECK (
            proposed_result IS NULL
            OR proposed_result IN ('correct', 'wrong', 'pending')
        ),
    CONSTRAINT handwriting_analysis_runs_result_confidence_check
        CHECK (
            result_confidence IS NULL
            OR result_confidence BETWEEN 0 AND 1
        ),
    CONSTRAINT handwriting_analysis_runs_uncertainty_reasons_check
        CHECK (
            jsonb_typeof(uncertainty_reasons) = 'array'
            AND pg_column_size(uncertainty_reasons) <= 8192
        ),
    CONSTRAINT handwriting_analysis_runs_evidence_check
        CHECK (
            evidence IS NULL
            OR (
                jsonb_typeof(evidence) = 'object'
                AND pg_column_size(evidence) <= 32768
                AND NOT (
                    evidence ?| ARRAY[
                        'base64',
                        'rawImage',
                        'fullPrompt',
                        'systemPrompt',
                        'chainOfThought',
                        'reasoningTrace',
                        'email',
                        'phone',
                        'address',
                        'learnerName'
                    ]
                )
            )
        ),
    CONSTRAINT handwriting_analysis_runs_error_code_check
        CHECK (
            error_code IS NULL
            OR error_code ~ '^[A-Z0-9][A-Z0-9_.-]{0,79}$'
        ),
    CONSTRAINT handwriting_analysis_runs_state_check
        CHECK (
            (
                status = 'running'
                AND recognized_text IS NULL
                AND transcription_confidence IS NULL
                AND legibility IS NULL
                AND proposed_result IS NULL
                AND result_confidence IS NULL
                AND evidence = '{}'::jsonb
                AND error_code IS NULL
                AND finished_at IS NULL
            )
            OR (
                status = 'completed'
                AND legibility IS NOT NULL
                AND proposed_result IS NOT NULL
                AND result_confidence IS NOT NULL
                AND evidence IS NOT NULL
                AND error_code IS NULL
                AND finished_at IS NOT NULL
                AND (legibility <> 'unreadable' OR proposed_result = 'pending')
            )
            OR (
                status = 'failed'
                AND recognized_text IS NULL
                AND transcription_confidence IS NULL
                AND legibility IS NULL
                AND proposed_result IS NULL
                AND result_confidence IS NULL
                AND evidence = '{}'::jsonb
                AND error_code IS NOT NULL
                AND finished_at IS NOT NULL
            )
            OR (
                status = 'cancelled'
                AND recognized_text IS NULL
                AND transcription_confidence IS NULL
                AND legibility IS NULL
                AND proposed_result IS NULL
                AND result_confidence IS NULL
                AND evidence = '{}'::jsonb
                AND error_code IS NULL
                AND finished_at IS NOT NULL
            )
        ),
    CONSTRAINT handwriting_analysis_runs_timestamps_check
        CHECK (
            created_at >= started_at
            AND (finished_at IS NULL OR finished_at >= started_at)
        )
);

CREATE INDEX handwriting_analysis_runs_job_index
    ON handwriting_analysis_runs(job_id, attempt_number DESC, id);

ALTER TABLE answer_reviews
    ADD COLUMN handwriting_analysis_run_id uuid,
    ADD CONSTRAINT answer_reviews_handwriting_analysis_run_fk
        FOREIGN KEY (handwriting_analysis_run_id)
        REFERENCES handwriting_analysis_runs(id);

CREATE UNIQUE INDEX answer_reviews_handwriting_analysis_run_unique
    ON answer_reviews(handwriting_analysis_run_id)
    WHERE handwriting_analysis_run_id IS NOT NULL;

CREATE FUNCTION lerniqa_validate_handwriting_analysis_job_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Serialize job creation/claims with a concurrent human result update.
    PERFORM 1
    FROM answer_part_results
    WHERE id = NEW.answer_part_result_id
    FOR UPDATE;

    IF NOT EXISTS (
        SELECT 1
        FROM answer_part_assets AS answer_asset
        JOIN assets AS asset ON asset.id = answer_asset.asset_id
        JOIN answer_part_results AS result
            ON result.id = answer_asset.answer_part_result_id
        JOIN question_parts AS part
            ON part.id = result.question_part_id
        JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
        JOIN practice_session_items AS item
            ON item.id = attempt.practice_session_item_id
        JOIN practice_sessions AS session ON session.id = item.practice_session_id
        WHERE answer_asset.answer_part_result_id = NEW.answer_part_result_id
            AND answer_asset.asset_id = NEW.asset_id
            AND answer_asset.asset_role = NEW.handwriting_asset_role
            AND answer_asset.asset_role = 'handwriting'
            AND result.question_part_id = NEW.question_part_id
            AND part.grading_policy = 'manual_review'
            AND part.question_revision_id = NEW.question_revision_id
            AND item.question_revision_id = NEW.question_revision_id
            AND asset.purpose = 'handwriting'
            AND asset.sensitivity = 'private'
            AND asset.scan_status = 'clean'
            AND asset.deleted_at IS NULL
            AND asset.checksum = NEW.asset_checksum
            AND NOT EXISTS (
                SELECT 1
                FROM asset_object_cleanup_jobs AS cleanup_job
                WHERE cleanup_job.asset_id = asset.id
                    AND cleanup_job.status <> 'completed'
            )
            AND session.check_mode IN ('instant', 'complete')
            AND (
                NEW.status NOT IN ('queued', 'retry', 'running', 'completed')
                OR (
                    result.answer_payload = '{"value":null}'::jsonb
                    AND result.initial_result = 'pending'
                    AND result.current_result = 'pending'
                    AND result.grading_source = 'manual_review'
                )
            )
    ) THEN
        RAISE EXCEPTION 'handwriting analysis job requires a fixed non-score answer, revision, part, and clean handwriting asset with matching SHA-256'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER handwriting_analysis_jobs_source_check
BEFORE INSERT OR UPDATE OF
    answer_part_result_id,
    question_revision_id,
    question_part_id,
    asset_id,
    handwriting_asset_role,
    asset_checksum,
    reference_sha256,
    status
ON handwriting_analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_handwriting_analysis_job_source();

CREATE FUNCTION lerniqa_validate_handwriting_source_final_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_result_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'handwriting_analysis_jobs' THEN
        affected_result_id := NEW.answer_part_result_id;
    ELSE
        affected_result_id := NEW.id;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM handwriting_analysis_jobs AS candidate_job
        WHERE candidate_job.answer_part_result_id = affected_result_id
            AND candidate_job.status IN ('queued', 'retry', 'running', 'completed')
            AND NOT EXISTS (
                SELECT 1
                FROM answer_part_results AS result
                JOIN question_parts AS part
                    ON part.id = result.question_part_id
                JOIN answer_attempts AS attempt
                    ON attempt.id = result.answer_attempt_id
                JOIN practice_session_items AS item
                    ON item.id = attempt.practice_session_item_id
                JOIN practice_sessions AS session
                    ON session.id = item.practice_session_id
                JOIN answer_part_assets AS answer_asset
                    ON answer_asset.answer_part_result_id = result.id
                    AND answer_asset.asset_id = candidate_job.asset_id
                    AND answer_asset.asset_role = candidate_job.handwriting_asset_role
                JOIN assets AS asset ON asset.id = answer_asset.asset_id
                WHERE result.id = candidate_job.answer_part_result_id
                    AND result.question_part_id = candidate_job.question_part_id
                    AND result.answer_payload = '{"value":null}'::jsonb
                    AND result.initial_result = 'pending'
                    AND result.current_result = 'pending'
                    AND result.grading_source = 'manual_review'
                    AND part.grading_policy = 'manual_review'
                    AND part.question_revision_id = candidate_job.question_revision_id
                    AND item.question_revision_id = candidate_job.question_revision_id
                    AND session.check_mode IN ('instant', 'complete')
                    AND asset.purpose = 'handwriting'
                    AND asset.sensitivity = 'private'
                    AND asset.scan_status = 'clean'
                    AND asset.deleted_at IS NULL
                    AND asset.checksum = candidate_job.asset_checksum
                    AND NOT EXISTS (
                        SELECT 1
                        FROM asset_object_cleanup_jobs AS cleanup_job
                        WHERE cleanup_job.asset_id = asset.id
                            AND cleanup_job.status <> 'completed'
                    )
            )
    ) THEN
        RAISE EXCEPTION 'queued, retry, running, or completed handwriting analysis requires an unresolved manual-review calculation anchor at transaction end'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER handwriting_analysis_jobs_source_final_state
AFTER INSERT OR UPDATE OF
    answer_part_result_id,
    question_revision_id,
    question_part_id,
    asset_id,
    handwriting_asset_role,
    asset_checksum,
    reference_sha256,
    status
ON handwriting_analysis_jobs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_handwriting_source_final_state();

CREATE CONSTRAINT TRIGGER answer_part_results_handwriting_job_check
AFTER UPDATE OF answer_payload, initial_result, current_result, grading_source
ON answer_part_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_handwriting_source_final_state();

CREATE FUNCTION lerniqa_prepare_handwriting_analysis_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'handwriting analysis jobs cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'queued'
            OR NEW.attempt_count <> 0
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.lease_owner IS NOT NULL
            OR NEW.last_error_code IS NOT NULL
            OR NEW.finished_at IS NOT NULL
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'handwriting analysis job must start queued without a lease or attempt evidence'
                USING ERRCODE = '23514';
        END IF;

        NEW.created_at := transaction_timestamp();
        NEW.updated_at := NEW.created_at;
        IF NEW.available_at < NEW.created_at THEN
            RAISE EXCEPTION 'handwriting analysis job cannot be scheduled before creation'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.answer_part_result_id IS DISTINCT FROM OLD.answer_part_result_id
        OR NEW.question_revision_id IS DISTINCT FROM OLD.question_revision_id
        OR NEW.question_part_id IS DISTINCT FROM OLD.question_part_id
        OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
        OR NEW.handwriting_asset_role IS DISTINCT FROM OLD.handwriting_asset_role
        OR NEW.asset_checksum IS DISTINCT FROM OLD.asset_checksum
        OR NEW.reference_sha256 IS DISTINCT FROM OLD.reference_sha256
        OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'handwriting analysis job input provenance is immutable'
            USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := transaction_timestamp();

    IF OLD.status = 'queued' AND NEW.status = 'queued' THEN
        IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
            OR NEW.last_error_code IS DISTINCT FROM OLD.last_error_code
            OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.lease_owner IS NOT NULL
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'queued handwriting job reschedule may only change available_at'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status IN ('queued', 'retry') AND NEW.status = 'running' THEN
        IF OLD.available_at > transaction_timestamp()
            OR NEW.available_at IS DISTINCT FROM OLD.available_at
            OR NEW.attempt_count <> OLD.attempt_count + 1
            OR NEW.attempt_count > NEW.max_attempts
            OR NEW.lease_owner IS NULL
            OR btrim(NEW.lease_owner) = ''
            OR NEW.lease_expires_at IS NULL
            OR NEW.lease_expires_at <= transaction_timestamp()
            OR NEW.last_error_code IS NOT NULL
            OR NEW.finished_at IS NOT NULL
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'claiming a handwriting job requires the next attempt and a future worker lease'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status = 'running' AND NEW.status = 'running' THEN
        IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
            OR NEW.available_at IS DISTINCT FROM OLD.available_at
            OR NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
            OR NEW.lease_expires_at IS NULL
            OR NEW.lease_expires_at <= OLD.lease_expires_at
            OR NEW.lease_expires_at <= transaction_timestamp()
            OR NEW.last_error_code IS NOT NULL
            OR NEW.finished_at IS NOT NULL
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'running handwriting job update may only extend the same worker lease'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status = 'running' AND NEW.status = 'retry' THEN
        IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
            OR NEW.attempt_count >= NEW.max_attempts
            OR NEW.available_at < transaction_timestamp()
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.lease_owner IS NOT NULL
            OR NEW.last_error_code IS NULL
            OR NEW.finished_at IS NOT NULL
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'retrying a handwriting job requires failed-attempt evidence and a new availability time'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.status = 'running'
        AND NEW.status IN ('completed', 'failed', 'cancelled') THEN
        IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
            OR NEW.available_at IS DISTINCT FROM OLD.available_at
            OR (
                NEW.status IN ('completed', 'cancelled')
                AND OLD.lease_expires_at <= transaction_timestamp()
            )
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.lease_owner IS NOT NULL
            OR (NEW.status = 'failed' AND NEW.last_error_code IS NULL)
            OR (NEW.status <> 'failed' AND NEW.last_error_code IS NOT NULL)
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'finishing a handwriting job requires matching terminal lease and error state'
                USING ERRCODE = '23514';
        END IF;
        NEW.finished_at := transaction_timestamp();
    ELSIF OLD.status = 'queued' AND NEW.status = 'cancelled' THEN
        IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.lease_owner IS NOT NULL
            OR NEW.last_error_code IS NOT NULL
            OR NEW.reviewed_by_user_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'cancelling a queued handwriting job cannot fabricate worker evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW.finished_at := transaction_timestamp();
    ELSIF OLD.status = 'completed' AND NEW.status = 'reviewed' THEN
        IF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
            OR NEW.available_at IS DISTINCT FROM OLD.available_at
            OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.lease_owner IS NOT NULL
            OR NEW.last_error_code IS NOT NULL
            OR NOT EXISTS (
                SELECT 1
                FROM users
                WHERE id = NEW.reviewed_by_user_id
                    AND status = 'active'
            ) THEN
            RAISE EXCEPTION 'reviewing a handwriting job requires an active human user without rewriting model evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW.reviewed_at := transaction_timestamp();
    ELSE
        RAISE EXCEPTION 'handwriting analysis job status transition is invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER handwriting_analysis_jobs_history_check
BEFORE INSERT OR UPDATE OR DELETE ON handwriting_analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_handwriting_analysis_job();

CREATE FUNCTION lerniqa_prepare_handwriting_analysis_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    job_row handwriting_analysis_jobs%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'handwriting analysis runs cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT *
        INTO job_row
        FROM handwriting_analysis_jobs
        WHERE id = NEW.job_id
        FOR UPDATE;

        IF NOT FOUND
            OR job_row.status <> 'running'
            OR job_row.attempt_count <> NEW.attempt_number
            OR job_row.lease_expires_at <= transaction_timestamp()
            OR job_row.available_at > NEW.started_at
            OR NEW.status <> 'running'
            OR NEW.finished_at IS NOT NULL THEN
            RAISE EXCEPTION 'handwriting analysis run must start for the current leased attempt'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.asset_checksum IS DISTINCT FROM job_row.asset_checksum
            OR NEW.reference_sha256 IS DISTINCT FROM job_row.reference_sha256 THEN
            RAISE EXCEPTION 'handwriting analysis run hashes must match its immutable job input'
                USING ERRCODE = '23514';
        END IF;

        NEW.created_at := clock_timestamp();
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.job_id IS DISTINCT FROM OLD.job_id
        OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
        OR NEW.engine IS DISTINCT FROM OLD.engine
        OR NEW.model_name IS DISTINCT FROM OLD.model_name
        OR NEW.model_version IS DISTINCT FROM OLD.model_version
        OR NEW.model_digest IS DISTINCT FROM OLD.model_digest
        OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
        OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
        OR NEW.rubric_version IS DISTINCT FROM OLD.rubric_version
        OR NEW.asset_checksum IS DISTINCT FROM OLD.asset_checksum
        OR NEW.reference_sha256 IS DISTINCT FROM OLD.reference_sha256
        OR NEW.started_at IS DISTINCT FROM OLD.started_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'handwriting analysis run input evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status <> 'running'
        OR NEW.status NOT IN ('completed', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'handwriting analysis run status transition is invalid'
            USING ERRCODE = '23514';
    END IF;
    NEW.finished_at := transaction_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER handwriting_analysis_runs_append_only
BEFORE INSERT OR UPDATE OR DELETE ON handwriting_analysis_runs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_handwriting_analysis_run();

CREATE FUNCTION lerniqa_validate_answer_review_handwriting_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.handwriting_analysis_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM answer_reviews AS review
        JOIN handwriting_analysis_runs AS analysis_run
            ON analysis_run.id = review.handwriting_analysis_run_id
        JOIN handwriting_analysis_jobs AS job ON job.id = analysis_run.job_id
        WHERE review.id = NEW.id
            AND analysis_run.status = 'completed'
            AND job.answer_part_result_id = review.answer_part_result_id
            AND job.status = 'reviewed'
            AND job.reviewed_by_user_id = review.reviewer_user_id
    ) THEN
        RAISE EXCEPTION 'answer review handwriting run must be a reviewed completed suggestion for the same answer and human reviewer'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER answer_reviews_handwriting_run_check
AFTER INSERT OR UPDATE
ON answer_reviews
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_review_handwriting_run();

CREATE FUNCTION lerniqa_validate_handwriting_analysis_attempts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    affected_job_id uuid;
    job_row handwriting_analysis_jobs%ROWTYPE;
    run_count integer;
    minimum_attempt integer;
    maximum_attempt integer;
    latest_run_id uuid;
    latest_run_status varchar(20);
    latest_run_error_code varchar(80);
BEGIN
    IF TG_TABLE_NAME = 'handwriting_analysis_jobs' THEN
        affected_job_id := NEW.id;
    ELSE
        affected_job_id := NEW.job_id;
    END IF;

    SELECT *
    INTO job_row
    FROM handwriting_analysis_jobs
    WHERE id = affected_job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'handwriting analysis job disappeared before commit'
            USING ERRCODE = '23514';
    END IF;

    SELECT
        count(*)::integer,
        min(attempt_number),
        max(attempt_number)
    INTO run_count, minimum_attempt, maximum_attempt
    FROM handwriting_analysis_runs
    WHERE job_id = affected_job_id;

    SELECT id, status, error_code
    INTO latest_run_id, latest_run_status, latest_run_error_code
    FROM handwriting_analysis_runs
    WHERE job_id = affected_job_id
    ORDER BY attempt_number DESC
    LIMIT 1;

    IF job_row.status = 'running' THEN
        IF run_count <> job_row.attempt_count
            OR (
                run_count > 0
                AND (
                    minimum_attempt <> 1
                    OR maximum_attempt <> job_row.attempt_count
                )
            )
            OR latest_run_status <> 'running' THEN
            RAISE EXCEPTION 'running handwriting job must have one open run for its current attempt'
                USING ERRCODE = '23514';
        END IF;
    ELSIF run_count <> job_row.attempt_count
        OR (
            run_count > 0
            AND (
                minimum_attempt <> 1
                OR maximum_attempt <> job_row.attempt_count
            )
        ) THEN
        RAISE EXCEPTION 'handwriting analysis attempt evidence must be contiguous and complete'
            USING ERRCODE = '23514';
    END IF;

    IF job_row.status = 'retry'
        AND (
            job_row.attempt_count >= job_row.max_attempts
            OR latest_run_status <> 'failed'
            OR latest_run_error_code IS DISTINCT FROM job_row.last_error_code
        ) THEN
        RAISE EXCEPTION 'retried handwriting job requires a failed latest run'
            USING ERRCODE = '23514';
    ELSIF job_row.status IN ('completed', 'reviewed')
        AND latest_run_status <> 'completed' THEN
        RAISE EXCEPTION 'completed handwriting job requires a completed latest run'
            USING ERRCODE = '23514';
    ELSIF job_row.status = 'failed' AND (
        latest_run_status <> 'failed'
        OR latest_run_error_code IS DISTINCT FROM job_row.last_error_code
    ) THEN
        RAISE EXCEPTION 'failed handwriting job requires a failed latest run'
            USING ERRCODE = '23514';
    ELSIF job_row.status = 'cancelled'
        AND job_row.attempt_count > 0
        AND latest_run_status NOT IN ('failed', 'cancelled') THEN
        RAISE EXCEPTION 'cancelled handwriting job has invalid latest attempt evidence'
            USING ERRCODE = '23514';
    END IF;

    IF job_row.status = 'reviewed' AND NOT EXISTS (
        SELECT 1
        FROM answer_reviews AS review
        WHERE review.handwriting_analysis_run_id = latest_run_id
            AND review.answer_part_result_id = job_row.answer_part_result_id
            AND review.reviewer_user_id = job_row.reviewed_by_user_id
    ) THEN
        RAISE EXCEPTION 'reviewed handwriting job requires a matching human answer review'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER handwriting_analysis_jobs_attempt_evidence_check
AFTER INSERT OR UPDATE ON handwriting_analysis_jobs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_handwriting_analysis_attempts();

CREATE CONSTRAINT TRIGGER handwriting_analysis_runs_job_check
AFTER INSERT OR UPDATE ON handwriting_analysis_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_handwriting_analysis_attempts();

-- Subscription data in this migration is catalog-only. It deliberately does
-- not create account subscriptions, checkout sessions, payment instruments,
-- invoices, payments, refunds, provider webhooks, entitlements, or revenue.
CREATE TABLE subscription_plans (
    id uuid PRIMARY KEY,
    code varchar(40) NOT NULL,
    name varchar(80) NOT NULL,
    description text,
    status varchar(20) NOT NULL DEFAULT 'draft',
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    updated_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscription_plans_code_unique UNIQUE (code),
    CONSTRAINT subscription_plans_code_check
        CHECK (code ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$'),
    CONSTRAINT subscription_plans_name_check
        CHECK (btrim(name) <> ''),
    CONSTRAINT subscription_plans_description_check
        CHECK (description IS NULL OR length(description) <= 500),
    CONSTRAINT subscription_plans_status_check
        CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT subscription_plans_lock_version_check
        CHECK (lock_version > 0),
    CONSTRAINT subscription_plans_timestamps_check
        CHECK (updated_at >= created_at)
);

CREATE INDEX subscription_plans_status_updated_index
    ON subscription_plans(status, updated_at DESC, id);

CREATE TABLE subscription_feature_definitions (
    id uuid PRIMARY KEY,
    feature_key varchar(80) NOT NULL,
    display_name varchar(120) NOT NULL,
    description text,
    value_type varchar(20) NOT NULL,
    unit varchar(40),
    status varchar(20) NOT NULL DEFAULT 'draft',
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    updated_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscription_feature_definitions_key_unique
        UNIQUE (feature_key),
    CONSTRAINT subscription_feature_definitions_key_check
        CHECK (feature_key ~ '^[a-z][a-z0-9]*([_-][a-z0-9]+)*$'),
    CONSTRAINT subscription_feature_definitions_name_check
        CHECK (btrim(display_name) <> ''),
    CONSTRAINT subscription_feature_definitions_description_check
        CHECK (description IS NULL OR length(description) <= 500),
    CONSTRAINT subscription_feature_definitions_value_type_check
        CHECK (value_type IN ('boolean', 'integer')),
    CONSTRAINT subscription_feature_definitions_unit_check
        CHECK (
            (value_type = 'boolean' AND unit IS NULL)
            OR (
                value_type = 'integer'
                AND unit IS NOT NULL
                AND btrim(unit) <> ''
            )
        ),
    CONSTRAINT subscription_feature_definitions_status_check
        CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT subscription_feature_definitions_lock_version_check
        CHECK (lock_version > 0),
    CONSTRAINT subscription_feature_definitions_timestamps_check
        CHECK (updated_at >= created_at)
);

CREATE INDEX subscription_features_status_updated_index
    ON subscription_feature_definitions(status, updated_at DESC, id);

CREATE TABLE subscription_plan_prices (
    id uuid PRIMARY KEY,
    plan_id uuid NOT NULL REFERENCES subscription_plans(id),
    currency varchar(3) NOT NULL,
    amount_minor bigint NOT NULL,
    billing_interval varchar(20) NOT NULL,
    billing_interval_count integer NOT NULL DEFAULT 1,
    status varchar(20) NOT NULL DEFAULT 'draft',
    effective_from date,
    effective_until date,
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    updated_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscription_plan_prices_currency_check
        CHECK (currency IN (
            'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
            'BAM', 'BBD', 'BDT', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
            'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP',
            'CNY', 'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP',
            'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL',
            'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG',
            'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD',
            'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD',
            'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL',
            'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK',
            'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
            'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR',
            'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK',
            'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP',
            'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD',
            'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND',
            'VUV', 'WST', 'XAF', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD',
            'XCD', 'XCG', 'XDR', 'XOF', 'XPD', 'XPF', 'XPT', 'XSU', 'XTS',
            'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWG'
        )),
    CONSTRAINT subscription_plan_prices_amount_check
        CHECK (amount_minor BETWEEN 0 AND 999999999),
    CONSTRAINT subscription_plan_prices_interval_check
        CHECK (billing_interval IN ('day', 'week', 'month', 'year')),
    CONSTRAINT subscription_plan_prices_interval_count_check
        CHECK (billing_interval_count BETWEEN 1 AND 365),
    CONSTRAINT subscription_plan_prices_status_check
        CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT subscription_plan_prices_effective_range_check
        CHECK (
            effective_until IS NULL
            OR (
                effective_from IS NOT NULL
                AND effective_until >= effective_from
            )
        ),
    CONSTRAINT subscription_plan_prices_active_date_check
        CHECK (status <> 'active' OR effective_from IS NOT NULL),
    CONSTRAINT subscription_plan_prices_lock_version_check
        CHECK (lock_version > 0),
    CONSTRAINT subscription_plan_prices_timestamps_check
        CHECK (updated_at >= created_at)
);

CREATE INDEX subscription_plan_prices_plan_status_index
    ON subscription_plan_prices(plan_id, status, effective_from DESC, id);

-- A price change creates another row. At most one price can be the currently
-- selectable catalog price for an identical billing dimension. A future
-- replacement remains draft until the old price is retired; "active" is a
-- lifecycle state, not a time-range reservation.
CREATE UNIQUE INDEX subscription_plan_prices_active_unique
    ON subscription_plan_prices(
        plan_id,
        currency,
        billing_interval,
        billing_interval_count
    )
    WHERE status = 'active';

CREATE TABLE subscription_plan_feature_limits (
    id uuid PRIMARY KEY,
    plan_id uuid NOT NULL REFERENCES subscription_plans(id),
    feature_definition_id uuid NOT NULL
        REFERENCES subscription_feature_definitions(id),
    included boolean NOT NULL,
    unlimited boolean NOT NULL DEFAULT false,
    limit_value bigint,
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    updated_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscription_plan_feature_limits_unique
        UNIQUE (plan_id, feature_definition_id),
    CONSTRAINT subscription_plan_feature_limits_value_check
        CHECK (
            (
                NOT included
                AND NOT unlimited
                AND limit_value IS NULL
            )
            OR (
                included
                AND unlimited
                AND limit_value IS NULL
            )
            OR (
                included
                AND NOT unlimited
                AND (
                    limit_value IS NULL
                    OR limit_value BETWEEN 0 AND 999999999
                )
            )
        ),
    CONSTRAINT subscription_plan_feature_limits_lock_version_check
        CHECK (lock_version > 0),
    CONSTRAINT subscription_plan_feature_limits_timestamps_check
        CHECK (updated_at >= created_at)
);

CREATE INDEX subscription_limits_feature_plan_index
    ON subscription_plan_feature_limits(feature_definition_id, plan_id);

-- Shared durable idempotency evidence for every privileged admin mutation.
-- A pending row must be completed in the same database transaction as its
-- business write and matching append-only admin audit row.
CREATE TABLE admin_mutation_receipts (
    id uuid PRIMARY KEY,
    actor_user_id uuid NOT NULL REFERENCES users(id),
    operation varchar(80) NOT NULL,
    idempotency_key uuid NOT NULL,
    request_fingerprint varchar(64) NOT NULL,
    request_id varchar(120) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    target_type varchar(60),
    target_id uuid,
    admin_audit_log_id uuid REFERENCES admin_audit_logs(id),
    replay_result jsonb,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    CONSTRAINT admin_mutation_receipts_actor_operation_key_unique
        UNIQUE (actor_user_id, operation, idempotency_key),
    CONSTRAINT admin_mutation_receipts_audit_log_unique
        UNIQUE (admin_audit_log_id),
    CONSTRAINT admin_mutation_receipts_operation_check
        CHECK (operation IN (
            'system_question_draft',
            'system_question_review',
            'system_question_publish',
            'subscription_plan_create',
            'subscription_plan_update',
            'subscription_plan_status',
            'subscription_price_create',
            'subscription_price_update',
            'subscription_price_status',
            'subscription_feature_create',
            'subscription_feature_update',
            'subscription_feature_status',
            'subscription_feature_limit_set'
        )),
    CONSTRAINT admin_mutation_receipts_idempotency_key_check
        CHECK (
            substring(idempotency_key::text, 15, 1) IN ('4', '7')
            AND substring(idempotency_key::text, 20, 1) IN ('8', '9', 'a', 'b')
        ),
    CONSTRAINT admin_mutation_receipts_fingerprint_check
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT admin_mutation_receipts_request_id_check
        CHECK (btrim(request_id) <> ''),
    CONSTRAINT admin_mutation_receipts_status_check
        CHECK (status IN ('pending', 'completed')),
    CONSTRAINT admin_mutation_receipts_target_check
        CHECK (
            (target_type IS NULL AND target_id IS NULL)
            OR (btrim(target_type) <> '' AND target_id IS NOT NULL)
        ),
    CONSTRAINT admin_mutation_receipts_state_check
        CHECK (
            (
                status = 'pending'
                AND target_type IS NULL
                AND target_id IS NULL
                AND admin_audit_log_id IS NULL
                AND replay_result IS NULL
                AND completed_at IS NULL
            )
            OR (
                status = 'completed'
                AND target_type IS NOT NULL
                AND target_id IS NOT NULL
                AND admin_audit_log_id IS NOT NULL
                AND replay_result IS NOT NULL
                AND jsonb_typeof(replay_result) = 'object'
                AND completed_at IS NOT NULL
                AND completed_at >= created_at
            )
        )
);

CREATE INDEX admin_mutation_receipts_operation_created_index
    ON admin_mutation_receipts(operation, created_at DESC, id);

CREATE INDEX admin_mutation_receipts_target_index
    ON admin_mutation_receipts(target_type, target_id, created_at DESC)
    WHERE status = 'completed';

CREATE FUNCTION lerniqa_prepare_subscription_catalog_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_plan_status varchar(20);
    referenced_feature_status varchar(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '% catalog history cannot be deleted', TG_TABLE_NAME
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by_user_id IS DISTINCT FROM NEW.updated_by_user_id THEN
            RAISE EXCEPTION 'catalog creation actor must match its initial update actor'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.lock_version <> 1 THEN
            RAISE EXCEPTION 'catalog records must start at lock_version 1'
                USING ERRCODE = '23514';
        END IF;

        IF TG_TABLE_NAME <> 'subscription_plan_feature_limits' THEN
            IF NEW.status <> 'draft' THEN
                RAISE EXCEPTION 'catalog records must be created as draft'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        NEW.created_at := transaction_timestamp();
    ELSE
        IF NEW.id IS DISTINCT FROM OLD.id
            OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
            OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'catalog identity and creation evidence cannot be overwritten'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.lock_version IS DISTINCT FROM OLD.lock_version + 1 THEN
            RAISE EXCEPTION 'catalog update must increment lock_version exactly once'
                USING ERRCODE = '23514';
        END IF;

        IF TG_TABLE_NAME = 'subscription_plans' THEN
            IF NEW.code IS DISTINCT FROM OLD.code THEN
                RAISE EXCEPTION 'subscription plan code is immutable'
                    USING ERRCODE = '23514';
            END IF;

            IF OLD.status = 'retired' THEN
                RAISE EXCEPTION 'retired subscription plan is immutable'
                    USING ERRCODE = '23514';
            END IF;

            IF NEW.status IS DISTINCT FROM OLD.status
                AND NOT (
                    (OLD.status = 'draft' AND NEW.status IN ('active', 'retired'))
                    OR (OLD.status = 'active' AND NEW.status = 'retired')
                ) THEN
                RAISE EXCEPTION 'subscription plan status transition is invalid'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF TG_TABLE_NAME = 'subscription_plan_prices' THEN
            IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
                RAISE EXCEPTION 'subscription price cannot move to another plan'
                    USING ERRCODE = '23514';
            END IF;

            IF OLD.status = 'retired' THEN
                RAISE EXCEPTION 'retired subscription price is immutable'
                    USING ERRCODE = '23514';
            END IF;

            IF NEW.status IS DISTINCT FROM OLD.status
                AND NOT (
                    (OLD.status = 'draft' AND NEW.status IN ('active', 'retired'))
                    OR (OLD.status = 'active' AND NEW.status = 'retired')
                ) THEN
                RAISE EXCEPTION 'subscription price status transition is invalid'
                    USING ERRCODE = '23514';
            END IF;

            IF OLD.status <> 'draft' AND (
                NEW.plan_id IS DISTINCT FROM OLD.plan_id
                OR NEW.currency IS DISTINCT FROM OLD.currency
                OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
                OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval
                OR NEW.billing_interval_count IS DISTINCT FROM OLD.billing_interval_count
                OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
            ) THEN
                RAISE EXCEPTION 'activated subscription price terms are immutable; create a new price'
                    USING ERRCODE = '23514';
            END IF;

            -- An administrator may schedule the first end date once. It can
            -- never be cleared or replaced after the price leaves draft.
            IF OLD.status <> 'draft'
                AND NEW.effective_until IS DISTINCT FROM OLD.effective_until
                AND NOT (
                    OLD.status = 'active'
                    AND OLD.effective_until IS NULL
                    AND NEW.effective_until IS NOT NULL
                ) THEN
                RAISE EXCEPTION 'subscription price end date can only be set once after activation'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF TG_TABLE_NAME = 'subscription_feature_definitions' THEN
            IF NEW.feature_key IS DISTINCT FROM OLD.feature_key THEN
                RAISE EXCEPTION 'subscription feature key is immutable'
                    USING ERRCODE = '23514';
            END IF;

            IF OLD.status = 'retired' THEN
                RAISE EXCEPTION 'retired subscription feature is immutable'
                    USING ERRCODE = '23514';
            END IF;

            IF NEW.status IS DISTINCT FROM OLD.status
                AND NOT (
                    (OLD.status = 'draft' AND NEW.status IN ('active', 'retired'))
                    OR (OLD.status = 'active' AND NEW.status = 'retired')
                ) THEN
                RAISE EXCEPTION 'subscription feature status transition is invalid'
                    USING ERRCODE = '23514';
            END IF;

            IF OLD.status <> 'draft' AND (
                NEW.value_type IS DISTINCT FROM OLD.value_type
                OR NEW.unit IS DISTINCT FROM OLD.unit
            ) THEN
                RAISE EXCEPTION 'activated subscription feature type and unit are immutable'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
                OR NEW.feature_definition_id IS DISTINCT FROM OLD.feature_definition_id THEN
                RAISE EXCEPTION 'feature limit cannot move to another plan or feature'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    IF NOT lerniqa_user_is_system_admin(NEW.updated_by_user_id) THEN
        RAISE EXCEPTION 'subscription catalog mutation requires an active system_admin user'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'subscription_plan_prices' THEN
        SELECT status
        INTO parent_plan_status
        FROM subscription_plans
        WHERE id = NEW.plan_id
        FOR SHARE;

        IF parent_plan_status = 'retired' THEN
            RAISE EXCEPTION 'retired subscription plan prices are immutable'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'subscription_plan_feature_limits' THEN
        SELECT status
        INTO parent_plan_status
        FROM subscription_plans
        WHERE id = NEW.plan_id
        FOR SHARE;

        SELECT status
        INTO referenced_feature_status
        FROM subscription_feature_definitions
        WHERE id = NEW.feature_definition_id
        FOR SHARE;

        IF parent_plan_status = 'retired' THEN
            RAISE EXCEPTION 'retired subscription plan feature limits are immutable'
                USING ERRCODE = '23514';
        END IF;

        IF referenced_feature_status = 'retired' THEN
            RAISE EXCEPTION 'retired subscription feature cannot be assigned to a plan'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := transaction_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_plans_history_check
BEFORE INSERT OR UPDATE OR DELETE ON subscription_plans
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();

CREATE TRIGGER subscription_prices_history_check
BEFORE INSERT OR UPDATE OR DELETE ON subscription_plan_prices
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();

CREATE TRIGGER subscription_features_history_check
BEFORE INSERT OR UPDATE OR DELETE ON subscription_feature_definitions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();

CREATE TRIGGER subscription_limits_history_check
BEFORE INSERT OR UPDATE OR DELETE ON subscription_plan_feature_limits
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_subscription_catalog_mutation();

CREATE FUNCTION lerniqa_validate_subscription_catalog_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    expected_action varchar(80);
    expected_target_type varchar(60);
    expected_state_kind varchar(20);
    expected_after_status jsonb;
    expected_before_status jsonb;
    expected_after_included jsonb;
    expected_before_included jsonb;
    expected_after_unlimited jsonb;
    expected_before_unlimited jsonb;
    expected_after_limit jsonb;
    expected_before_limit jsonb;
    expected_before_lock_version jsonb;
BEGIN
    CASE TG_TABLE_NAME
        WHEN 'subscription_plans' THEN
            expected_target_type := 'subscription_plan';
            IF TG_OP = 'INSERT' THEN
                expected_action := 'subscription_plan_created';
            ELSIF NEW.status IS DISTINCT FROM OLD.status
                AND NEW.status = 'active' THEN
                expected_action := 'subscription_plan_activated';
            ELSIF NEW.status IS DISTINCT FROM OLD.status
                AND NEW.status = 'retired' THEN
                expected_action := 'subscription_plan_retired';
            ELSE
                expected_action := 'subscription_plan_updated';
            END IF;
        WHEN 'subscription_plan_prices' THEN
            expected_target_type := 'subscription_plan_price';
            IF TG_OP = 'INSERT' THEN
                expected_action := 'subscription_price_created';
            ELSIF NEW.status IS DISTINCT FROM OLD.status
                AND NEW.status = 'active' THEN
                expected_action := 'subscription_price_activated';
            ELSIF NEW.status IS DISTINCT FROM OLD.status
                AND NEW.status = 'retired' THEN
                expected_action := 'subscription_price_retired';
            ELSE
                expected_action := 'subscription_price_updated';
            END IF;
        WHEN 'subscription_feature_definitions' THEN
            expected_target_type := 'subscription_feature_definition';
            IF TG_OP = 'INSERT' THEN
                expected_action := 'subscription_feature_definition_created';
            ELSIF NEW.status IS DISTINCT FROM OLD.status
                AND NEW.status = 'active' THEN
                expected_action := 'subscription_feature_definition_activated';
            ELSIF NEW.status IS DISTINCT FROM OLD.status
                AND NEW.status = 'retired' THEN
                expected_action := 'subscription_feature_definition_retired';
            ELSE
                expected_action := 'subscription_feature_definition_updated';
            END IF;
        WHEN 'subscription_plan_feature_limits' THEN
            expected_target_type := 'subscription_plan_feature_limit';
            IF TG_OP = 'INSERT' THEN
                expected_action := 'subscription_feature_limit_set';
            ELSE
                expected_action := 'subscription_feature_limit_updated';
            END IF;
        ELSE
            RAISE EXCEPTION 'unsupported subscription catalog audit table: %', TG_TABLE_NAME;
    END CASE;

    IF TG_TABLE_NAME = 'subscription_plan_feature_limits' THEN
        expected_state_kind := 'feature_limit';
        expected_after_included := to_jsonb(NEW.included);
        expected_after_unlimited := to_jsonb(NEW.unlimited);
        expected_after_limit := CASE
            WHEN NEW.limit_value IS NULL THEN 'null'::jsonb
            ELSE to_jsonb(NEW.limit_value)
        END;
        IF TG_OP = 'UPDATE' THEN
            expected_before_included := to_jsonb(OLD.included);
            expected_before_unlimited := to_jsonb(OLD.unlimited);
            expected_before_limit := CASE
                WHEN OLD.limit_value IS NULL THEN 'null'::jsonb
                ELSE to_jsonb(OLD.limit_value)
            END;
        END IF;
    ELSE
        expected_state_kind := 'status';
        expected_after_status := to_jsonb(NEW.status);
        IF TG_OP = 'UPDATE' THEN
            expected_before_status := to_jsonb(OLD.status);
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        expected_before_lock_version := to_jsonb(OLD.lock_version);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_audit_logs AS audit
        WHERE audit.action = expected_action
            AND audit.target_type = expected_target_type
            AND audit.target_id = NEW.id
            AND audit.actor_type = 'user'
            AND audit.actor_user_id = NEW.updated_by_user_id
            AND audit.created_at = transaction_timestamp()
            AND audit.after_data IS NOT NULL
            AND audit.after_data -> 'lockVersion' = to_jsonb(NEW.lock_version)
            AND (
                (TG_OP = 'INSERT' AND audit.before_data IS NULL)
                OR (
                    TG_OP = 'UPDATE'
                    AND audit.before_data IS NOT NULL
                    AND audit.before_data -> 'lockVersion' = expected_before_lock_version
                )
            )
            AND (
                (
                    expected_state_kind = 'status'
                    AND audit.after_data -> 'status' = expected_after_status
                    AND (
                        TG_OP = 'INSERT'
                        OR audit.before_data -> 'status' = expected_before_status
                    )
                )
                OR (
                    expected_state_kind = 'feature_limit'
                    AND audit.after_data -> 'included' = expected_after_included
                    AND audit.after_data -> 'unlimited' = expected_after_unlimited
                    AND audit.after_data ? 'limit'
                    AND audit.after_data -> 'limit' = expected_after_limit
                    AND (
                        TG_OP = 'INSERT'
                        OR (
                            audit.before_data -> 'included' = expected_before_included
                            AND audit.before_data -> 'unlimited' = expected_before_unlimited
                            AND audit.before_data ? 'limit'
                            AND audit.before_data -> 'limit' = expected_before_limit
                        )
                    )
                )
            )
            AND lerniqa_user_is_system_admin(audit.actor_user_id)
    ) THEN
        RAISE EXCEPTION '% mutation requires a matching same-transaction admin audit row', TG_TABLE_NAME
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER subscription_plans_audit_check
AFTER INSERT OR UPDATE ON subscription_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();

CREATE CONSTRAINT TRIGGER subscription_prices_audit_check
AFTER INSERT OR UPDATE ON subscription_plan_prices
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();

CREATE CONSTRAINT TRIGGER subscription_features_audit_check
AFTER INSERT OR UPDATE ON subscription_feature_definitions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();

CREATE CONSTRAINT TRIGGER subscription_limits_audit_check
AFTER INSERT OR UPDATE ON subscription_plan_feature_limits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_audit();

CREATE FUNCTION lerniqa_assert_subscription_catalog_integrity(
    candidate_plan_id uuid,
    candidate_feature_definition_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- Activation is intentionally reachable in two audited statements: the
    -- plan becomes active first, then one or more prices may become active.
    -- Therefore only the price-to-plan direction is required here.
    IF candidate_plan_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM subscription_plan_prices AS price
        JOIN subscription_plans AS plan ON plan.id = price.plan_id
        WHERE price.plan_id = candidate_plan_id
            AND price.status = 'active'
            AND plan.status <> 'active'
    ) THEN
        RAISE EXCEPTION 'active subscription price requires an active plan'
            USING ERRCODE = '23514';
    END IF;

    IF candidate_plan_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM subscription_plan_prices AS price
        JOIN subscription_plans AS plan ON plan.id = price.plan_id
        WHERE price.plan_id = candidate_plan_id
            AND plan.status = 'retired'
            AND price.status <> 'retired'
    ) THEN
        RAISE EXCEPTION 'retired subscription plan cannot retain draft or active prices'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM subscription_plan_feature_limits AS feature_limit
        JOIN subscription_feature_definitions AS feature
            ON feature.id = feature_limit.feature_definition_id
        WHERE (
                candidate_plan_id IS NULL
                OR feature_limit.plan_id = candidate_plan_id
            )
            AND (
                candidate_feature_definition_id IS NULL
                OR feature.id = candidate_feature_definition_id
            )
            AND feature_limit.included
            AND (
                (
                    feature.value_type = 'boolean'
                    AND (
                        feature_limit.unlimited
                        OR feature_limit.limit_value IS NOT NULL
                    )
                )
                OR (
                    feature.value_type = 'integer'
                    AND (
                        (feature_limit.unlimited AND feature_limit.limit_value IS NOT NULL)
                        OR (
                            NOT feature_limit.unlimited
                            AND feature_limit.limit_value IS NULL
                        )
                    )
                )
            )
    ) THEN
        RAISE EXCEPTION 'subscription feature limit does not match its feature value type'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM subscription_plan_feature_limits AS feature_limit
        JOIN subscription_plans AS plan ON plan.id = feature_limit.plan_id
        JOIN subscription_feature_definitions AS feature
            ON feature.id = feature_limit.feature_definition_id
        WHERE (candidate_plan_id IS NULL OR plan.id = candidate_plan_id)
            AND (
                candidate_feature_definition_id IS NULL
                OR feature.id = candidate_feature_definition_id
            )
            AND plan.status = 'active'
            AND feature_limit.included
            AND feature.status <> 'active'
    ) THEN
        RAISE EXCEPTION 'an included feature on an active plan must use an active feature definition'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_subscription_catalog_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_plan_id uuid;
    current_plan_id uuid;
    previous_feature_id uuid;
    current_feature_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'subscription_plans' THEN
        current_plan_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'subscription_plan_prices' THEN
        IF TG_OP <> 'INSERT' THEN
            previous_plan_id := OLD.plan_id;
        END IF;
        current_plan_id := NEW.plan_id;
    ELSIF TG_TABLE_NAME = 'subscription_feature_definitions' THEN
        current_feature_id := NEW.id;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            previous_plan_id := OLD.plan_id;
            previous_feature_id := OLD.feature_definition_id;
        END IF;
        current_plan_id := NEW.plan_id;
        current_feature_id := NEW.feature_definition_id;
    END IF;

    PERFORM lerniqa_assert_subscription_catalog_integrity(
        previous_plan_id,
        previous_feature_id
    );
    PERFORM lerniqa_assert_subscription_catalog_integrity(
        current_plan_id,
        current_feature_id
    );
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER subscription_plans_integrity_check
AFTER INSERT OR UPDATE OF status ON subscription_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_integrity();

CREATE CONSTRAINT TRIGGER subscription_prices_integrity_check
AFTER INSERT OR UPDATE OF plan_id, status ON subscription_plan_prices
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_integrity();

CREATE CONSTRAINT TRIGGER subscription_features_integrity_check
AFTER INSERT OR UPDATE OF status, value_type ON subscription_feature_definitions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_integrity();

CREATE CONSTRAINT TRIGGER subscription_limits_integrity_check
AFTER INSERT OR UPDATE OF
    plan_id,
    feature_definition_id,
    included,
    unlimited,
    limit_value
ON subscription_plan_feature_limits
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_subscription_catalog_integrity();

CREATE FUNCTION lerniqa_prepare_admin_mutation_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'admin mutation receipt cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF NOT lerniqa_user_is_system_admin(NEW.actor_user_id) THEN
        RAISE EXCEPTION 'admin mutation receipt requires an active system_admin actor'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending'
            OR NEW.target_type IS NOT NULL
            OR NEW.target_id IS NOT NULL
            OR NEW.admin_audit_log_id IS NOT NULL
            OR NEW.replay_result IS NOT NULL
            OR NEW.completed_at IS NOT NULL THEN
            RAISE EXCEPTION 'admin mutation receipt must start pending without a result'
                USING ERRCODE = '23514';
        END IF;
        NEW.created_at := transaction_timestamp();
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
        OR NEW.operation IS DISTINCT FROM OLD.operation
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
        OR NEW.request_id IS DISTINCT FROM OLD.request_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'admin mutation receipt request evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'completed' OR NEW.status <> 'completed' THEN
        RAISE EXCEPTION 'admin mutation receipt can only move from pending to completed once'
            USING ERRCODE = '23514';
    END IF;

    NEW.completed_at := transaction_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER admin_mutation_receipts_history_check
BEFORE INSERT OR UPDATE OR DELETE ON admin_mutation_receipts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_prepare_admin_mutation_receipt();

CREATE FUNCTION lerniqa_validate_admin_mutation_receipt_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    final_receipt admin_mutation_receipts%ROWTYPE;
    expected_target_type varchar(60);
    expected_actions varchar(80)[];
BEGIN
    SELECT *
    INTO final_receipt
    FROM admin_mutation_receipts
    WHERE id = NEW.id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'admin mutation receipt disappeared before commit'
            USING ERRCODE = '23514';
    END IF;

    IF final_receipt.status <> 'completed' THEN
        RAISE EXCEPTION 'admin mutation receipt must complete in its business transaction'
            USING ERRCODE = '23514';
    END IF;

    CASE final_receipt.operation
        WHEN 'system_question_draft' THEN
            expected_target_type := 'question_revision';
            expected_actions := ARRAY['system_question_revision_draft_created'];
        WHEN 'system_question_review' THEN
            expected_target_type := 'question_revision';
            expected_actions := ARRAY['system_question_revision_reviewed'];
        WHEN 'system_question_publish' THEN
            expected_target_type := 'question_revision';
            expected_actions := ARRAY['system_question_revision_status_changed'];
        WHEN 'subscription_plan_create' THEN
            expected_target_type := 'subscription_plan';
            expected_actions := ARRAY['subscription_plan_created'];
        WHEN 'subscription_plan_update' THEN
            expected_target_type := 'subscription_plan';
            expected_actions := ARRAY['subscription_plan_updated'];
        WHEN 'subscription_plan_status' THEN
            expected_target_type := 'subscription_plan';
            expected_actions := ARRAY[
                'subscription_plan_activated',
                'subscription_plan_retired'
            ];
        WHEN 'subscription_price_create' THEN
            expected_target_type := 'subscription_plan_price';
            expected_actions := ARRAY['subscription_price_created'];
        WHEN 'subscription_price_update' THEN
            expected_target_type := 'subscription_plan_price';
            expected_actions := ARRAY['subscription_price_updated'];
        WHEN 'subscription_price_status' THEN
            expected_target_type := 'subscription_plan_price';
            expected_actions := ARRAY[
                'subscription_price_activated',
                'subscription_price_retired'
            ];
        WHEN 'subscription_feature_create' THEN
            expected_target_type := 'subscription_feature_definition';
            expected_actions := ARRAY['subscription_feature_definition_created'];
        WHEN 'subscription_feature_update' THEN
            expected_target_type := 'subscription_feature_definition';
            expected_actions := ARRAY['subscription_feature_definition_updated'];
        WHEN 'subscription_feature_status' THEN
            expected_target_type := 'subscription_feature_definition';
            expected_actions := ARRAY[
                'subscription_feature_definition_activated',
                'subscription_feature_definition_retired'
            ];
        WHEN 'subscription_feature_limit_set' THEN
            expected_target_type := 'subscription_plan_feature_limit';
            expected_actions := ARRAY[
                'subscription_feature_limit_set',
                'subscription_feature_limit_updated'
            ];
        ELSE
            RAISE EXCEPTION 'unsupported admin mutation receipt operation: %', final_receipt.operation
                USING ERRCODE = '23514';
    END CASE;

    IF final_receipt.target_type <> expected_target_type THEN
        RAISE EXCEPTION 'admin mutation receipt target type does not match its operation'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_audit_logs AS audit
        WHERE audit.id = final_receipt.admin_audit_log_id
            AND audit.actor_type = 'user'
            AND audit.actor_user_id = final_receipt.actor_user_id
            AND audit.target_type = final_receipt.target_type
            AND audit.target_id = final_receipt.target_id
            AND audit.action = ANY (expected_actions)
            AND audit.request_id = final_receipt.request_id
            AND audit.created_at = transaction_timestamp()
            AND lerniqa_user_is_system_admin(audit.actor_user_id)
    ) THEN
        RAISE EXCEPTION 'completed admin mutation receipt requires matching same-transaction audit evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER admin_mutation_receipts_completion_check
AFTER INSERT OR UPDATE ON admin_mutation_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_admin_mutation_receipt_completion();

INSERT INTO schema_migrations (version, name)
VALUES ('0012', 'admin_catalog_and_question_enrichment');

COMMIT;
