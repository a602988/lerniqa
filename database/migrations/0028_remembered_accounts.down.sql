BEGIN;

DROP TABLE auth_device_accounts;
DROP TABLE auth_devices;

DELETE FROM schema_migrations WHERE version = '0028';

COMMIT;
