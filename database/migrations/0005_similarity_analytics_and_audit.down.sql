BEGIN;

-- This DDL rollback is only safe before 0005 starts carrying durable review,
-- policy, provenance, audit, or erasure data. Runtime rollback should disable
-- the feature and clear only rebuildable aggregates instead of dropping these.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM question_similarity_groups)
        OR EXISTS (SELECT 1 FROM question_similarity_candidates)
        OR EXISTS (SELECT 1 FROM question_similarity_memberships)
        OR EXISTS (SELECT 1 FROM question_generation_relations)
        OR EXISTS (SELECT 1 FROM analytics_privacy_policies)
        OR EXISTS (SELECT 1 FROM admin_audit_logs)
        OR EXISTS (SELECT 1 FROM data_erasure_requests)
        OR EXISTS (
            SELECT 1
            FROM learner_practice_queue_items
            WHERE similarity_group_id IS NOT NULL
                OR match_basis = 'confirmed_group'
        )
        OR EXISTS (
            SELECT 1
            FROM practice_session_item_origins
            WHERE similarity_group_id IS NOT NULL
                OR match_basis = 'confirmed_group'
        )
        OR EXISTS (
            SELECT 1
            FROM curriculum_units
            WHERE origin <> 'system' OR owner_user_id IS NOT NULL
        )
        OR EXISTS (
            SELECT 1
            FROM source_categories
            WHERE origin <> 'system' OR owner_user_id IS NOT NULL
        )
        OR EXISTS (
            SELECT 1
            FROM assets
            WHERE purpose = 'answer_attachment'
        )
        OR EXISTS (
            SELECT 1
            FROM question_revisions
            WHERE status = 'superseded'
                AND published_at IS NOT NULL
        )
        OR EXISTS (
            SELECT 1
            FROM seed_manifests
            WHERE status = 'superseded'
                AND applied_at IS NOT NULL
        ) THEN
        RAISE EXCEPTION '0005 contains durable data; use the operational rollback path before removing its schema'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

DELETE FROM schema_migrations WHERE version = '0005';

DROP TRIGGER practice_plan_difficulty_mix_total_check
    ON practice_plan_difficulty_mix;
DROP TRIGGER practice_plans_difficulty_mix_check ON practice_plans;
DROP FUNCTION lerniqa_validate_practice_plan_difficulty_mix();
DROP FUNCTION lerniqa_practice_plan_difficulty_mix_is_valid(uuid);

DROP TRIGGER seed_manifests_evidence_immutable ON seed_manifests;
DROP FUNCTION lerniqa_protect_seed_manifest_evidence();
ALTER TABLE seed_manifests
    DROP CONSTRAINT seed_manifests_applied_at_check,
    ADD CONSTRAINT seed_manifests_applied_at_check
        CHECK (
            (status = 'applied' AND applied_at IS NOT NULL)
            OR (status <> 'applied' AND applied_at IS NULL)
        );

DROP TRIGGER subjects_aliases_origin_check ON subjects;
DROP FUNCTION lerniqa_validate_subject_aliases_after_origin_change();
DROP TRIGGER subject_aliases_system_subject_check ON subject_aliases;
DROP FUNCTION lerniqa_validate_subject_alias_subject();

DROP TRIGGER exam_program_levels_ancestry_check ON exam_program_levels;
DROP FUNCTION lerniqa_validate_exam_program_level_ancestry();

DROP TRIGGER users_auth_sessions_check ON users;
DROP TRIGGER learner_access_auth_sessions_check ON learner_access;
DROP TRIGGER user_roles_auth_sessions_check ON user_roles;
DROP FUNCTION lerniqa_validate_sessions_after_access_change();
DROP TRIGGER auth_sessions_access_check ON auth_sessions;
DROP FUNCTION lerniqa_validate_auth_session();
DROP TRIGGER users_auth_user_lock ON users;
DROP TRIGGER learner_access_auth_user_lock ON learner_access;
DROP TRIGGER user_roles_auth_user_lock ON user_roles;
DROP FUNCTION lerniqa_lock_auth_change_user();
DROP FUNCTION lerniqa_lock_auth_user(uuid);
DROP FUNCTION lerniqa_auth_user_lock_key(uuid);
DROP FUNCTION lerniqa_auth_session_is_valid(uuid, varchar, uuid);

DROP TRIGGER question_answers_frozen_revision_check ON question_answers;
DROP TRIGGER question_options_frozen_revision_check ON question_options;
DROP TRIGGER question_revision_sources_frozen_revision_check
    ON question_revision_sources;
DROP TRIGGER question_revision_filter_values_frozen_revision_check
    ON question_revision_filter_values;
DROP TRIGGER question_revision_curriculum_codes_frozen_revision_check
    ON question_revision_curriculum_codes;
DROP TRIGGER question_revision_knowledge_points_frozen_revision_check
    ON question_revision_knowledge_points;
DROP TRIGGER question_revision_topics_frozen_revision_check
    ON question_revision_topics;
DROP TRIGGER question_revision_units_frozen_revision_check
    ON question_revision_units;
DROP TRIGGER question_content_blocks_frozen_revision_check
    ON question_content_blocks;
DROP TRIGGER question_parts_frozen_revision_check ON question_parts;
DROP FUNCTION lerniqa_protect_frozen_revision_part_child();
DROP FUNCTION lerniqa_protect_frozen_revision_child();
DROP TRIGGER question_revisions_review_check ON question_revisions;
DROP FUNCTION lerniqa_validate_system_revision_review();
DROP TRIGGER question_revisions_frozen_check ON question_revisions;
DROP FUNCTION lerniqa_protect_frozen_question_revision();
DROP FUNCTION lerniqa_question_revision_is_frozen(uuid);

DROP TRIGGER questions_system_revision_change_note_check ON questions;
DROP TRIGGER question_revisions_change_note_check ON question_revisions;
DROP FUNCTION lerniqa_validate_system_revision_change_note();

DROP TRIGGER question_revisions_current_status_check ON question_revisions;
DROP FUNCTION lerniqa_validate_revision_current_status();

DROP TRIGGER questions_current_revision_status_check ON questions;
CREATE OR REPLACE FUNCTION lerniqa_validate_current_revision_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM question_revisions
        WHERE id = NEW.current_revision_id
            AND question_id = NEW.id
            AND status = 'published'
    ) THEN
        RAISE EXCEPTION '目前題目版本必須是同一題的已發布版本'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER questions_current_revision_status_check
AFTER INSERT OR UPDATE OF current_revision_id ON questions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_current_revision_status();

ALTER TABLE question_revisions
    DROP CONSTRAINT question_revisions_publish_check,
    ADD CONSTRAINT question_revisions_publish_check
        CHECK (
            (status = 'published' AND published_at IS NOT NULL)
            OR (status <> 'published' AND published_at IS NULL)
        );

DROP TRIGGER answer_part_results_history_check ON answer_part_results;
DROP TRIGGER answer_part_results_review_transaction_check
    ON answer_part_results;
DROP FUNCTION lerniqa_validate_answer_review_transaction();
DROP TRIGGER answer_reviews_transaction_check ON answer_reviews;
DROP FUNCTION lerniqa_validate_answer_review_insert();
DROP TRIGGER answer_attempts_overall_result_check ON answer_attempts;
DROP FUNCTION lerniqa_validate_answer_attempt_overall_result();
DROP TRIGGER answer_part_results_attempt_overall_check
    ON answer_part_results;
DROP FUNCTION lerniqa_validate_answer_part_attempt_overall_result();
DROP FUNCTION lerniqa_answer_attempt_expected_result(uuid);
DROP FUNCTION lerniqa_validate_answer_part_result_history();
DROP TRIGGER answer_attempts_history_check ON answer_attempts;
DROP FUNCTION lerniqa_validate_answer_attempt_history();
DROP TRIGGER answer_reviews_append_only ON answer_reviews;
DROP TRIGGER question_revision_reviews_append_only
    ON question_revision_reviews;
DROP TRIGGER admin_audit_logs_append_only ON admin_audit_logs;
DROP TRIGGER answer_reviews_transaction_timestamp ON answer_reviews;
DROP TRIGGER question_revision_reviews_transaction_timestamp
    ON question_revision_reviews;
DROP TRIGGER admin_audit_logs_transaction_timestamp ON admin_audit_logs;
DROP FUNCTION lerniqa_set_transaction_created_at();

DROP TRIGGER analytics_privacy_policies_admin_check
    ON analytics_privacy_policies;
DROP TRIGGER analytics_privacy_policies_version_check
    ON analytics_privacy_policies;
DROP TRIGGER analytics_privacy_policies_audit_check
    ON analytics_privacy_policies;
DROP FUNCTION lerniqa_validate_privacy_policy_audit();
DROP FUNCTION lerniqa_validate_privacy_policy_version();
DROP TRIGGER admin_audit_logs_actor_role_check ON admin_audit_logs;
DROP TRIGGER data_erasure_requests_reviewer_role_check
    ON data_erasure_requests;
DROP TRIGGER data_erasure_requests_completion_audit_check
    ON data_erasure_requests;
DROP FUNCTION lerniqa_validate_data_erasure_completion_audit();
DROP TRIGGER data_erasure_requests_history_check
    ON data_erasure_requests;
DROP FUNCTION lerniqa_protect_data_erasure_request_history();
DROP TRIGGER user_roles_system_admin_audit_check ON user_roles;
DROP FUNCTION lerniqa_validate_system_admin_role_audit();
DROP TRIGGER user_roles_history_check ON user_roles;
DROP FUNCTION lerniqa_protect_user_role_history();
DROP FUNCTION lerniqa_validate_privileged_record_actor();
DROP FUNCTION lerniqa_user_is_system_admin(uuid);

DROP TRIGGER assets_reference_update_check ON assets;
DROP FUNCTION lerniqa_validate_asset_reference_update();
DROP TRIGGER learners_avatar_asset_check ON learners;
DROP FUNCTION lerniqa_validate_learner_avatar_asset();
DROP TRIGGER question_content_blocks_asset_check ON question_content_blocks;
DROP FUNCTION lerniqa_validate_question_content_asset();

CREATE OR REPLACE FUNCTION lerniqa_validate_source_document_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM assets
        WHERE id = NEW.asset_id
            AND purpose = 'source_document'
    ) THEN
        RAISE EXCEPTION '來源文件只能引用 source_document 用途的檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_revision_source_crop()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.crop_asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM assets
        WHERE id = NEW.crop_asset_id
            AND purpose = 'page_crop'
    ) THEN
        RAISE EXCEPTION '題目來源裁切圖只能引用 page_crop 用途的檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION lerniqa_validate_answer_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.asset_role = 'handwriting' AND NOT EXISTS (
        SELECT 1
        FROM assets
        WHERE id = NEW.asset_id
            AND purpose = 'handwriting'
    ) THEN
        RAISE EXCEPTION '手寫作答只能引用 handwriting 用途的檔案'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.asset_role = 'attachment' AND NOT EXISTS (
        SELECT 1
        FROM assets
        WHERE id = NEW.asset_id
            AND sensitivity = 'private'
    ) THEN
        RAISE EXCEPTION '作答附件必須使用 private 敏感度的檔案'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE assets
    DROP CONSTRAINT assets_purpose_check,
    DROP CONSTRAINT assets_private_purpose_check,
    ADD CONSTRAINT assets_purpose_check
        CHECK (
            purpose IN (
                'question_content',
                'source_document',
                'handwriting',
                'learner_avatar',
                'page_crop'
            )
        ),
    ADD CONSTRAINT assets_private_purpose_check
        CHECK (purpose NOT IN ('handwriting', 'learner_avatar') OR sensitivity = 'private');

DROP FUNCTION lerniqa_asset_reference_is_valid(uuid, varchar[], boolean);

DROP TRIGGER practice_session_item_origins_consistency_check
    ON practice_session_item_origins;
DROP TRIGGER learner_practice_queue_items_consumed_origin_check
    ON learner_practice_queue_items;
DROP FUNCTION lerniqa_validate_consumed_queue_origin();
DROP TRIGGER practice_session_item_origins_append_only
    ON practice_session_item_origins;
DROP FUNCTION lerniqa_reject_origin_mutation();
DROP TRIGGER learner_practice_queue_items_learner_check
    ON learner_practice_queue_items;
DROP TRIGGER learner_practice_queue_items_provenance_immutable
    ON learner_practice_queue_items;
DROP TRIGGER practice_session_items_provenance_immutable
    ON practice_session_items;
DROP TRIGGER practice_sessions_provenance_immutable ON practice_sessions;
DROP FUNCTION lerniqa_protect_consumed_practice_provenance();

CREATE OR REPLACE FUNCTION lerniqa_validate_answer_attempt_learner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM practice_session_items AS item
        JOIN practice_sessions AS session ON session.id = item.practice_session_id
        WHERE item.id = NEW.practice_session_item_id
            AND session.learner_id = NEW.learner_id
    ) THEN
        RAISE EXCEPTION '作答學習者必須與練習工作階段相同'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP INDEX practice_session_item_origins_queue_unique;

ALTER TABLE practice_session_item_origins
    DROP CONSTRAINT practice_session_item_origins_match_basis_check,
    DROP CONSTRAINT practice_session_item_origins_basis_check,
    DROP COLUMN similarity_group_id,
    ADD CONSTRAINT practice_session_item_origins_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN ('same_topic', 'same_knowledge_point', 'same_unit', 'same_subject')
        ),
    ADD CONSTRAINT practice_session_item_origins_basis_check
        CHECK (
            (
                relation_kind = 'wrong_review'
                AND match_basis IS NULL
                AND num_nonnulls(
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
            )
            OR (
                relation_kind = 'similar_review'
                AND (
                    (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                    OR (
                        match_basis = 'same_knowledge_point'
                        AND matched_knowledge_point_id IS NOT NULL
                    )
                    OR (match_basis = 'same_unit' AND matched_curriculum_unit_id IS NOT NULL)
                    OR (match_basis = 'same_subject' AND matched_subject_id IS NOT NULL)
                )
                AND num_nonnulls(
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 1
            )
        );

ALTER TABLE learner_practice_queue_items
    DROP CONSTRAINT learner_practice_queue_items_match_basis_check,
    DROP CONSTRAINT learner_practice_queue_items_origin_check,
    DROP COLUMN similarity_group_id,
    ADD CONSTRAINT learner_practice_queue_items_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN ('same_topic', 'same_knowledge_point', 'same_unit', 'same_subject')
        ),
    ADD CONSTRAINT learner_practice_queue_items_origin_check
        CHECK (
            (
                reason = 'wrong_review'
                AND source_answer_part_result_id IS NOT NULL
                AND match_basis IS NULL
                AND num_nonnulls(
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
                    (match_basis = 'same_topic' AND matched_topic_id IS NOT NULL)
                    OR (
                        match_basis = 'same_knowledge_point'
                        AND matched_knowledge_point_id IS NOT NULL
                    )
                    OR (match_basis = 'same_unit' AND matched_curriculum_unit_id IS NOT NULL)
                    OR (match_basis = 'same_subject' AND matched_subject_id IS NOT NULL)
                )
                AND num_nonnulls(
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
                    matched_topic_id,
                    matched_knowledge_point_id,
                    matched_curriculum_unit_id,
                    matched_subject_id
                ) = 0
                AND (reason = 'manual' OR source_answer_part_result_id IS NULL)
            )
        );

CREATE OR REPLACE FUNCTION lerniqa_validate_queue_item_learner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_answer_part_result_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM answer_part_results AS result
        JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
        WHERE result.id = NEW.source_answer_part_result_id
            AND attempt.learner_id = NEW.learner_id
    ) THEN
        RAISE EXCEPTION '後續練習來源作答必須屬於同一學習者'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER learner_practice_queue_items_learner_check
BEFORE INSERT OR UPDATE OF learner_id, source_answer_part_result_id
ON learner_practice_queue_items
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_queue_item_learner();

CREATE OR REPLACE FUNCTION lerniqa_validate_session_item_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    session_learner_id uuid;
    source_learner_id uuid;
    queue_learner_id uuid;
    queue_source_id uuid;
    queue_reason varchar(30);
BEGIN
    SELECT session.learner_id
    INTO session_learner_id
    FROM practice_session_items AS item
    JOIN practice_sessions AS session ON session.id = item.practice_session_id
    WHERE item.id = NEW.practice_session_item_id;

    SELECT attempt.learner_id
    INTO source_learner_id
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    WHERE result.id = NEW.source_answer_part_result_id;

    IF session_learner_id IS DISTINCT FROM source_learner_id THEN
        RAISE EXCEPTION '練習來源作答必須屬於同一學習者'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.queue_item_id IS NOT NULL THEN
        SELECT learner_id, source_answer_part_result_id, reason
        INTO queue_learner_id, queue_source_id, queue_reason
        FROM learner_practice_queue_items
        WHERE id = NEW.queue_item_id;

        IF queue_learner_id IS DISTINCT FROM session_learner_id
            OR queue_source_id IS DISTINCT FROM NEW.source_answer_part_result_id
            OR queue_reason <> NEW.relation_kind THEN
            RAISE EXCEPTION '練習來源與消耗的後續練習項目不一致'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER practice_session_item_origins_consistency_check
BEFORE INSERT OR UPDATE ON practice_session_item_origins
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_session_item_origin();

DROP FUNCTION lerniqa_similarity_match_is_valid(
    uuid,
    uuid,
    uuid,
    varchar,
    uuid,
    uuid,
    uuid,
    uuid,
    uuid
);

DROP TABLE learner_similarity_group_stats;
DROP FUNCTION lerniqa_validate_similarity_group_stats_group();
DROP TABLE learner_part_stats;
DROP TABLE learner_question_stats;
DROP TABLE learner_daily_stats;
DROP TABLE question_daily_stats;
DROP TRIGGER analytics_outbox_history_check ON analytics_outbox;
DROP FUNCTION lerniqa_validate_analytics_outbox_history();
DROP TABLE analytics_outbox;
DROP TABLE analytics_jobs;
DROP TABLE analytics_privacy_policies;
DROP TABLE data_erasure_requests;
DROP TABLE admin_audit_logs;
DROP FUNCTION lerniqa_reject_append_only_mutation();
DROP TABLE question_generation_relations;
DROP TABLE question_similarity_memberships;
DROP FUNCTION lerniqa_validate_similarity_membership();
DROP TRIGGER question_similarity_candidates_question_check
    ON question_similarity_candidates;
DROP FUNCTION lerniqa_validate_similarity_candidate_questions();
DROP TABLE question_similarity_candidates;
DROP TABLE question_similarity_groups;

DROP INDEX curriculum_units_owner_status_index;
ALTER TABLE curriculum_units
    DROP CONSTRAINT curriculum_units_origin_check,
    DROP CONSTRAINT curriculum_units_owner_check,
    DROP COLUMN owner_user_id,
    DROP COLUMN origin;

DROP INDEX source_categories_owner_status_index;
ALTER TABLE source_categories
    DROP CONSTRAINT source_categories_origin_check,
    DROP CONSTRAINT source_categories_owner_check,
    DROP COLUMN owner_user_id,
    DROP COLUMN origin;

COMMIT;
