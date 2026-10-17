BEGIN;

-- Catalog rows, completed mutation receipts, and their linked audit records are
-- durable administrative evidence. A DDL rollback is safe only before 0012 has
-- carried data. Operational rollback must disable the feature and use a
-- forward migration instead of deleting history.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM handwriting_analysis_runs)
        OR EXISTS (SELECT 1 FROM handwriting_analysis_jobs)
        OR EXISTS (SELECT 1 FROM practice_recommendation_requests)
        OR EXISTS (
            SELECT 1
            FROM answer_reviews
            WHERE handwriting_analysis_run_id IS NOT NULL
        )
        OR EXISTS (SELECT 1 FROM question_revision_enrichment_suggestions)
        OR EXISTS (SELECT 1 FROM question_enrichment_runs)
        OR EXISTS (
            SELECT 1
            FROM practice_session_items
            WHERE selection_reason = 'same_type_review'
        )
        OR EXISTS (
            SELECT 1
            FROM learner_practice_queue_items
            WHERE match_basis = 'same_question_type'
        )
        OR EXISTS (
            SELECT 1
            FROM practice_session_item_origins
            WHERE match_basis = 'same_question_type'
        )
        OR EXISTS (SELECT 1 FROM subscription_plan_feature_limits)
        OR EXISTS (SELECT 1 FROM subscription_plan_prices)
        OR EXISTS (SELECT 1 FROM subscription_feature_definitions)
        OR EXISTS (SELECT 1 FROM subscription_plans)
        OR EXISTS (SELECT 1 FROM admin_mutation_receipts)
        -- DELETE history triggers do not cover TRUNCATE. Subscription target
        -- types did not exist before 0012, so their surviving audit rows are
        -- also durable evidence that must fail this DDL rollback closed.
        OR EXISTS (
            SELECT 1
            FROM admin_audit_logs
            WHERE target_type IN (
                'subscription_plan',
                'subscription_plan_price',
                'subscription_feature_definition',
                'subscription_plan_feature_limit'
            )
        ) THEN
        RAISE EXCEPTION '0012 contains durable catalog, provenance, enrichment, AI-assessment, or mutation-receipt data; use an operational rollback or forward migration'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

DROP TRIGGER verification_challenges_recovery_final_state
    ON verification_challenges;
DROP TRIGGER account_identities_recovery_final_state
    ON account_identities;
DROP TRIGGER users_recovery_final_state
    ON users;
DROP FUNCTION lerniqa_validate_recovery_challenge_final_state();
DROP TRIGGER verification_challenges_recovery_identity_check
    ON verification_challenges;
DROP FUNCTION lerniqa_validate_recovery_challenge_identity();
DROP TRIGGER verification_challenges_auth_user_lock
    ON verification_challenges;
DROP FUNCTION lerniqa_recovery_challenge_is_usable(uuid, uuid, uuid);

DROP INDEX verification_challenges_recovery_rate_index;
DROP INDEX verification_challenges_recovery_identity_lookup_index;
DROP INDEX verification_challenges_active_role_pin_reset_unique;
DROP INDEX verification_challenges_active_password_reset_user_unique;
ALTER TABLE verification_challenges
    DROP CONSTRAINT verification_challenges_recovery_identity_presence_check,
    DROP CONSTRAINT verification_challenges_account_identity_user_fk,
    DROP COLUMN account_identity_id;
ALTER TABLE account_identities
    DROP CONSTRAINT account_identities_id_user_unique;

DROP TRIGGER practice_recommendation_requests_append_only
    ON practice_recommendation_requests;
DROP FUNCTION lerniqa_prepare_practice_recommendation_request();
DROP TABLE practice_recommendation_requests;
DROP FUNCTION lerniqa_uuid_array_is_canonical_unique(uuid[]);

DROP TRIGGER practice_sessions_score_receipt_immutable
    ON practice_sessions;

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

        IF EXISTS (
            SELECT 1
            FROM practice_session_items AS item
            JOIN practice_score_receipts AS receipt
                ON receipt.practice_session_item_id = item.id
            WHERE item.practice_session_id = OLD.id
        ) AND (
            NEW.learner_id IS DISTINCT FROM OLD.learner_id
            OR NEW.check_mode IS DISTINCT FROM OLD.check_mode
        ) THEN
            RAISE EXCEPTION '已有 score 收據的練習不可改換學習者或檢查模式'
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

CREATE TRIGGER practice_sessions_score_receipt_immutable
BEFORE UPDATE OF learner_id, check_mode ON practice_sessions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_score_receipt_provenance();

DROP TRIGGER handwriting_analysis_runs_job_check
    ON handwriting_analysis_runs;
DROP TRIGGER handwriting_analysis_jobs_attempt_evidence_check
    ON handwriting_analysis_jobs;
DROP FUNCTION lerniqa_validate_handwriting_analysis_attempts();
DROP TRIGGER answer_reviews_handwriting_run_check
    ON answer_reviews;
DROP FUNCTION lerniqa_validate_answer_review_handwriting_run();
DROP INDEX answer_reviews_handwriting_analysis_run_unique;
ALTER TABLE answer_reviews
    DROP CONSTRAINT answer_reviews_handwriting_analysis_run_fk,
    DROP COLUMN handwriting_analysis_run_id;
DROP TRIGGER handwriting_analysis_runs_append_only
    ON handwriting_analysis_runs;
DROP FUNCTION lerniqa_prepare_handwriting_analysis_run();
DROP TRIGGER handwriting_analysis_jobs_history_check
    ON handwriting_analysis_jobs;
DROP FUNCTION lerniqa_prepare_handwriting_analysis_job();
DROP TRIGGER handwriting_analysis_jobs_source_check
    ON handwriting_analysis_jobs;
DROP FUNCTION lerniqa_validate_handwriting_analysis_job_source();
DROP TRIGGER answer_part_results_handwriting_job_check
    ON answer_part_results;
DROP TRIGGER handwriting_analysis_jobs_source_final_state
    ON handwriting_analysis_jobs;
DROP FUNCTION lerniqa_validate_handwriting_source_final_state();
DROP TABLE handwriting_analysis_runs;
DROP TABLE handwriting_analysis_jobs;

DROP TRIGGER question_revision_enrichment_suggestions_run_check
    ON question_revision_enrichment_suggestions;
DROP TRIGGER question_enrichment_runs_suggestion_check
    ON question_enrichment_runs;
DROP FUNCTION lerniqa_validate_enrichment_suggestion_run();
DROP TRIGGER question_revision_enrichment_suggestions_history_check
    ON question_revision_enrichment_suggestions;
DROP FUNCTION lerniqa_prepare_question_revision_enrichment_suggestion();
DROP TRIGGER question_enrichment_runs_history_check
    ON question_enrichment_runs;
DROP FUNCTION lerniqa_prepare_question_enrichment_run();
DROP TABLE question_revision_enrichment_suggestions;
DROP TABLE question_enrichment_runs;

ALTER TABLE practice_session_items
    DROP CONSTRAINT practice_session_items_reason_check,
    ADD CONSTRAINT practice_session_items_reason_check
        CHECK (
            selection_reason IN (
                'filter',
                'fixed',
                'wrong_review',
                'similar_review',
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
                'same_subject'
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
                    (match_basis = 'confirmed_group' AND similarity_group_id IS NOT NULL)
                    OR (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                    OR (
                        match_basis = 'same_knowledge_point'
                        AND matched_knowledge_point_id IS NOT NULL
                    )
                    OR (match_basis = 'same_unit' AND matched_curriculum_unit_id IS NOT NULL)
                    OR (match_basis = 'same_subject' AND matched_subject_id IS NOT NULL)
                )
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 1
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
                'same_subject'
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
                    (match_basis = 'confirmed_group' AND similarity_group_id IS NOT NULL)
                    OR (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                    OR (
                        match_basis = 'same_knowledge_point'
                        AND matched_knowledge_point_id IS NOT NULL
                    )
                    OR (match_basis = 'same_unit' AND matched_curriculum_unit_id IS NOT NULL)
                    OR (match_basis = 'same_subject' AND matched_subject_id IS NOT NULL)
                )
                AND num_nonnulls(
                    similarity_group_id,
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 1
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
    item_question_id uuid;
    item_revision_id uuid;
    item_part_id uuid;
    item_selection_reason varchar(30);
    source_learner_id uuid;
    source_result varchar(20);
    source_question_id uuid;
    source_revision_id uuid;
    source_part_id uuid;
    queue_row learner_practice_queue_items%ROWTYPE;
BEGIN
    SELECT
        session.learner_id,
        item.question_id,
        item.question_revision_id,
        item.question_part_id,
        item.selection_reason
    INTO
        session_learner_id,
        item_question_id,
        item_revision_id,
        item_part_id,
        item_selection_reason
    FROM practice_session_items AS item
    JOIN practice_sessions AS session ON session.id = item.practice_session_id
    WHERE item.id = NEW.practice_session_item_id;

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

    IF item_selection_reason IS DISTINCT FROM NEW.relation_kind THEN
        RAISE EXCEPTION '練習項目的選入原因必須與來源追溯關係一致'
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

DROP TRIGGER admin_mutation_receipts_completion_check
    ON admin_mutation_receipts;
DROP FUNCTION lerniqa_validate_admin_mutation_receipt_completion();
DROP TRIGGER admin_mutation_receipts_history_check
    ON admin_mutation_receipts;
DROP FUNCTION lerniqa_prepare_admin_mutation_receipt();

DROP TRIGGER subscription_limits_integrity_check
    ON subscription_plan_feature_limits;
DROP TRIGGER subscription_features_integrity_check
    ON subscription_feature_definitions;
DROP TRIGGER subscription_prices_integrity_check
    ON subscription_plan_prices;
DROP TRIGGER subscription_plans_integrity_check
    ON subscription_plans;
DROP FUNCTION lerniqa_validate_subscription_catalog_integrity();
DROP FUNCTION lerniqa_assert_subscription_catalog_integrity(uuid, uuid);

DROP TRIGGER subscription_limits_audit_check
    ON subscription_plan_feature_limits;
DROP TRIGGER subscription_features_audit_check
    ON subscription_feature_definitions;
DROP TRIGGER subscription_prices_audit_check
    ON subscription_plan_prices;
DROP TRIGGER subscription_plans_audit_check
    ON subscription_plans;
DROP FUNCTION lerniqa_validate_subscription_catalog_audit();

DROP TRIGGER subscription_limits_history_check
    ON subscription_plan_feature_limits;
DROP TRIGGER subscription_features_history_check
    ON subscription_feature_definitions;
DROP TRIGGER subscription_prices_history_check
    ON subscription_plan_prices;
DROP TRIGGER subscription_plans_history_check
    ON subscription_plans;
DROP FUNCTION lerniqa_prepare_subscription_catalog_mutation();

DROP TABLE admin_mutation_receipts;
DROP TABLE subscription_plan_feature_limits;
DROP TABLE subscription_plan_prices;
DROP TABLE subscription_feature_definitions;
DROP TABLE subscription_plans;

DELETE FROM schema_migrations WHERE version = '0012';

COMMIT;
