BEGIN;

DROP TRIGGER practice_session_item_origins_relation_evidence_check
    ON practice_session_item_origins;
DROP FUNCTION lerniqa_validate_relation_origin_evidence();

ALTER TABLE practice_session_item_origins
    DROP CONSTRAINT practice_session_item_origins_match_basis_check,
    DROP CONSTRAINT practice_session_item_origins_basis_check,
    DROP CONSTRAINT practice_session_item_origins_relation_count_check,
    DROP CONSTRAINT practice_session_item_origins_relation_evidence_check,
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

ALTER TABLE practice_session_item_origins
    DROP COLUMN question_template_id,
    DROP COLUMN shared_relation_count,
    DROP COLUMN relation_method_version,
    DROP COLUMN relation_evidence;

DROP TRIGGER question_revision_keywords_keyword_check
    ON question_revision_keywords;
DROP FUNCTION lerniqa_validate_question_revision_keyword();

DROP TRIGGER question_template_memberships_template_check
    ON question_template_memberships;
DROP FUNCTION lerniqa_validate_question_template_membership();

DROP TABLE question_revision_keywords;
DROP TABLE relation_keywords;
DROP TABLE question_template_memberships;
DROP TABLE question_templates;

DELETE FROM schema_migrations WHERE version = '0014';

COMMIT;
