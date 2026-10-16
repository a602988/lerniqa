BEGIN;

-- Keep the preflight and trigger installation in one write-blocking transaction
-- so a concurrent publisher cannot create a gap between both operations.
LOCK TABLE
    question_revisions,
    question_parts,
    question_content_blocks,
    question_revision_units,
    question_revision_topics,
    question_revision_knowledge_points,
    question_revision_curriculum_codes,
    question_revision_filter_values,
    question_revision_sources,
    question_options,
    question_answers
IN SHARE ROW EXCLUSIVE MODE;

-- PostgreSQL's one-argument btrim only removes U+0020. Keep the database's
-- definition of a usable answer aligned with JavaScript trim for ASCII control
-- whitespace and Unicode separators used by imported text.
CREATE FUNCTION lerniqa_text_has_non_whitespace(candidate_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT btrim(
        candidate_value,
        E' \t\n\r\f' || chr(11) ||
        U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    ) <> '';
$$;

CREATE FUNCTION lerniqa_automatic_part_has_complete_answer(
    candidate_part_id uuid,
    candidate_answer_mode varchar
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN candidate_answer_mode IN ('single_choice', 'boolean') THEN (
            SELECT count(DISTINCT answer.answer_key) = 1
            FROM question_answers AS answer
            JOIN question_options AS option
                ON option.question_part_id = answer.question_part_id
                AND option.option_key = answer.answer_key
            WHERE answer.question_part_id = candidate_part_id
                AND lerniqa_text_has_non_whitespace(answer.answer_key)
        )
        WHEN candidate_answer_mode = 'multiple_choice' THEN EXISTS (
            SELECT 1
            FROM question_answers AS answer
            JOIN question_options AS option
                ON option.question_part_id = answer.question_part_id
                AND option.option_key = answer.answer_key
            WHERE answer.question_part_id = candidate_part_id
                AND lerniqa_text_has_non_whitespace(answer.answer_key)
        )
        WHEN candidate_answer_mode = 'text' THEN EXISTS (
            SELECT 1
            FROM question_answers AS answer
            WHERE answer.question_part_id = candidate_part_id
                AND lerniqa_text_has_non_whitespace(answer.accepted_value)
        )
        ELSE false
    END;
$$;

-- Published and superseded revisions are immutable grading history. Refuse to
-- install the contract when that history is already missing an answer instead
-- of inventing one or silently changing the grading policy.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM question_revisions AS revision
        JOIN question_parts AS part
            ON part.question_revision_id = revision.id
        WHERE revision.status IN ('published', 'superseded')
            AND part.grading_policy = 'automatic'
            AND NOT lerniqa_automatic_part_has_complete_answer(
                part.id,
                part.answer_mode
            )
    ) THEN
        RAISE EXCEPTION 'existing published or superseded automatic question part has no complete reference answer'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE INDEX question_answers_part_index
    ON question_answers(question_part_id);

-- Lock parent revisions before changing any table protected by 0005's frozen
-- revision triggers. The lock is intentionally taken in the BEFORE phase: a
-- publisher updating revision.status conflicts with FOR SHARE, so it either
-- sees every committed child change or completes first and makes the child
-- mutation fail as frozen. Nested option/answer rows first lock their parent
-- parts so a concurrent part move cannot change the revision mapping. Trigger
-- names sort before the 0005 *_frozen_revision_check triggers, and the frozen
-- status is checked again here after every required lock has been acquired.
CREATE FUNCTION lerniqa_lock_frozen_revision_parents()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_part_id uuid;
    current_part_id uuid;
    previous_revision_id uuid;
    current_revision_id uuid;
    part_revision_id uuid;
    candidate_revision_ids uuid[] := ARRAY[]::uuid[];
    locked_revision record;
BEGIN
    IF TG_TABLE_NAME NOT IN ('question_options', 'question_answers') THEN
        IF TG_OP <> 'INSERT' THEN
            previous_revision_id := OLD.question_revision_id;
            candidate_revision_ids := array_append(
                candidate_revision_ids,
                previous_revision_id
            );
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_revision_id := NEW.question_revision_id;
            candidate_revision_ids := array_append(
                candidate_revision_ids,
                current_revision_id
            );
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            previous_part_id := OLD.question_part_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_part_id := NEW.question_part_id;
        END IF;

        -- Stabilize an option or answer's part-to-revision mapping before the
        -- revision locks are chosen. Primary-key order gives opposite moves the
        -- same lock order.
        FOR part_revision_id IN
            SELECT part.question_revision_id
            FROM question_parts AS part
            WHERE part.id = ANY(ARRAY[previous_part_id, current_part_id])
            ORDER BY part.id
            FOR SHARE OF part
        LOOP
            candidate_revision_ids := array_append(
                candidate_revision_ids,
                part_revision_id
            );
        END LOOP;
    END IF;

    FOR locked_revision IN
        SELECT revision.id, revision.status
        FROM question_revisions AS revision
        WHERE revision.id = ANY(candidate_revision_ids)
        ORDER BY revision.id
        FOR SHARE OF revision
    LOOP
        IF locked_revision.status IN ('published', 'superseded') THEN
            RAISE EXCEPTION '已發布或已取代版本的內容、選項與答案不可修改'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER question_parts_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_parts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_content_blocks_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_content_blocks
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_revision_units_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_units
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_revision_topics_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_topics
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_revision_knowledge_points_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_knowledge_points
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_revision_curriculum_codes_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_curriculum_codes
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_revision_filter_values_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_filter_values
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_revision_sources_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_revision_sources
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_options_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_options
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE TRIGGER question_answers_0009_parent_revision_lock
BEFORE INSERT OR UPDATE OR DELETE ON question_answers
FOR EACH ROW
EXECUTE FUNCTION lerniqa_lock_frozen_revision_parents();

CREATE FUNCTION lerniqa_assert_automatic_answer_completeness(candidate_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    final_revision_status varchar(20);
BEGIN
    IF candidate_revision_id IS NULL THEN
        RETURN;
    END IF;

    -- Child writers already hold this parent lock from their BEFORE trigger.
    -- A revision status writer holds a conflicting row lock by virtue of the
    -- UPDATE itself. Re-locking here keeps the final status stable while the
    -- deferred check reads every part and answer.
    SELECT status
    INTO final_revision_status
    FROM question_revisions
    WHERE id = candidate_revision_id
    FOR SHARE;

    IF NOT FOUND OR final_revision_status NOT IN ('published', 'superseded') THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_parts AS part
        WHERE part.question_revision_id = candidate_revision_id
            AND part.grading_policy = 'automatic'
            AND NOT lerniqa_automatic_part_has_complete_answer(
                part.id,
                part.answer_mode
            )
    ) THEN
        RAISE EXCEPTION '已發布或已取代版本的自動判分小題必須有完整參考答案'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_automatic_answer_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_revision_id uuid;
    current_revision_id uuid;
    revision_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'question_revisions' THEN
        IF TG_OP <> 'INSERT' THEN
            previous_revision_id := OLD.id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_revision_id := NEW.id;
        END IF;
    ELSIF TG_TABLE_NAME = 'question_parts' THEN
        IF TG_OP <> 'INSERT' THEN
            previous_revision_id := OLD.question_revision_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_revision_id := NEW.question_revision_id;
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            SELECT question_revision_id
            INTO previous_revision_id
            FROM question_parts
            WHERE id = OLD.question_part_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            SELECT question_revision_id
            INTO current_revision_id
            FROM question_parts
            WHERE id = NEW.question_part_id;
        END IF;
    END IF;

    -- A row can move between parts or revisions. Always acquire revision locks
    -- in UUID order to avoid deadlocks between opposite-direction moves.
    FOR revision_id IN
        SELECT DISTINCT candidate_id
        FROM unnest(ARRAY[previous_revision_id, current_revision_id]) AS candidate(candidate_id)
        WHERE candidate_id IS NOT NULL
        ORDER BY candidate_id
    LOOP
        PERFORM lerniqa_assert_automatic_answer_completeness(revision_id);
    END LOOP;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER question_revisions_automatic_answer_check
AFTER INSERT OR UPDATE OR DELETE ON question_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_automatic_answer_completeness();

CREATE CONSTRAINT TRIGGER question_parts_automatic_answer_check
AFTER INSERT OR UPDATE OR DELETE ON question_parts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_automatic_answer_completeness();

CREATE CONSTRAINT TRIGGER question_options_automatic_answer_check
AFTER INSERT OR UPDATE OR DELETE ON question_options
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_automatic_answer_completeness();

CREATE CONSTRAINT TRIGGER question_answers_automatic_answer_check
AFTER INSERT OR UPDATE OR DELETE ON question_answers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_automatic_answer_completeness();

INSERT INTO schema_migrations (version, name)
VALUES ('0009', 'automatic_answer_completeness');

COMMIT;
