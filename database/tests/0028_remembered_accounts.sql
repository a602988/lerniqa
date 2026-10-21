\set ON_ERROR_STOP on

DO $$
BEGIN
    IF to_regclass('public.auth_devices') IS NULL
        OR to_regclass('public.auth_device_accounts') IS NULL THEN
        RAISE EXCEPTION 'remembered account tables are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM schema_migrations
        WHERE version = '0028' AND name = 'remembered_accounts'
    ) THEN
        RAISE EXCEPTION '0028 migration record is missing';
    END IF;
END;
$$;

INSERT INTO auth_devices(id, token_hash, expires_at)
VALUES (
    '28000000-0000-4000-8000-000000000001',
    'sha256:v1:migration-test-device',
    CURRENT_TIMESTAMP + INTERVAL '30 days'
);

INSERT INTO auth_device_accounts(id, device_id, user_id)
VALUES (
    '28000000-0000-4000-8000-000000000002',
    '28000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO auth_device_accounts(id, device_id, user_id)
        VALUES (
            '28000000-0000-4000-8000-000000000003',
            '28000000-0000-4000-8000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION 'duplicate active remembered account was accepted';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END;
$$;

UPDATE auth_device_accounts
SET removed_at = CURRENT_TIMESTAMP
WHERE id = '28000000-0000-4000-8000-000000000002';

INSERT INTO auth_device_accounts(id, device_id, user_id)
VALUES (
    '28000000-0000-4000-8000-000000000004',
    '28000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);
