BEGIN;

DO $$
DECLARE
    index_definition text;
    preferred_identifier text;
    synthetic_publisher_id constant uuid := '19000000-0000-4000-8000-000000000005';
    synthetic_question_id constant uuid := '19000000-0000-4000-8000-000000000001';
BEGIN
    SELECT pg_get_indexdef(index_relation.oid)
    INTO index_definition
    FROM pg_class AS index_relation
    JOIN pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
    WHERE index_namespace.nspname = 'public'
        AND index_relation.relname = 'question_identifiers_preferred_lookup_index'
        AND index_relation.relkind = 'i';

    IF regexp_replace(index_definition, '[[:space:]]+', ' ', 'g') <>
        'CREATE INDEX question_identifiers_preferred_lookup_index ON public.question_identifiers USING btree (question_id, ( CASE identifier_type WHEN ''publisher_question''::text THEN 0 ELSE 1 END), value)'
    THEN
        RAISE EXCEPTION 'preferred question identifier index definition is incorrect: %', index_definition;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0019'
            AND name = 'question_identifier_question_lookup'
    ) THEN
        RAISE EXCEPTION 'question identifier lookup migration is not registered';
    END IF;

    INSERT INTO publishers (id, code, name)
    VALUES (synthetic_publisher_id, 'test_0019', 'Synthetic migration publisher');

    INSERT INTO questions (id, origin, status, created_method)
    VALUES (synthetic_question_id, 'system', 'draft', 'import');

    INSERT INTO question_identifiers (
        id,
        question_id,
        identifier_type,
        publisher_id,
        value,
        normalized_value
    )
    VALUES
        (
            '19000000-0000-4000-8000-000000000002',
            synthetic_question_id,
            'legacy',
            NULL,
            'A-legacy',
            'a-legacy'
        ),
        (
            '19000000-0000-4000-8000-000000000003',
            synthetic_question_id,
            'publisher_question',
            synthetic_publisher_id,
            'Z-publisher',
            'z-publisher'
        ),
        (
            '19000000-0000-4000-8000-000000000004',
            synthetic_question_id,
            'publisher_question',
            synthetic_publisher_id,
            'B-publisher',
            'b-publisher'
        );

    SELECT identifier.value
    INTO preferred_identifier
    FROM question_identifiers AS identifier
    WHERE identifier.question_id = synthetic_question_id
    ORDER BY
        CASE identifier.identifier_type WHEN 'publisher_question' THEN 0 ELSE 1 END,
        identifier.value
    LIMIT 1;

    IF preferred_identifier <> 'B-publisher' THEN
        RAISE EXCEPTION 'preferred question identifier ordering changed: %', preferred_identifier;
    END IF;
END;
$$;

ROLLBACK;
