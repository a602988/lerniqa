BEGIN;

LOCK TABLE grades, semesters, seed_manifests IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    conflicting_code text;
BEGIN
    SELECT candidate.code
    INTO conflicting_code
    FROM (
        VALUES
            ('elementary-1', 'bd69e019-9d77-53ce-ac8e-287003516866'::uuid),
            ('elementary-2', '66d796d9-0c68-5b91-bc98-8257a101f431'::uuid),
            ('elementary-3', 'ade39f2a-cb79-52ab-be08-954923032350'::uuid),
            ('elementary-4', '6c2dfa87-fa9f-57df-b225-3ec949c4d328'::uuid),
            ('elementary-5', '2f39bb42-286a-51ac-baab-918bdf448bc1'::uuid),
            ('elementary-6', 'e5d43921-0d06-5c6f-af2a-b3a61ff0eb97'::uuid),
            ('junior-high-1', 'f5cc7d9c-6cb4-5774-803f-02fc0f1ca514'::uuid),
            ('junior-high-2', '75547248-0abf-5060-afca-f1354156dd5d'::uuid),
            ('junior-high-3', '77ecbb4e-c00f-5523-b840-a109b2b2c6d4'::uuid),
            ('senior-high-1', '6a9f64f9-fde7-505d-94a4-18fc4de0cf03'::uuid),
            ('senior-high-2', '1a1d68a0-289d-525a-b773-2db3d09083b0'::uuid),
            ('senior-high-3', 'a8aeaa59-a4fa-5098-b167-7121d17766d3'::uuid)
    ) AS candidate(code, id)
    JOIN grades AS grade ON grade.code = candidate.code
    WHERE grade.id <> candidate.id
    ORDER BY candidate.code
    LIMIT 1;

    IF conflicting_code IS NOT NULL THEN
        RAISE EXCEPTION 'grade code % already uses a non-canonical id', conflicting_code
            USING ERRCODE = '23505';
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('semester-1', 'bf139382-7968-5546-b7d0-0f7e7779c72b'::uuid),
                ('semester-2', 'b1834952-0333-5fee-bade-99e00fe9692a'::uuid)
        ) AS candidate(code, id)
        JOIN semesters AS semester ON semester.code = candidate.code
        WHERE semester.id <> candidate.id
    ) THEN
        RAISE EXCEPTION 'a formal semester code already uses a non-canonical id'
            USING ERRCODE = '23505';
    END IF;
END;
$$;

ALTER TABLE grades
    DROP CONSTRAINT grades_stage_check,
    ADD CONSTRAINT grades_stage_check
        CHECK (stage IN ('elementary', 'junior_high', 'senior_high'));

INSERT INTO grades (id, stage, code, name, sort_order, status)
VALUES
    ('bd69e019-9d77-53ce-ac8e-287003516866', 'elementary', 'elementary-1', '小一', 1, 'active'),
    ('66d796d9-0c68-5b91-bc98-8257a101f431', 'elementary', 'elementary-2', '小二', 2, 'active'),
    ('ade39f2a-cb79-52ab-be08-954923032350', 'elementary', 'elementary-3', '小三', 3, 'active'),
    ('6c2dfa87-fa9f-57df-b225-3ec949c4d328', 'elementary', 'elementary-4', '小四', 4, 'active'),
    ('2f39bb42-286a-51ac-baab-918bdf448bc1', 'elementary', 'elementary-5', '小五', 5, 'active'),
    ('e5d43921-0d06-5c6f-af2a-b3a61ff0eb97', 'elementary', 'elementary-6', '小六', 6, 'active'),
    ('f5cc7d9c-6cb4-5774-803f-02fc0f1ca514', 'junior_high', 'junior-high-1', '國一', 7, 'active'),
    ('75547248-0abf-5060-afca-f1354156dd5d', 'junior_high', 'junior-high-2', '國二', 8, 'active'),
    ('77ecbb4e-c00f-5523-b840-a109b2b2c6d4', 'junior_high', 'junior-high-3', '國三', 9, 'active'),
    ('6a9f64f9-fde7-505d-94a4-18fc4de0cf03', 'senior_high', 'senior-high-1', '高一', 10, 'active'),
    ('1a1d68a0-289d-525a-b773-2db3d09083b0', 'senior_high', 'senior-high-2', '高二', 11, 'active'),
    ('a8aeaa59-a4fa-5098-b167-7121d17766d3', 'senior_high', 'senior-high-3', '高三', 12, 'active')
ON CONFLICT (code) DO UPDATE
SET
    stage = EXCLUDED.stage,
    name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    status = 'active';

INSERT INTO semesters (id, code, name, sort_order, status)
VALUES
    ('bf139382-7968-5546-b7d0-0f7e7779c72b', 'semester-1', '上學期', 1, 'active'),
    ('b1834952-0333-5fee-bade-99e00fe9692a', 'semester-2', '下學期', 2, 'active')
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    status = 'active';

INSERT INTO seed_manifests (
    id,
    catalog_key,
    version,
    source_reference,
    content_checksum,
    item_count,
    status,
    applied_at,
    migration_name
)
VALUES (
    '5825b9a4-2cce-5b1c-a451-de0ca1829ab7',
    'grades',
    'twelve-year-basic-education-v1',
    '國家教育研究院：十二年國民基本教育課程綱要總綱（111學年度實施）',
    'sha256:cf142a509f51bac3287dce4d4c90e0d530c191da10b3bfe532a025adbcee15f0',
    12,
    'pending',
    NULL,
    '0013_education_stage_catalog'
)
ON CONFLICT (catalog_key, version) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE id = '5825b9a4-2cce-5b1c-a451-de0ca1829ab7'
            AND catalog_key = 'grades'
            AND version = 'twelve-year-basic-education-v1'
            AND source_reference = '國家教育研究院：十二年國民基本教育課程綱要總綱（111學年度實施）'
            AND content_checksum = 'sha256:cf142a509f51bac3287dce4d4c90e0d530c191da10b3bfe532a025adbcee15f0'
            AND item_count = 12
            AND status IN ('pending', 'applied')
            AND migration_name = '0013_education_stage_catalog'
    ) THEN
        RAISE EXCEPTION 'grade seed manifest conflicts with the formal catalog'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

UPDATE seed_manifests
SET status = 'applied'
WHERE id = '5825b9a4-2cce-5b1c-a451-de0ca1829ab7'
    AND status = 'pending';

INSERT INTO seed_manifests (
    id,
    catalog_key,
    version,
    source_reference,
    content_checksum,
    item_count,
    status,
    applied_at,
    migration_name
)
VALUES (
    'd4879e55-6830-5509-a6e9-cf29ebad96df',
    'semesters',
    'twelve-year-basic-education-v1',
    '國家教育研究院：十二年國民基本教育課程綱要總綱（111學年度實施）',
    'sha256:8a6c864b2da5747e401dfad3a0404172e02a8e7ea52076c4eb2fb0a2057e85f8',
    2,
    'pending',
    NULL,
    '0013_education_stage_catalog'
)
ON CONFLICT (catalog_key, version) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM seed_manifests
        WHERE id = 'd4879e55-6830-5509-a6e9-cf29ebad96df'
            AND catalog_key = 'semesters'
            AND version = 'twelve-year-basic-education-v1'
            AND source_reference = '國家教育研究院：十二年國民基本教育課程綱要總綱（111學年度實施）'
            AND content_checksum = 'sha256:8a6c864b2da5747e401dfad3a0404172e02a8e7ea52076c4eb2fb0a2057e85f8'
            AND item_count = 2
            AND status IN ('pending', 'applied')
            AND migration_name = '0013_education_stage_catalog'
    ) THEN
        RAISE EXCEPTION 'semester seed manifest conflicts with the formal catalog'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

UPDATE seed_manifests
SET status = 'applied'
WHERE id = 'd4879e55-6830-5509-a6e9-cf29ebad96df'
    AND status = 'pending';

INSERT INTO schema_migrations (version, name)
VALUES ('0013', 'education_stage_catalog');

COMMIT;
