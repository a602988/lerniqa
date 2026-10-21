BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM question_content_blocks
        WHERE placement = 'hint' OR hint_index IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'question hint content exists; remove it through an approved data migration before rolling back 0026';
    END IF;
END;
$$;

DROP INDEX question_content_blocks_hint_index;

ALTER TABLE question_content_blocks
    DROP CONSTRAINT question_content_blocks_hint_placement_check,
    DROP CONSTRAINT question_content_blocks_hint_index_check,
    DROP CONSTRAINT question_content_blocks_placement_check,
    DROP COLUMN hint_index,
    ADD CONSTRAINT question_content_blocks_placement_check
        CHECK (placement IN ('prompt', 'option', 'answer', 'explanation', 'transcript'));

DELETE FROM schema_migrations WHERE version = '0026';

COMMIT;
