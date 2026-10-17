DO $$
DECLARE
    test_keyword_id uuid := 'f1000000-0000-4000-8000-000000000001';
BEGIN
    INSERT INTO relation_keywords (
        id,
        keyword_key,
        label,
        keyword_kind,
        status,
        created_source,
        method_version,
        evidence
    )
    VALUES (
        test_keyword_id,
        'test:pending-keyword',
        '待審關鍵字',
        'concept',
        'pending',
        'ai',
        'question-relation-analysis/v1',
        '{"confidence": 0.8}'::jsonb
    );

    BEGIN
        UPDATE relation_keywords
        SET status = 'active'
        WHERE id = test_keyword_id;
        RAISE EXCEPTION 'AI keyword became active without reviewer';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE relation_keywords
    SET
        status = 'active',
        reviewed_by_user_id = (
            SELECT id
            FROM users
            ORDER BY created_at, id
            LIMIT 1
        ),
        reviewed_at = CURRENT_TIMESTAMP
    WHERE id = test_keyword_id;

    IF NOT EXISTS (
        SELECT 1
        FROM relation_keywords
        WHERE id = test_keyword_id
            AND status = 'active'
            AND reviewed_by_user_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'reviewed AI keyword did not become active';
    END IF;

    DELETE FROM relation_keywords WHERE id = test_keyword_id;
END;
$$;
