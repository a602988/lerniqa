BEGIN;

DROP INDEX question_identifiers_preferred_lookup_index;

DELETE FROM schema_migrations
WHERE version = '0019' AND name = 'question_identifier_question_lookup';

COMMIT;
