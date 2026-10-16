BEGIN;

CREATE TABLE exams (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    name varchar(120) NOT NULL,
    exam_date date NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT exams_identity_learner_unique UNIQUE (id, learner_id),
    CONSTRAINT exams_status_check CHECK (status IN ('active', 'completed', 'archived')),
    CONSTRAINT exams_lock_version_check CHECK (lock_version > 0)
);

ALTER TABLE learner_preferences
ADD COLUMN active_exam_id uuid;

ALTER TABLE learner_preferences
ADD CONSTRAINT learner_preferences_active_exam_fk
FOREIGN KEY (active_exam_id, learner_id)
REFERENCES exams(id, learner_id);

CREATE TABLE exam_subject_ranges (
    id uuid PRIMARY KEY,
    exam_id uuid NOT NULL REFERENCES exams(id),
    subject_id uuid NOT NULL REFERENCES subjects(id),
    book_version_id uuid,
    start_unit_id uuid REFERENCES curriculum_units(id),
    end_unit_id uuid REFERENCES curriculum_units(id),
    target_level_id uuid REFERENCES exam_program_levels(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT exam_subject_ranges_exam_subject_unique UNIQUE (exam_id, subject_id),
    CONSTRAINT exam_subject_ranges_book_subject_fk
        FOREIGN KEY (book_version_id, subject_id)
        REFERENCES book_versions(id, subject_id),
    CONSTRAINT exam_subject_ranges_mode_check
        CHECK (
            (
                target_level_id IS NOT NULL
                AND book_version_id IS NULL
                AND start_unit_id IS NULL
                AND end_unit_id IS NULL
            )
            OR (
                target_level_id IS NULL
                AND start_unit_id IS NOT NULL
                AND end_unit_id IS NOT NULL
            )
        )
);

CREATE FUNCTION lerniqa_validate_exam_subject_range()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    start_unit_subject_id uuid;
    start_unit_book_version_id uuid;
    start_subject_id uuid;
    start_book_version_id uuid;
    start_root_id uuid;
    end_unit_subject_id uuid;
    end_unit_book_version_id uuid;
    end_subject_id uuid;
    end_book_version_id uuid;
    end_root_id uuid;
BEGIN
    IF NEW.target_level_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT subject_id, book_version_id
    INTO start_unit_subject_id, start_unit_book_version_id
    FROM curriculum_units
    WHERE id = NEW.start_unit_id;

    SELECT subject_id, book_version_id
    INTO end_unit_subject_id, end_unit_book_version_id
    FROM curriculum_units
    WHERE id = NEW.end_unit_id;

    WITH RECURSIVE unit_path AS (
        SELECT id, parent_unit_id, subject_id, book_version_id
        FROM curriculum_units
        WHERE id = NEW.start_unit_id

        UNION ALL

        SELECT parent.id, parent.parent_unit_id, parent.subject_id, parent.book_version_id
        FROM curriculum_units AS parent
        JOIN unit_path AS child ON child.parent_unit_id = parent.id
    )
    SELECT subject_id, book_version_id, id
    INTO start_subject_id, start_book_version_id, start_root_id
    FROM unit_path
    WHERE parent_unit_id IS NULL;

    WITH RECURSIVE unit_path AS (
        SELECT id, parent_unit_id, subject_id, book_version_id
        FROM curriculum_units
        WHERE id = NEW.end_unit_id

        UNION ALL

        SELECT parent.id, parent.parent_unit_id, parent.subject_id, parent.book_version_id
        FROM curriculum_units AS parent
        JOIN unit_path AS child ON child.parent_unit_id = parent.id
    )
    SELECT subject_id, book_version_id, id
    INTO end_subject_id, end_book_version_id, end_root_id
    FROM unit_path
    WHERE parent_unit_id IS NULL;

    IF start_root_id IS NULL
        OR end_root_id IS NULL
        OR start_root_id <> end_root_id
        OR start_unit_subject_id <> NEW.subject_id
        OR end_unit_subject_id <> NEW.subject_id
        OR start_unit_book_version_id IS DISTINCT FROM NEW.book_version_id
        OR end_unit_book_version_id IS DISTINCT FROM NEW.book_version_id
        OR start_subject_id <> NEW.subject_id
        OR end_subject_id <> NEW.subject_id
        OR start_book_version_id IS DISTINCT FROM NEW.book_version_id
        OR end_book_version_id IS DISTINCT FROM NEW.book_version_id THEN
        RAISE EXCEPTION '考試起訖單元必須屬於同一科目、版本與教材樹'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER exam_subject_ranges_catalog_check
BEFORE INSERT OR UPDATE ON exam_subject_ranges
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_exam_subject_range();

CREATE TABLE practice_plans (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    created_role varchar(30) NOT NULL,
    name varchar(140) NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    basis varchar(20) NOT NULL DEFAULT 'chapter',
    exam_id uuid,
    check_mode varchar(20) NOT NULL,
    question_limit smallint NOT NULL,
    selection_mode varchar(20) NOT NULL DEFAULT 'dynamic',
    difficulty_mix_enabled boolean NOT NULL DEFAULT false,
    filter_schema_version smallint NOT NULL DEFAULT 1,
    filter_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(20) NOT NULL DEFAULT 'active',
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT practice_plans_identity_learner_unique UNIQUE (id, learner_id),
    CONSTRAINT practice_plans_exam_learner_fk
        FOREIGN KEY (exam_id, learner_id)
        REFERENCES exams(id, learner_id),
    CONSTRAINT practice_plans_created_role_check
        CHECK (created_role IN ('parent', 'learner', 'tutor')),
    CONSTRAINT practice_plans_basis_check CHECK (basis IN ('chapter', 'assessment')),
    CONSTRAINT practice_plans_exam_check
        CHECK (
            (basis = 'chapter' AND exam_id IS NULL)
            OR (basis = 'assessment' AND exam_id IS NOT NULL)
        ),
    CONSTRAINT practice_plans_check_mode_check
        CHECK (check_mode IN ('complete', 'instant', 'score')),
    CONSTRAINT practice_plans_question_limit_check CHECK (question_limit BETWEEN 1 AND 500),
    CONSTRAINT practice_plans_selection_mode_check
        CHECK (selection_mode IN ('dynamic', 'fixed')),
    CONSTRAINT practice_plans_filter_schema_version_check CHECK (filter_schema_version > 0),
    CONSTRAINT practice_plans_filter_snapshot_check CHECK (jsonb_typeof(filter_snapshot) = 'object'),
    CONSTRAINT practice_plans_status_check
        CHECK (status IN ('draft', 'active', 'completed', 'archived')),
    CONSTRAINT practice_plans_lock_version_check CHECK (lock_version > 0)
);

CREATE UNIQUE INDEX practice_plans_default_unique
    ON practice_plans(learner_id)
    WHERE is_default AND status <> 'archived';

CREATE INDEX practice_plans_learner_status_index
    ON practice_plans(learner_id, status, updated_at DESC);

CREATE TABLE practice_plan_difficulty_mix (
    practice_plan_id uuid NOT NULL REFERENCES practice_plans(id),
    difficulty_level_id uuid NOT NULL REFERENCES difficulty_levels(id),
    percentage numeric(5,2) NOT NULL,
    PRIMARY KEY (practice_plan_id, difficulty_level_id),
    CONSTRAINT practice_plan_difficulty_mix_percentage_check
        CHECK (percentage BETWEEN 0 AND 100)
);

CREATE TABLE practice_plan_items (
    id uuid PRIMARY KEY,
    practice_plan_id uuid NOT NULL REFERENCES practice_plans(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    question_revision_id uuid NOT NULL,
    question_part_id uuid,
    position integer NOT NULL,
    reason varchar(30) NOT NULL DEFAULT 'selected',
    CONSTRAINT practice_plan_items_position_unique UNIQUE (practice_plan_id, position),
    CONSTRAINT practice_plan_items_revision_fk
        FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT practice_plan_items_part_fk
        FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT practice_plan_items_position_check CHECK (position >= 0),
    CONSTRAINT practice_plan_items_reason_check
        CHECK (reason IN ('selected', 'wrong_review', 'similar_review', 'manual'))
);

CREATE TABLE practice_schedules (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    practice_plan_id uuid,
    name varchar(140) NOT NULL,
    scheduled_for timestamptz NOT NULL,
    check_mode varchar(20) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'scheduled',
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    lock_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT practice_schedules_identity_learner_unique UNIQUE (id, learner_id),
    CONSTRAINT practice_schedules_plan_learner_fk
        FOREIGN KEY (practice_plan_id, learner_id)
        REFERENCES practice_plans(id, learner_id),
    CONSTRAINT practice_schedules_check_mode_check
        CHECK (check_mode IN ('complete', 'instant', 'score')),
    CONSTRAINT practice_schedules_status_check
        CHECK (status IN ('scheduled', 'available', 'completed', 'cancelled', 'missed')),
    CONSTRAINT practice_schedules_lock_version_check CHECK (lock_version > 0)
);

CREATE INDEX practice_schedules_due_index
    ON practice_schedules(learner_id, status, scheduled_for);

CREATE TABLE practice_schedule_items (
    id uuid PRIMARY KEY,
    practice_schedule_id uuid NOT NULL REFERENCES practice_schedules(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    question_revision_id uuid NOT NULL,
    question_part_id uuid,
    position integer NOT NULL,
    reason varchar(30) NOT NULL,
    CONSTRAINT practice_schedule_items_position_unique UNIQUE (practice_schedule_id, position),
    CONSTRAINT practice_schedule_items_revision_fk
        FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT practice_schedule_items_part_fk
        FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT practice_schedule_items_position_check CHECK (position >= 0),
    CONSTRAINT practice_schedule_items_reason_check
        CHECK (reason IN ('selected', 'wrong_review', 'similar_review', 'manual'))
);

CREATE TABLE practice_sessions (
    id uuid PRIMARY KEY,
    practice_plan_id uuid,
    practice_schedule_id uuid,
    learner_id uuid NOT NULL REFERENCES learners(id),
    created_by_user_id uuid NOT NULL REFERENCES users(id),
    mode varchar(20) NOT NULL,
    check_mode varchar(20) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    CONSTRAINT practice_sessions_plan_learner_fk
        FOREIGN KEY (practice_plan_id, learner_id)
        REFERENCES practice_plans(id, learner_id),
    CONSTRAINT practice_sessions_schedule_learner_fk
        FOREIGN KEY (practice_schedule_id, learner_id)
        REFERENCES practice_schedules(id, learner_id),
    CONSTRAINT practice_sessions_schedule_unique UNIQUE (practice_schedule_id),
    CONSTRAINT practice_sessions_mode_check CHECK (mode IN ('practice', 'review', 'similar')),
    CONSTRAINT practice_sessions_check_mode_check
        CHECK (check_mode IN ('complete', 'instant', 'score')),
    CONSTRAINT practice_sessions_status_check
        CHECK (status IN ('active', 'paused', 'completed', 'abandoned')),
    CONSTRAINT practice_sessions_completion_check
        CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

CREATE INDEX practice_sessions_learner_status_index
    ON practice_sessions(learner_id, status, started_at DESC);

CREATE TABLE practice_session_items (
    id uuid PRIMARY KEY,
    practice_session_id uuid NOT NULL REFERENCES practice_sessions(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    question_revision_id uuid NOT NULL,
    question_part_id uuid,
    position integer NOT NULL,
    selection_reason varchar(30) NOT NULL,
    CONSTRAINT practice_session_items_position_unique UNIQUE (practice_session_id, position),
    CONSTRAINT practice_session_items_revision_fk
        FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT practice_session_items_part_fk
        FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT practice_session_items_position_check CHECK (position >= 0),
    CONSTRAINT practice_session_items_reason_check
        CHECK (
            selection_reason IN (
                'filter',
                'fixed',
                'wrong_review',
                'similar_review',
                'difficulty_fill'
            )
        )
);

CREATE TABLE answer_attempts (
    id uuid PRIMARY KEY,
    practice_session_item_id uuid NOT NULL REFERENCES practice_session_items(id),
    learner_id uuid NOT NULL REFERENCES learners(id),
    attempt_number integer NOT NULL,
    idempotency_key varchar(120) NOT NULL,
    overall_result varchar(20) NOT NULL,
    grading_source varchar(20) NOT NULL,
    duration_seconds integer,
    submitted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT answer_attempts_item_number_unique
        UNIQUE (practice_session_item_id, attempt_number),
    CONSTRAINT answer_attempts_learner_idempotency_unique
        UNIQUE (learner_id, idempotency_key),
    CONSTRAINT answer_attempts_attempt_number_check CHECK (attempt_number > 0),
    CONSTRAINT answer_attempts_result_check
        CHECK (overall_result IN ('correct', 'wrong', 'pending')),
    CONSTRAINT answer_attempts_grading_source_check
        CHECK (grading_source IN ('automatic', 'manual_review', 'ai_assisted_review')),
    CONSTRAINT answer_attempts_duration_check
        CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE FUNCTION lerniqa_validate_answer_attempt_learner()
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

CREATE TRIGGER answer_attempts_learner_check
BEFORE INSERT OR UPDATE OF practice_session_item_id, learner_id ON answer_attempts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_attempt_learner();

CREATE INDEX answer_attempts_learner_submitted_index
    ON answer_attempts(learner_id, submitted_at DESC);

CREATE TABLE answer_part_results (
    id uuid PRIMARY KEY,
    answer_attempt_id uuid NOT NULL REFERENCES answer_attempts(id),
    question_part_id uuid NOT NULL REFERENCES question_parts(id),
    answer_payload jsonb NOT NULL,
    initial_result varchar(20) NOT NULL,
    current_result varchar(20) NOT NULL,
    grading_source varchar(20) NOT NULL,
    recognized_text text,
    recognition_confidence numeric(4,3),
    CONSTRAINT answer_part_results_attempt_part_unique
        UNIQUE (answer_attempt_id, question_part_id),
    CONSTRAINT answer_part_results_payload_check CHECK (answer_payload <> 'null'::jsonb),
    CONSTRAINT answer_part_results_initial_result_check
        CHECK (initial_result IN ('correct', 'wrong', 'pending')),
    CONSTRAINT answer_part_results_current_result_check
        CHECK (current_result IN ('correct', 'wrong', 'pending')),
    CONSTRAINT answer_part_results_grading_source_check
        CHECK (grading_source IN ('automatic', 'manual_review', 'ai_assisted_review')),
    CONSTRAINT answer_part_results_confidence_check
        CHECK (recognition_confidence IS NULL OR recognition_confidence BETWEEN 0 AND 1)
);

CREATE FUNCTION lerniqa_validate_answer_part()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM answer_attempts AS attempt
        JOIN practice_session_items AS item ON item.id = attempt.practice_session_item_id
        JOIN question_parts AS part
            ON part.id = NEW.question_part_id
            AND part.question_revision_id = item.question_revision_id
        WHERE attempt.id = NEW.answer_attempt_id
            AND (item.question_part_id IS NULL OR item.question_part_id = NEW.question_part_id)
    ) THEN
        RAISE EXCEPTION '小題作答必須屬於練習項目的固定題目版本與範圍'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER answer_part_results_part_check
BEFORE INSERT OR UPDATE OF answer_attempt_id, question_part_id ON answer_part_results
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_part();

CREATE INDEX answer_part_results_part_result_index
    ON answer_part_results(question_part_id, current_result);

CREATE TABLE answer_part_assets (
    answer_part_result_id uuid NOT NULL REFERENCES answer_part_results(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    asset_role varchar(20) NOT NULL,
    position smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (answer_part_result_id, asset_id, asset_role),
    CONSTRAINT answer_part_assets_role_check
        CHECK (asset_role IN ('handwriting', 'attachment')),
    CONSTRAINT answer_part_assets_position_check CHECK (position >= 0)
);

CREATE FUNCTION lerniqa_validate_answer_asset()
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

CREATE TRIGGER answer_part_assets_purpose_check
BEFORE INSERT OR UPDATE OF asset_id, asset_role ON answer_part_assets
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_asset();

CREATE INDEX answer_part_assets_asset_index ON answer_part_assets(asset_id);

CREATE TABLE answer_reviews (
    id uuid PRIMARY KEY,
    answer_part_result_id uuid NOT NULL REFERENCES answer_part_results(id),
    reviewer_user_id uuid NOT NULL REFERENCES users(id),
    result varchar(20) NOT NULL,
    reason text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT answer_reviews_result_check CHECK (result IN ('correct', 'wrong', 'pending'))
);

CREATE INDEX answer_reviews_result_created_index
    ON answer_reviews(answer_part_result_id, created_at DESC);

CREATE TABLE learner_practice_queue_items (
    id uuid PRIMARY KEY,
    learner_id uuid NOT NULL REFERENCES learners(id),
    question_id uuid NOT NULL REFERENCES questions(id),
    question_revision_id uuid NOT NULL,
    question_part_id uuid,
    reason varchar(30) NOT NULL,
    source_answer_part_result_id uuid REFERENCES answer_part_results(id),
    match_basis varchar(30),
    matched_topic_id uuid REFERENCES topics(id),
    matched_knowledge_point_id uuid REFERENCES knowledge_points(id),
    matched_curriculum_unit_id uuid REFERENCES curriculum_units(id),
    matched_subject_id uuid REFERENCES subjects(id),
    status varchar(20) NOT NULL DEFAULT 'pending',
    added_by_user_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at timestamptz,
    CONSTRAINT learner_practice_queue_items_revision_fk
        FOREIGN KEY (question_revision_id, question_id)
        REFERENCES question_revisions(id, question_id),
    CONSTRAINT learner_practice_queue_items_part_fk
        FOREIGN KEY (question_part_id, question_revision_id)
        REFERENCES question_parts(id, question_revision_id),
    CONSTRAINT learner_practice_queue_items_reason_check
        CHECK (reason IN ('wrong_review', 'similar_review', 'manual', 'legacy_migration')),
    CONSTRAINT learner_practice_queue_items_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN ('same_topic', 'same_knowledge_point', 'same_unit', 'same_subject')
        ),
    CONSTRAINT learner_practice_queue_items_origin_check
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
        ),
    CONSTRAINT learner_practice_queue_items_status_check
        CHECK (status IN ('pending', 'consumed', 'removed')),
    CONSTRAINT learner_practice_queue_items_consumed_check
        CHECK (
            (status = 'consumed' AND consumed_at IS NOT NULL)
            OR (status <> 'consumed' AND consumed_at IS NULL)
        )
);

CREATE INDEX learner_practice_queue_items_status_index
    ON learner_practice_queue_items(learner_id, status, created_at);

CREATE FUNCTION lerniqa_validate_queue_item_learner()
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

CREATE TABLE practice_session_item_origins (
    id uuid PRIMARY KEY,
    practice_session_item_id uuid NOT NULL REFERENCES practice_session_items(id),
    source_answer_part_result_id uuid NOT NULL REFERENCES answer_part_results(id),
    queue_item_id uuid REFERENCES learner_practice_queue_items(id),
    relation_kind varchar(30) NOT NULL,
    match_basis varchar(30),
    matched_topic_id uuid REFERENCES topics(id),
    matched_knowledge_point_id uuid REFERENCES knowledge_points(id),
    matched_curriculum_unit_id uuid REFERENCES curriculum_units(id),
    matched_subject_id uuid REFERENCES subjects(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT practice_session_item_origins_source_unique
        UNIQUE (practice_session_item_id, source_answer_part_result_id, relation_kind),
    CONSTRAINT practice_session_item_origins_relation_kind_check
        CHECK (relation_kind IN ('wrong_review', 'similar_review')),
    CONSTRAINT practice_session_item_origins_match_basis_check
        CHECK (
            match_basis IS NULL
            OR match_basis IN ('same_topic', 'same_knowledge_point', 'same_unit', 'same_subject')
        ),
    CONSTRAINT practice_session_item_origins_basis_check
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
        )
);

CREATE INDEX practice_session_item_origins_source_index
    ON practice_session_item_origins(source_answer_part_result_id, relation_kind);

CREATE FUNCTION lerniqa_validate_session_item_origin()
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

INSERT INTO schema_migrations (version, name)
VALUES ('0004', 'practice_and_attempts');

COMMIT;
