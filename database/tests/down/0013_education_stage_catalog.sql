\set ON_ERROR_STOP on

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM grades
        WHERE stage = 'senior_high'
    ) THEN
        RAISE EXCEPTION 'senior-high grades remain after 0013 rollback';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE catalog_key = 'grades'
            AND version = 'twelve-year-basic-education-v1'
            AND status = 'applied'
    ) THEN
        RAISE EXCEPTION 'durable grade seed evidence was lost after 0013 rollback';
    END IF;

    BEGIN
        INSERT INTO grades (id, stage, code, name, sort_order)
        VALUES ('13000000-0000-4000-8000-000000000002', 'senior_high', 'senior-high-test', '高中測試', 13);
        RAISE EXCEPTION 'pre-0013 stage constraint was not restored';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;
