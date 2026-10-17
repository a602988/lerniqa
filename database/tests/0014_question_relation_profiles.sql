\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
            AND table_name = 'question_templates'
    ) THEN
        RAISE EXCEPTION 'question_templates is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
            AND table_name = 'question_revision_keywords'
    ) THEN
        RAISE EXCEPTION 'question_revision_keywords is missing';
    END IF;

    IF (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'practice_session_item_origins'
            AND column_name IN (
                'question_template_id',
                'shared_relation_count',
                'relation_method_version',
                'relation_evidence'
            )
    ) <> 4 THEN
        RAISE EXCEPTION 'practice_session_item_origins relation evidence columns are incomplete';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'practice_session_item_origins_match_basis_check'
            AND pg_get_constraintdef(oid) LIKE '%same_template%'
            AND pg_get_constraintdef(oid) LIKE '%shared_keyword%'
    ) THEN
        RAISE EXCEPTION 'practice_session_item_origins relation match bases are incomplete';
    END IF;
END;
$$;

DO $$
DECLARE
    user_id uuid := '14000000-0000-4000-8000-000000000001';
    template_id uuid := '14000000-0000-4000-8000-000000000002';
    keyword_id uuid := '14000000-0000-4000-8000-000000000003';
BEGIN
    INSERT INTO users (id, display_name, status)
    VALUES (user_id, '關聯審核者', 'active');

    INSERT INTO question_templates (
        id,
        template_key,
        normalized_pattern,
        logic_key,
        status,
        created_source,
        method_version,
        evidence
    ) VALUES (
        template_id,
        'hanlin-chinese-template-1',
        '將「{target_character}」改成正確的國字',
        'correct-target-character',
        'pending',
        'rule',
        'template-rule-v1',
        '{"source":"migration-test"}'::jsonb
    );

    INSERT INTO relation_keywords (
        id,
        keyword_key,
        label,
        keyword_kind
    ) VALUES (
        keyword_id,
        'target-character',
        '目標字',
        'target_character'
    );

    BEGIN
        INSERT INTO question_revision_keywords (
            question_revision_id,
            relation_keyword_id,
            value_source,
            status,
            reviewed_by_user_id,
            reviewed_at
        ) VALUES (
            '00000000-0000-0000-0000-000000000000',
            keyword_id,
            'manual',
            'confirmed',
            user_id,
            CURRENT_TIMESTAMP
        );
        RAISE EXCEPTION 'question_revision_keywords accepted a missing revision';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        UPDATE question_templates
        SET status = 'confirmed'
        WHERE id = template_id;
        RAISE EXCEPTION 'question_templates accepted confirmation without reviewer evidence';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE question_templates
    SET
        status = 'confirmed',
        confirmed_by_user_id = user_id,
        confirmed_at = CURRENT_TIMESTAMP
    WHERE id = template_id;

    IF NOT EXISTS (
        SELECT 1
        FROM question_templates
        WHERE id = template_id
            AND status = 'confirmed'
            AND evidence ->> 'source' = 'migration-test'
    ) THEN
        RAISE EXCEPTION 'confirmed template evidence was not preserved';
    END IF;
END;
$$;
