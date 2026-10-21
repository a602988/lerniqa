BEGIN;

DROP TABLE email_registration_onboarding;

DELETE FROM schema_migrations WHERE version = '0024';

COMMIT;
