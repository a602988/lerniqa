\set ON_ERROR_STOP on

BEGIN;

-- This fixture is applied only to an isolated clone at the exact 0010 schema.
-- It represents projections that already consumed the legacy score attempt and
-- must be replaced, not adjusted, by 0011.
INSERT INTO question_similarity_groups (
    id,
    name,
    status,
    created_source,
    created_by_user_id,
    confirmed_by_user_id,
    confirmed_at
)
VALUES (
    '11000000-0000-4000-8000-000000000091',
    '0011 legacy score rebuild fixture',
    'confirmed',
    'manual',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    transaction_timestamp()
);

INSERT INTO question_similarity_memberships (
    similarity_group_id,
    question_id,
    based_on_revision_id,
    status,
    reviewed_by_user_id,
    reviewed_at
)
VALUES (
    '11000000-0000-4000-8000-000000000091',
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    'confirmed',
    '00000000-0000-0000-0000-000000000001',
    transaction_timestamp()
);

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
    last_revision_id
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    2,
    2,
    0,
    2,
    0,
    '2026-01-15 01:00:00+00'::timestamptz,
    '2026-01-15 01:05:00+00'::timestamptz,
    'wrong',
    '84000000-0000-0000-0000-000000000001'
);

INSERT INTO learner_part_stats (
    learner_id,
    question_part_id,
    total_attempts,
    correct_attempts,
    wrong_attempts,
    pending_attempts,
    last_result,
    last_attempted_at
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '85000000-0000-0000-0000-000000000001',
    2,
    0,
    2,
    0,
    'wrong',
    '2026-01-15 01:05:00+00'::timestamptz
);

INSERT INTO learner_similarity_group_stats (
    learner_id,
    similarity_group_id,
    attempted_question_count,
    correct_question_count,
    wrong_question_count,
    is_mastered
)
VALUES (
    '30000000-0000-0000-0000-000000000001',
    '11000000-0000-4000-8000-000000000091',
    2,
    2,
    0,
    true
);

INSERT INTO learner_daily_stats (
    stat_date,
    learner_id,
    session_count,
    attempt_count,
    correct_part_count,
    wrong_part_count,
    pending_part_count,
    total_duration_seconds
)
VALUES (
    '2026-01-15'::date,
    '30000000-0000-0000-0000-000000000001',
    1,
    2,
    0,
    2,
    0,
    29
);

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
    total_duration_seconds
)
VALUES (
    '2026-01-15'::date,
    '83000000-0000-0000-0000-000000000001',
    '84000000-0000-0000-0000-000000000001',
    2,
    1,
    1,
    0,
    2,
    0,
    29
);

INSERT INTO analytics_outbox (
    id,
    event_type,
    source_record_id,
    aggregate_key,
    occurred_at
)
VALUES (
    '11000000-0000-4000-8000-000000000092',
    'attempt_submitted',
    'b9000000-0000-0000-0000-000000000011',
    'learner:30000000-0000-0000-0000-000000000001',
    '2026-01-15 01:05:00+00'::timestamptz
);

COMMIT;
