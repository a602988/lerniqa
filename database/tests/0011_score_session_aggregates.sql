\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    aggregate_column_count integer;
    score_artifact_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE version = '0011'
            AND name = 'score_session_aggregates'
    ) THEN
        RAISE EXCEPTION '缺少 0011 migration 紀錄';
    END IF;

    IF to_regclass('public.practice_score_receipts') IS NULL THEN
        RAISE EXCEPTION '缺少 score 模式的冪等收據表';
    END IF;

    IF to_regclass('public.asset_object_cleanup_jobs') IS NULL THEN
        RAISE EXCEPTION '缺少解除引用後的實體物件清理工作表';
    END IF;

    SELECT count(*)
    INTO aggregate_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'practice_sessions'
        AND column_name IN (
            'score_total_count',
            'score_answered_count',
            'score_correct_count',
            'score_wrong_count',
            'score_pending_count'
        )
        AND is_nullable = 'NO'
        AND data_type = 'integer';

    IF aggregate_column_count <> 5 THEN
        RAISE EXCEPTION 'score session aggregate 欄位不完整';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
            AND table_name = 'practice_score_receipts'
            AND column_name IN (
                'answer_payload',
                'overall_result',
                'current_result',
                'question_part_id',
                'duration_seconds'
            )
    ) THEN
        RAISE EXCEPTION 'score 冪等收據不可保存答案或逐題判分';
    END IF;

    SELECT count(*)
    INTO score_artifact_count
    FROM answer_attempts AS attempt
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'score';

    IF score_artifact_count <> 0 THEN
        RAISE EXCEPTION '0011 升級後仍保留 score answer_attempts';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM answer_part_results
        WHERE id = 'ba000000-0000-0000-0000-000000000011'
    ) OR EXISTS (
        SELECT 1
        FROM answer_part_assets
        WHERE answer_part_result_id = 'ba000000-0000-0000-0000-000000000011'
    ) OR EXISTS (
        SELECT 1
        FROM answer_reviews
        WHERE id = 'bc000000-0000-0000-0000-000000000011'
    ) OR EXISTS (
        SELECT 1
        FROM learner_practice_queue_items
        WHERE id = 'bd000000-0000-0000-0000-000000000011'
    ) OR EXISTS (
        SELECT 1
        FROM analytics_outbox
        WHERE source_record_id IN (
            'b9000000-0000-0000-0000-000000000011'::uuid,
            'bc000000-0000-0000-0000-000000000011'::uuid
        )
    ) THEN
        RAISE EXCEPTION '0011 升級沒有清除完整的 legacy score detail';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM answer_attempts
        WHERE id = 'b9000000-0000-0000-0000-000000000001'
    ) THEN
        RAISE EXCEPTION '0011 不可刪除非 score 作答紀錄';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM assets AS asset
        WHERE asset.id = 'bb000000-0000-0000-0000-000000000001'
            AND asset.deleted_at IS NULL
            AND NOT EXISTS (
                SELECT 1
                FROM asset_object_cleanup_jobs AS job
                WHERE job.asset_id = asset.id
            )
    ) THEN
        RAISE EXCEPTION '0011 錯誤停用仍由非 score 作答共用的資產';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM assets AS asset
        JOIN asset_object_cleanup_jobs AS job ON job.asset_id = asset.id
        WHERE asset.id = 'bb000000-0000-0000-0000-000000000011'
            AND asset.deleted_at IS NOT NULL
            AND job.reason = 'legacy_score_detail_purge'
            AND job.status = 'pending'
            AND job.last_attempted_at IS NULL
            AND job.object_deleted_at IS NULL
            AND job.last_error IS NULL
    ) THEN
        RAISE EXCEPTION 'score-only private 作答資產未停用並排入物件清理';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_audit_logs
        WHERE action = 'asset_object_cleanup_queued'
            AND target_type = 'asset'
            AND target_id = 'bb000000-0000-0000-0000-000000000011'
            AND after_data ->> 'reason' = 'legacy_score_detail_purge'
            AND after_data ->> 'status' = 'pending'
    ) THEN
        RAISE EXCEPTION 'score-only 資產清理工作缺少不含物件內容的稽核紀錄';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM practice_score_receipts AS receipt
        WHERE receipt.id = 'b9000000-0000-0000-0000-000000000011'
            AND receipt.practice_session_item_id = 'b8000000-0000-0000-0000-000000000011'
            AND receipt.learner_id = '30000000-0000-0000-0000-000000000001'
            AND receipt.idempotency_key = '0011-legacy-score-attempt'
    ) THEN
        RAISE EXCEPTION 'legacy score attempt 未轉為無答案冪等收據';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM practice_sessions
        WHERE id = 'b7000000-0000-0000-0000-000000000011'
            AND score_total_count = 1
            AND score_answered_count = 1
            AND score_correct_count = 0
            AND score_wrong_count = 1
            AND score_pending_count = 0
    ) THEN
        RAISE EXCEPTION 'legacy score aggregate 回填不正確';
    END IF;

    IF (SELECT count(*) FROM learner_question_stats) <> 1
        OR NOT EXISTS (
            SELECT 1
            FROM learner_question_stats AS stats
            JOIN answer_attempts AS attempt
                ON attempt.id = 'b9000000-0000-0000-0000-000000000001'
            WHERE stats.learner_id = attempt.learner_id
                AND stats.question_id = '83000000-0000-0000-0000-000000000001'
                AND stats.total_attempts = 1
                AND stats.graded_attempts = 1
                AND stats.correct_attempts = 0
                AND stats.wrong_attempts = 1
                AND stats.pending_attempts = 0
                AND stats.first_attempted_at = attempt.submitted_at
                AND stats.last_attempted_at = attempt.submitted_at
                AND stats.last_result = 'wrong'
                AND stats.last_revision_id =
                    '84000000-0000-0000-0000-000000000001'
        ) THEN
        RAISE EXCEPTION 'learner_question_stats 未只由 eligible non-score 明細重建';
    END IF;

    IF (SELECT count(*) FROM learner_part_stats) <> 1
        OR NOT EXISTS (
            SELECT 1
            FROM learner_part_stats AS stats
            JOIN answer_attempts AS attempt
                ON attempt.id = 'b9000000-0000-0000-0000-000000000001'
            WHERE stats.learner_id = attempt.learner_id
                AND stats.question_part_id =
                    '85000000-0000-0000-0000-000000000001'
                AND stats.total_attempts = 1
                AND stats.correct_attempts = 0
                AND stats.wrong_attempts = 1
                AND stats.pending_attempts = 0
                AND stats.last_result = 'wrong'
                AND stats.last_attempted_at = attempt.submitted_at
        ) THEN
        RAISE EXCEPTION 'learner_part_stats 未只由 eligible non-score 明細重建';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM question_similarity_groups
        WHERE id = '11000000-0000-4000-8000-000000000091'
    ) THEN
        IF (SELECT count(*) FROM learner_similarity_group_stats) <> 1
            OR NOT EXISTS (
                SELECT 1
                FROM learner_similarity_group_stats
                WHERE learner_id = '30000000-0000-0000-0000-000000000001'
                    AND similarity_group_id =
                        '11000000-0000-4000-8000-000000000091'
                    AND attempted_question_count = 1
                    AND correct_question_count = 0
                    AND wrong_question_count = 1
                    AND NOT is_mastered
            ) THEN
            RAISE EXCEPTION 'learner_similarity_group_stats 未依非 score 最新題目結果重建';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM learner_similarity_group_stats) THEN
        RAISE EXCEPTION '無 confirmed group 時仍保留 legacy similarity 統計';
    END IF;

    IF (SELECT count(*) FROM learner_daily_stats) <> 1
        OR NOT EXISTS (
            SELECT 1
            FROM learner_daily_stats AS stats
            JOIN answer_attempts AS attempt
                ON attempt.id = 'b9000000-0000-0000-0000-000000000001'
            WHERE stats.stat_date =
                    (attempt.submitted_at AT TIME ZONE 'Asia/Taipei')::date
                AND stats.learner_id = attempt.learner_id
                AND stats.session_count = 0
                AND stats.attempt_count = 1
                AND stats.correct_part_count = 0
                AND stats.wrong_part_count = 1
                AND stats.pending_part_count = 0
                AND stats.total_duration_seconds = 18
        ) THEN
        RAISE EXCEPTION 'learner_daily_stats 未依臺北日期及非 score 明細重建';
    END IF;

    IF (SELECT count(*) FROM question_daily_stats) <> 1
        OR NOT EXISTS (
            SELECT 1
            FROM question_daily_stats AS stats
            JOIN answer_attempts AS attempt
                ON attempt.id = 'b9000000-0000-0000-0000-000000000001'
            WHERE stats.stat_date =
                    (attempt.submitted_at AT TIME ZONE 'Asia/Taipei')::date
                AND stats.question_id =
                    '83000000-0000-0000-0000-000000000001'
                AND stats.question_revision_id =
                    '84000000-0000-0000-0000-000000000001'
                AND stats.total_attempts = 1
                AND stats.unique_learner_count = 1
                AND stats.wrong_learner_count = 1
                AND stats.correct_attempts = 0
                AND stats.wrong_attempts = 1
                AND stats.pending_attempts = 0
                AND stats.total_duration_seconds = 18
        ) THEN
        RAISE EXCEPTION 'question_daily_stats 未只由 eligible non-score 明細重建';
    END IF;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO asset_object_cleanup_jobs (
            asset_id,
            reason
        )
        VALUES (
            'bb000000-0000-0000-0000-000000000001',
            'must-not-queue-live-shared-asset'
        );
        RAISE EXCEPTION '仍有效且共用的資產可被排入物件清理';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE asset_object_cleanup_jobs
        SET status = 'completed',
            last_attempted_at = transaction_timestamp(),
            object_deleted_at = transaction_timestamp()
        WHERE asset_id = 'bb000000-0000-0000-0000-000000000011';
        RAISE EXCEPTION 'pending 物件工作可跳過 processing 直接完成';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE assets
        SET checksum = 'rewritten-after-cleanup-queue'
        WHERE id = 'bb000000-0000-0000-0000-000000000011';
        RAISE EXCEPTION '已排入清理的資產證據可被覆寫';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM asset_object_cleanup_jobs
        WHERE asset_id = 'bb000000-0000-0000-0000-000000000011';
        RAISE EXCEPTION '物件清理工作可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    INSERT INTO assets (
        id,
        storage_key,
        mime_type,
        byte_size,
        checksum,
        purpose,
        sensitivity,
        scan_status,
        deleted_at
    )
    VALUES (
        '11000000-0000-4000-8000-00000000009a',
        'tests/0011-cleanup-lifecycle.png',
        'image/png',
        10,
        '0011-cleanup-lifecycle',
        'handwriting',
        'private',
        'clean',
        transaction_timestamp()
    );

    INSERT INTO asset_object_cleanup_jobs (asset_id, reason)
    VALUES (
        '11000000-0000-4000-8000-00000000009a',
        'cleanup_lifecycle_test'
    );

    UPDATE asset_object_cleanup_jobs
    SET status = 'processing',
        last_attempted_at = transaction_timestamp()
    WHERE asset_id = '11000000-0000-4000-8000-00000000009a';

    UPDATE asset_object_cleanup_jobs
    SET status = 'failed',
        last_error = 'synthetic object-store failure'
    WHERE asset_id = '11000000-0000-4000-8000-00000000009a';

    UPDATE asset_object_cleanup_jobs
    SET status = 'processing',
        last_attempted_at = transaction_timestamp(),
        last_error = NULL
    WHERE asset_id = '11000000-0000-4000-8000-00000000009a';

    UPDATE asset_object_cleanup_jobs
    SET status = 'completed',
        object_deleted_at = transaction_timestamp()
    WHERE asset_id = '11000000-0000-4000-8000-00000000009a';

    IF NOT EXISTS (
        SELECT 1
        FROM asset_object_cleanup_jobs
        WHERE asset_id = '11000000-0000-4000-8000-00000000009a'
            AND status = 'completed'
            AND object_deleted_at IS NOT NULL
            AND last_error IS NULL
    ) THEN
        RAISE EXCEPTION '物件清理工作合法重試／完成流程未保存完成證據';
    END IF;

    BEGIN
        UPDATE asset_object_cleanup_jobs
        SET status = 'processing',
            object_deleted_at = NULL
        WHERE asset_id = '11000000-0000-4000-8000-00000000009a';
        RAISE EXCEPTION 'completed 物件清理工作可被重新開啟';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO practice_sessions (
    id,
    learner_id,
    created_by_user_id,
    mode,
    check_mode,
    status
)
VALUES (
    '11000000-0000-4000-8000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'practice',
    'score',
    'active'
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
        '11000000-0000-4000-8000-000000000011',
        '11000000-0000-4000-8000-000000000001',
        '83000000-0000-0000-0000-000000000001',
        '84000000-0000-0000-0000-000000000001',
        '85000000-0000-0000-0000-000000000001',
        0,
        'fixed'
    ),
    (
        '11000000-0000-4000-8000-000000000012',
        '11000000-0000-4000-8000-000000000001',
        '83000000-0000-0000-0000-000000000001',
        '84000000-0000-0000-0000-000000000001',
        '85000000-0000-0000-0000-000000000001',
        1,
        'fixed'
    );

UPDATE practice_sessions
SET score_total_count = 2,
    score_pending_count = 2
WHERE id = '11000000-0000-4000-8000-000000000001';

INSERT INTO practice_score_receipts (
    id,
    practice_session_item_id,
    learner_id,
    idempotency_key
)
VALUES (
    '11000000-0000-4000-8000-000000000021',
    '11000000-0000-4000-8000-000000000011',
    '30000000-0000-0000-0000-000000000001',
    '0011-score-receipt-one'
);

UPDATE practice_sessions
SET score_answered_count = 1,
    score_wrong_count = 1,
    score_pending_count = 1
WHERE id = '11000000-0000-4000-8000-000000000001';

SET CONSTRAINTS
    practice_sessions_score_aggregate_consistency,
    practice_session_items_score_aggregate_consistency,
    practice_score_receipts_aggregate_consistency
IMMEDIATE;

SET CONSTRAINTS
    practice_sessions_score_aggregate_consistency,
    practice_session_items_score_aggregate_consistency,
    practice_score_receipts_aggregate_consistency
DEFERRED;

DO $$
BEGIN
    BEGIN
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
            '11000000-0000-4000-8000-000000000031',
            '11000000-0000-4000-8000-000000000011',
            '30000000-0000-0000-0000-000000000001',
            1,
            '0011-score-detail-bypass',
            'wrong',
            'automatic'
        );
        RAISE EXCEPTION 'score session 可繞過 store 寫入 answer_attempt';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO analytics_outbox (
            id,
            event_type,
            source_record_id,
            aggregate_key,
            occurred_at
        )
        VALUES (
            '11000000-0000-4000-8000-000000000032',
            'attempt_submitted',
            '11000000-0000-4000-8000-000000000021',
            'learner:30000000-0000-0000-0000-000000000001',
            transaction_timestamp()
        );
        RAISE EXCEPTION 'score receipt 可建立 attempt_submitted outbox';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_sessions
        SET check_mode = 'score',
            score_total_count = 1,
            score_pending_count = 1
        WHERE id = 'b7000000-0000-0000-0000-000000000001';
        RAISE EXCEPTION '已有逐題作答的 session 可改成 score';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO practice_score_receipts (
            id,
            practice_session_item_id,
            learner_id,
            idempotency_key
        )
        VALUES (
            '11000000-0000-4000-8000-000000000022',
            'b8000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0000-000000000001',
            '0011-non-score-receipt'
        );
        RAISE EXCEPTION '非 score session 可寫入 score receipt';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_sessions
        SET score_correct_count = 2,
            score_wrong_count = 1,
            score_pending_count = 0
        WHERE id = '11000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'score aggregate 可超過已作答數';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE practice_sessions
        SET status = 'completed',
            completed_at = transaction_timestamp()
        WHERE id = '11000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'score session 可在尚有未作答 item 時提前完成';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        DELETE FROM practice_score_receipts
        WHERE id = '11000000-0000-4000-8000-000000000021';
        RAISE EXCEPTION 'score receipt 可被刪除';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO practice_score_receipts (
    id,
    practice_session_item_id,
    learner_id,
    idempotency_key
)
VALUES (
    '11000000-0000-4000-8000-000000000023',
    '11000000-0000-4000-8000-000000000012',
    '30000000-0000-0000-0000-000000000001',
    '0011-score-receipt-two'
);

UPDATE practice_sessions
SET score_answered_count = 2,
    score_correct_count = 1,
    score_pending_count = 0,
    status = 'completed',
    completed_at = transaction_timestamp()
WHERE id = '11000000-0000-4000-8000-000000000001';

SET CONSTRAINTS
    practice_sessions_score_aggregate_consistency,
    practice_session_items_score_aggregate_consistency,
    practice_score_receipts_aggregate_consistency
IMMEDIATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM practice_sessions
        WHERE id = '11000000-0000-4000-8000-000000000001'
            AND status = 'completed'
            AND score_total_count = 2
            AND score_answered_count = 2
            AND score_correct_count = 1
            AND score_wrong_count = 1
            AND score_pending_count = 0
    ) THEN
        RAISE EXCEPTION 'score aggregate 的完成狀態不正確';
    END IF;
END;
$$;

COMMIT;
