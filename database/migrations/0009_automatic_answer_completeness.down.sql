BEGIN;

DROP TRIGGER question_answers_automatic_answer_check ON question_answers;
DROP TRIGGER question_options_automatic_answer_check ON question_options;
DROP TRIGGER question_parts_automatic_answer_check ON question_parts;
DROP TRIGGER question_revisions_automatic_answer_check ON question_revisions;

DROP TRIGGER question_answers_0009_parent_revision_lock ON question_answers;
DROP TRIGGER question_options_0009_parent_revision_lock ON question_options;
DROP TRIGGER question_revision_sources_0009_parent_revision_lock
    ON question_revision_sources;
DROP TRIGGER question_revision_filter_values_0009_parent_revision_lock
    ON question_revision_filter_values;
DROP TRIGGER question_revision_curriculum_codes_0009_parent_revision_lock
    ON question_revision_curriculum_codes;
DROP TRIGGER question_revision_knowledge_points_0009_parent_revision_lock
    ON question_revision_knowledge_points;
DROP TRIGGER question_revision_topics_0009_parent_revision_lock
    ON question_revision_topics;
DROP TRIGGER question_revision_units_0009_parent_revision_lock
    ON question_revision_units;
DROP TRIGGER question_content_blocks_0009_parent_revision_lock
    ON question_content_blocks;
DROP TRIGGER question_parts_0009_parent_revision_lock ON question_parts;

DROP FUNCTION lerniqa_validate_automatic_answer_completeness();
DROP FUNCTION lerniqa_assert_automatic_answer_completeness(uuid);
DROP FUNCTION lerniqa_lock_frozen_revision_parents();
DROP FUNCTION lerniqa_automatic_part_has_complete_answer(uuid, varchar);
DROP FUNCTION lerniqa_text_has_non_whitespace(text);

DROP INDEX question_answers_part_index;

DELETE FROM schema_migrations WHERE version = '0009';

COMMIT;
