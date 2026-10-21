\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.auth_devices') IS NOT NULL
        OR to_regclass('public.auth_device_accounts') IS NOT NULL THEN
        RAISE EXCEPTION 'remembered account tables still exist';
    END IF;
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0028') THEN
        RAISE EXCEPTION '0028 migration record still exists';
    END IF;
END;
$$;
