BEGIN;

DELETE FROM filter_field_option_scopes
WHERE filter_option_id IN (
    SELECT option.id
    FROM filter_field_options AS option
    JOIN filter_fields AS field ON field.id = option.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM question_revision_filter_values
WHERE filter_field_id IN (SELECT id FROM filter_fields WHERE origin = 'account');

DELETE FROM filter_field_options
WHERE filter_field_id IN (SELECT id FROM filter_fields WHERE origin = 'account');

DELETE FROM filter_field_scope_sources
WHERE filter_field_scope_id IN (
    SELECT scope.id FROM filter_field_scopes AS scope
    JOIN filter_fields AS field ON field.id = scope.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM filter_field_scope_subjects
WHERE filter_field_scope_id IN (
    SELECT scope.id FROM filter_field_scopes AS scope
    JOIN filter_fields AS field ON field.id = scope.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM filter_field_scope_grades
WHERE filter_field_scope_id IN (
    SELECT scope.id FROM filter_field_scopes AS scope
    JOIN filter_fields AS field ON field.id = scope.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM filter_field_scope_semesters
WHERE filter_field_scope_id IN (
    SELECT scope.id FROM filter_field_scopes AS scope
    JOIN filter_fields AS field ON field.id = scope.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM filter_field_scope_book_versions
WHERE filter_field_scope_id IN (
    SELECT scope.id FROM filter_field_scopes AS scope
    JOIN filter_fields AS field ON field.id = scope.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM filter_field_scope_exam_levels
WHERE filter_field_scope_id IN (
    SELECT scope.id FROM filter_field_scopes AS scope
    JOIN filter_fields AS field ON field.id = scope.filter_field_id
    WHERE field.origin = 'account'
);

DELETE FROM filter_field_scopes
WHERE filter_field_id IN (SELECT id FROM filter_fields WHERE origin = 'account');

DELETE FROM filter_fields WHERE origin = 'account';

DROP INDEX filter_fields_owner_status_index;
DROP INDEX filter_fields_account_key_unique;
DROP INDEX filter_fields_system_key_unique;

ALTER TABLE filter_fields
    DROP CONSTRAINT filter_fields_owner_check,
    DROP CONSTRAINT filter_fields_origin_check,
    DROP COLUMN created_at,
    DROP COLUMN owner_user_id,
    DROP COLUMN origin,
    ADD CONSTRAINT filter_fields_key_key UNIQUE (key);

DELETE FROM schema_migrations WHERE version = '0025';

COMMIT;
