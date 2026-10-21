BEGIN;

CREATE TABLE auth_devices (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz
);

CREATE TABLE auth_device_accounts (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES auth_devices(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at timestamptz
);

CREATE UNIQUE INDEX auth_device_accounts_active_unique
    ON auth_device_accounts(device_id, user_id)
    WHERE removed_at IS NULL;

CREATE INDEX auth_device_accounts_device_index
    ON auth_device_accounts(device_id, removed_at, last_used_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES ('0028', 'remembered_accounts');

COMMIT;
