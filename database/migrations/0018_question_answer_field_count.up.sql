BEGIN;

ALTER TABLE question_parts
    ADD COLUMN answer_field_count smallint NOT NULL DEFAULT 1,
    ADD CONSTRAINT question_parts_answer_field_count_check
        CHECK (
            answer_field_count BETWEEN 1 AND 8
            AND (answer_mode = 'text' OR answer_field_count = 1)
            AND (answer_field_count = 1 OR grading_policy = 'manual_review')
        );

INSERT INTO schema_migrations (version, name) VALUES ('0018', 'question_answer_field_count');
COMMIT;
