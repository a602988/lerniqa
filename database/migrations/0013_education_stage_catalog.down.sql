BEGIN;

LOCK TABLE grades, semesters, seed_manifests IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM grades
WHERE code IN ('senior-high-1', 'senior-high-2', 'senior-high-3');

ALTER TABLE grades
    DROP CONSTRAINT grades_stage_check,
    ADD CONSTRAINT grades_stage_check
        CHECK (stage IN ('elementary', 'junior_high'));

DELETE FROM schema_migrations WHERE version = '0013';

COMMIT;
