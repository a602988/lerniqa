DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0016'
            AND name = 'book_version_volume_boundary'
    ) THEN
        RAISE EXCEPTION 'book version and volume boundary migration is not registered';
    END IF;
END;
$$;
