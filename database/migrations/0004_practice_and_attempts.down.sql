BEGIN;

DELETE FROM schema_migrations WHERE version = '0004';

DROP TABLE practice_session_item_origins;
DROP FUNCTION lerniqa_validate_session_item_origin();
DROP TABLE learner_practice_queue_items;
DROP FUNCTION lerniqa_validate_queue_item_learner();
DROP TABLE answer_reviews;
DROP TABLE answer_part_assets;
DROP FUNCTION lerniqa_validate_answer_asset();
DROP TABLE answer_part_results;
DROP FUNCTION lerniqa_validate_answer_part();
DROP TABLE answer_attempts;
DROP FUNCTION lerniqa_validate_answer_attempt_learner();
DROP TABLE practice_session_items;
DROP TABLE practice_sessions;
DROP TABLE practice_schedule_items;
DROP TABLE practice_schedules;
DROP TABLE practice_plan_items;
DROP TABLE practice_plan_difficulty_mix;
DROP TABLE practice_plans;
DROP TABLE exam_subject_ranges;
DROP FUNCTION lerniqa_validate_exam_subject_range();
ALTER TABLE learner_preferences DROP CONSTRAINT learner_preferences_active_exam_fk;
ALTER TABLE learner_preferences DROP COLUMN active_exam_id;
DROP TABLE exams;

COMMIT;
