\set ON_ERROR_STOP on

DO $$
DECLARE
    removed_object text;
    match_constraint text;
    origin_constraint text;
    reason_constraint text;
    match_function text;
    origin_function text;
BEGIN
    IF EXISTS (
        SELECT 1 FROM schema_migrations WHERE version = '0012'
    ) THEN
        RAISE EXCEPTION '0012 down 沒有移除 migration 紀錄';
    END IF;

    FOREACH removed_object IN ARRAY ARRAY[
        'subscription_plans',
        'subscription_plan_prices',
        'subscription_feature_definitions',
        'subscription_plan_feature_limits',
        'admin_mutation_receipts',
        'practice_recommendation_requests',
        'question_enrichment_runs',
        'question_revision_enrichment_suggestions',
        'handwriting_analysis_jobs',
        'handwriting_analysis_runs'
    ]
    LOOP
        IF to_regclass('public.' || removed_object) IS NOT NULL THEN
            RAISE EXCEPTION '0012 down 留下資料表：%', removed_object;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'answer_reviews'
            AND column_name = 'handwriting_analysis_run_id'
    ) THEN
        RAISE EXCEPTION '0012 down 留下 answer_reviews 的 handwriting run FK 欄位';
    END IF;

    SELECT pg_get_constraintdef(oid)
    INTO match_constraint
    FROM pg_constraint
    WHERE conrelid = 'learner_practice_queue_items'::regclass
        AND conname = 'learner_practice_queue_items_match_basis_check';

    SELECT pg_get_constraintdef(oid)
    INTO origin_constraint
    FROM pg_constraint
    WHERE conrelid = 'practice_session_item_origins'::regclass
        AND conname = 'practice_session_item_origins_match_basis_check';

    SELECT pg_get_constraintdef(oid)
    INTO reason_constraint
    FROM pg_constraint
    WHERE conrelid = 'practice_session_items'::regclass
        AND conname = 'practice_session_items_reason_check';

    IF match_constraint LIKE '%same_question_type%'
        OR origin_constraint LIKE '%same_question_type%'
        OR reason_constraint LIKE '%same_type_review%' THEN
        RAISE EXCEPTION '0012 down 沒有還原 provenance CHECK 值域';
    END IF;

    SELECT pg_get_functiondef(
        'lerniqa_similarity_match_is_valid(uuid,uuid,uuid,character varying,uuid,uuid,uuid,uuid,uuid)'::regprocedure
    ) INTO match_function;
    SELECT pg_get_functiondef(
        'lerniqa_validate_session_item_origin()'::regprocedure
    ) INTO origin_function;

    IF match_function LIKE '%same_question_type%'
        OR origin_function LIKE '%same_type_review%' THEN
        RAISE EXCEPTION '0012 down 沒有還原 0005 provenance validator';
    END IF;
END;
$$;
