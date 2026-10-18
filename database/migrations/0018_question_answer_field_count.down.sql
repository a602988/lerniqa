BEGIN;

ALTER TABLE question_parts
    DROP CONSTRAINT question_parts_answer_field_count_check,
    DROP COLUMN answer_field_count;

DELETE FROM schema_migrations WHERE version = '0018' AND name = 'question_answer_field_count';
COMMIT;
