BEGIN;

DROP TABLE google_quick_registrations;

DELETE FROM schema_migrations WHERE version = '0021';

COMMIT;
