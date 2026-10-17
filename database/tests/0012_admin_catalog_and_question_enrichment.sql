\set ON_ERROR_STOP on

BEGIN;

-- 0005's system-admin fixture is transaction-local and rolls back. Create an
-- isolated administrator plus a plain active human reviewer for this test.
INSERT INTO users (id, display_name)
VALUES ('f0000000-0000-4000-8000-000000000002', '0012 一般審核者');

INSERT INTO user_roles (
    id,
    user_id,
    role,
    granted_by_type
)
VALUES (
    '12000000-0000-4000-8000-000000000201',
    '00000000-0000-0000-0000-000000000001',
    'system_admin',
    'bootstrap_admin'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000202',
    'bootstrap_admin',
    'admin_role_granted',
    'user_role',
    '12000000-0000-4000-8000-000000000201',
    '{"role":"system_admin"}'::jsonb,
    '0012-test-admin-grant'
);

SET CONSTRAINTS user_roles_system_admin_audit_check IMMEDIATE;
SET CONSTRAINTS user_roles_system_admin_audit_check DEFERRED;

DO $$
DECLARE
    expected_table text;
    expected_trigger text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0012'
            AND name = 'admin_catalog_and_question_enrichment'
    ) THEN
        RAISE EXCEPTION '缺少 0012 migration 紀錄';
    END IF;

    FOREACH expected_table IN ARRAY ARRAY[
        'subscription_plans',
        'subscription_plan_prices',
        'subscription_feature_definitions',
        'subscription_plan_feature_limits',
        'admin_mutation_receipts',
        'question_enrichment_runs',
        'question_revision_enrichment_suggestions',
        'handwriting_analysis_jobs',
        'handwriting_analysis_runs'
    ]
    LOOP
        IF to_regclass('public.' || expected_table) IS NULL THEN
            RAISE EXCEPTION '缺少 0012 資料表：%', expected_table;
        END IF;
    END LOOP;

    FOREACH expected_trigger IN ARRAY ARRAY[
        'subscription_plans_history_check',
        'subscription_prices_history_check',
        'subscription_features_history_check',
        'subscription_limits_history_check',
        'subscription_plans_audit_check',
        'subscription_prices_audit_check',
        'subscription_features_audit_check',
        'subscription_limits_audit_check',
        'subscription_plans_integrity_check',
        'subscription_prices_integrity_check',
        'subscription_features_integrity_check',
        'subscription_limits_integrity_check',
        'admin_mutation_receipts_history_check',
        'admin_mutation_receipts_completion_check',
        'question_enrichment_runs_history_check',
        'question_revision_enrichment_suggestions_history_check',
        'question_enrichment_runs_suggestion_check',
        'question_revision_enrichment_suggestions_run_check',
        'handwriting_analysis_jobs_source_check',
        'handwriting_analysis_jobs_history_check',
        'handwriting_analysis_runs_append_only',
        'answer_reviews_handwriting_run_check',
        'handwriting_analysis_jobs_attempt_evidence_check',
        'handwriting_analysis_runs_job_check'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = expected_trigger
                AND NOT tgisinternal
        ) THEN
            RAISE EXCEPTION '缺少 0012 trigger：%', expected_trigger;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname IN (
            'subscription_plans_audit_check',
            'subscription_prices_audit_check',
            'subscription_features_audit_check',
            'subscription_limits_audit_check',
            'subscription_plans_integrity_check',
            'subscription_prices_integrity_check',
            'subscription_features_integrity_check',
            'subscription_limits_integrity_check',
            'admin_mutation_receipts_completion_check',
            'question_enrichment_runs_suggestion_check',
            'question_revision_enrichment_suggestions_run_check',
            'answer_reviews_handwriting_run_check',
            'handwriting_analysis_jobs_attempt_evidence_check',
            'handwriting_analysis_runs_job_check'
        )
            AND NOT tgisinternal
            AND (NOT tgdeferrable OR NOT tginitdeferred)
    ) THEN
        RAISE EXCEPTION '0012 final-state 或 audit trigger 必須 deferred initially deferred';
    END IF;

    IF to_regclass('public.account_subscriptions') IS NOT NULL
        OR to_regclass('public.checkout_sessions') IS NOT NULL
        OR to_regclass('public.payment_methods') IS NOT NULL
        OR to_regclass('public.invoices') IS NOT NULL
        OR to_regclass('public.payments') IS NOT NULL
        OR to_regclass('public.refunds') IS NOT NULL
        OR to_regclass('public.payment_webhooks') IS NOT NULL
        OR to_regclass('public.subscription_entitlements') IS NOT NULL THEN
        RAISE EXCEPTION '0012 不可建立訂閱、付款、發票、退款或 entitlement 資料表';
    END IF;

    IF pg_get_functiondef(
        'lerniqa_validate_handwriting_analysis_job_source()'::regprocedure
    ) NOT LIKE '%session.check_mode IN (''instant'', ''complete'')%' THEN
        RAISE EXCEPTION '手寫 AI 建議未明確排除 score 練習';
    END IF;

    IF NOT lerniqa_user_is_system_admin(
        '00000000-0000-0000-0000-000000000001'
    ) THEN
        RAISE EXCEPTION '0012 測試需要 0005 建立的有效合成 system_admin';
    END IF;
END;
$$;

-- Build a fully isolated wrong-answer source and a same-type target. The
-- selector's complete-candidate/fallback ordering is an application
-- transaction responsibility; these cases verify the persisted pair only.
INSERT INTO question_types (id, code, name, supports_parts)
SELECT
    '12d00000-0000-4000-8000-000000000001',
    'single-choice',
    '0012 合成粗題型',
    false
WHERE NOT EXISTS (
    SELECT 1 FROM question_types WHERE code = 'single-choice'
);

INSERT INTO question_types (id, code, name, supports_parts)
VALUES (
    '12d00000-0000-4000-8000-000000000002',
    '0012-fine-type',
    '0012 合成細題型',
    false
);

INSERT INTO questions (id, origin, status, created_method)
VALUES
    ('12d00000-0000-4000-8000-000000000003', 'system', 'draft', 'migration'),
    ('12d00000-0000-4000-8000-000000000004', 'system', 'draft', 'migration');

INSERT INTO question_revisions (
    id,
    question_id,
    revision_number,
    question_type_id,
    original_question_type_label,
    source_category_id,
    status,
    created_by_type
)
VALUES
    (
        '12d00000-0000-4000-8000-000000000005',
        '12d00000-0000-4000-8000-000000000003',
        1,
        (SELECT id FROM question_types WHERE code = 'single-choice'),
        '單選題 A',
        '82700000-0000-0000-0000-000000000001',
        'draft',
        'migration'
    ),
    (
        '12d00000-0000-4000-8000-000000000006',
        '12d00000-0000-4000-8000-000000000004',
        1,
        (SELECT id FROM question_types WHERE code = 'single-choice'),
        '單選題 A',
        '82700000-0000-0000-0000-000000000001',
        'draft',
        'migration'
    );

INSERT INTO question_parts (
    id,
    question_revision_id,
    stable_key,
    position,
    answer_mode,
    grading_policy
)
VALUES
    (
        '12d00000-0000-4000-8000-000000000007',
        '12d00000-0000-4000-8000-000000000005',
        'root',
        0,
        'text',
        'manual_review'
    ),
    (
        '12d00000-0000-4000-8000-000000000008',
        '12d00000-0000-4000-8000-000000000006',
        'root',
        0,
        'text',
        'manual_review'
    );

INSERT INTO practice_sessions (
    id,
    learner_id,
    created_by_user_id,
    mode,
    check_mode
)
VALUES
    (
        '12d00000-0000-4000-8000-000000000009',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'practice',
        'instant'
    ),
    (
        '12d00000-0000-4000-8000-00000000000a',
        '30000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'similar',
        'instant'
    );

INSERT INTO practice_session_items (
    id,
    practice_session_id,
    question_id,
    question_revision_id,
    question_part_id,
    position,
    selection_reason
)
VALUES
    (
        '12d00000-0000-4000-8000-00000000000b',
        '12d00000-0000-4000-8000-000000000009',
        '12d00000-0000-4000-8000-000000000003',
        '12d00000-0000-4000-8000-000000000005',
        '12d00000-0000-4000-8000-000000000007',
        0,
        'fixed'
    ),
    (
        '12d00000-0000-4000-8000-00000000000c',
        '12d00000-0000-4000-8000-00000000000a',
        '12d00000-0000-4000-8000-000000000004',
        '12d00000-0000-4000-8000-000000000006',
        '12d00000-0000-4000-8000-000000000008',
        0,
        'same_type_review'
    );

INSERT INTO answer_attempts (
    id,
    practice_session_item_id,
    learner_id,
    attempt_number,
    idempotency_key,
    overall_result,
    grading_source
)
VALUES (
    '12d00000-0000-4000-8000-00000000000d',
    '12d00000-0000-4000-8000-00000000000b',
    '30000000-0000-0000-0000-000000000001',
    1,
    '0012-same-type-source-attempt',
    'wrong',
    'manual_review'
);

INSERT INTO answer_part_results (
    id,
    answer_attempt_id,
    question_part_id,
    answer_payload,
    initial_result,
    current_result,
    grading_source
)
VALUES (
    '12d00000-0000-4000-8000-00000000000e',
    '12d00000-0000-4000-8000-00000000000d',
    '12d00000-0000-4000-8000-000000000007',
    '{"text":"synthetic answer"}'::jsonb,
    'wrong',
    'wrong',
    'manual_review'
);

DO $$
BEGIN
    IF NOT lerniqa_similarity_match_is_valid(
        '12d00000-0000-4000-8000-00000000000e',
        '12d00000-0000-4000-8000-000000000004',
        '12d00000-0000-4000-8000-000000000006',
        'same_question_type',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    ) THEN
        RAISE EXCEPTION '同 source category/type/原始粗題型標籤沒有成立 same_question_type';
    END IF;

    UPDATE question_revisions
    SET original_question_type_label = '單選題 B'
    WHERE id = '12d00000-0000-4000-8000-000000000006';

    IF lerniqa_similarity_match_is_valid(
        '12d00000-0000-4000-8000-00000000000e',
        '12d00000-0000-4000-8000-000000000004',
        '12d00000-0000-4000-8000-000000000006',
        'same_question_type',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    ) THEN
        RAISE EXCEPTION '粗題型不同原始標籤仍被視為 same_question_type';
    END IF;

    UPDATE question_revisions
    SET source_category_id = NULL,
        original_question_type_label = '單選題 A'
    WHERE id = '12d00000-0000-4000-8000-000000000006';

    IF lerniqa_similarity_match_is_valid(
        '12d00000-0000-4000-8000-00000000000e',
        '12d00000-0000-4000-8000-000000000004',
        '12d00000-0000-4000-8000-000000000006',
        'same_question_type',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    ) THEN
        RAISE EXCEPTION 'NULL source category 不可通過 same_question_type';
    END IF;

    UPDATE question_revisions
    SET question_type_id = '12d00000-0000-4000-8000-000000000002',
        original_question_type_label = NULL,
        source_category_id = '82700000-0000-0000-0000-000000000001'
    WHERE id IN (
        '12d00000-0000-4000-8000-000000000005',
        '12d00000-0000-4000-8000-000000000006'
    );

    IF NOT lerniqa_similarity_match_is_valid(
        '12d00000-0000-4000-8000-00000000000e',
        '12d00000-0000-4000-8000-000000000004',
        '12d00000-0000-4000-8000-000000000006',
        'same_question_type',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
    ) THEN
        RAISE EXCEPTION '細題型同 type/category 不應要求原始粗標籤';
    END IF;

    UPDATE question_revisions
    SET question_type_id = (
            SELECT id FROM question_types WHERE code = 'single-choice'
        ),
        original_question_type_label = '單選題 A'
    WHERE id IN (
        '12d00000-0000-4000-8000-000000000005',
        '12d00000-0000-4000-8000-000000000006'
    );
END;
$$;

INSERT INTO learner_practice_queue_items (
    id,
    learner_id,
    question_id,
    question_revision_id,
    question_part_id,
    reason,
    source_answer_part_result_id,
    match_basis,
    status,
    added_by_user_id,
    consumed_at
)
VALUES (
    '12d00000-0000-4000-8000-00000000000f',
    '30000000-0000-0000-0000-000000000001',
    '12d00000-0000-4000-8000-000000000004',
    '12d00000-0000-4000-8000-000000000006',
    '12d00000-0000-4000-8000-000000000008',
    'similar_review',
    '12d00000-0000-4000-8000-00000000000e',
    'same_question_type',
    'consumed',
    '00000000-0000-0000-0000-000000000001',
    transaction_timestamp()
);

INSERT INTO practice_session_item_origins (
    id,
    practice_session_item_id,
    source_answer_part_result_id,
    queue_item_id,
    relation_kind,
    match_basis
)
VALUES (
    '12d00000-0000-4000-8000-000000000010',
    '12d00000-0000-4000-8000-00000000000c',
    '12d00000-0000-4000-8000-00000000000e',
    '12d00000-0000-4000-8000-00000000000f',
    'similar_review',
    'same_question_type'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM practice_session_item_origins AS origin
        JOIN practice_session_items AS item
            ON item.id = origin.practice_session_item_id
        JOIN learner_practice_queue_items AS queue
            ON queue.id = origin.queue_item_id
        WHERE origin.id = '12d00000-0000-4000-8000-000000000010'
            AND origin.relation_kind = 'similar_review'
            AND origin.match_basis = 'same_question_type'
            AND queue.reason = 'similar_review'
            AND queue.match_basis = 'same_question_type'
            AND item.selection_reason = 'same_type_review'
    ) THEN
        RAISE EXCEPTION 'same_question_type queue/origin/selection provenance 未完整保存';
    END IF;

    BEGIN
        INSERT INTO learner_practice_queue_items (
            id, learner_id, question_id, question_revision_id,
            question_part_id, reason, source_answer_part_result_id,
            match_basis, matched_topic_id
        )
        VALUES (
            '12d00000-0000-4000-8000-000000000011',
            '30000000-0000-0000-0000-000000000001',
            '12d00000-0000-4000-8000-000000000004',
            '12d00000-0000-4000-8000-000000000006',
            '12d00000-0000-4000-8000-000000000008',
            'similar_review',
            '12d00000-0000-4000-8000-00000000000e',
            'same_question_type',
            '82000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION 'same_question_type 可挾帶其他 discriminator';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- Enrichment suggestions may be written before a run is finalized in the same
-- transaction, but must resolve to a completed parent before constraint check.
INSERT INTO question_enrichment_runs (
    id, purpose, engine, model_name, model_digest, prompt_version,
    taxonomy_version, status, started_at
)
VALUES (
    '12e00000-0000-4000-8000-000000000001',
    'question_bank_enrichment',
    'ollama',
    'synthetic-enricher',
    repeat('1', 64),
    'prompt-v1',
    'taxonomy-v1',
    'running',
    transaction_timestamp()
);

INSERT INTO question_revision_enrichment_suggestions (
    id,
    run_id,
    question_revision_id,
    dimension,
    suggested_key,
    suggested_label,
    input_sha256,
    confidence,
    evidence
)
VALUES (
    '12e00000-0000-4000-8000-000000000002',
    '12e00000-0000-4000-8000-000000000001',
    '12d00000-0000-4000-8000-000000000005',
    'fine_question_type',
    'single_choice',
    '單一選擇題',
    repeat('2', 64),
    0.9500,
    '{"signals":["synthetic"]}'::jsonb
);

UPDATE question_enrichment_runs
SET status = 'completed'
WHERE id = '12e00000-0000-4000-8000-000000000001';

SET CONSTRAINTS
    question_enrichment_runs_suggestion_check,
    question_revision_enrichment_suggestions_run_check
IMMEDIATE;
SET CONSTRAINTS
    question_enrichment_runs_suggestion_check,
    question_revision_enrichment_suggestions_run_check
DEFERRED;

UPDATE question_revision_enrichment_suggestions
SET status = 'approved',
    reviewed_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12e00000-0000-4000-8000-000000000002';

DO $$
BEGIN
    BEGIN
        INSERT INTO question_enrichment_runs (
            id, purpose, engine, model_name, model_digest, prompt_version,
            taxonomy_version, status, started_at
        )
        VALUES (
            '12e00000-0000-4000-8000-000000000003',
            'question_bank_enrichment',
            'ollama',
            'synthetic-enricher',
            repeat('3', 64),
            'prompt-v2',
            'taxonomy-v1',
            'running',
            transaction_timestamp()
        );

        INSERT INTO question_revision_enrichment_suggestions (
            id, run_id, question_revision_id, dimension, suggested_key,
            suggested_label, input_sha256, confidence, evidence
        )
        VALUES (
            '12e00000-0000-4000-8000-000000000004',
            '12e00000-0000-4000-8000-000000000003',
            '12d00000-0000-4000-8000-000000000005',
            'knowledge_point',
            'synthetic',
            '合成知識點',
            repeat('4', 64),
            0.8000,
            '{"signals":["synthetic"]}'::jsonb
        );

        UPDATE question_enrichment_runs
        SET status = 'failed', error_code = 'SYNTHETIC_FAILURE'
        WHERE id = '12e00000-0000-4000-8000-000000000003';

        SET CONSTRAINTS
            question_enrichment_runs_suggestion_check,
            question_revision_enrichment_suggestions_run_check
        IMMEDIATE;
        RAISE EXCEPTION 'failed enrichment run 可保留 suggestion';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS
                question_enrichment_runs_suggestion_check,
                question_revision_enrichment_suggestions_run_check
            DEFERRED;
    END;

    BEGIN
        UPDATE question_revision_enrichment_suggestions
        SET evidence = '{"rewritten":true}'::jsonb
        WHERE id = '12e00000-0000-4000-8000-000000000002';
        RAISE EXCEPTION 'enrichment suggestion evidence 可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM question_revision_enrichment_suggestions
        WHERE id = '12e00000-0000-4000-8000-000000000002';
        RAISE EXCEPTION 'enrichment suggestion evidence 可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- Queue one clean, fixed handwriting input. Its low-confidence completed run
-- remains a pending model suggestion until an active human records an
-- answer_review; no trigger changes answer_part_results.
INSERT INTO practice_session_items (
    id, practice_session_id, question_id, question_revision_id,
    question_part_id, position, selection_reason
)
VALUES (
    '12c00000-0000-4000-8000-000000000010',
    '12d00000-0000-4000-8000-000000000009',
    '12d00000-0000-4000-8000-000000000003',
    '12d00000-0000-4000-8000-000000000005',
    '12d00000-0000-4000-8000-000000000007',
    1,
    'fixed'
);

INSERT INTO answer_attempts (
    id, practice_session_item_id, learner_id, attempt_number,
    idempotency_key, overall_result, grading_source
)
VALUES (
    '12c00000-0000-4000-8000-000000000011',
    '12c00000-0000-4000-8000-000000000010',
    '30000000-0000-0000-0000-000000000001',
    1,
    '0012-handwriting-pending-attempt',
    'pending',
    'manual_review'
);

INSERT INTO answer_part_results (
    id, answer_attempt_id, question_part_id, answer_payload,
    initial_result, current_result, grading_source
)
VALUES (
    '12c00000-0000-4000-8000-000000000012',
    '12c00000-0000-4000-8000-000000000011',
    '12d00000-0000-4000-8000-000000000007',
    '{"value":null}'::jsonb,
    'pending',
    'pending',
    'manual_review'
);

INSERT INTO assets (
    id,
    storage_key,
    mime_type,
    byte_size,
    checksum,
    purpose,
    sensitivity,
    scan_status,
    created_by_user_id
)
VALUES (
    '12c00000-0000-4000-8000-000000000001',
    'tests/0012-handwriting-sha256.png',
    'image/png',
    512,
    repeat('a', 64),
    'handwriting',
    'private',
    'clean',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO answer_part_assets (
    answer_part_result_id,
    asset_id,
    asset_role
)
VALUES (
    '12c00000-0000-4000-8000-000000000012',
    '12c00000-0000-4000-8000-000000000001',
    'handwriting'
);

INSERT INTO handwriting_analysis_jobs (
    id,
    answer_part_result_id,
    asset_id,
    question_revision_id,
    question_part_id,
    asset_checksum,
    reference_sha256,
    max_attempts
)
VALUES (
    '12c00000-0000-4000-8000-000000000002',
    '12c00000-0000-4000-8000-000000000012',
    '12c00000-0000-4000-8000-000000000001',
    '12d00000-0000-4000-8000-000000000005',
    '12d00000-0000-4000-8000-000000000007',
    repeat('a', 64),
    repeat('b', 64),
    3
);

DO $$
BEGIN
    BEGIN
        INSERT INTO handwriting_analysis_jobs (
            id, answer_part_result_id, asset_id, question_revision_id,
            question_part_id, asset_checksum, reference_sha256
        )
        VALUES (
            '12c00000-0000-4000-8000-000000000003',
            '12c00000-0000-4000-8000-000000000012',
            '12c00000-0000-4000-8000-000000000001',
            '12d00000-0000-4000-8000-000000000005',
            '12d00000-0000-4000-8000-000000000007',
            repeat('c', 64),
            repeat('b', 64)
        );
        RAISE EXCEPTION 'handwriting job 可接受與 asset 不同的 checksum';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

UPDATE handwriting_analysis_jobs
SET status = 'running',
    attempt_count = 1,
    lease_owner = '0012-worker',
    lease_expires_at = transaction_timestamp() + interval '5 minutes'
WHERE id = '12c00000-0000-4000-8000-000000000002';

INSERT INTO handwriting_analysis_runs (
    id, job_id, attempt_number, status, engine, model_name, model_version,
    model_digest, prompt_version, schema_version, asset_checksum,
    reference_sha256, started_at
)
VALUES (
    '12c00000-0000-4000-8000-000000000004',
    '12c00000-0000-4000-8000-000000000002',
    1,
    'running',
    'ollama',
    'synthetic-model',
    'ollama:test',
    repeat('c', 64),
    'prompt-v1',
    'schema-v1',
    repeat('a', 64),
    repeat('b', 64),
    transaction_timestamp()
);

UPDATE handwriting_analysis_runs
SET status = 'completed',
    recognized_text = 'synthetic recognized answer',
    transcription_confidence = 0.4500,
    legibility = 'uncertain',
    proposed_result = 'pending',
    result_confidence = 0.4000,
    uncertainty_reasons = '["low-confidence"]'::jsonb,
    evidence = '{"signals":["low-confidence"],"warnings":["human-review"]}'::jsonb
WHERE id = '12c00000-0000-4000-8000-000000000004';

UPDATE handwriting_analysis_jobs
SET status = 'completed',
    lease_owner = NULL,
    lease_expires_at = NULL
WHERE id = '12c00000-0000-4000-8000-000000000002';

SET CONSTRAINTS
    handwriting_analysis_jobs_attempt_evidence_check,
    handwriting_analysis_runs_job_check
IMMEDIATE;
SET CONSTRAINTS
    handwriting_analysis_jobs_attempt_evidence_check,
    handwriting_analysis_runs_job_check
DEFERRED;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM answer_part_results
        WHERE id = '12c00000-0000-4000-8000-000000000012'
            AND current_result = 'pending'
    ) THEN
        RAISE EXCEPTION '模型完成不應直接改寫 answer_part_results.current_result';
    END IF;
END;
$$;

INSERT INTO answer_reviews (
    id,
    answer_part_result_id,
    reviewer_user_id,
    result,
    reason,
    handwriting_analysis_run_id
)
VALUES (
    '12c00000-0000-4000-8000-000000000005',
    '12c00000-0000-4000-8000-000000000012',
    'f0000000-0000-4000-8000-000000000002',
    'correct',
    '0012 合成人工覆核',
    '12c00000-0000-4000-8000-000000000004'
);

INSERT INTO analytics_outbox (
    id,
    event_type,
    source_record_id,
    aggregate_key,
    occurred_at
)
VALUES (
    '12c00000-0000-4000-8000-000000000008',
    'answer_reviewed',
    '12c00000-0000-4000-8000-000000000005',
    'answer-part-result:12c00000-0000-4000-8000-000000000012',
    transaction_timestamp()
);

UPDATE answer_attempts
SET overall_result = 'correct'
WHERE id = '12c00000-0000-4000-8000-000000000011';

UPDATE answer_part_results
SET current_result = 'correct',
    grading_source = 'manual_review',
    recognized_text = 'synthetic recognized answer',
    recognition_confidence = 0.450
WHERE id = '12c00000-0000-4000-8000-000000000012';

UPDATE handwriting_analysis_jobs
SET status = 'reviewed',
    reviewed_by_user_id = 'f0000000-0000-4000-8000-000000000002'
WHERE id = '12c00000-0000-4000-8000-000000000002';

SET CONSTRAINTS
    answer_reviews_handwriting_run_check,
    handwriting_analysis_jobs_attempt_evidence_check,
    answer_part_results_review_transaction_check,
    answer_reviews_transaction_check,
    answer_attempts_overall_result_check,
    answer_part_results_attempt_overall_check
IMMEDIATE;
SET CONSTRAINTS
    answer_reviews_handwriting_run_check,
    handwriting_analysis_jobs_attempt_evidence_check,
    answer_part_results_review_transaction_check,
    answer_reviews_transaction_check,
    answer_attempts_overall_result_check,
    answer_part_results_attempt_overall_check
DEFERRED;

DO $$
BEGIN
    IF lerniqa_user_is_system_admin(
        'f0000000-0000-4000-8000-000000000002'
    ) THEN
        RAISE EXCEPTION '手寫人工覆核測試不應依賴 system_admin 角色';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM handwriting_analysis_jobs AS job
        JOIN handwriting_analysis_runs AS analysis_run
            ON analysis_run.job_id = job.id
        JOIN answer_reviews AS review
            ON review.handwriting_analysis_run_id = analysis_run.id
        WHERE job.id = '12c00000-0000-4000-8000-000000000002'
            AND job.status = 'reviewed'
            AND job.reviewed_by_user_id = review.reviewer_user_id
            AND analysis_run.status = 'completed'
            AND analysis_run.proposed_result = 'pending'
            AND review.answer_part_result_id = job.answer_part_result_id
    ) THEN
        RAISE EXCEPTION '手寫 job/run/human review 證據鏈不完整';
    END IF;

    BEGIN
        UPDATE handwriting_analysis_runs
        SET recognized_text = 'rewritten'
        WHERE id = '12c00000-0000-4000-8000-000000000004';
        RAISE EXCEPTION 'handwriting run 可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM handwriting_analysis_runs
        WHERE id = '12c00000-0000-4000-8000-000000000004';
        RAISE EXCEPTION 'handwriting run 可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- A failed attempt can be requeued only with matching append-only run evidence.
INSERT INTO answer_attempts (
    id, practice_session_item_id, learner_id, attempt_number,
    idempotency_key, overall_result, grading_source
)
VALUES (
    '12c00000-0000-4000-8000-000000000013',
    '12c00000-0000-4000-8000-000000000010',
    '30000000-0000-0000-0000-000000000001',
    2,
    '0012-handwriting-retry-attempt',
    'pending',
    'manual_review'
);

INSERT INTO answer_part_results (
    id, answer_attempt_id, question_part_id, answer_payload,
    initial_result, current_result, grading_source
)
VALUES (
    '12c00000-0000-4000-8000-000000000014',
    '12c00000-0000-4000-8000-000000000013',
    '12d00000-0000-4000-8000-000000000007',
    '{"value":null}'::jsonb,
    'pending',
    'pending',
    'manual_review'
);

INSERT INTO answer_part_assets (answer_part_result_id, asset_id, asset_role)
VALUES (
    '12c00000-0000-4000-8000-000000000014',
    '12c00000-0000-4000-8000-000000000001',
    'handwriting'
);

INSERT INTO handwriting_analysis_jobs (
    id, answer_part_result_id, asset_id, question_revision_id,
    question_part_id, asset_checksum, reference_sha256, max_attempts
)
VALUES (
    '12c00000-0000-4000-8000-000000000006',
    '12c00000-0000-4000-8000-000000000014',
    '12c00000-0000-4000-8000-000000000001',
    '12d00000-0000-4000-8000-000000000005',
    '12d00000-0000-4000-8000-000000000007',
    repeat('a', 64),
    repeat('e', 64),
    2
);

UPDATE handwriting_analysis_jobs
SET status = 'running',
    attempt_count = 1,
    lease_owner = '0012-worker',
    lease_expires_at = transaction_timestamp() + interval '5 minutes'
WHERE id = '12c00000-0000-4000-8000-000000000006';

INSERT INTO handwriting_analysis_runs (
    id, job_id, attempt_number, status, engine, model_name, model_version,
    model_digest, prompt_version, schema_version, asset_checksum,
    reference_sha256, started_at
)
VALUES (
    '12c00000-0000-4000-8000-000000000007',
    '12c00000-0000-4000-8000-000000000006',
    1,
    'running',
    'ollama',
    'synthetic-model',
    'ollama:test',
    repeat('f', 64),
    'prompt-v2',
    'schema-v1',
    repeat('a', 64),
    repeat('e', 64),
    transaction_timestamp()
);

UPDATE handwriting_analysis_runs
SET status = 'failed', error_code = 'MODEL_TIMEOUT'
WHERE id = '12c00000-0000-4000-8000-000000000007';

UPDATE handwriting_analysis_jobs
SET status = 'retry',
    available_at = transaction_timestamp() + interval '1 minute',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = 'MODEL_TIMEOUT'
WHERE id = '12c00000-0000-4000-8000-000000000006';

SET CONSTRAINTS
    handwriting_analysis_jobs_attempt_evidence_check,
    handwriting_analysis_runs_job_check
IMMEDIATE;
SET CONSTRAINTS
    handwriting_analysis_jobs_attempt_evidence_check,
    handwriting_analysis_runs_job_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        INSERT INTO handwriting_analysis_jobs (
            id, answer_part_result_id, asset_id, question_revision_id,
            question_part_id, asset_checksum, reference_sha256, max_attempts
        )
        VALUES (
            '12c00000-0000-4000-8000-000000000009',
            '12c00000-0000-4000-8000-000000000014',
            '12c00000-0000-4000-8000-000000000001',
            '12d00000-0000-4000-8000-000000000005',
            '12d00000-0000-4000-8000-000000000007',
            repeat('a', 64),
            repeat('f', 64),
            1
        );

        UPDATE handwriting_analysis_jobs
        SET status = 'running',
            attempt_count = 1,
            lease_owner = '0012-worker',
            lease_expires_at = transaction_timestamp() + interval '5 minutes'
        WHERE id = '12c00000-0000-4000-8000-000000000009';

        INSERT INTO handwriting_analysis_runs (
            id, job_id, attempt_number, status, engine, model_name,
            model_version, model_digest, prompt_version, schema_version,
            asset_checksum, reference_sha256, started_at
        )
        VALUES (
            '12c00000-0000-4000-8000-00000000000a',
            '12c00000-0000-4000-8000-000000000009',
            1,
            'running',
            'ollama',
            'synthetic-model',
            'ollama:test',
            repeat('1', 64),
            'prompt-max-attempt',
            'schema-v1',
            repeat('a', 64),
            repeat('f', 64),
            transaction_timestamp()
        );

        UPDATE handwriting_analysis_runs
        SET status = 'failed', error_code = 'MODEL_TIMEOUT'
        WHERE id = '12c00000-0000-4000-8000-00000000000a';

        UPDATE handwriting_analysis_jobs
        SET status = 'retry',
            available_at = transaction_timestamp() + interval '1 minute',
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error_code = 'MODEL_TIMEOUT'
        WHERE id = '12c00000-0000-4000-8000-000000000009';

        RAISE EXCEPTION '已達 max_attempts 的失敗 job 可重新排隊';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- Every catalog object starts as draft and has a matching same-transaction
-- audit row. No production plan, price, or feature value is seeded here.
INSERT INTO subscription_plans (
    id,
    code,
    name,
    description,
    created_by_user_id,
    updated_by_user_id
)
VALUES (
    '12000000-0000-4000-8000-000000000001',
    'synthetic_plan',
    '0012 合成方案',
    '只供隔離 migration 測試',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000011',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_plan_created',
    'subscription_plan',
    '12000000-0000-4000-8000-000000000001',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '0012-plan-create'
);

INSERT INTO subscription_feature_definitions (
    id,
    feature_key,
    display_name,
    description,
    value_type,
    unit,
    created_by_user_id,
    updated_by_user_id
)
VALUES (
    '12000000-0000-4000-8000-000000000002',
    'monthly_practice_limit',
    '每月練習上限',
    '合成限制定義',
    'integer',
    'sessions',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000021',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_feature_definition_created',
    'subscription_feature_definition',
    '12000000-0000-4000-8000-000000000002',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '0012-feature-create'
);

INSERT INTO subscription_plan_feature_limits (
    id,
    plan_id,
    feature_definition_id,
    included,
    unlimited,
    limit_value,
    created_by_user_id,
    updated_by_user_id
)
VALUES (
    '12000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000002',
    false,
    false,
    NULL,
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000031',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_feature_limit_set',
    'subscription_plan_feature_limit',
    '12000000-0000-4000-8000-000000000003',
    '{"included":false,"unlimited":false,"limit":null,"lockVersion":1}'::jsonb,
    '0012-feature-limit-create'
);

INSERT INTO subscription_plan_prices (
    id,
    plan_id,
    currency,
    amount_minor,
    billing_interval,
    billing_interval_count,
    created_by_user_id,
    updated_by_user_id
)
VALUES (
    '12000000-0000-4000-8000-000000000004',
    '12000000-0000-4000-8000-000000000001',
    'TWD',
    9900,
    'month',
    1,
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    actor_user_id,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000041',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_price_created',
    'subscription_plan_price',
    '12000000-0000-4000-8000-000000000004',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '0012-price-create'
);

SET CONSTRAINTS
    subscription_plans_audit_check,
    subscription_features_audit_check,
    subscription_limits_audit_check,
    subscription_prices_audit_check
IMMEDIATE;
SET CONSTRAINTS
    subscription_plans_audit_check,
    subscription_features_audit_check,
    subscription_limits_audit_check,
    subscription_prices_audit_check
DEFERRED;

DO $$
BEGIN
    BEGIN
        INSERT INTO subscription_plans (
            id,
            code,
            name,
            status,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000101',
            'starts_active',
            '不可直接啟用',
            'active',
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '方案可跳過 draft 直接建立為 active';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO subscription_plan_prices (
            id,
            plan_id,
            currency,
            amount_minor,
            billing_interval,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000102',
            '12000000-0000-4000-8000-000000000001',
            'ZZZ',
            100,
            'month',
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '價格可寫入非 ISO 4217 幣別';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO subscription_plan_feature_limits (
            id,
            plan_id,
            feature_definition_id,
            included,
            unlimited,
            limit_value,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000103',
            '12000000-0000-4000-8000-000000000001',
            '12000000-0000-4000-8000-000000000002',
            false,
            true,
            10,
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION '未包含功能可同時標記 unlimited 與 limit';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO subscription_feature_definitions (
            id,
            feature_key,
            display_name,
            value_type,
            unit,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000106',
            'boolean_with_unit',
            '錯誤布林單位',
            'boolean',
            'sessions',
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION 'boolean 功能可設定 unit';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO subscription_feature_definitions (
            id,
            feature_key,
            display_name,
            value_type,
            unit,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000107',
            'integer_without_unit',
            '錯誤整數單位',
            'integer',
            NULL,
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        RAISE EXCEPTION 'integer 功能可省略 unit';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE subscription_plan_feature_limits
        SET included = true,
            unlimited = false,
            limit_value = NULL,
            lock_version = 2,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000003';

        SET CONSTRAINTS subscription_limits_integrity_check IMMEDIATE;
        RAISE EXCEPTION 'integer 功能可在 included 時沒有 limit 或 unlimited';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subscription_limits_integrity_check DEFERRED;
    END;

    BEGIN
        INSERT INTO subscription_feature_definitions (
            id,
            feature_key,
            display_name,
            value_type,
            unit,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000108',
            'boolean_with_limit',
            '錯誤布林限制',
            'boolean',
            NULL,
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );

        INSERT INTO subscription_plan_feature_limits (
            id,
            plan_id,
            feature_definition_id,
            included,
            unlimited,
            limit_value,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000109',
            '12000000-0000-4000-8000-000000000001',
            '12000000-0000-4000-8000-000000000108',
            true,
            false,
            1,
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );

        SET CONSTRAINTS subscription_limits_integrity_check IMMEDIATE;
        RAISE EXCEPTION 'boolean 功能可設定數值 limit';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subscription_limits_integrity_check DEFERRED;
    END;

    -- The fourth valid limit state is a boolean feature that is included
    -- without either unlimited or a numeric value.
    BEGIN
        INSERT INTO subscription_feature_definitions (
            id,
            feature_key,
            display_name,
            value_type,
            unit,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000201',
            'synthetic_boolean_feature',
            '合成布林功能',
            'boolean',
            NULL,
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );

        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000211',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_feature_definition_created',
            'subscription_feature_definition',
            '12000000-0000-4000-8000-000000000201',
            '{"status":"draft","lockVersion":1}'::jsonb,
            '0012-valid-boolean-feature'
        );

        INSERT INTO subscription_plan_feature_limits (
            id,
            plan_id,
            feature_definition_id,
            included,
            unlimited,
            limit_value,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000202',
            '12000000-0000-4000-8000-000000000001',
            '12000000-0000-4000-8000-000000000201',
            true,
            false,
            NULL,
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );

        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000212',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_feature_limit_set',
            'subscription_plan_feature_limit',
            '12000000-0000-4000-8000-000000000202',
            '{"included":true,"unlimited":false,"limit":null,"lockVersion":1}'::jsonb,
            '0012-valid-boolean-limit'
        );

        SET CONSTRAINTS
            subscription_features_audit_check,
            subscription_limits_audit_check,
            subscription_features_integrity_check,
            subscription_limits_integrity_check
        IMMEDIATE;
        RAISE EXCEPTION 'rollback validated boolean fixture' USING ERRCODE = 'P0001';
    EXCEPTION
        WHEN raise_exception THEN
            SET CONSTRAINTS
                subscription_features_audit_check,
                subscription_limits_audit_check,
                subscription_features_integrity_check,
                subscription_limits_integrity_check
            DEFERRED;
    END;

    BEGIN
        INSERT INTO subscription_plans (
            id,
            code,
            name,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000104',
            'non_admin_plan',
            '非管理員方案',
            'f0000000-0000-0000-0000-000000000002',
            'f0000000-0000-0000-0000-000000000002'
        );
        RAISE EXCEPTION '非 system_admin 可建立方案';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO subscription_plans (
            id,
            code,
            name,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000105',
            'missing_audit',
            '缺少稽核',
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001'
        );
        SET CONSTRAINTS subscription_plans_audit_check IMMEDIATE;
        RAISE EXCEPTION '方案可在沒有相符稽核時提交';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subscription_plans_audit_check DEFERRED;
    END;

    BEGIN
        UPDATE subscription_plans
        SET name = '沒有版本遞增',
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION '方案更新可不遞增 lock_version';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- Activate the feature, plan, limit, and first price through the audited
-- forward-only lifecycle.
UPDATE subscription_feature_definitions
SET status = 'active',
    lock_version = 2,
    updated_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12000000-0000-4000-8000-000000000002';

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    before_data, after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000022',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_feature_definition_activated',
    'subscription_feature_definition',
    '12000000-0000-4000-8000-000000000002',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '{"status":"active","lockVersion":2}'::jsonb,
    '0012-feature-activate'
);

UPDATE subscription_plans
SET status = 'active',
    lock_version = 2,
    updated_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12000000-0000-4000-8000-000000000001';

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    before_data, after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000012',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_plan_activated',
    'subscription_plan',
    '12000000-0000-4000-8000-000000000001',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '{"status":"active","lockVersion":2}'::jsonb,
    '0012-plan-activate'
);

UPDATE subscription_plan_feature_limits
SET included = true,
    limit_value = 100,
    lock_version = 2,
    updated_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12000000-0000-4000-8000-000000000003';

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    before_data, after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000032',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_feature_limit_updated',
    'subscription_plan_feature_limit',
    '12000000-0000-4000-8000-000000000003',
    '{"included":false,"unlimited":false,"limit":null,"lockVersion":1}'::jsonb,
    '{"included":true,"unlimited":false,"limit":100,"lockVersion":2}'::jsonb,
    '0012-feature-limit-update'
);

UPDATE subscription_plan_prices
SET status = 'active',
    effective_from = DATE '2026-10-01',
    lock_version = 2,
    updated_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12000000-0000-4000-8000-000000000004';

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    before_data, after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000042',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_price_activated',
    'subscription_plan_price',
    '12000000-0000-4000-8000-000000000004',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '{"status":"active","lockVersion":2}'::jsonb,
    '0012-price-activate'
);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
BEGIN
    -- The first end date may be appended to an active price, but it becomes
    -- immutable immediately after that audited update.
    BEGIN
        UPDATE subscription_plan_prices
        SET effective_until = DATE '2026-10-31',
            lock_version = 3,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000004';

        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000044',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_updated',
            'subscription_plan_price',
            '12000000-0000-4000-8000-000000000004',
            '{"status":"active","effectiveUntil":null,"lockVersion":2}'::jsonb,
            '{"status":"active","effectiveUntil":"2026-10-31","lockVersion":3}'::jsonb,
            '0012-price-end-date'
        );

        SET CONSTRAINTS subscription_prices_audit_check IMMEDIATE;

        BEGIN
            UPDATE subscription_plan_prices
            SET effective_until = DATE '2026-11-30',
                lock_version = 4,
                updated_by_user_id = '00000000-0000-0000-0000-000000000001'
            WHERE id = '12000000-0000-4000-8000-000000000004';
            RAISE EXCEPTION '已設定的價格結束日可再次改寫'
                USING ERRCODE = 'P0002';
        EXCEPTION
            WHEN check_violation THEN NULL;
        END;

        RAISE EXCEPTION 'rollback validated one-time price end date'
            USING ERRCODE = 'P0001';
    EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
            SET CONSTRAINTS subscription_prices_audit_check DEFERRED;
    END;

    BEGIN
        UPDATE subscription_plan_prices
        SET amount_minor = 10900,
            lock_version = 3,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000004';
        RAISE EXCEPTION '已生效價格可原地改價';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE subscription_feature_definitions
        SET value_type = 'boolean',
            unit = NULL,
            lock_version = 3,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000002';
        RAISE EXCEPTION '已啟用功能可改寫值型別';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM subscription_plan_feature_limits
        WHERE id = '12000000-0000-4000-8000-000000000003';
        RAISE EXCEPTION '方案功能限制可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

-- A changed amount is represented by a separate price row.
INSERT INTO subscription_plan_prices (
    id,
    plan_id,
    currency,
    amount_minor,
    billing_interval,
    billing_interval_count,
    effective_from,
    created_by_user_id,
    updated_by_user_id
)
VALUES (
    '12000000-0000-4000-8000-000000000005',
    '12000000-0000-4000-8000-000000000001',
    'TWD',
    10900,
    'month',
    1,
    DATE '2026-11-01',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000051',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_price_created',
    'subscription_plan_price',
    '12000000-0000-4000-8000-000000000005',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '0012-replacement-price-create'
);

DO $$
BEGIN
    BEGIN
        UPDATE subscription_plan_prices
        SET status = 'active',
            lock_version = 2,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000005';
        RAISE EXCEPTION '同一 billing dimension 可同時有兩個 active 價格';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        UPDATE subscription_plans
        SET status = 'retired',
            lock_version = 3,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000001';

        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000013',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_plan_retired',
            'subscription_plan',
            '12000000-0000-4000-8000-000000000001',
            '{"status":"active","lockVersion":2}'::jsonb,
            '{"status":"retired","lockVersion":3}'::jsonb,
            '0012-invalid-plan-retire'
        );

        SET CONSTRAINTS subscription_plans_integrity_check IMMEDIATE;
        RAISE EXCEPTION '仍有 active 價格的方案可被 retired';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subscription_plans_integrity_check DEFERRED;
    END;

    BEGIN
        UPDATE subscription_feature_definitions
        SET status = 'retired',
            lock_version = 3,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000002';

        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000023',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_feature_definition_retired',
            'subscription_feature_definition',
            '12000000-0000-4000-8000-000000000002',
            '{"status":"active","lockVersion":2}'::jsonb,
            '{"status":"retired","lockVersion":3}'::jsonb,
            '0012-invalid-feature-retire'
        );

        SET CONSTRAINTS subscription_features_integrity_check IMMEDIATE;
        RAISE EXCEPTION 'active 方案仍包含的功能定義可被 retired';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subscription_features_integrity_check DEFERRED;
    END;

    BEGIN
        UPDATE subscription_plans
        SET name = '缺少 update audit',
            lock_version = 3,
            updated_by_user_id = '00000000-0000-0000-0000-000000000001'
        WHERE id = '12000000-0000-4000-8000-000000000001';
        SET CONSTRAINTS subscription_plans_audit_check IMMEDIATE;
        RAISE EXCEPTION '方案更新可缺少同交易 audit';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS subscription_plans_audit_check DEFERRED;
    END;
END;
$$;

-- Retire the old active price before activating the replacement.
UPDATE subscription_plan_prices
SET status = 'retired',
    lock_version = 3,
    updated_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12000000-0000-4000-8000-000000000004';

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    before_data, after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000043',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_price_retired',
    'subscription_plan_price',
    '12000000-0000-4000-8000-000000000004',
    '{"status":"active","lockVersion":2}'::jsonb,
    '{"status":"retired","lockVersion":3}'::jsonb,
    '0012-old-price-retire'
);

UPDATE subscription_plan_prices
SET status = 'active',
    lock_version = 2,
    updated_by_user_id = '00000000-0000-0000-0000-000000000001'
WHERE id = '12000000-0000-4000-8000-000000000005';

INSERT INTO admin_audit_logs (
    id, actor_type, actor_user_id, action, target_type, target_id,
    before_data, after_data, request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000052',
    'user',
    '00000000-0000-0000-0000-000000000001',
    'subscription_price_activated',
    'subscription_plan_price',
    '12000000-0000-4000-8000-000000000005',
    '{"status":"draft","lockVersion":1}'::jsonb,
    '{"status":"active","lockVersion":2}'::jsonb,
    '0012-replacement-price-activate'
);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Complete one durable idempotency receipt against the replacement-price
-- audit. replay_result contains response metadata, never request secrets.
INSERT INTO admin_mutation_receipts (
    id,
    actor_user_id,
    operation,
    idempotency_key,
    request_fingerprint,
    request_id
)
VALUES (
    '12000000-0000-4000-8000-000000000061',
    '00000000-0000-0000-0000-000000000001',
    'subscription_price_status',
    '12000000-0000-4000-8000-000000000101',
    repeat('a', 64),
    '0012-replacement-price-activate'
);

UPDATE admin_mutation_receipts
SET status = 'completed',
    target_type = 'subscription_plan_price',
    target_id = '12000000-0000-4000-8000-000000000005',
    admin_audit_log_id = '12000000-0000-4000-8000-000000000052',
    replay_result = '{"responseStatus":200,"priceId":"12000000-0000-4000-8000-000000000005"}'::jsonb
WHERE id = '12000000-0000-4000-8000-000000000061';

SET CONSTRAINTS admin_mutation_receipts_completion_check IMMEDIATE;
SET CONSTRAINTS admin_mutation_receipts_completion_check DEFERRED;

DO $$
BEGIN
    BEGIN
        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000062',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_status',
            '12000000-0000-4000-8000-000000000101',
            repeat('b', 64),
            '0012-receipt-duplicate'
        );
        RAISE EXCEPTION '同 actor、operation、idempotency key 可建立第二筆 receipt';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000063',
            '00000000-0000-0000-0000-000000000001',
            'subscription_plan_update',
            '12000000-0000-4000-8000-000000000102',
            repeat('c', 64),
            '0012-receipt-pending'
        );
        SET CONSTRAINTS admin_mutation_receipts_completion_check IMMEDIATE;
        RAISE EXCEPTION 'pending receipt 可離開 business transaction';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS admin_mutation_receipts_completion_check DEFERRED;
    END;

    BEGIN
        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id,
            status,
            target_type,
            target_id,
            admin_audit_log_id,
            replay_result,
            completed_at
        )
        VALUES (
            '12000000-0000-4000-8000-000000000064',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_status',
            '12000000-0000-4000-8000-000000000103',
            repeat('d', 64),
            '0012-receipt-direct-complete',
            'completed',
            'subscription_plan_price',
            '12000000-0000-4000-8000-000000000005',
            '12000000-0000-4000-8000-000000000052',
            '{}'::jsonb,
            transaction_timestamp()
        );
        RAISE EXCEPTION 'receipt 可直接以 completed 建立';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE admin_mutation_receipts
        SET replay_result = '{"rewritten":true}'::jsonb
        WHERE id = '12000000-0000-4000-8000-000000000061';
        RAISE EXCEPTION 'completed receipt 可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM admin_mutation_receipts
        WHERE id = '12000000-0000-4000-8000-000000000061';
        RAISE EXCEPTION 'completed receipt 可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000065',
            'f0000000-0000-0000-0000-000000000002',
            'subscription_plan_update',
            '12000000-0000-4000-8000-000000000104',
            repeat('e', 64),
            '0012-non-admin-receipt'
        );
        RAISE EXCEPTION '非 system_admin 可建立 mutation receipt';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000071',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_activated',
            'subscription_plan_price',
            '12000000-0000-4000-8000-000000000005',
            '{"status":"draft","lockVersion":1}'::jsonb,
            '{"status":"active","lockVersion":2}'::jsonb,
            '0012-wrong-audit-target'
        );

        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000066',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_status',
            '12000000-0000-4000-8000-000000000105',
            repeat('f', 64),
            '0012-wrong-audit-target'
        );

        UPDATE admin_mutation_receipts
        SET status = 'completed',
            target_type = 'subscription_plan',
            target_id = '12000000-0000-4000-8000-000000000001',
            admin_audit_log_id = '12000000-0000-4000-8000-000000000071',
            replay_result = '{}'::jsonb
        WHERE id = '12000000-0000-4000-8000-000000000066';

        SET CONSTRAINTS admin_mutation_receipts_completion_check IMMEDIATE;
        RAISE EXCEPTION 'receipt 可引用不同 target 的 audit';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS admin_mutation_receipts_completion_check DEFERRED;
    END;

    BEGIN
        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000072',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_created',
            'subscription_plan_price',
            '12000000-0000-4000-8000-000000000005',
            NULL,
            '{"status":"draft","lockVersion":1}'::jsonb,
            '0012-wrong-audit-action'
        );

        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000067',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_status',
            '12000000-0000-4000-8000-000000000106',
            repeat('1', 64),
            '0012-wrong-audit-action'
        );

        UPDATE admin_mutation_receipts
        SET status = 'completed',
            target_type = 'subscription_plan_price',
            target_id = '12000000-0000-4000-8000-000000000005',
            admin_audit_log_id = '12000000-0000-4000-8000-000000000072',
            replay_result = '{}'::jsonb
        WHERE id = '12000000-0000-4000-8000-000000000067';

        SET CONSTRAINTS admin_mutation_receipts_completion_check IMMEDIATE;
        RAISE EXCEPTION 'receipt operation 可引用錯誤 action 的 audit';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS admin_mutation_receipts_completion_check DEFERRED;
    END;

    BEGIN
        INSERT INTO admin_audit_logs (
            id, actor_type, actor_user_id, action, target_type, target_id,
            before_data, after_data, request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000073',
            'user',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_activated',
            'subscription_plan_price',
            '12000000-0000-4000-8000-000000000005',
            '{"status":"draft","lockVersion":1}'::jsonb,
            '{"status":"active","lockVersion":2}'::jsonb,
            '0012-audit-request-id'
        );

        INSERT INTO admin_mutation_receipts (
            id,
            actor_user_id,
            operation,
            idempotency_key,
            request_fingerprint,
            request_id
        )
        VALUES (
            '12000000-0000-4000-8000-000000000068',
            '00000000-0000-0000-0000-000000000001',
            'subscription_price_status',
            '12000000-0000-4000-8000-000000000107',
            repeat('2', 64),
            '0012-receipt-request-id'
        );

        UPDATE admin_mutation_receipts
        SET status = 'completed',
            target_type = 'subscription_plan_price',
            target_id = '12000000-0000-4000-8000-000000000005',
            admin_audit_log_id = '12000000-0000-4000-8000-000000000073',
            replay_result = '{}'::jsonb
        WHERE id = '12000000-0000-4000-8000-000000000068';

        SET CONSTRAINTS admin_mutation_receipts_completion_check IMMEDIATE;
        RAISE EXCEPTION 'receipt 可引用不同 request_id 的 audit';
    EXCEPTION
        WHEN check_violation THEN
            SET CONSTRAINTS admin_mutation_receipts_completion_check DEFERRED;
    END;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM subscription_plan_prices
        WHERE id = '12000000-0000-4000-8000-000000000004'
            AND status = 'retired'
            AND amount_minor = 9900
            AND lock_version = 3
    ) OR NOT EXISTS (
        SELECT 1
        FROM subscription_plan_prices
        WHERE id = '12000000-0000-4000-8000-000000000005'
            AND status = 'active'
            AND amount_minor = 10900
            AND lock_version = 2
    ) THEN
        RAISE EXCEPTION '價格換版沒有保留舊金額與新價格身份';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_mutation_receipts
        WHERE id = '12000000-0000-4000-8000-000000000061'
            AND status = 'completed'
            AND target_type = 'subscription_plan_price'
            AND target_id = '12000000-0000-4000-8000-000000000005'
            AND replay_result ->> 'responseStatus' = '200'
    ) THEN
        RAISE EXCEPTION '完成 receipt 沒有保存可重播結果與 target/audit 證據';
    END IF;
END;
$$;

-- Keep the migration test database empty so 0012's fail-closed down migration
-- can verify schema parity. Every row above is synthetic and transaction-local.
ROLLBACK;
