BEGIN;

-- Score mode is intentionally aggregate-only. Block concurrent practice writes
-- while legacy per-question rows are converted and then removed.
LOCK TABLE
    assets,
    learners,
    source_documents,
    question_revision_sources,
    question_content_blocks,
    practice_sessions,
    practice_session_items,
    answer_attempts,
    answer_part_results,
    answer_part_assets,
    answer_reviews,
    learner_practice_queue_items,
    practice_session_item_origins,
    analytics_outbox,
    question_similarity_groups,
    question_similarity_memberships,
    learner_question_stats,
    learner_part_stats,
    learner_similarity_group_stats,
    learner_daily_stats,
    question_daily_stats,
    admin_audit_logs
IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE practice_sessions
ADD COLUMN score_total_count integer NOT NULL DEFAULT 0,
ADD COLUMN score_answered_count integer NOT NULL DEFAULT 0,
ADD COLUMN score_correct_count integer NOT NULL DEFAULT 0,
ADD COLUMN score_wrong_count integer NOT NULL DEFAULT 0,
ADD COLUMN score_pending_count integer NOT NULL DEFAULT 0;

-- A database migration can revoke every application reference to a private
-- answer object, but it cannot truthfully claim that an external object store
-- deleted the bytes. Queue that second phase explicitly. object_deleted_at is
-- the worker's durable proof marker and is never populated by this migration.
CREATE TABLE asset_object_cleanup_jobs (
    asset_id uuid PRIMARY KEY REFERENCES assets(id),
    reason varchar(60) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempted_at timestamptz,
    object_deleted_at timestamptz,
    last_error text,
    CONSTRAINT asset_object_cleanup_jobs_reason_check
        CHECK (btrim(reason) <> ''),
    CONSTRAINT asset_object_cleanup_jobs_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT asset_object_cleanup_jobs_state_check
        CHECK (
            (
                status = 'pending'
                AND last_attempted_at IS NULL
                AND object_deleted_at IS NULL
                AND last_error IS NULL
            )
            OR (
                status = 'processing'
                AND last_attempted_at IS NOT NULL
                AND last_attempted_at >= requested_at
                AND object_deleted_at IS NULL
                AND last_error IS NULL
            )
            OR (
                status = 'completed'
                AND last_attempted_at IS NOT NULL
                AND last_attempted_at >= requested_at
                AND object_deleted_at IS NOT NULL
                AND object_deleted_at >= last_attempted_at
                AND last_error IS NULL
            )
            OR (
                status = 'failed'
                AND last_attempted_at IS NOT NULL
                AND last_attempted_at >= requested_at
                AND object_deleted_at IS NULL
                AND btrim(last_error) <> ''
            )
        )
);

CREATE INDEX asset_object_cleanup_jobs_status_index
    ON asset_object_cleanup_jobs(status, requested_at);

CREATE FUNCTION lerniqa_validate_asset_object_cleanup_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '資產物件清理工作不可刪除'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending'
            OR NEW.last_attempted_at IS NOT NULL
            OR NEW.object_deleted_at IS NOT NULL
            OR NEW.last_error IS NOT NULL THEN
            RAISE EXCEPTION '資產物件清理工作必須從 pending 建立'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
            OR NEW.reason IS DISTINCT FROM OLD.reason
            OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
            RAISE EXCEPTION '資產物件清理工作的身份與原因不可覆寫'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status = 'completed'
            OR NOT (
                (OLD.status = 'pending' AND NEW.status = 'processing')
                OR (
                    OLD.status = 'processing'
                    AND NEW.status IN ('completed', 'failed')
                )
                OR (OLD.status = 'failed' AND NEW.status = 'processing')
            ) THEN
            RAISE EXCEPTION '資產物件清理工作狀態流程不合法'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM assets AS asset
        WHERE asset.id = NEW.asset_id
            AND asset.purpose IN ('handwriting', 'answer_attachment')
            AND asset.sensitivity = 'private'
            AND asset.deleted_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION '物件清理工作只能引用已解除引用並邏輯刪除的 private 作答資產'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER asset_object_cleanup_jobs_history_check
BEFORE INSERT OR UPDATE OR DELETE ON asset_object_cleanup_jobs
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_asset_object_cleanup_job();

CREATE FUNCTION lerniqa_protect_asset_pending_object_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM asset_object_cleanup_jobs
        WHERE asset_id = OLD.id
    ) AND (
        NEW.storage_key IS DISTINCT FROM OLD.storage_key
        OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
        OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
        OR NEW.width IS DISTINCT FROM OLD.width
        OR NEW.height IS DISTINCT FROM OLD.height
        OR NEW.checksum IS DISTINCT FROM OLD.checksum
        OR NEW.purpose IS DISTINCT FROM OLD.purpose
        OR NEW.sensitivity IS DISTINCT FROM OLD.sensitivity
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    ) THEN
        RAISE EXCEPTION '已排入物件清理的資產證據與刪除狀態不可覆寫'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER assets_pending_object_cleanup_immutable
BEFORE UPDATE OF
    storage_key,
    mime_type,
    byte_size,
    width,
    height,
    checksum,
    purpose,
    sensitivity,
    created_by_user_id,
    created_at,
    deleted_at
ON assets
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_asset_pending_object_cleanup();

-- A rollback/re-apply keeps the append-only audit row even though 0010 has no
-- cleanup queue table. Restore any still-logically-deleted migration jobs.
INSERT INTO asset_object_cleanup_jobs (
    asset_id,
    reason,
    requested_at
)
SELECT
    audit.target_id,
    'legacy_score_detail_purge',
    audit.created_at
FROM admin_audit_logs AS audit
JOIN assets AS asset ON asset.id = audit.target_id
WHERE audit.action = 'asset_object_cleanup_queued'
    AND audit.target_type = 'asset'
    AND audit.after_data ->> 'reason' = 'legacy_score_detail_purge'
    AND asset.deleted_at IS NOT NULL
ON CONFLICT (asset_id) DO NOTHING;

CREATE TABLE practice_score_receipts (
    id uuid PRIMARY KEY,
    practice_session_item_id uuid NOT NULL REFERENCES practice_session_items(id),
    learner_id uuid NOT NULL REFERENCES learners(id),
    idempotency_key varchar(120) NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT practice_score_receipts_item_unique
        UNIQUE (practice_session_item_id),
    CONSTRAINT practice_score_receipts_learner_idempotency_unique
        UNIQUE (learner_id, idempotency_key),
    CONSTRAINT practice_score_receipts_idempotency_key_check
        CHECK (btrim(idempotency_key) <> '')
);

CREATE FUNCTION lerniqa_validate_score_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
    FROM practice_session_items AS item
    JOIN practice_sessions AS session ON session.id = item.practice_session_id
    WHERE item.id = NEW.practice_session_item_id
        AND session.learner_id = NEW.learner_id
        AND session.check_mode = 'score'
    FOR SHARE OF item, session;

    IF NOT FOUND THEN
        RAISE EXCEPTION '計分模式收據必須屬於同一學習者的 score session item'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER practice_score_receipts_provenance_check
BEFORE INSERT OR UPDATE OF practice_session_item_id, learner_id
ON practice_score_receipts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_score_receipt();

CREATE FUNCTION lerniqa_reject_score_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '計分模式收據是冪等操作紀錄，不可修改或刪除'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER practice_score_receipts_append_only
BEFORE UPDATE OR DELETE ON practice_score_receipts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_score_receipt_mutation();

CREATE FUNCTION lerniqa_reject_score_answer_detail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM practice_session_items AS item
        JOIN practice_sessions AS session ON session.id = item.practice_session_id
        WHERE item.id = NEW.practice_session_item_id
            AND session.check_mode = 'score'
        FOR SHARE OF item, session
    ) THEN
        RAISE EXCEPTION 'score session 不可保存逐題 answer_attempt'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER answer_attempts_score_detail_check
BEFORE INSERT OR UPDATE OF practice_session_item_id ON answer_attempts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_score_answer_detail();

CREATE FUNCTION lerniqa_reject_score_receipt_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.event_type = 'attempt_submitted'
        AND EXISTS (
            SELECT 1
            FROM practice_score_receipts
            WHERE id = NEW.source_record_id
        ) THEN
        RAISE EXCEPTION 'score 收據不可建立逐題 attempt_submitted outbox'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER analytics_outbox_score_receipt_check
BEFORE INSERT OR UPDATE OF event_type, source_record_id ON analytics_outbox
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_score_receipt_outbox();

-- One legacy attempt per item becomes an answer-free idempotency receipt. The
-- historical attempt id remains the stable receipt id returned on a retry.
INSERT INTO practice_score_receipts (
    id,
    practice_session_item_id,
    learner_id,
    idempotency_key,
    submitted_at
)
SELECT
    latest.id,
    item.id,
    session.learner_id,
    latest.idempotency_key,
    latest.submitted_at
FROM practice_sessions AS session
JOIN practice_session_items AS item ON item.practice_session_id = session.id
JOIN LATERAL (
    SELECT attempt.id, attempt.idempotency_key, attempt.submitted_at
    FROM answer_attempts AS attempt
    WHERE attempt.practice_session_item_id = item.id
    ORDER BY attempt.attempt_number DESC, attempt.id DESC
    LIMIT 1
) AS latest ON true
WHERE session.check_mode = 'score';

WITH score_counts AS (
    SELECT
        session.id,
        count(item.id)::integer AS total_count,
        count(item.id) FILTER (WHERE latest.id IS NOT NULL)::integer AS answered_count,
        count(item.id) FILTER (WHERE latest.overall_result = 'correct')::integer AS correct_count,
        count(item.id) FILTER (WHERE latest.overall_result = 'wrong')::integer AS wrong_count
    FROM practice_sessions AS session
    LEFT JOIN practice_session_items AS item
        ON item.practice_session_id = session.id
    LEFT JOIN LATERAL (
        SELECT attempt.id, attempt.overall_result
        FROM answer_attempts AS attempt
        WHERE attempt.practice_session_item_id = item.id
        ORDER BY attempt.attempt_number DESC, attempt.id DESC
        LIMIT 1
    ) AS latest ON true
    WHERE session.check_mode = 'score'
    GROUP BY session.id
)
UPDATE practice_sessions AS session
SET score_total_count = score_counts.total_count,
    score_answered_count = score_counts.answered_count,
    score_correct_count = score_counts.correct_count,
    score_wrong_count = score_counts.wrong_count,
    score_pending_count = score_counts.total_count
        - score_counts.correct_count
        - score_counts.wrong_count
FROM score_counts
WHERE session.id = score_counts.id;

-- A completed score session promises one answer-free receipt for every item.
-- Stop atomically when legacy detail is incomplete instead of preserving a
-- completed status whose aggregate cannot be proven from durable receipts.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM practice_sessions AS session
        WHERE session.check_mode = 'score'
            AND session.status = 'completed'
            AND session.score_answered_count <> session.score_total_count
    ) THEN
        RAISE EXCEPTION 'completed legacy score session is missing one or more answer attempts'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

-- Capture private answer assets before removing their score links. Only an
-- asset with no surviving reference of any supported kind may be disabled and
-- queued for physical object deletion. Shared assets stay live.
CREATE TEMPORARY TABLE lerniqa_0011_score_only_assets (
    asset_id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO lerniqa_0011_score_only_assets (asset_id)
SELECT DISTINCT asset.id
FROM assets AS asset
JOIN answer_part_assets AS score_answer_asset
    ON score_answer_asset.asset_id = asset.id
JOIN answer_part_results AS score_result
    ON score_result.id = score_answer_asset.answer_part_result_id
JOIN answer_attempts AS score_attempt
    ON score_attempt.id = score_result.answer_attempt_id
JOIN practice_session_items AS score_item
    ON score_item.id = score_attempt.practice_session_item_id
JOIN practice_sessions AS score_session
    ON score_session.id = score_item.practice_session_id
WHERE score_session.check_mode = 'score'
    AND asset.purpose IN ('handwriting', 'answer_attachment')
    AND asset.sensitivity = 'private'
    AND NOT EXISTS (
        SELECT 1
        FROM learners AS learner
        WHERE learner.avatar_asset_id = asset.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM source_documents AS document
        WHERE document.asset_id = asset.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM question_revision_sources AS revision_source
        WHERE revision_source.crop_asset_id = asset.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM question_content_blocks AS block
        WHERE block.asset_id = asset.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM answer_part_assets AS retained_answer_asset
        JOIN answer_part_results AS retained_result
            ON retained_result.id = retained_answer_asset.answer_part_result_id
        JOIN answer_attempts AS retained_attempt
            ON retained_attempt.id = retained_result.answer_attempt_id
        JOIN practice_session_items AS retained_item
            ON retained_item.id = retained_attempt.practice_session_item_id
        JOIN practice_sessions AS retained_session
            ON retained_session.id = retained_item.practice_session_id
        WHERE retained_answer_asset.asset_id = asset.id
            AND retained_session.check_mode <> 'score'
    );

-- The append-only guards protect normal product writes. This one-time privacy
-- migration deliberately removes legacy score detail, then reinstalls them.
DROP TRIGGER practice_session_item_origins_append_only
    ON practice_session_item_origins;
DROP TRIGGER answer_reviews_append_only ON answer_reviews;
DROP TRIGGER answer_part_results_history_check ON answer_part_results;
DROP TRIGGER answer_attempts_history_check ON answer_attempts;

DELETE FROM analytics_outbox AS event
WHERE event.source_record_id IN (
    SELECT attempt.id
    FROM answer_attempts AS attempt
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'score'
    UNION
    SELECT review.id
    FROM answer_reviews AS review
    JOIN answer_part_results AS result
        ON result.id = review.answer_part_result_id
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'score'
);

DELETE FROM practice_session_item_origins AS origin
USING answer_part_results AS result,
    answer_attempts AS attempt,
    practice_session_items AS source_item,
    practice_sessions AS source_session
WHERE origin.source_answer_part_result_id = result.id
    AND result.answer_attempt_id = attempt.id
    AND attempt.practice_session_item_id = source_item.id
    AND source_item.practice_session_id = source_session.id
    AND source_session.check_mode = 'score';

DELETE FROM learner_practice_queue_items AS queue
USING answer_part_results AS result,
    answer_attempts AS attempt,
    practice_session_items AS item,
    practice_sessions AS session
WHERE queue.source_answer_part_result_id = result.id
    AND result.answer_attempt_id = attempt.id
    AND attempt.practice_session_item_id = item.id
    AND item.practice_session_id = session.id
    AND session.check_mode = 'score';

DELETE FROM answer_reviews AS review
USING answer_part_results AS result,
    answer_attempts AS attempt,
    practice_session_items AS item,
    practice_sessions AS session
WHERE review.answer_part_result_id = result.id
    AND result.answer_attempt_id = attempt.id
    AND attempt.practice_session_item_id = item.id
    AND item.practice_session_id = session.id
    AND session.check_mode = 'score';

DELETE FROM answer_part_assets AS answer_asset
USING answer_part_results AS result,
    answer_attempts AS attempt,
    practice_session_items AS item,
    practice_sessions AS session
WHERE answer_asset.answer_part_result_id = result.id
    AND result.answer_attempt_id = attempt.id
    AND attempt.practice_session_item_id = item.id
    AND item.practice_session_id = session.id
    AND session.check_mode = 'score';

UPDATE assets AS asset
SET deleted_at = transaction_timestamp()
WHERE asset.id IN (
    SELECT asset_id
    FROM lerniqa_0011_score_only_assets
)
    AND asset.deleted_at IS NULL;

INSERT INTO asset_object_cleanup_jobs (
    asset_id,
    reason
)
SELECT
    asset_id,
    'legacy_score_detail_purge'
FROM lerniqa_0011_score_only_assets
ON CONFLICT (asset_id) DO NOTHING;

INSERT INTO admin_audit_logs (
    id,
    actor_type,
    action,
    target_type,
    target_id,
    after_data,
    request_id
)
SELECT
    md5('0011-score-asset-cleanup:' || asset_id::text)::uuid,
    'system_job',
    'asset_object_cleanup_queued',
    'asset',
    asset_id,
    jsonb_build_object(
        'reason', 'legacy_score_detail_purge',
        'status', 'pending',
        'objectDeleted', false
    ),
    'migration-0011-score-asset-cleanup:' || asset_id::text
FROM lerniqa_0011_score_only_assets
ON CONFLICT (id) DO NOTHING;

DELETE FROM answer_part_results AS result
USING answer_attempts AS attempt,
    practice_session_items AS item,
    practice_sessions AS session
WHERE result.answer_attempt_id = attempt.id
    AND attempt.practice_session_item_id = item.id
    AND item.practice_session_id = session.id
    AND session.check_mode = 'score';

DELETE FROM answer_attempts AS attempt
USING practice_session_items AS item,
    practice_sessions AS session
WHERE attempt.practice_session_item_id = item.id
    AND item.practice_session_id = session.id
    AND session.check_mode = 'score';

-- These five tables are rebuildable projections. Recompute them from eligible
-- non-score immutable detail instead of subtracting legacy score values, which
-- could preserve per-question information or compound an already-stale row.
DELETE FROM learner_question_stats;

WITH eligible_attempts AS (
    SELECT
        attempt.id,
        attempt.learner_id,
        attempt.attempt_number,
        attempt.overall_result,
        attempt.submitted_at,
        item.question_id,
        item.question_revision_id
    FROM answer_attempts AS attempt
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'instant'
        OR (
            session.check_mode = 'complete'
            AND session.status = 'completed'
        )
),
question_totals AS (
    SELECT
        learner_id,
        question_id,
        count(*)::integer AS total_attempts,
        count(*) FILTER (
            WHERE overall_result IN ('correct', 'wrong')
        )::integer AS graded_attempts,
        count(*) FILTER (WHERE overall_result = 'correct')::integer
            AS correct_attempts,
        count(*) FILTER (WHERE overall_result = 'wrong')::integer
            AS wrong_attempts,
        count(*) FILTER (WHERE overall_result = 'pending')::integer
            AS pending_attempts,
        min(submitted_at) AS first_attempted_at,
        max(submitted_at) AS last_attempted_at
    FROM eligible_attempts
    GROUP BY learner_id, question_id
),
latest_question_attempt AS (
    SELECT DISTINCT ON (learner_id, question_id)
        learner_id,
        question_id,
        overall_result,
        question_revision_id
    FROM eligible_attempts
    ORDER BY
        learner_id,
        question_id,
        submitted_at DESC,
        attempt_number DESC,
        id DESC
)
INSERT INTO learner_question_stats (
    learner_id,
    question_id,
    total_attempts,
    graded_attempts,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    first_attempted_at,
    last_attempted_at,
    last_result,
    last_revision_id,
    updated_at
)
SELECT
    totals.learner_id,
    totals.question_id,
    totals.total_attempts,
    totals.graded_attempts,
    totals.correct_attempts,
    totals.wrong_attempts,
    totals.pending_attempts,
    totals.first_attempted_at,
    totals.last_attempted_at,
    latest.overall_result,
    latest.question_revision_id,
    transaction_timestamp()
FROM question_totals AS totals
JOIN latest_question_attempt AS latest
    ON latest.learner_id = totals.learner_id
    AND latest.question_id = totals.question_id;

DELETE FROM learner_part_stats;

WITH eligible_part_results AS (
    SELECT
        result.id,
        result.question_part_id,
        result.current_result,
        attempt.learner_id,
        attempt.attempt_number,
        attempt.submitted_at
    FROM answer_part_results AS result
    JOIN answer_attempts AS attempt ON attempt.id = result.answer_attempt_id
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'instant'
        OR (
            session.check_mode = 'complete'
            AND session.status = 'completed'
        )
),
part_totals AS (
    SELECT
        learner_id,
        question_part_id,
        count(*)::integer AS total_attempts,
        count(*) FILTER (WHERE current_result = 'correct')::integer
            AS correct_attempts,
        count(*) FILTER (WHERE current_result = 'wrong')::integer
            AS wrong_attempts,
        count(*) FILTER (WHERE current_result = 'pending')::integer
            AS pending_attempts,
        max(submitted_at) AS last_attempted_at
    FROM eligible_part_results
    GROUP BY learner_id, question_part_id
),
latest_part_result AS (
    SELECT DISTINCT ON (learner_id, question_part_id)
        learner_id,
        question_part_id,
        current_result
    FROM eligible_part_results
    ORDER BY
        learner_id,
        question_part_id,
        submitted_at DESC,
        attempt_number DESC,
        id DESC
)
INSERT INTO learner_part_stats (
    learner_id,
    question_part_id,
    total_attempts,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    last_result,
    last_attempted_at,
    updated_at
)
SELECT
    totals.learner_id,
    totals.question_part_id,
    totals.total_attempts,
    totals.correct_attempts,
    totals.wrong_attempts,
    totals.pending_attempts,
    latest.current_result,
    totals.last_attempted_at,
    transaction_timestamp()
FROM part_totals AS totals
JOIN latest_part_result AS latest
    ON latest.learner_id = totals.learner_id
    AND latest.question_part_id = totals.question_part_id;

DELETE FROM learner_similarity_group_stats;

WITH eligible_attempts AS (
    SELECT
        attempt.id,
        attempt.learner_id,
        attempt.attempt_number,
        attempt.overall_result,
        attempt.submitted_at,
        item.question_id
    FROM answer_attempts AS attempt
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'instant'
        OR (
            session.check_mode = 'complete'
            AND session.status = 'completed'
        )
),
latest_question_attempt AS (
    SELECT DISTINCT ON (learner_id, question_id)
        learner_id,
        question_id,
        overall_result
    FROM eligible_attempts
    ORDER BY
        learner_id,
        question_id,
        submitted_at DESC,
        attempt_number DESC,
        id DESC
),
group_totals AS (
    SELECT
        latest.learner_id,
        membership.similarity_group_id,
        count(*)::integer AS attempted_question_count,
        count(*) FILTER (WHERE latest.overall_result = 'correct')::integer
            AS correct_question_count,
        count(*) FILTER (WHERE latest.overall_result = 'wrong')::integer
            AS wrong_question_count
    FROM latest_question_attempt AS latest
    JOIN question_similarity_memberships AS membership
        ON membership.question_id = latest.question_id
        AND membership.status = 'confirmed'
    JOIN question_similarity_groups AS similarity_group
        ON similarity_group.id = membership.similarity_group_id
        AND similarity_group.status = 'confirmed'
    GROUP BY latest.learner_id, membership.similarity_group_id
)
INSERT INTO learner_similarity_group_stats (
    learner_id,
    similarity_group_id,
    attempted_question_count,
    correct_question_count,
    wrong_question_count,
    is_mastered,
    updated_at
)
SELECT
    learner_id,
    similarity_group_id,
    attempted_question_count,
    correct_question_count,
    wrong_question_count,
    correct_question_count >= 2,
    transaction_timestamp()
FROM group_totals;

DELETE FROM learner_daily_stats;

WITH eligible_attempts AS (
    SELECT
        attempt.id,
        attempt.learner_id,
        attempt.duration_seconds,
        attempt.submitted_at,
        (attempt.submitted_at AT TIME ZONE 'Asia/Taipei')::date AS stat_date
    FROM answer_attempts AS attempt
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'instant'
        OR (
            session.check_mode = 'complete'
            AND session.status = 'completed'
        )
),
attempt_daily AS (
    SELECT
        stat_date,
        learner_id,
        count(*)::integer AS attempt_count,
        coalesce(sum(duration_seconds), 0)::bigint AS total_duration_seconds
    FROM eligible_attempts
    GROUP BY stat_date, learner_id
),
part_daily AS (
    SELECT
        attempt.stat_date,
        attempt.learner_id,
        count(*) FILTER (WHERE result.current_result = 'correct')::integer
            AS correct_part_count,
        count(*) FILTER (WHERE result.current_result = 'wrong')::integer
            AS wrong_part_count,
        count(*) FILTER (WHERE result.current_result = 'pending')::integer
            AS pending_part_count
    FROM eligible_attempts AS attempt
    JOIN answer_part_results AS result
        ON result.answer_attempt_id = attempt.id
    GROUP BY attempt.stat_date, attempt.learner_id
),
session_daily AS (
    SELECT
        (session.completed_at AT TIME ZONE 'Asia/Taipei')::date AS stat_date,
        session.learner_id,
        count(*)::integer AS session_count
    FROM practice_sessions AS session
    WHERE session.check_mode IN ('instant', 'complete')
        AND session.status = 'completed'
    GROUP BY
        (session.completed_at AT TIME ZONE 'Asia/Taipei')::date,
        session.learner_id
),
daily_keys AS (
    SELECT stat_date, learner_id FROM attempt_daily
    UNION
    SELECT stat_date, learner_id FROM session_daily
)
INSERT INTO learner_daily_stats (
    stat_date,
    learner_id,
    session_count,
    attempt_count,
    correct_part_count,
    wrong_part_count,
    pending_part_count,
    total_duration_seconds,
    updated_at
)
SELECT
    key.stat_date,
    key.learner_id,
    coalesce(session.session_count, 0),
    coalesce(attempt.attempt_count, 0),
    coalesce(part.correct_part_count, 0),
    coalesce(part.wrong_part_count, 0),
    coalesce(part.pending_part_count, 0),
    coalesce(attempt.total_duration_seconds, 0),
    transaction_timestamp()
FROM daily_keys AS key
LEFT JOIN session_daily AS session
    ON session.stat_date = key.stat_date
    AND session.learner_id = key.learner_id
LEFT JOIN attempt_daily AS attempt
    ON attempt.stat_date = key.stat_date
    AND attempt.learner_id = key.learner_id
LEFT JOIN part_daily AS part
    ON part.stat_date = key.stat_date
    AND part.learner_id = key.learner_id;

DELETE FROM question_daily_stats;

WITH eligible_attempts AS (
    SELECT
        attempt.learner_id,
        attempt.overall_result,
        attempt.duration_seconds,
        (attempt.submitted_at AT TIME ZONE 'Asia/Taipei')::date AS stat_date,
        item.question_id,
        item.question_revision_id
    FROM answer_attempts AS attempt
    JOIN practice_session_items AS item
        ON item.id = attempt.practice_session_item_id
    JOIN practice_sessions AS session
        ON session.id = item.practice_session_id
    WHERE session.check_mode = 'instant'
        OR (
            session.check_mode = 'complete'
            AND session.status = 'completed'
        )
)
INSERT INTO question_daily_stats (
    stat_date,
    question_id,
    question_revision_id,
    total_attempts,
    unique_learner_count,
    wrong_learner_count,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    total_duration_seconds,
    updated_at
)
SELECT
    stat_date,
    question_id,
    question_revision_id,
    count(*)::integer,
    count(DISTINCT learner_id)::integer,
    count(DISTINCT learner_id) FILTER (
        WHERE overall_result = 'wrong'
    )::integer,
    count(*) FILTER (WHERE overall_result = 'correct')::integer,
    count(*) FILTER (WHERE overall_result = 'wrong')::integer,
    count(*) FILTER (WHERE overall_result = 'pending')::integer,
    coalesce(sum(duration_seconds), 0)::bigint,
    transaction_timestamp()
FROM eligible_attempts
GROUP BY stat_date, question_id, question_revision_id;

CREATE TRIGGER practice_session_item_origins_append_only
BEFORE UPDATE OR DELETE ON practice_session_item_origins
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_origin_mutation();

CREATE TRIGGER answer_reviews_append_only
BEFORE UPDATE OR DELETE ON answer_reviews
FOR EACH ROW
EXECUTE FUNCTION lerniqa_reject_append_only_mutation();

CREATE TRIGGER answer_part_results_history_check
BEFORE INSERT OR UPDATE OR DELETE ON answer_part_results
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_part_result_history();

CREATE TRIGGER answer_attempts_history_check
BEFORE UPDATE OR DELETE ON answer_attempts
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_answer_attempt_history();

ALTER TABLE practice_sessions
ADD CONSTRAINT practice_sessions_score_aggregate_check
CHECK (
    score_total_count >= 0
    AND score_answered_count >= 0
    AND score_correct_count >= 0
    AND score_wrong_count >= 0
    AND score_pending_count >= 0
    AND score_answered_count <= score_total_count
    AND score_correct_count + score_wrong_count <= score_answered_count
    AND score_correct_count + score_wrong_count + score_pending_count
        = score_total_count
    AND (
        check_mode <> 'score'
        OR status <> 'completed'
        OR score_answered_count = score_total_count
    )
    AND (
        check_mode = 'score'
        OR (
            score_total_count = 0
            AND score_answered_count = 0
            AND score_correct_count = 0
            AND score_wrong_count = 0
            AND score_pending_count = 0
        )
    )
);

CREATE FUNCTION lerniqa_assert_score_session_aggregate(candidate_session_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    session_row practice_sessions%ROWTYPE;
    item_count integer;
    receipt_count integer;
BEGIN
    IF candidate_session_id IS NULL THEN
        RETURN;
    END IF;

    SELECT *
    INTO session_row
    FROM practice_sessions
    WHERE id = candidate_session_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT
        count(item.id)::integer,
        count(receipt.id)::integer
    INTO item_count, receipt_count
    FROM practice_session_items AS item
    LEFT JOIN practice_score_receipts AS receipt
        ON receipt.practice_session_item_id = item.id
    WHERE item.practice_session_id = candidate_session_id;

    IF session_row.check_mode = 'score' THEN
        IF session_row.score_total_count IS DISTINCT FROM item_count
            OR session_row.score_answered_count IS DISTINCT FROM receipt_count
            OR (
                session_row.status = 'completed'
                AND receipt_count IS DISTINCT FROM item_count
            ) THEN
            RAISE EXCEPTION 'score session aggregate 必須與 item 與冪等收據數量一致'
                USING ERRCODE = '23514';
        END IF;
    ELSIF receipt_count <> 0 THEN
        RAISE EXCEPTION '非 score session 不可持有計分模式收據'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION lerniqa_validate_score_session_aggregate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    previous_session_id uuid;
    current_session_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'practice_sessions' THEN
        IF TG_OP <> 'INSERT' THEN
            previous_session_id := OLD.id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_session_id := NEW.id;
        END IF;
    ELSIF TG_TABLE_NAME = 'practice_session_items' THEN
        IF TG_OP <> 'INSERT' THEN
            previous_session_id := OLD.practice_session_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current_session_id := NEW.practice_session_id;
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN
            SELECT item.practice_session_id
            INTO previous_session_id
            FROM practice_session_items AS item
            WHERE item.id = OLD.practice_session_item_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            SELECT item.practice_session_id
            INTO current_session_id
            FROM practice_session_items AS item
            WHERE item.id = NEW.practice_session_item_id;
        END IF;
    END IF;

    PERFORM lerniqa_assert_score_session_aggregate(previous_session_id);
    IF current_session_id IS DISTINCT FROM previous_session_id THEN
        PERFORM lerniqa_assert_score_session_aggregate(current_session_id);
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER practice_sessions_score_aggregate_consistency
AFTER INSERT OR UPDATE OF
    check_mode,
    status,
    score_total_count,
    score_answered_count,
    score_correct_count,
    score_wrong_count,
    score_pending_count
ON practice_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_score_session_aggregate();

CREATE CONSTRAINT TRIGGER practice_session_items_score_aggregate_consistency
AFTER INSERT OR UPDATE OF practice_session_id OR DELETE
ON practice_session_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_score_session_aggregate();

CREATE CONSTRAINT TRIGGER practice_score_receipts_aggregate_consistency
AFTER INSERT OR UPDATE OF practice_session_item_id OR DELETE
ON practice_score_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION lerniqa_validate_score_session_aggregate();

CREATE FUNCTION lerniqa_protect_score_receipt_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_TABLE_NAME = 'practice_sessions' THEN
        IF NEW.check_mode = 'score'
            AND NEW.check_mode IS DISTINCT FROM OLD.check_mode
            AND EXISTS (
                SELECT 1
                FROM practice_session_items AS item
                JOIN answer_attempts AS attempt
                    ON attempt.practice_session_item_id = item.id
                WHERE item.practice_session_id = OLD.id
            ) THEN
            RAISE EXCEPTION '已有逐題作答的練習不可改成 score 模式'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM practice_session_items AS item
            JOIN practice_score_receipts AS receipt
                ON receipt.practice_session_item_id = item.id
            WHERE item.practice_session_id = OLD.id
        ) AND (
            NEW.learner_id IS DISTINCT FROM OLD.learner_id
            OR NEW.check_mode IS DISTINCT FROM OLD.check_mode
        ) THEN
            RAISE EXCEPTION '已有 score 收據的練習不可改換學習者或檢查模式'
                USING ERRCODE = '23514';
        END IF;
    ELSIF EXISTS (
        SELECT 1
        FROM practice_score_receipts
        WHERE practice_session_item_id = OLD.id
    ) AND (
        NEW.practice_session_id IS DISTINCT FROM OLD.practice_session_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
        OR NEW.question_revision_id IS DISTINCT FROM OLD.question_revision_id
        OR NEW.question_part_id IS DISTINCT FROM OLD.question_part_id
    ) THEN
        RAISE EXCEPTION '已有 score 收據的練習項目不可改寫題目或工作階段'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER practice_sessions_score_receipt_immutable
BEFORE UPDATE OF learner_id, check_mode ON practice_sessions
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_score_receipt_provenance();

CREATE TRIGGER practice_session_items_score_receipt_immutable
BEFORE UPDATE OF
    practice_session_id,
    question_id,
    question_revision_id,
    question_part_id
ON practice_session_items
FOR EACH ROW
EXECUTE FUNCTION lerniqa_protect_score_receipt_provenance();

INSERT INTO schema_migrations (version, name)
VALUES ('0011', 'score_session_aggregates');

COMMIT;
