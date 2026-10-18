BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'question_parts' AND column_name = 'answer_field_count'
    ) THEN
        RAISE EXCEPTION 'question_parts.answer_field_count is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'question_parts_answer_field_count_check'
    ) THEN
        RAISE EXCEPTION 'answer field count constraint is missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM question_parts
        WHERE answer_field_count NOT BETWEEN 1 AND 8
            OR (answer_mode <> 'text' AND answer_field_count <> 1)
            OR (answer_field_count > 1 AND grading_policy <> 'manual_review')
    ) THEN
        RAISE EXCEPTION 'persisted answer field count violates the part contract';
    END IF;
END $$;

ROLLBACK;
