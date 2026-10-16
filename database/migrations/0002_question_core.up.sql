BEGIN;

CREATE TABLE topics (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES subjects(id),
    code varchar(80),
    name varchar(120) NOT NULL,
    origin varchar(20) NOT NULL,
    owner_user_id uuid REFERENCES users(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT topics_origin_check CHECK (origin IN ('system', 'account')),
    CONSTRAINT topics_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT topics_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE TABLE knowledge_points (
    id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES subjects(id),
    parent_id uuid REFERENCES knowledge_points(id),
    code varchar(80),
    name varchar(160) NOT NULL,
    origin varchar(20) NOT NULL,
    owner_user_id uuid REFERENCES users(id),
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT knowledge_points_parent_check CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT knowledge_points_origin_check CHECK (origin IN ('system', 'account')),
    CONSTRAINT knowledge_points_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT knowledge_points_status_check CHECK (status IN ('active', 'inactive', 'archived'))
);

CREATE TABLE unit_topics (
    curriculum_unit_id uuid NOT NULL REFERENCES curriculum_units(id),
    topic_id uuid NOT NULL REFERENCES topics(id),
    position smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (curriculum_unit_id, topic_id),
    CONSTRAINT unit_topics_position_check CHECK (position >= 0)
);

CREATE INDEX unit_topics_topic_index ON unit_topics(topic_id, curriculum_unit_id);

CREATE TABLE unit_knowledge_points (
    curriculum_unit_id uuid NOT NULL REFERENCES curriculum_units(id),
    knowledge_point_id uuid NOT NULL REFERENCES knowledge_points(id),
    position smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (curriculum_unit_id, knowledge_point_id),
    CONSTRAINT unit_knowledge_points_position_check CHECK (position >= 0)
);

CREATE INDEX unit_knowledge_points_knowledge_index
    ON unit_knowledge_points(knowledge_point_id, curriculum_unit_id);

CREATE TABLE question_types (
    id uuid PRIMARY KEY,
    code varchar(60) NOT NULL UNIQUE,
    name varchar(100) NOT NULL,
    supports_parts boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT question_types_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE difficulty_levels (
    id uuid PRIMARY KEY,
    code varchar(30) NOT NULL UNIQUE,
    name varchar(40) NOT NULL,
    sort_order smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT difficulty_levels_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT difficulty_levels_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE filter_fields (
    id uuid PRIMARY KEY,
    key varchar(80) NOT NULL UNIQUE,
    name varchar(100) NOT NULL,
    value_type varchar(20) NOT NULL,
    selection_mode varchar(20) NOT NULL DEFAULT 'single',
    sort_order smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT filter_fields_value_type_check
        CHECK (value_type IN ('option', 'text', 'integer', 'year', 'date')),
    CONSTRAINT filter_fields_selection_mode_check
        CHECK (selection_mode IN ('single', 'multiple')),
    CONSTRAINT filter_fields_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT filter_fields_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE filter_field_scopes (
    id uuid PRIMARY KEY,
    filter_field_id uuid NOT NULL REFERENCES filter_fields(id),
    name varchar(120),
    required_on_publish boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT filter_field_scopes_identity_field_unique UNIQUE (id, filter_field_id),
    CONSTRAINT filter_field_scopes_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE filter_field_scope_sources (
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    source_category_id uuid NOT NULL REFERENCES source_categories(id),
    effect varchar(20) NOT NULL DEFAULT 'include',
    PRIMARY KEY (filter_field_scope_id, source_category_id),
    CONSTRAINT filter_field_scope_sources_effect_check CHECK (effect IN ('include', 'exclude'))
);

CREATE INDEX filter_field_scope_sources_reverse_index
    ON filter_field_scope_sources(source_category_id, effect, filter_field_scope_id);

CREATE TABLE filter_field_scope_subjects (
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    subject_id uuid NOT NULL REFERENCES subjects(id),
    effect varchar(20) NOT NULL DEFAULT 'include',
    PRIMARY KEY (filter_field_scope_id, subject_id),
    CONSTRAINT filter_field_scope_subjects_effect_check CHECK (effect IN ('include', 'exclude'))
);

CREATE INDEX filter_field_scope_subjects_reverse_index
    ON filter_field_scope_subjects(subject_id, effect, filter_field_scope_id);

CREATE TABLE filter_field_scope_grades (
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    grade_id uuid NOT NULL REFERENCES grades(id),
    effect varchar(20) NOT NULL DEFAULT 'include',
    PRIMARY KEY (filter_field_scope_id, grade_id),
    CONSTRAINT filter_field_scope_grades_effect_check CHECK (effect IN ('include', 'exclude'))
);

CREATE INDEX filter_field_scope_grades_reverse_index
    ON filter_field_scope_grades(grade_id, effect, filter_field_scope_id);

CREATE TABLE filter_field_scope_semesters (
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    semester_id uuid NOT NULL REFERENCES semesters(id),
    effect varchar(20) NOT NULL DEFAULT 'include',
    PRIMARY KEY (filter_field_scope_id, semester_id),
    CONSTRAINT filter_field_scope_semesters_effect_check CHECK (effect IN ('include', 'exclude'))
);

CREATE INDEX filter_field_scope_semesters_reverse_index
    ON filter_field_scope_semesters(semester_id, effect, filter_field_scope_id);

CREATE TABLE filter_field_scope_book_versions (
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    book_version_id uuid NOT NULL REFERENCES book_versions(id),
    effect varchar(20) NOT NULL DEFAULT 'include',
    PRIMARY KEY (filter_field_scope_id, book_version_id),
    CONSTRAINT filter_field_scope_book_versions_effect_check CHECK (effect IN ('include', 'exclude'))
);

CREATE INDEX filter_field_scope_book_versions_reverse_index
    ON filter_field_scope_book_versions(book_version_id, effect, filter_field_scope_id);

CREATE TABLE filter_field_scope_exam_levels (
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    exam_program_level_id uuid NOT NULL REFERENCES exam_program_levels(id),
    effect varchar(20) NOT NULL DEFAULT 'include',
    PRIMARY KEY (filter_field_scope_id, exam_program_level_id),
    CONSTRAINT filter_field_scope_exam_levels_effect_check CHECK (effect IN ('include', 'exclude'))
);

CREATE INDEX filter_field_scope_exam_levels_reverse_index
    ON filter_field_scope_exam_levels(exam_program_level_id, effect, filter_field_scope_id);

CREATE TABLE filter_field_options (
    id uuid PRIMARY KEY,
    filter_field_id uuid NOT NULL REFERENCES filter_fields(id),
    parent_option_id uuid,
    value varchar(160) NOT NULL,
    label varchar(160) NOT NULL,
    sort_order smallint NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    CONSTRAINT filter_field_options_identity_field_unique UNIQUE (id, filter_field_id),
    CONSTRAINT filter_field_options_value_unique UNIQUE (filter_field_id, value),
    CONSTRAINT filter_field_options_parent_check CHECK (parent_option_id IS NULL OR parent_option_id <> id),
    CONSTRAINT filter_field_options_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT filter_field_options_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT filter_field_options_parent_field_fk
        FOREIGN KEY (parent_option_id, filter_field_id)
        REFERENCES filter_field_options(id, filter_field_id)
);

CREATE FUNCTION lerniqa_validate_filter_option()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM filter_fields
        WHERE id = NEW.filter_field_id
            AND value_type = 'option'
    ) THEN
        RAISE EXCEPTION '只有選項型篩選欄位可以建立選項'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER filter_field_options_type_check
BEFORE INSERT OR UPDATE ON filter_field_options
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_filter_option();

CREATE TABLE filter_field_option_scopes (
    filter_option_id uuid NOT NULL REFERENCES filter_field_options(id),
    filter_field_scope_id uuid NOT NULL REFERENCES filter_field_scopes(id),
    PRIMARY KEY (filter_option_id, filter_field_scope_id)
);

CREATE FUNCTION lerniqa_validate_filter_option_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM filter_field_options AS option
        JOIN filter_field_scopes AS scope
            ON scope.filter_field_id = option.filter_field_id
        WHERE option.id = NEW.filter_option_id
            AND scope.id = NEW.filter_field_scope_id
    ) THEN
        RAISE EXCEPTION '篩選選項與適用規則不屬於同一欄位'
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER filter_field_option_scopes_field_check
BEFORE INSERT OR UPDATE ON filter_field_option_scopes
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_filter_option_scope();

CREATE TABLE question_banks (
    id uuid PRIMARY KEY,
    name varchar(120) NOT NULL,
    origin varchar(20) NOT NULL,
    owner_user_id uuid REFERENCES users(id),
    created_role varchar(30),
    is_default boolean NOT NULL DEFAULT false,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT question_banks_origin_check CHECK (origin IN ('system', 'account')),
    CONSTRAINT question_banks_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL AND created_role IS NULL)
            OR (
                origin = 'account'
                AND owner_user_id IS NOT NULL
                AND (created_role IS NULL OR created_role IN ('parent', 'learner', 'tutor'))
            )
        ),
    CONSTRAINT question_banks_status_check CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX question_banks_account_default_unique
    ON question_banks(owner_user_id)
    WHERE origin = 'account' AND status = 'active' AND is_default = true;

CREATE UNIQUE INDEX question_banks_system_default_unique
    ON question_banks(origin)
    WHERE origin = 'system' AND status = 'active' AND is_default = true;

CREATE TABLE question_bank_learners (
    question_bank_id uuid NOT NULL REFERENCES question_banks(id),
    learner_id uuid NOT NULL REFERENCES learners(id),
    added_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (question_bank_id, learner_id)
);

CREATE INDEX question_bank_learners_learner_index
    ON question_bank_learners(learner_id, question_bank_id);

CREATE TABLE questions (
    id uuid PRIMARY KEY,
    origin varchar(20) NOT NULL,
    owner_user_id uuid REFERENCES users(id),
    current_revision_id uuid,
    status varchar(20) NOT NULL DEFAULT 'draft',
    created_method varchar(20) NOT NULL,
    created_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at timestamptz,
    CONSTRAINT questions_origin_check CHECK (origin IN ('system', 'account')),
    CONSTRAINT questions_owner_check
        CHECK (
            (origin = 'system' AND owner_user_id IS NULL)
            OR (origin = 'account' AND owner_user_id IS NOT NULL)
        ),
    CONSTRAINT questions_status_check CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT questions_method_check
        CHECK (created_method IN ('manual', 'import', 'generated', 'migration')),
    CONSTRAINT questions_archive_check
        CHECK (
            (status = 'archived' AND archived_at IS NOT NULL)
            OR (status <> 'archived' AND archived_at IS NULL)
        )
);

CREATE TABLE question_identifiers (
    id uuid PRIMARY KEY,
    question_id uuid NOT NULL REFERENCES questions(id),
    identifier_type varchar(30) NOT NULL,
    publisher_id uuid REFERENCES publishers(id),
    book_version_id uuid REFERENCES book_versions(id),
    value varchar(120) NOT NULL,
    normalized_value varchar(120) NOT NULL,
    CONSTRAINT question_identifiers_type_check
        CHECK (identifier_type IN ('legacy', 'publisher_question')),
    CONSTRAINT question_identifiers_scope_check
        CHECK (
            (identifier_type = 'legacy' AND publisher_id IS NULL AND book_version_id IS NULL)
            OR (identifier_type = 'publisher_question' AND publisher_id IS NOT NULL)
        )
);

CREATE UNIQUE INDEX question_identifiers_legacy_unique
    ON question_identifiers(identifier_type, normalized_value)
    WHERE identifier_type = 'legacy';

CREATE UNIQUE INDEX question_identifiers_publisher_version_unique
    ON question_identifiers(publisher_id, book_version_id, normalized_value)
    WHERE identifier_type = 'publisher_question' AND book_version_id IS NOT NULL;

CREATE UNIQUE INDEX question_identifiers_publisher_unique
    ON question_identifiers(publisher_id, normalized_value)
    WHERE identifier_type = 'publisher_question' AND book_version_id IS NULL;

CREATE TABLE question_revisions (
    id uuid PRIMARY KEY,
    question_id uuid NOT NULL REFERENCES questions(id),
    revision_number integer NOT NULL,
    question_type_id uuid NOT NULL REFERENCES question_types(id),
    original_question_type_label varchar(120),
    subject_id uuid REFERENCES subjects(id),
    grade_id uuid REFERENCES grades(id),
    semester_id uuid REFERENCES semesters(id),
    book_version_id uuid,
    exam_program_level_id uuid REFERENCES exam_program_levels(id),
    difficulty_level_id uuid REFERENCES difficulty_levels(id),
    source_category_id uuid REFERENCES source_categories(id),
    search_text text NOT NULL DEFAULT '',
    status varchar(20) NOT NULL DEFAULT 'draft',
    change_note varchar(500),
    created_by_type varchar(30) NOT NULL,
    created_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at timestamptz,
    CONSTRAINT question_revisions_question_number_unique UNIQUE (question_id, revision_number),
    CONSTRAINT question_revisions_identity_question_unique UNIQUE (id, question_id),
    CONSTRAINT question_revisions_revision_number_check CHECK (revision_number > 0),
    CONSTRAINT question_revisions_book_subject_check CHECK (book_version_id IS NULL OR subject_id IS NOT NULL),
    CONSTRAINT question_revisions_book_subject_fk
        FOREIGN KEY (book_version_id, subject_id)
        REFERENCES book_versions(id, subject_id),
    CONSTRAINT question_revisions_status_check
        CHECK (status IN ('draft', 'published', 'superseded', 'rejected')),
    CONSTRAINT question_revisions_creator_type_check
        CHECK (created_by_type IN ('user', 'bootstrap_admin', 'system_job', 'migration')),
    CONSTRAINT question_revisions_creator_check
        CHECK (
            (created_by_type = 'user' AND created_by_user_id IS NOT NULL)
            OR (created_by_type <> 'user' AND created_by_user_id IS NULL)
        ),
    CONSTRAINT question_revisions_publish_check
        CHECK (
            (status = 'published' AND published_at IS NOT NULL)
            OR (status <> 'published' AND published_at IS NULL)
        )
);

CREATE FUNCTION lerniqa_validate_question_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subject_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM subjects
        WHERE id = NEW.subject_id
            AND subject_kind = 'leaf'
    ) THEN
        RAISE EXCEPTION '題目版本只能直接關聯末層科目'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.exam_program_level_id IS NOT NULL
        AND NEW.source_category_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM source_categories AS source
            JOIN exam_program_levels AS level
                ON level.id = NEW.exam_program_level_id
            WHERE source.id = NEW.source_category_id
                AND source.exam_program_id IS NOT NULL
                AND source.exam_program_id <> level.exam_program_id
        ) THEN
        RAISE EXCEPTION '考試級別與題目來源限定的考試體系不一致'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_revisions_catalog_check
BEFORE INSERT OR UPDATE ON question_revisions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_question_revision();

ALTER TABLE questions
ADD CONSTRAINT questions_current_revision_fk
FOREIGN KEY (current_revision_id, id)
REFERENCES question_revisions(id, question_id)
DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION lerniqa_validate_current_revision_status()
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

CREATE INDEX question_revisions_question_index
    ON question_revisions(question_id, revision_number DESC);

CREATE INDEX question_revisions_filter_index
    ON question_revisions(
        subject_id,
        grade_id,
        semester_id,
        book_version_id,
        source_category_id,
        difficulty_level_id,
        question_type_id
    );

CREATE INDEX question_revisions_exam_level_index
    ON question_revisions(exam_program_level_id);

CREATE TABLE question_revision_reviews (
    id uuid PRIMARY KEY,
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    reviewer_type varchar(30) NOT NULL,
    reviewer_user_id uuid REFERENCES users(id),
    decision varchar(20) NOT NULL,
    reason text,
    from_status varchar(20) NOT NULL,
    to_status varchar(20) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT question_revision_reviews_reviewer_check
        CHECK (
            (reviewer_type = 'user' AND reviewer_user_id IS NOT NULL)
            OR (reviewer_type = 'bootstrap_admin' AND reviewer_user_id IS NULL)
        ),
    CONSTRAINT question_revision_reviews_decision_check
        CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
    CONSTRAINT question_revision_reviews_reason_check
        CHECK (decision = 'approved' OR reason IS NOT NULL),
    CONSTRAINT question_revision_reviews_status_check
        CHECK (
            from_status IN ('draft', 'published', 'rejected')
            AND to_status IN ('draft', 'published', 'superseded', 'rejected')
        ),
    CONSTRAINT question_revision_reviews_transition_check
        CHECK (
            (from_status = 'draft' AND to_status IN ('draft', 'published', 'rejected'))
            OR (from_status = 'rejected' AND to_status = 'draft')
            OR (from_status = 'published' AND to_status = 'superseded')
        ),
    CONSTRAINT question_revision_reviews_decision_transition_check
        CHECK (
            (decision = 'changes_requested' AND from_status = 'draft' AND to_status = 'draft')
            OR (decision = 'rejected' AND from_status = 'draft' AND to_status = 'rejected')
            OR (
                decision = 'approved'
                AND (
                    (from_status = 'draft' AND to_status = 'published')
                    OR (from_status = 'rejected' AND to_status = 'draft')
                    OR (from_status = 'published' AND to_status = 'superseded')
                )
            )
        )
);

CREATE INDEX question_revision_reviews_revision_index
    ON question_revision_reviews(question_revision_id, created_at DESC);

CREATE TABLE question_parts (
    id uuid PRIMARY KEY,
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    parent_part_id uuid,
    stable_key varchar(80) NOT NULL,
    position smallint NOT NULL,
    answer_mode varchar(30) NOT NULL,
    grading_policy varchar(30) NOT NULL,
    is_independently_gradable boolean NOT NULL DEFAULT true,
    CONSTRAINT question_parts_identity_revision_unique UNIQUE (id, question_revision_id),
    CONSTRAINT question_parts_stable_key_unique UNIQUE (question_revision_id, stable_key),
    CONSTRAINT question_parts_parent_check CHECK (parent_part_id IS NULL OR parent_part_id <> id),
    CONSTRAINT question_parts_parent_revision_fk
        FOREIGN KEY (parent_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT question_parts_position_check CHECK (position >= 0),
    CONSTRAINT question_parts_answer_mode_check
        CHECK (answer_mode IN ('single_choice', 'multiple_choice', 'boolean', 'text')),
    CONSTRAINT question_parts_grading_policy_check
        CHECK (grading_policy IN ('automatic', 'manual_review', 'ai_assisted_review'))
);

CREATE TABLE question_options (
    id uuid PRIMARY KEY,
    question_part_id uuid NOT NULL REFERENCES question_parts(id),
    option_key varchar(30) NOT NULL,
    position smallint NOT NULL,
    CONSTRAINT question_options_identity_part_unique UNIQUE (id, question_part_id),
    CONSTRAINT question_options_key_unique UNIQUE (question_part_id, option_key),
    CONSTRAINT question_options_position_check CHECK (position >= 0)
);

CREATE TABLE question_content_blocks (
    id uuid PRIMARY KEY,
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    question_part_id uuid,
    question_option_id uuid,
    parent_block_id uuid,
    placement varchar(20) NOT NULL,
    content_type varchar(20) NOT NULL,
    position smallint NOT NULL,
    text_content text,
    asset_id uuid REFERENCES assets(id),
    alt_text varchar(300),
    CONSTRAINT question_content_blocks_identity_revision_unique
        UNIQUE (id, question_revision_id),
    CONSTRAINT question_content_blocks_part_revision_fk
        FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT question_content_blocks_option_part_fk
        FOREIGN KEY (question_option_id, question_part_id)
        REFERENCES question_options(id, question_part_id),
    CONSTRAINT question_content_blocks_parent_revision_fk
        FOREIGN KEY (parent_block_id, question_revision_id)
        REFERENCES question_content_blocks(id, question_revision_id),
    CONSTRAINT question_content_blocks_parent_check CHECK (parent_block_id IS NULL OR parent_block_id <> id),
    CONSTRAINT question_content_blocks_placement_check
        CHECK (placement IN ('prompt', 'option', 'answer', 'explanation', 'transcript')),
    CONSTRAINT question_content_blocks_type_check
        CHECK (content_type IN ('text', 'image', 'audio', 'transcript', 'formula', 'table', 'page_crop')),
    CONSTRAINT question_content_blocks_position_check CHECK (position >= 0),
    CONSTRAINT question_content_blocks_content_check
        CHECK (
            (content_type IN ('text', 'transcript', 'formula', 'table') AND text_content IS NOT NULL AND asset_id IS NULL)
            OR (content_type IN ('image', 'audio', 'page_crop') AND asset_id IS NOT NULL)
        ),
    CONSTRAINT question_content_blocks_option_placement_check
        CHECK (
            (placement = 'option' AND question_option_id IS NOT NULL AND question_part_id IS NOT NULL)
            OR (placement <> 'option' AND question_option_id IS NULL)
        ),
    CONSTRAINT question_content_blocks_transcript_check
        CHECK (
            content_type <> 'transcript'
            OR (placement = 'transcript' AND parent_block_id IS NOT NULL)
        )
);

CREATE INDEX question_content_blocks_revision_position_index
    ON question_content_blocks(question_revision_id, placement, position);

CREATE TABLE question_revision_units (
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    curriculum_unit_id uuid NOT NULL REFERENCES curriculum_units(id),
    assignment_type varchar(30) NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    value_source varchar(30) NOT NULL,
    confidence numeric(5,4),
    PRIMARY KEY (question_revision_id, curriculum_unit_id),
    CONSTRAINT question_revision_units_assignment_check
        CHECK (assignment_type IN ('native', 'cross_version_alignment', 'manual_classification')),
    CONSTRAINT question_revision_units_source_check
        CHECK (value_source IN ('document', 'user', 'migration', 'system_rule')),
    CONSTRAINT question_revision_units_confidence_check
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE UNIQUE INDEX question_revision_units_primary_unique
    ON question_revision_units(question_revision_id)
    WHERE is_primary = true;

CREATE INDEX question_revision_units_unit_index
    ON question_revision_units(curriculum_unit_id, question_revision_id);

CREATE TABLE question_answers (
    id uuid PRIMARY KEY,
    question_part_id uuid NOT NULL REFERENCES question_parts(id),
    answer_key varchar(80),
    accepted_value text,
    position smallint NOT NULL DEFAULT 0,
    CONSTRAINT question_answers_representation_check
        CHECK ((answer_key IS NOT NULL)::integer + (accepted_value IS NOT NULL)::integer = 1),
    CONSTRAINT question_answers_position_check CHECK (position >= 0)
);

CREATE TABLE question_revision_topics (
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    topic_id uuid NOT NULL REFERENCES topics(id),
    is_primary boolean NOT NULL DEFAULT false,
    value_source varchar(30) NOT NULL,
    PRIMARY KEY (question_revision_id, topic_id),
    CONSTRAINT question_revision_topics_source_check
        CHECK (value_source IN ('document', 'user', 'migration', 'system_rule'))
);

CREATE UNIQUE INDEX question_revision_topics_primary_unique
    ON question_revision_topics(question_revision_id)
    WHERE is_primary = true;

CREATE INDEX question_revision_topics_topic_index
    ON question_revision_topics(topic_id, question_revision_id);

CREATE TABLE question_revision_knowledge_points (
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    knowledge_point_id uuid NOT NULL REFERENCES knowledge_points(id),
    is_primary boolean NOT NULL DEFAULT false,
    value_source varchar(30) NOT NULL,
    PRIMARY KEY (question_revision_id, knowledge_point_id),
    CONSTRAINT question_revision_knowledge_source_check
        CHECK (value_source IN ('document', 'user', 'migration', 'system_rule'))
);

CREATE UNIQUE INDEX question_revision_knowledge_primary_unique
    ON question_revision_knowledge_points(question_revision_id)
    WHERE is_primary = true;

CREATE INDEX question_revision_knowledge_point_index
    ON question_revision_knowledge_points(knowledge_point_id, question_revision_id);

CREATE TABLE question_revision_curriculum_codes (
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    curriculum_code_id uuid NOT NULL REFERENCES curriculum_codes(id),
    is_primary boolean NOT NULL DEFAULT false,
    value_source varchar(30) NOT NULL,
    confidence numeric(5,4),
    PRIMARY KEY (question_revision_id, curriculum_code_id),
    CONSTRAINT question_revision_curriculum_source_check
        CHECK (value_source IN ('document', 'user', 'migration', 'system_rule')),
    CONSTRAINT question_revision_curriculum_confidence_check
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE UNIQUE INDEX question_revision_curriculum_primary_unique
    ON question_revision_curriculum_codes(question_revision_id)
    WHERE is_primary = true;

CREATE INDEX question_revision_curriculum_code_index
    ON question_revision_curriculum_codes(curriculum_code_id, question_revision_id);

CREATE TABLE question_revision_filter_values (
    id uuid PRIMARY KEY,
    question_revision_id uuid NOT NULL REFERENCES question_revisions(id),
    filter_field_id uuid NOT NULL REFERENCES filter_fields(id),
    filter_option_id uuid,
    raw_label varchar(160),
    raw_value text,
    normalized_value varchar(240),
    value_source varchar(20) NOT NULL,
    confidence numeric(4,3),
    CONSTRAINT question_revision_filter_option_field_fk
        FOREIGN KEY (filter_option_id, filter_field_id)
        REFERENCES filter_field_options(id, filter_field_id),
    CONSTRAINT question_revision_filter_representation_check
        CHECK (
            (filter_option_id IS NOT NULL AND normalized_value IS NULL)
            OR (filter_option_id IS NULL AND normalized_value IS NOT NULL)
        ),
    CONSTRAINT question_revision_filter_source_check
        CHECK (value_source IN ('document', 'path', 'ai', 'user', 'migration')),
    CONSTRAINT question_revision_filter_confidence_check
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE FUNCTION lerniqa_validate_revision_filter_value()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    field_value_type varchar(20);
BEGIN
    SELECT value_type
    INTO field_value_type
    FROM filter_fields
    WHERE id = NEW.filter_field_id;

    IF field_value_type = 'option' AND NEW.filter_option_id IS NULL THEN
        RAISE EXCEPTION '選項型篩選欄位必須使用正式選項'
            USING ERRCODE = '23514';
    END IF;

    IF field_value_type <> 'option' AND NEW.normalized_value IS NULL THEN
        RAISE EXCEPTION '非選項型篩選欄位必須保存標準值'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER question_revision_filter_values_type_check
BEFORE INSERT OR UPDATE ON question_revision_filter_values
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_revision_filter_value();

CREATE UNIQUE INDEX question_revision_filter_option_unique
    ON question_revision_filter_values(question_revision_id, filter_field_id, filter_option_id)
    WHERE filter_option_id IS NOT NULL;

CREATE UNIQUE INDEX question_revision_filter_value_unique
    ON question_revision_filter_values(question_revision_id, filter_field_id, normalized_value)
    WHERE normalized_value IS NOT NULL;

CREATE INDEX question_revision_filter_option_index
    ON question_revision_filter_values(filter_option_id, question_revision_id);

CREATE INDEX question_revision_filter_value_index
    ON question_revision_filter_values(filter_field_id, normalized_value, question_revision_id);

CREATE TABLE question_bank_items (
    question_bank_id uuid NOT NULL REFERENCES question_banks(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    added_by_user_id uuid REFERENCES users(id),
    added_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (question_bank_id, question_id)
);

CREATE INDEX question_bank_items_question_index
    ON question_bank_items(question_id, question_bank_id);

INSERT INTO schema_migrations (version, name)
VALUES ('0002', 'question_core');

COMMIT;
