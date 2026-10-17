BEGIN;

CREATE TABLE question_templates (
    id uuid PRIMARY KEY,
    template_key varchar(160) NOT NULL UNIQUE,
    normalized_pattern text NOT NULL,
    logic_key varchar(160) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    created_source varchar(20) NOT NULL,
    method_version varchar(80),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by_user_id uuid REFERENCES users(id),
    confirmed_at timestamptz,
    CONSTRAINT question_templates_identity_check
        CHECK (
            btrim(template_key) <> ''
            AND btrim(normalized_pattern) <> ''
            AND btrim(logic_key) <> ''
        ),
    CONSTRAINT question_templates_status_check
        CHECK (status IN ('pending', 'confirmed', 'inactive')),
    CONSTRAINT question_templates_source_check
        CHECK (created_source IN ('manual', 'rule', 'ai')),
    CONSTRAINT question_templates_method_check
        CHECK (
            (created_source = 'manual' AND method_version IS NULL)
            OR (
                created_source IN ('rule', 'ai')
                AND method_version IS NOT NULL
                AND btrim(method_version) <> ''
            )
        ),
    CONSTRAINT question_templates_evidence_check
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND pg_column_size(evidence) <= 32768
        ),
    CONSTRAINT question_templates_confirmation_check
        CHECK (
            (
                status = 'pending'
                AND confirmed_by_user_id IS NULL
                AND confirmed_at IS NULL
            )
            OR (
                status IN ('confirmed', 'inactive')
                AND confirmed_by_user_id IS NOT NULL
                AND confirmed_at IS NOT NULL
            )
        )
);

CREATE INDEX question_templates_status_index
    ON question_templates(status, logic_key, template_key);

CREATE TABLE question_template_memberships (
    question_template_id uuid NOT NULL REFERENCES question_templates(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    based_on_revision_id uuid NOT NULL,
    variable_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'pending',
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (question_template_id, question_id),
    CONSTRAINT question_template_memberships_revision_fk
        FOREIGN KEY (based_on_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT question_template_memberships_values_check
        CHECK (
            jsonb_typeof(variable_values) = 'object'
            AND pg_column_size(variable_values) <= 32768
        ),
    CONSTRAINT question_template_memberships_status_check
        CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
    CONSTRAINT question_template_memberships_evidence_check
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND pg_column_size(evidence) <= 32768
        ),
    CONSTRAINT question_template_memberships_review_check
        CHECK (
            (
                status = 'pending'
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status IN ('confirmed', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
            OR (
                status = 'expired'
                AND (reviewed_by_user_id IS NULL) = (reviewed_at IS NULL)
            )
        ),
    CONSTRAINT question_template_memberships_review_time_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);

CREATE INDEX question_template_memberships_question_index
    ON question_template_memberships(question_id, status);

CREATE INDEX question_template_memberships_revision_index
    ON question_template_memberships(based_on_revision_id, status);

CREATE TABLE relation_keywords (
    id uuid PRIMARY KEY,
    keyword_key varchar(160) NOT NULL UNIQUE,
    label varchar(160) NOT NULL,
    keyword_kind varchar(30) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT relation_keywords_text_check
        CHECK (btrim(keyword_key) <> '' AND btrim(label) <> ''),
    CONSTRAINT relation_keywords_kind_check
        CHECK (
            keyword_kind IN (
                'person',
                'work',
                'passage',
                'target_character',
                'concept',
                'topic',
                'knowledge_point',
                'other'
            )
        ),
    CONSTRAINT relation_keywords_status_check
        CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX relation_keywords_kind_status_index
    ON relation_keywords(keyword_kind, status, keyword_key);

CREATE TABLE question_revision_keywords (
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    relation_keyword_id uuid NOT NULL REFERENCES relation_keywords(id),
    value_source varchar(20) NOT NULL,
    method_version varchar(80),
    status varchar(20) NOT NULL DEFAULT 'pending',
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by_user_id uuid REFERENCES users(id),
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (question_revision_id, relation_keyword_id),
    CONSTRAINT question_revision_keywords_source_check
        CHECK (value_source IN ('manual', 'document', 'rule', 'ai', 'migration')),
    CONSTRAINT question_revision_keywords_method_check
        CHECK (
            (value_source IN ('manual', 'document', 'migration') AND method_version IS NULL)
            OR (
                value_source IN ('rule', 'ai')
                AND method_version IS NOT NULL
                AND btrim(method_version) <> ''
            )
        ),
    CONSTRAINT question_revision_keywords_status_check
        CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
    CONSTRAINT question_revision_keywords_evidence_check
        CHECK (
            jsonb_typeof(evidence) = 'object'
            AND pg_column_size(evidence) <= 32768
        ),
    CONSTRAINT question_revision_keywords_review_check
        CHECK (
            (
                status = 'pending'
                AND reviewed_by_user_id IS NULL
                AND reviewed_at IS NULL
            )
            OR (
                status IN ('confirmed', 'rejected')
                AND reviewed_by_user_id IS NOT NULL
                AND reviewed_at IS NOT NULL
            )
            OR (
                status = 'expired'
                AND (reviewed_by_user_id IS NULL) = (reviewed_at IS NULL)
            )
        ),
    CONSTRAINT question_revision_keywords_review_time_check
        CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);

CREATE INDEX question_revision_keywords_keyword_index
    ON question_revision_keywords(relation_keyword_id, status, question_revision_id);

CREATE INDEX question_revision_keywords_revision_index
    ON question_revision_keywords(question_revision_id, status, relation_keyword_id);

CREATE FUNCTION lerniqa_validate_question_template_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'confirmed' AND NOT EXISTS (
        SELECT 1
        FROM question_templates AS template
        WHERE template.id = NEW.question_template_id
            AND template.status = 'confirmed'
    ) THEN
        RAISE EXCEPTION '確認的題目模板成員必須屬於已確認模板'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_template_memberships_template_check
BEFORE INSERT OR UPDATE OF question_template_id, status
ON question_template_memberships
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_question_template_membership();

CREATE FUNCTION lerniqa_validate_question_revision_keyword()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'confirmed' AND NOT EXISTS (
        SELECT 1
        FROM relation_keywords AS keyword
        WHERE keyword.id = NEW.relation_keyword_id
            AND keyword.status = 'active'
    ) THEN
        RAISE EXCEPTION '確認的題目關鍵字關聯必須引用有效關鍵字'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_revision_keywords_keyword_check
BEFORE INSERT OR UPDATE OF relation_keyword_id, status
ON question_revision_keywords
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_question_revision_keyword();

ALTER TABLE practice_session_item_origins
    ADD COLUMN question_template_id uuid REFERENCES question_templates(id),
    ADD COLUMN shared_relation_count smallint,
    ADD COLUMN relation_method_version varchar(80),
    ADD COLUMN relation_evidence jsonb,
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
                'same_question_type',
                'same_template',
                'shared_keyword'
            )
        ),
    ADD CONSTRAINT practice_session_item_origins_relation_count_check
        CHECK (shared_relation_count IS NULL OR shared_relation_count >= 0),
    ADD CONSTRAINT practice_session_item_origins_relation_evidence_check
        CHECK (
            relation_evidence IS NULL
            OR (
                jsonb_typeof(relation_evidence) = 'object'
                AND pg_column_size(relation_evidence) <= 32768
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
                    matched_subject_id,
                    question_template_id
                ) = 0
                AND shared_relation_count IS NULL
                AND relation_method_version IS NULL
                AND relation_evidence IS NULL
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
                            matched_subject_id,
                            question_template_id
                        ) = 0
                    )
                    OR (
                        match_basis = 'same_template'
                        AND question_template_id IS NOT NULL
                        AND num_nonnulls(
                            similarity_group_id,
                            matched_topic_id,
                            matched_knowledge_point_id,
                            matched_curriculum_unit_id,
                            matched_subject_id
                        ) = 0
                        AND shared_relation_count = 0
                        AND relation_method_version IS NOT NULL
                        AND btrim(relation_method_version) <> ''
                        AND relation_evidence IS NOT NULL
                    )
                    OR (
                        match_basis = 'shared_keyword'
                        AND num_nonnulls(
                            similarity_group_id,
                            matched_topic_id,
                            matched_knowledge_point_id,
                            matched_curriculum_unit_id,
                            matched_subject_id,
                            question_template_id
                        ) = 0
                        AND shared_relation_count > 0
                        AND relation_method_version IS NOT NULL
                        AND btrim(relation_method_version) <> ''
                        AND relation_evidence IS NOT NULL
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
                            matched_subject_id,
                            question_template_id
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
        WHEN 'same_template' THEN
            RETURN EXISTS (
                SELECT 1
                FROM question_template_memberships AS source_membership
                JOIN question_templates AS template
                    ON template.id = source_membership.question_template_id
                    AND template.status = 'confirmed'
                JOIN question_template_memberships AS target_membership
                    ON target_membership.question_template_id = template.id
                    AND target_membership.question_id = target_question_id
                    AND target_membership.based_on_revision_id = target_revision_id
                    AND target_membership.status = 'confirmed'
                WHERE source_membership.question_id = source_question_id
                    AND source_membership.based_on_revision_id = source_revision_id
                    AND source_membership.status = 'confirmed'
            );

        WHEN 'shared_keyword' THEN
            RETURN EXISTS (
                SELECT 1
                FROM question_revision_keywords AS source_keyword
                JOIN question_revision_keywords AS target_keyword
                    ON target_keyword.relation_keyword_id = source_keyword.relation_keyword_id
                    AND target_keyword.question_revision_id = target_revision_id
                    AND target_keyword.status = 'confirmed'
                JOIN relation_keywords AS keyword
                    ON keyword.id = source_keyword.relation_keyword_id
                    AND keyword.status = 'active'
                WHERE source_keyword.question_revision_id = source_revision_id
                    AND source_keyword.status = 'confirmed'
            );

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

CREATE FUNCTION lerniqa_validate_relation_origin_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    source_revision_id uuid;
    target_revision_id uuid;
    actual_keyword_count integer;
BEGIN
    IF NEW.relation_kind <> 'similar_review'
        OR NEW.match_basis NOT IN ('same_template', 'shared_keyword') THEN
        RETURN NEW;
    END IF;

    SELECT source_item.question_revision_id, target_item.question_revision_id
    INTO source_revision_id, target_revision_id
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS source_item
        ON source_item.id = attempt.practice_session_item_id
    JOIN practice_session_items AS target_item
        ON target_item.id = NEW.practice_session_item_id
    WHERE result.id = NEW.source_answer_part_result_id;

    IF NEW.match_basis = 'same_template' AND NOT EXISTS (
        SELECT 1
        FROM question_templates AS template
        JOIN question_template_memberships AS source_membership
            ON source_membership.question_template_id = template.id
            AND source_membership.based_on_revision_id = source_revision_id
            AND source_membership.status = 'confirmed'
        JOIN question_template_memberships AS target_membership
            ON target_membership.question_template_id = template.id
            AND target_membership.based_on_revision_id = target_revision_id
            AND target_membership.status = 'confirmed'
        WHERE template.id = NEW.question_template_id
            AND template.status = 'confirmed'
    ) THEN
        RAISE EXCEPTION '相同題來源必須引用兩個題目版本共同的已確認模板'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.match_basis = 'shared_keyword' THEN
        IF jsonb_typeof(NEW.relation_evidence -> 'keyword_ids') <> 'array'
            OR jsonb_array_length(NEW.relation_evidence -> 'keyword_ids')
                <> NEW.shared_relation_count THEN
            RAISE EXCEPTION '相近題來源的共同關鍵字證據與數量不一致'
                USING ERRCODE = '23514';
        END IF;

        SELECT count(DISTINCT keyword.id)
        INTO actual_keyword_count
        FROM jsonb_array_elements_text(NEW.relation_evidence -> 'keyword_ids') AS evidence(keyword_id)
        JOIN relation_keywords AS keyword
            ON keyword.id = evidence.keyword_id::uuid
            AND keyword.status = 'active'
        JOIN question_revision_keywords AS source_keyword
            ON source_keyword.relation_keyword_id = keyword.id
            AND source_keyword.question_revision_id = source_revision_id
            AND source_keyword.status = 'confirmed'
        JOIN question_revision_keywords AS target_keyword
            ON target_keyword.relation_keyword_id = keyword.id
            AND target_keyword.question_revision_id = target_revision_id
            AND target_keyword.status = 'confirmed';

        IF actual_keyword_count <> NEW.shared_relation_count THEN
            RAISE EXCEPTION '相近題來源包含未確認或未共同命中的關鍵字'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER practice_session_item_origins_relation_evidence_check
BEFORE INSERT ON practice_session_item_origins
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_relation_origin_evidence();

INSERT INTO schema_migrations (version, name)
VALUES ('0014', 'question_relation_profiles');

COMMIT;
