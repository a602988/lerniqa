\set ON_ERROR_STOP on

DO $$
DECLARE
    actual_count integer;
    actual_stages text[];
BEGIN
    SELECT count(*), array_agg(DISTINCT stage ORDER BY stage)
    INTO actual_count, actual_stages
    FROM grades
    WHERE code IN (
        'elementary-1', 'elementary-2', 'elementary-3',
        'elementary-4', 'elementary-5', 'elementary-6',
        'junior-high-1', 'junior-high-2', 'junior-high-3',
        'senior-high-1', 'senior-high-2', 'senior-high-3'
    )
        AND status = 'active';

    IF actual_count <> 12 THEN
        RAISE EXCEPTION 'expected 12 active formal grades, found %', actual_count;
    END IF;
    IF actual_stages <> ARRAY['elementary', 'junior_high', 'senior_high']::text[] THEN
        RAISE EXCEPTION 'unexpected education stages: %', actual_stages;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE catalog_key = 'grades'
            AND version = 'twelve-year-basic-education-v1'
            AND content_checksum = 'sha256:cf142a509f51bac3287dce4d4c90e0d530c191da10b3bfe532a025adbcee15f0'
            AND item_count = 12
            AND status = 'applied'
            AND applied_at IS NOT NULL
            AND migration_name = '0013_education_stage_catalog'
    ) THEN
        RAISE EXCEPTION 'formal grade seed manifest is missing or invalid';
    END IF;

    IF (
        SELECT array_agg(code::text ORDER BY sort_order)
        FROM semesters
        WHERE status = 'active'
            AND code IN ('semester-1', 'semester-2')
    ) <> ARRAY['semester-1', 'semester-2']::text[] THEN
        RAISE EXCEPTION 'formal semester catalog is incomplete';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE catalog_key = 'semesters'
            AND version = 'twelve-year-basic-education-v1'
            AND content_checksum = 'sha256:8a6c864b2da5747e401dfad3a0404172e02a8e7ea52076c4eb2fb0a2057e85f8'
            AND item_count = 2
            AND status = 'applied'
            AND applied_at IS NOT NULL
            AND migration_name = '0013_education_stage_catalog'
    ) THEN
        RAISE EXCEPTION 'formal semester seed manifest is missing or invalid';
    END IF;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO grades (id, stage, code, name, sort_order)
        VALUES ('13000000-0000-4000-8000-000000000001', 'tertiary', 'college-1', '大一', 13);
        RAISE EXCEPTION 'grades accepted an unsupported education stage';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;
