BEGIN;

ALTER TABLE question_content_blocks
    ADD COLUMN hint_index smallint,
    DROP CONSTRAINT question_content_blocks_placement_check,
    ADD CONSTRAINT question_content_blocks_placement_check
        CHECK (placement IN ('prompt', 'option', 'answer', 'explanation', 'transcript', 'hint')),
    ADD CONSTRAINT question_content_blocks_hint_index_check
        CHECK (hint_index IS NULL OR hint_index >= 0),
    ADD CONSTRAINT question_content_blocks_hint_placement_check
        CHECK (
            (
                placement = 'hint'
                AND question_part_id IS NOT NULL
                AND question_option_id IS NULL
                AND hint_index IS NOT NULL
            )
            OR (
                placement <> 'hint'
                AND hint_index IS NULL
            )
        );

CREATE INDEX question_content_blocks_hint_index
    ON question_content_blocks(question_part_id, hint_index, position)
    WHERE placement = 'hint';

INSERT INTO schema_migrations (version, name)
VALUES ('0026', 'question_hints');

COMMIT;
