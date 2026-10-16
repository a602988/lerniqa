\set ON_ERROR_STOP on

-- The 0008 data repair is forward-only. Rolling back its schema additions must
-- not erase corrected provenance or rewrite native rows that cannot safely be
-- attributed to the migration.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '07800000-0000-0000-0000-000000000009'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'native'
            AND value_source = 'document'
    ) THEN
        RAISE EXCEPTION '0008 down reversed the forward-only repaired classification';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '07800000-0000-0000-0000-000000000014'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'native'
            AND value_source = 'document'
    ) THEN
        RAISE EXCEPTION '0008 down changed an already-correct native classification';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '08000000-0000-0000-0000-000000000009'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'native'
            AND value_source = 'document'
    ) THEN
        RAISE EXCEPTION '0008 down changed a native classification created after the migration';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM question_revision_units
        WHERE question_revision_id = '07800000-0000-0000-0000-000000000011'
            AND curriculum_unit_id = '07800000-0000-0000-0000-000000000003'
            AND assignment_type = 'manual_classification'
            AND value_source = 'user'
    ) THEN
        RAISE EXCEPTION '0008 down changed a classification outside the target batch';
    END IF;
END;
$$;
