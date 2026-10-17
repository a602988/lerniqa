import type { QueryResultRow } from "pg";

import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    ADMIN_REPORT_TIME_ZONE,
    REPORT_MISSING_VALUE_LABEL,
    REPORT_NO_DATA_LABEL,
    REPORT_PRIVACY_SUPPRESSED_LABEL,
    calculateReportRatio,
    createTaipeiDateRange,
    formatReportDimensionValue,
    getPrivacySuppressionLabel,
    type ReportBucketGranularity,
} from "./admin-reporting.ts";
import {
    ACCOUNT_STATUSES,
    GRANTED_ROLES,
    QUESTION_ORIGINS,
    QUESTION_REVIEW_STATUSES,
    QUESTION_REVISION_STATUSES,
    QUESTION_STATUSES,
    AdminApiError,
    type AccountStatus,
    type GrantedRole,
    type QuestionOrigin,
    type QuestionReviewStatus,
    type QuestionRevisionStatus,
    type QuestionStatus,
} from "./admin-types.ts";

export const ADMIN_REPORT_PRIVACY_POLICY_KEY = "admin_platform_reporting" as const;

const GRANULARITIES = new Set<ReportBucketGranularity>(["day", "week", "month"]);
const ACCOUNT_STATUS_SET = new Set<string>(ACCOUNT_STATUSES);
const GRANTED_ROLE_SET = new Set<string>(GRANTED_ROLES);
const QUESTION_ORIGIN_SET = new Set<string>(QUESTION_ORIGINS);
const QUESTION_STATUS_SET = new Set<string>(QUESTION_STATUSES);
const REVISION_STATUS_SET = new Set<string>(QUESTION_REVISION_STATUSES);
const REVIEW_STATUS_SET = new Set<string>(QUESTION_REVIEW_STATUSES);

const IMPORT_BATCH_STATUSES = [
    "draft",
    "recognizing",
    "review",
    "confirmed",
    "failed",
    "cancelled",
] as const;
const IMPORT_ITEM_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
const SOURCE_DOCUMENT_STATUSES = ["uploaded", "processing", "ready", "failed", "archived"] as const;
const CURRENT_REVISION_STATES = [...QUESTION_REVISION_STATUSES, "missing"] as const;
const REVIEW_COVERAGE_STATES = ["reviewed", "unreviewed"] as const;
const SOURCE_COVERAGE_STATES = [
    "with_primary_source",
    "without_primary_source",
    "without_source",
] as const;

const IMPORT_BATCH_STATUS_SET = new Set<string>(IMPORT_BATCH_STATUSES);
const IMPORT_ITEM_REVIEW_STATUS_SET = new Set<string>(IMPORT_ITEM_REVIEW_STATUSES);
const SOURCE_DOCUMENT_STATUS_SET = new Set<string>(SOURCE_DOCUMENT_STATUSES);
const CURRENT_REVISION_STATE_SET = new Set<string>(CURRENT_REVISION_STATES);
const REVIEW_COVERAGE_STATE_SET = new Set<string>(REVIEW_COVERAGE_STATES);
const SOURCE_COVERAGE_STATE_SET = new Set<string>(SOURCE_COVERAGE_STATES);
const AUTOMATIC_ANSWER_COMPLETENESS_SET = new Set<string>(["complete", "incomplete"]);

const POLICY_REQUIRED_REASON = "尚未啟用管理報表的統計隱私政策。";

export type AdminReportDatasetState =
    | "available"
    | "no_data"
    | "suppressed"
    | "policy_required";

export type AdminReportMetric =
    | { state: "available"; value: number }
    | { state: "no_data"; value: null; reason: typeof REPORT_NO_DATA_LABEL }
    | { state: "suppressed"; value: null; reason: typeof REPORT_PRIVACY_SUPPRESSED_LABEL }
    | { state: "policy_required"; value: null; reason: string };

export interface AdminReportQuery {
    startLocalDate: string;
    endLocalDate: string;
    granularity: ReportBucketGranularity;
}

export interface AdminReportDistributionRow<Key extends string = string> {
    key: Key;
    label: string;
    count: AdminReportMetric;
}

export interface AdminReportDistribution<Key extends string = string> {
    state: AdminReportDatasetState;
    rows: Array<AdminReportDistributionRow<Key>>;
}

export interface AdminReportSnapshot {
    generatedAt: string;
    range: {
        timeZone: typeof ADMIN_REPORT_TIME_ZONE;
        granularity: ReportBucketGranularity;
        startLocalDate: string;
        endLocalDate: string;
        startInclusive: string;
        endExclusive: string;
    };
    privacyPolicy:
        | {
            state: "configured";
            policyKey: typeof ADMIN_REPORT_PRIVACY_POLICY_KEY;
            minimumDistinctLearners: number;
            effectiveAt: string;
        }
        | {
            state: "not_configured";
            policyKey: typeof ADMIN_REPORT_PRIVACY_POLICY_KEY;
            minimumDistinctLearners: null;
            effectiveAt: null;
        };
    registrations: {
        state: "available" | "no_data";
        total: AdminReportMetric;
        trend: Array<{
            bucketKey: string;
            count: AdminReportMetric;
        }>;
    };
    accounts: {
        statuses: AdminReportDistribution<AccountStatus>;
        activeRoles: AdminReportDistribution<GrantedRole>;
        roleCountingNote: string;
    };
    learners: {
        grades: AdminReportDistribution;
        region: {
            state: "not_collected";
            sourceField: null;
            rows: [];
            reason: string;
        };
    };
    practice: {
        completion: {
            completedInPeriod: AdminReportMetric;
            startedCohortSessions: AdminReportMetric;
            completedStartedCohortSessions: AdminReportMetric;
            startedCohortCompletionRate: AdminReportMetric;
        };
        nonScoreActivity: {
            activeLearners: AdminReportMetric;
            attempts: AdminReportMetric;
            results: AdminReportDistribution<"correct" | "wrong" | "pending">;
        };
        scoreActivity: {
            activeLearners: AdminReportMetric;
            submittedItems: AdminReportMetric;
            completedSessions: AdminReportMetric;
            totalItems: AdminReportMetric;
            answeredItems: AdminReportMetric;
            correctItems: AdminReportMetric;
            wrongItems: AdminReportMetric;
            pendingItems: AdminReportMetric;
        };
    };
    questionQuality: {
        state: "available" | "no_data";
        originAndStatus: Array<{
            origin: QuestionOrigin;
            status: QuestionStatus;
            count: AdminReportMetric;
        }>;
        currentRevisionStates: AdminReportDistribution;
        revisionStatuses: AdminReportDistribution<QuestionRevisionStatus>;
        revisionReviewCoverage: AdminReportDistribution<"reviewed" | "unreviewed">;
        latestReviewDecisions: AdminReportDistribution<QuestionReviewStatus>;
        importBatchStatuses: AdminReportDistribution<(typeof IMPORT_BATCH_STATUSES)[number]>;
        importItemReviewStatuses: AdminReportDistribution<(typeof IMPORT_ITEM_REVIEW_STATUSES)[number]>;
        sourceDocumentStatuses: AdminReportDistribution<(typeof SOURCE_DOCUMENT_STATUSES)[number]>;
        currentRevisionSourceCoverage: AdminReportDistribution<(typeof SOURCE_COVERAGE_STATES)[number]>;
        automaticAnswerCompleteness: {
            totalParts: AdminReportMetric;
            completeParts: AdminReportMetric;
            incompleteParts: AdminReportMetric;
            rate: AdminReportMetric;
        };
    };
}

interface PrivacyPolicyRow extends QueryResultRow {
    snapshot_at: Date | string;
    min_distinct_learners: number | string | null;
    effective_at: Date | string | null;
}

interface RegistrationTrendRow extends QueryResultRow {
    bucket_key: string;
    count_value: number | string;
}

interface SnapshotDistributionRow extends QueryResultRow {
    category: "account_status" | "active_role";
    dimension_key: string;
    count_value: number | string;
}

interface LearnerDistributionRow extends QueryResultRow {
    dimension_kind: "grade" | "not_enrolled" | "missing";
    dimension_key: string | null;
    dimension_label: string | null;
    learner_count: number | string;
}

interface PracticeReportRow extends QueryResultRow {
    completed_in_period: number | string;
    completed_in_period_learners: number | string;
    started_cohort_sessions: number | string;
    completed_started_cohort_sessions: number | string;
    started_cohort_learners: number | string;
    non_score_active_learners: number | string;
    non_score_attempts: number | string;
    correct_attempts: number | string;
    correct_learners: number | string;
    wrong_attempts: number | string;
    wrong_learners: number | string;
    pending_attempts: number | string;
    pending_learners: number | string;
    score_active_learners: number | string;
    score_submitted_items: number | string;
    completed_score_sessions: number | string;
    completed_score_learners: number | string;
    score_total_items: number | string;
    score_answered_items: number | string;
    score_correct_items: number | string;
    score_correct_learners: number | string;
    score_wrong_items: number | string;
    score_wrong_learners: number | string;
    score_pending_items: number | string;
    score_pending_learners: number | string;
}

type QuestionQualityCategory =
    | "question_origin_status"
    | "current_revision_state"
    | "revision_status"
    | "revision_review_coverage"
    | "latest_review_decision"
    | "import_batch_status"
    | "import_item_review_status"
    | "source_document_status"
    | "current_revision_source_coverage"
    | "automatic_answer_completeness";

interface QuestionQualityRow extends QueryResultRow {
    category: QuestionQualityCategory;
    dimension_key: string;
    secondary_key: string | null;
    count_value: number | string;
}

const PRIVACY_POLICY_SQL = `
    SELECT
        clock.snapshot_at,
        policy.min_distinct_learners,
        policy.effective_at
    FROM (SELECT transaction_timestamp() AS snapshot_at) AS clock
    LEFT JOIN LATERAL (
        SELECT
            min_distinct_learners,
            effective_at
        FROM analytics_privacy_policies
        WHERE policy_key = $1
            AND aggregation_scope = 'platform'
            AND status = 'active'
            AND effective_at <= clock.snapshot_at
        ORDER BY effective_at DESC, created_at DESC
        LIMIT 1
    ) AS policy ON true
`;

const REGISTRATION_TREND_SQL = `
    WITH report_range AS (
        SELECT
            $1::timestamptz AT TIME ZONE 'Asia/Taipei' AS start_local,
            ($2::timestamptz - interval '1 microsecond')
                AT TIME ZONE 'Asia/Taipei' AS end_local
    ),
    buckets AS (
        SELECT generate_series(
            date_trunc($3::text, report_range.start_local),
            date_trunc($3::text, report_range.end_local),
            CASE $3::text
                WHEN 'day' THEN interval '1 day'
                WHEN 'week' THEN interval '1 week'
                WHEN 'month' THEN interval '1 month'
            END
        ) AS bucket_start
        FROM report_range
    ),
    registration_counts AS (
        SELECT
            date_trunc(
                $3::text,
                app_user.created_at AT TIME ZONE 'Asia/Taipei'
            ) AS bucket_start,
            count(*) AS count_value
        FROM users AS app_user
        WHERE app_user.created_at >= $1
            AND app_user.created_at < $2
        GROUP BY 1
    )
    SELECT
        CASE $3::text
            WHEN 'day' THEN to_char(
                bucket.bucket_start,
                'YYYY-MM-DD'
            )
            WHEN 'week' THEN to_char(
                bucket.bucket_start,
                'YYYY-MM-DD'
            )
            WHEN 'month' THEN to_char(
                bucket.bucket_start,
                'YYYY-MM'
            )
        END AS bucket_key,
        coalesce(registration.count_value, 0) AS count_value
    FROM buckets AS bucket
    LEFT JOIN registration_counts AS registration
        ON registration.bucket_start = bucket.bucket_start
    ORDER BY bucket.bucket_start ASC
`;

const ACCOUNT_SNAPSHOT_SQL = `
    SELECT
        distribution.category,
        distribution.dimension_key,
        distribution.count_value
    FROM (
        SELECT
            'account_status'::text AS category,
            app_user.status::text AS dimension_key,
            count(*) AS count_value
        FROM users AS app_user
        GROUP BY app_user.status

        UNION ALL

        SELECT
            'active_role'::text AS category,
            role.role::text AS dimension_key,
            count(*) AS count_value
        FROM user_roles AS role
        WHERE role.revoked_at IS NULL
        GROUP BY role.role
    ) AS distribution
    ORDER BY distribution.category, distribution.dimension_key
`;

const LEARNER_DISTRIBUTION_SQL = `
    SELECT
        CASE
            WHEN learner.education_status = 'not_enrolled' THEN 'not_enrolled'
            WHEN grade.id IS NULL THEN 'missing'
            ELSE 'grade'
        END AS dimension_kind,
        CASE
            WHEN learner.education_status = 'not_enrolled' THEN 'not_enrolled'
            ELSE grade.code
        END AS dimension_key,
        CASE
            WHEN learner.education_status = 'not_enrolled' THEN '不在學'
            ELSE grade.name
        END AS dimension_label,
        count(DISTINCT learner.id) AS learner_count
    FROM learners AS learner
    LEFT JOIN grades AS grade ON grade.id = learner.grade_id
    WHERE learner.status = 'active'
    GROUP BY
        learner.education_status,
        grade.id,
        grade.code,
        grade.name,
        grade.sort_order
    ORDER BY
        CASE WHEN learner.education_status = 'not_enrolled' THEN 1 ELSE 0 END,
        grade.sort_order NULLS LAST,
        dimension_key
`;

const PRACTICE_REPORT_SQL = `
    WITH completed_in_period AS (
        SELECT
            count(*) AS session_count,
            count(DISTINCT session.learner_id) AS learner_count
        FROM practice_sessions AS session
        WHERE session.status = 'completed'
            AND session.completed_at >= $1
            AND session.completed_at < $2
    ),
    started_cohort AS (
        SELECT
            count(*) AS session_count,
            count(*) FILTER (WHERE session.status = 'completed') AS completed_count,
            count(DISTINCT session.learner_id) AS learner_count
        FROM practice_sessions AS session
        WHERE session.started_at >= $1
            AND session.started_at < $2
    ),
    non_score_attempts AS (
        SELECT
            attempt.learner_id,
            attempt.overall_result
        FROM answer_attempts AS attempt
        JOIN practice_session_items AS item
            ON item.id = attempt.practice_session_item_id
        JOIN practice_sessions AS session
            ON session.id = item.practice_session_id
        WHERE session.check_mode <> 'score'
            AND attempt.submitted_at >= $1
            AND attempt.submitted_at < $2
    ),
    score_receipts_in_period AS (
        SELECT
            count(*) AS submitted_item_count,
            count(DISTINCT receipt.learner_id) AS learner_count
        FROM practice_score_receipts AS receipt
        WHERE receipt.submitted_at >= $1
            AND receipt.submitted_at < $2
    ),
    completed_score_sessions AS (
        SELECT
            count(*) AS session_count,
            count(DISTINCT session.learner_id) AS learner_count,
            count(DISTINCT session.learner_id) FILTER (
                WHERE session.score_correct_count > 0
            ) AS correct_learner_count,
            count(DISTINCT session.learner_id) FILTER (
                WHERE session.score_wrong_count > 0
            ) AS wrong_learner_count,
            count(DISTINCT session.learner_id) FILTER (
                WHERE session.score_pending_count > 0
            ) AS pending_learner_count,
            coalesce(sum(session.score_total_count), 0) AS total_item_count,
            coalesce(sum(session.score_answered_count), 0) AS answered_item_count,
            coalesce(sum(session.score_correct_count), 0) AS correct_item_count,
            coalesce(sum(session.score_wrong_count), 0) AS wrong_item_count,
            coalesce(sum(session.score_pending_count), 0) AS pending_item_count
        FROM practice_sessions AS session
        WHERE session.check_mode = 'score'
            AND session.status = 'completed'
            AND session.completed_at >= $1
            AND session.completed_at < $2
    )
    SELECT
        completed.session_count AS completed_in_period,
        completed.learner_count AS completed_in_period_learners,
        cohort.session_count AS started_cohort_sessions,
        cohort.completed_count AS completed_started_cohort_sessions,
        cohort.learner_count AS started_cohort_learners,
        count(DISTINCT attempt.learner_id) AS non_score_active_learners,
        count(attempt.learner_id) AS non_score_attempts,
        count(attempt.learner_id) FILTER (
            WHERE attempt.overall_result = 'correct'
        ) AS correct_attempts,
        count(DISTINCT attempt.learner_id) FILTER (
            WHERE attempt.overall_result = 'correct'
        ) AS correct_learners,
        count(attempt.learner_id) FILTER (
            WHERE attempt.overall_result = 'wrong'
        ) AS wrong_attempts,
        count(DISTINCT attempt.learner_id) FILTER (
            WHERE attempt.overall_result = 'wrong'
        ) AS wrong_learners,
        count(attempt.learner_id) FILTER (
            WHERE attempt.overall_result = 'pending'
        ) AS pending_attempts,
        count(DISTINCT attempt.learner_id) FILTER (
            WHERE attempt.overall_result = 'pending'
        ) AS pending_learners,
        score_receipts.learner_count AS score_active_learners,
        score_receipts.submitted_item_count AS score_submitted_items,
        score_sessions.session_count AS completed_score_sessions,
        score_sessions.learner_count AS completed_score_learners,
        score_sessions.total_item_count AS score_total_items,
        score_sessions.answered_item_count AS score_answered_items,
        score_sessions.correct_item_count AS score_correct_items,
        score_sessions.correct_learner_count AS score_correct_learners,
        score_sessions.wrong_item_count AS score_wrong_items,
        score_sessions.wrong_learner_count AS score_wrong_learners,
        score_sessions.pending_item_count AS score_pending_items,
        score_sessions.pending_learner_count AS score_pending_learners
    FROM completed_in_period AS completed
    CROSS JOIN started_cohort AS cohort
    CROSS JOIN score_receipts_in_period AS score_receipts
    CROSS JOIN completed_score_sessions AS score_sessions
    LEFT JOIN non_score_attempts AS attempt ON true
    GROUP BY
        completed.session_count,
        completed.learner_count,
        cohort.session_count,
        cohort.completed_count,
        cohort.learner_count,
        score_receipts.learner_count,
        score_receipts.submitted_item_count,
        score_sessions.session_count,
        score_sessions.learner_count,
        score_sessions.total_item_count,
        score_sessions.answered_item_count,
        score_sessions.correct_item_count,
        score_sessions.correct_learner_count,
        score_sessions.wrong_item_count,
        score_sessions.wrong_learner_count,
        score_sessions.pending_item_count,
        score_sessions.pending_learner_count
`;

const QUESTION_QUALITY_SQL = `
    WITH latest_review AS (
        SELECT DISTINCT ON (review.question_revision_id)
            review.question_revision_id,
            review.decision
        FROM question_revision_reviews AS review
        ORDER BY review.question_revision_id, review.created_at DESC, review.id DESC
    ),
    current_revision_source_quality AS (
        SELECT
            question.id AS question_id,
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM question_revision_sources AS source
                    WHERE source.question_revision_id = question.current_revision_id
                        AND source.is_primary = true
                ) THEN 'with_primary_source'
                WHEN EXISTS (
                    SELECT 1
                    FROM question_revision_sources AS source
                    WHERE source.question_revision_id = question.current_revision_id
                ) THEN 'without_primary_source'
                ELSE 'without_source'
            END AS source_coverage
        FROM questions AS question
        WHERE question.current_revision_id IS NOT NULL
    ),
    quality_distribution AS (
        SELECT
            'question_origin_status'::text AS category,
            question.origin::text AS dimension_key,
            question.status::text AS secondary_key,
            count(*) AS count_value
        FROM questions AS question
        GROUP BY question.origin, question.status

        UNION ALL

        SELECT
            'current_revision_state'::text,
            coalesce(revision.status, 'missing')::text,
            NULL::text,
            count(*)
        FROM questions AS question
        LEFT JOIN question_revisions AS revision
            ON revision.id = question.current_revision_id
        GROUP BY coalesce(revision.status, 'missing')

        UNION ALL

        SELECT
            'revision_status'::text,
            revision.status::text,
            NULL::text,
            count(*)
        FROM question_revisions AS revision
        GROUP BY revision.status

        UNION ALL

        SELECT
            'revision_review_coverage'::text,
            CASE WHEN latest.question_revision_id IS NULL THEN 'unreviewed' ELSE 'reviewed' END,
            NULL::text,
            count(*)
        FROM question_revisions AS revision
        LEFT JOIN latest_review AS latest
            ON latest.question_revision_id = revision.id
        GROUP BY CASE WHEN latest.question_revision_id IS NULL THEN 'unreviewed' ELSE 'reviewed' END

        UNION ALL

        SELECT
            'latest_review_decision'::text,
            latest.decision::text,
            NULL::text,
            count(*)
        FROM latest_review AS latest
        GROUP BY latest.decision

        UNION ALL

        SELECT
            'import_batch_status'::text,
            batch.status::text,
            NULL::text,
            count(*)
        FROM import_batches AS batch
        GROUP BY batch.status

        UNION ALL

        SELECT
            'import_item_review_status'::text,
            item.review_status::text,
            NULL::text,
            count(*)
        FROM import_items AS item
        GROUP BY item.review_status

        UNION ALL

        SELECT
            'source_document_status'::text,
            document.status::text,
            NULL::text,
            count(*)
        FROM source_documents AS document
        GROUP BY document.status

        UNION ALL

        SELECT
            'current_revision_source_coverage'::text,
            source_quality.source_coverage,
            NULL::text,
            count(*)
        FROM current_revision_source_quality AS source_quality
        GROUP BY source_quality.source_coverage

        UNION ALL

        SELECT
            'automatic_answer_completeness'::text,
            CASE
                WHEN lerniqa_automatic_part_has_complete_answer(
                    part.id,
                    part.answer_mode
                ) THEN 'complete'
                ELSE 'incomplete'
            END,
            NULL::text,
            count(*)
        FROM question_revisions AS revision
        JOIN question_parts AS part
            ON part.question_revision_id = revision.id
        WHERE revision.status IN ('published', 'superseded')
            AND part.grading_policy = 'automatic'
        GROUP BY CASE
            WHEN lerniqa_automatic_part_has_complete_answer(
                part.id,
                part.answer_mode
            ) THEN 'complete'
            ELSE 'incomplete'
        END
    )
    SELECT
        category,
        dimension_key,
        secondary_key,
        count_value
    FROM quality_distribution
    ORDER BY category, dimension_key, secondary_key NULLS FIRST
`;

function asIso(value: Date | string, label: string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}格式不正確。`, 500);
    }
    return date.toISOString();
}

function asSafeCount(value: number | string, label: string): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}格式不正確。`, 500);
    }
    return parsed;
}

function availableMetric(value: number): AdminReportMetric {
    if (!Number.isFinite(value) || value < 0) {
        throw new AdminApiError("INTERNAL_ERROR", "報表指標格式不正確。", 500);
    }
    return { state: "available", value };
}

function noDataMetric(): AdminReportMetric {
    return { state: "no_data", value: null, reason: REPORT_NO_DATA_LABEL };
}

function unavailableWithoutPolicy(): AdminReportMetric {
    return { state: "policy_required", value: null, reason: POLICY_REQUIRED_REASON };
}

function suppressedMetric(): AdminReportMetric {
    return {
        state: "suppressed",
        value: null,
        reason: REPORT_PRIVACY_SUPPRESSED_LABEL,
    };
}

function protectedMetric(
    value: number,
    distinctLearnerCount: number,
    minimumDistinctLearners: number | null,
): AdminReportMetric {
    if (minimumDistinctLearners === null) return unavailableWithoutPolicy();
    const suppression = getPrivacySuppressionLabel(
        distinctLearnerCount,
        minimumDistinctLearners,
    );
    if (suppression) {
        return { state: "suppressed", value: null, reason: suppression };
    }
    return availableMetric(value);
}

function protectedOptionalMetric(
    value: number | null,
    distinctLearnerCount: number,
    minimumDistinctLearners: number | null,
): AdminReportMetric {
    const privacyState = protectedMetric(
        value ?? 0,
        distinctLearnerCount,
        minimumDistinctLearners,
    );
    if (privacyState.state !== "available") return privacyState;
    return value === null ? noDataMetric() : availableMetric(value);
}

function datasetState(rows: readonly unknown[]): "available" | "no_data" {
    return rows.length > 0 ? "available" : "no_data";
}

function protectedDatasetState(
    rows: readonly unknown[],
    minimumDistinctLearners: number | null,
): AdminReportDatasetState {
    if (minimumDistinctLearners === null) return "policy_required";
    if (rows.length === 0) {
        return getPrivacySuppressionLabel(0, minimumDistinctLearners)
            ? "suppressed"
            : "no_data";
    }
    return "available";
}

function assertKnown<Key extends string>(
    value: string,
    allowed: ReadonlySet<string>,
    label: string,
): Key {
    if (!allowed.has(value)) {
        throw new AdminApiError("INTERNAL_ERROR", `${label}包含未知狀態。`, 500);
    }
    return value as Key;
}

function mapUnprotectedDistribution<Key extends string>(
    rows: readonly QuestionQualityRow[],
    category: QuestionQualityCategory,
    allowed: ReadonlySet<string>,
    label: string,
): AdminReportDistribution<Key> {
    const selected = rows.filter((row) => row.category === category);
    return {
        state: datasetState(selected),
        rows: selected.map((row) => {
            const key = assertKnown<Key>(row.dimension_key, allowed, label);
            return {
                key,
                label: key,
                count: availableMetric(asSafeCount(row.count_value, label)),
            };
        }),
    };
}

function mapQuestionQuality(rows: readonly QuestionQualityRow[]): AdminReportSnapshot["questionQuality"] {
    const originAndStatus = rows
        .filter((row) => row.category === "question_origin_status")
        .map((row) => ({
            origin: assertKnown<QuestionOrigin>(row.dimension_key, QUESTION_ORIGIN_SET, "題目來源統計"),
            status: assertKnown<QuestionStatus>(row.secondary_key ?? "", QUESTION_STATUS_SET, "題目狀態統計"),
            count: availableMetric(asSafeCount(row.count_value, "題目來源狀態統計")),
        }));
    let completeAutomaticParts = 0;
    let incompleteAutomaticParts = 0;
    for (const row of rows.filter((candidate) =>
        candidate.category === "automatic_answer_completeness")) {
        const key = assertKnown<"complete" | "incomplete">(
            row.dimension_key,
            AUTOMATIC_ANSWER_COMPLETENESS_SET,
            "自動答案完整性統計",
        );
        const count = asSafeCount(row.count_value, "自動答案完整性統計");
        if (key === "complete") completeAutomaticParts += count;
        else incompleteAutomaticParts += count;
    }
    const totalAutomaticParts = completeAutomaticParts + incompleteAutomaticParts;
    const completenessRate = calculateReportRatio(
        completeAutomaticParts,
        totalAutomaticParts,
    );

    return {
        state: datasetState(rows),
        originAndStatus,
        currentRevisionStates: mapUnprotectedDistribution(
            rows,
            "current_revision_state",
            CURRENT_REVISION_STATE_SET,
            "目前版本統計",
        ),
        revisionStatuses: mapUnprotectedDistribution<QuestionRevisionStatus>(
            rows,
            "revision_status",
            REVISION_STATUS_SET,
            "題目版本狀態統計",
        ),
        revisionReviewCoverage: mapUnprotectedDistribution(
            rows,
            "revision_review_coverage",
            REVIEW_COVERAGE_STATE_SET,
            "題目審核覆蓋統計",
        ),
        latestReviewDecisions: mapUnprotectedDistribution<QuestionReviewStatus>(
            rows,
            "latest_review_decision",
            REVIEW_STATUS_SET,
            "題目審核結果統計",
        ),
        importBatchStatuses: mapUnprotectedDistribution(
            rows,
            "import_batch_status",
            IMPORT_BATCH_STATUS_SET,
            "匯入批次狀態統計",
        ),
        importItemReviewStatuses: mapUnprotectedDistribution(
            rows,
            "import_item_review_status",
            IMPORT_ITEM_REVIEW_STATUS_SET,
            "匯入項目審核統計",
        ),
        sourceDocumentStatuses: mapUnprotectedDistribution(
            rows,
            "source_document_status",
            SOURCE_DOCUMENT_STATUS_SET,
            "來源文件狀態統計",
        ),
        currentRevisionSourceCoverage: mapUnprotectedDistribution(
            rows,
            "current_revision_source_coverage",
            SOURCE_COVERAGE_STATE_SET,
            "目前版本來源覆蓋統計",
        ),
        automaticAnswerCompleteness: {
            totalParts: availableMetric(totalAutomaticParts),
            completeParts: availableMetric(completeAutomaticParts),
            incompleteParts: availableMetric(incompleteAutomaticParts),
            rate: completenessRate === null
                ? noDataMetric()
                : availableMetric(completenessRate),
        },
    };
}

/**
 * Builds one read-only administrative snapshot from the committed 0001-0011
 * schema. Callers should pass a transaction-scoped runner when a consistent
 * snapshot across all fixed-count aggregate queries is required.
 */
export async function getAdminReportSnapshot(
    runner: AdminQueryRunner,
    query: AdminReportQuery,
): Promise<AdminReportSnapshot> {
    if (!GRANULARITIES.has(query.granularity)) {
        throw new RangeError("不支援的報表分組週期。");
    }
    const range = createTaipeiDateRange(query.startLocalDate, query.endLocalDate);

    const policyResult = await runner.query<PrivacyPolicyRow>(
        PRIVACY_POLICY_SQL,
        [ADMIN_REPORT_PRIVACY_POLICY_KEY],
    );
    const policyRow = policyResult.rows[0];
    if (!policyRow) {
        throw new AdminApiError("INTERNAL_ERROR", "無法取得報表快照時間。", 500);
    }

    const minimumDistinctLearners = policyRow.min_distinct_learners === null
        ? null
        : asSafeCount(policyRow.min_distinct_learners, "統計隱私門檻");
    if (minimumDistinctLearners !== null && minimumDistinctLearners < 2) {
        throw new AdminApiError("INTERNAL_ERROR", "統計隱私門檻格式不正確。", 500);
    }
    if ((minimumDistinctLearners === null) !== (policyRow.effective_at === null)) {
        throw new AdminApiError("INTERNAL_ERROR", "統計隱私政策資料不完整。", 500);
    }

    const registrationResult = await runner.query<RegistrationTrendRow>(
        REGISTRATION_TREND_SQL,
        [range.startInclusive, range.endExclusive, query.granularity],
    );
    const accountResult = await runner.query<SnapshotDistributionRow>(ACCOUNT_SNAPSHOT_SQL);
    const learnerResult = await runner.query<LearnerDistributionRow>(LEARNER_DISTRIBUTION_SQL);
    const practiceResult = await runner.query<PracticeReportRow>(
        PRACTICE_REPORT_SQL,
        [range.startInclusive, range.endExclusive],
    );
    const questionResult = await runner.query<QuestionQualityRow>(QUESTION_QUALITY_SQL);

    const registrationTrend = registrationResult.rows.map((row) => ({
        bucketKey: row.bucket_key,
        count: availableMetric(asSafeCount(row.count_value, "註冊趨勢統計")),
    }));
    const registrationTotal = registrationTrend.reduce(
        (total, row) => total + (row.count.state === "available" ? row.count.value : 0),
        0,
    );

    const accountStatusRows = accountResult.rows
        .filter((row) => row.category === "account_status")
        .map((row) => {
            const key = assertKnown<AccountStatus>(row.dimension_key, ACCOUNT_STATUS_SET, "帳號狀態統計");
            return {
                key,
                label: key,
                count: availableMetric(asSafeCount(row.count_value, "帳號狀態統計")),
            };
        });
    const activeRoleRows = accountResult.rows
        .filter((row) => row.category === "active_role")
        .map((row) => {
            const key = assertKnown<GrantedRole>(row.dimension_key, GRANTED_ROLE_SET, "有效角色統計");
            return {
                key,
                label: key,
                count: availableMetric(asSafeCount(row.count_value, "有效角色統計")),
            };
        });

    const gradeRows = learnerResult.rows.map((row) => {
        const count = asSafeCount(row.learner_count, "年級統計");
        const key = row.dimension_kind === "not_enrolled"
            ? "not_enrolled"
            : row.dimension_kind === "missing"
                ? "missing"
                : `grade:${formatReportDimensionValue(row.dimension_key)}`;
        const label = row.dimension_kind === "not_enrolled"
            ? "不在學"
            : formatReportDimensionValue(row.dimension_label);
        return {
            key,
            label,
            count: protectedMetric(count, count, minimumDistinctLearners),
        };
    });

    const practiceRow = practiceResult.rows[0];
    if (!practiceRow) {
        throw new AdminApiError("INTERNAL_ERROR", "練習報表查詢未回傳彙總結果。", 500);
    }
    const completedInPeriod = asSafeCount(practiceRow.completed_in_period, "期間完成練習統計");
    const completedInPeriodLearners = asSafeCount(
        practiceRow.completed_in_period_learners,
        "期間完成練習學習者統計",
    );
    const startedCohortSessions = asSafeCount(practiceRow.started_cohort_sessions, "啟動 cohort 統計");
    const completedStartedCohortSessions = asSafeCount(
        practiceRow.completed_started_cohort_sessions,
        "啟動 cohort 完成統計",
    );
    const startedCohortLearners = asSafeCount(
        practiceRow.started_cohort_learners,
        "啟動 cohort 學習者統計",
    );
    const cohortRate = calculateReportRatio(
        completedStartedCohortSessions,
        startedCohortSessions,
    );
    const activeLearners = asSafeCount(
        practiceRow.non_score_active_learners,
        "非 score 活躍學習者統計",
    );
    const nonScoreAttempts = asSafeCount(practiceRow.non_score_attempts, "非 score 作答統計");
    const resultDefinitions = [
        {
            key: "correct" as const,
            attempts: practiceRow.correct_attempts,
            learners: practiceRow.correct_learners,
        },
        {
            key: "wrong" as const,
            attempts: practiceRow.wrong_attempts,
            learners: practiceRow.wrong_learners,
        },
        {
            key: "pending" as const,
            attempts: practiceRow.pending_attempts,
            learners: practiceRow.pending_learners,
        },
    ];
    const nonScoreResults = resultDefinitions.map((definition) => {
        const attempts = asSafeCount(definition.attempts, `非 score ${definition.key} 作答統計`);
        const learners = asSafeCount(definition.learners, `非 score ${definition.key} 學習者統計`);
        return {
            key: definition.key,
            label: definition.key,
            count: protectedMetric(attempts, learners, minimumDistinctLearners),
        };
    });
    const nonScoreOutcomeNeedsComplementarySuppression = nonScoreResults.some(
        (result) => result.count.state === "suppressed",
    );
    const protectNonScoreOutcomeTotal = (): AdminReportMetric => {
        const metric = protectedMetric(
            nonScoreAttempts,
            activeLearners,
            minimumDistinctLearners,
        );
        return nonScoreOutcomeNeedsComplementarySuppression && metric.state === "available"
            ? suppressedMetric()
            : metric;
    };
    const scoreActiveLearners = asSafeCount(
        practiceRow.score_active_learners,
        "score 活躍學習者統計",
    );
    const scoreSubmittedItems = asSafeCount(
        practiceRow.score_submitted_items,
        "score 送出收據統計",
    );
    const completedScoreSessions = asSafeCount(
        practiceRow.completed_score_sessions,
        "期間完成 score session 統計",
    );
    const completedScoreLearners = asSafeCount(
        practiceRow.completed_score_learners,
        "期間完成 score session 學習者統計",
    );
    const scoreTotalItems = asSafeCount(practiceRow.score_total_items, "score 總題數統計");
    const scoreAnsweredItems = asSafeCount(
        practiceRow.score_answered_items,
        "score 已送出題數統計",
    );
    const scoreCorrectItems = asSafeCount(
        practiceRow.score_correct_items,
        "score 答對題數統計",
    );
    const scoreCorrectLearners = asSafeCount(
        practiceRow.score_correct_learners,
        "score 答對學習者統計",
    );
    const scoreWrongItems = asSafeCount(practiceRow.score_wrong_items, "score 答錯題數統計");
    const scoreWrongLearners = asSafeCount(
        practiceRow.score_wrong_learners,
        "score 答錯學習者統計",
    );
    const scorePendingItems = asSafeCount(
        practiceRow.score_pending_items,
        "score 待判定題數統計",
    );
    const scorePendingLearners = asSafeCount(
        practiceRow.score_pending_learners,
        "score 待判定學習者統計",
    );
    if (
        scoreActiveLearners > scoreSubmittedItems
        || completedScoreLearners > completedScoreSessions
        || scoreCorrectLearners > completedScoreLearners
        || scoreWrongLearners > completedScoreLearners
        || scorePendingLearners > completedScoreLearners
        || scoreCorrectLearners > scoreCorrectItems
        || scoreWrongLearners > scoreWrongItems
        || scorePendingLearners > scorePendingItems
        || scoreAnsweredItems !== scoreTotalItems
        || scoreCorrectItems + scoreWrongItems > scoreAnsweredItems
        || scoreCorrectItems + scoreWrongItems + scorePendingItems !== scoreTotalItems
    ) {
        throw new AdminApiError("INTERNAL_ERROR", "score 報表彙總不符合 0011 契約。", 500);
    }
    const scoreCorrectMetric = protectedMetric(
        scoreCorrectItems,
        scoreCorrectLearners,
        minimumDistinctLearners,
    );
    const scoreWrongMetric = protectedMetric(
        scoreWrongItems,
        scoreWrongLearners,
        minimumDistinctLearners,
    );
    const scorePendingMetric = protectedMetric(
        scorePendingItems,
        scorePendingLearners,
        minimumDistinctLearners,
    );
    const scoreOutcomeNeedsComplementarySuppression = [
        scoreCorrectMetric,
        scoreWrongMetric,
        scorePendingMetric,
    ].some((metric) => metric.state === "suppressed");
    const protectScoreOutcomeTotal = (value: number): AdminReportMetric => {
        const metric = protectedMetric(
            value,
            completedScoreLearners,
            minimumDistinctLearners,
        );
        return scoreOutcomeNeedsComplementarySuppression && metric.state === "available"
            ? suppressedMetric()
            : metric;
    };

    const policy = minimumDistinctLearners === null
        ? {
            state: "not_configured" as const,
            policyKey: ADMIN_REPORT_PRIVACY_POLICY_KEY,
            minimumDistinctLearners: null,
            effectiveAt: null,
        }
        : {
            state: "configured" as const,
            policyKey: ADMIN_REPORT_PRIVACY_POLICY_KEY,
            minimumDistinctLearners,
            effectiveAt: asIso(policyRow.effective_at as Date | string, "統計隱私政策生效時間"),
        };

    return {
        generatedAt: asIso(policyRow.snapshot_at, "報表快照時間"),
        range: {
            timeZone: ADMIN_REPORT_TIME_ZONE,
            granularity: query.granularity,
            startLocalDate: range.startLocalDate,
            endLocalDate: range.endLocalDate,
            startInclusive: range.startInclusive.toISOString(),
            endExclusive: range.endExclusive.toISOString(),
        },
        privacyPolicy: policy,
        registrations: {
            state: "available",
            total: availableMetric(registrationTotal),
            trend: registrationTrend,
        },
        accounts: {
            statuses: {
                state: datasetState(accountStatusRows),
                rows: accountStatusRows,
            },
            activeRoles: {
                state: datasetState(activeRoleRows),
                rows: activeRoleRows,
            },
            roleCountingNote: "只計未撤銷角色；同一帳號有多個角色時會分別計入。",
        },
        learners: {
            grades: {
                state: protectedDatasetState(gradeRows, minimumDistinctLearners),
                rows: minimumDistinctLearners === null ? [] : gradeRows,
            },
            region: {
                state: "not_collected",
                sourceField: null,
                rows: [],
                reason: "現有正式資料契約沒有地區欄位；不以學校名稱推測地區。",
            },
        },
        practice: {
            completion: {
                completedInPeriod: protectedMetric(
                    completedInPeriod,
                    completedInPeriodLearners,
                    minimumDistinctLearners,
                ),
                startedCohortSessions: protectedMetric(
                    startedCohortSessions,
                    startedCohortLearners,
                    minimumDistinctLearners,
                ),
                completedStartedCohortSessions: protectedMetric(
                    completedStartedCohortSessions,
                    startedCohortLearners,
                    minimumDistinctLearners,
                ),
                startedCohortCompletionRate: protectedOptionalMetric(
                    cohortRate,
                    startedCohortLearners,
                    minimumDistinctLearners,
                ),
            },
            nonScoreActivity: {
                activeLearners: protectedMetric(
                    activeLearners,
                    activeLearners,
                    minimumDistinctLearners,
                ),
                attempts: protectNonScoreOutcomeTotal(),
                results: {
                    state: protectedDatasetState(nonScoreResults, minimumDistinctLearners),
                    rows: minimumDistinctLearners === null ? [] : nonScoreResults,
                },
            },
            scoreActivity: {
                activeLearners: protectedMetric(
                    scoreActiveLearners,
                    scoreActiveLearners,
                    minimumDistinctLearners,
                ),
                submittedItems: protectedMetric(
                    scoreSubmittedItems,
                    scoreActiveLearners,
                    minimumDistinctLearners,
                ),
                completedSessions: protectedMetric(
                    completedScoreSessions,
                    completedScoreLearners,
                    minimumDistinctLearners,
                ),
                totalItems: protectScoreOutcomeTotal(scoreTotalItems),
                answeredItems: protectScoreOutcomeTotal(scoreAnsweredItems),
                correctItems: scoreCorrectMetric,
                wrongItems: scoreWrongMetric,
                pendingItems: scorePendingMetric,
            },
        },
        questionQuality: mapQuestionQuality(questionResult.rows),
    };
}

// Keep these definitions reachable to tests without exposing raw result rows.
export const ADMIN_REPORT_DEFINITIONS = Object.freeze({
    missingValueLabel: REPORT_MISSING_VALUE_LABEL,
    regionCollection: "not_collected" as const,
    nonScoreAttemptSource: "answer_attempts" as const,
    scoreSubmissionSource: "practice_score_receipts" as const,
    scoreResultSource: "practice_sessions" as const,
    automaticAnswerCompletenessSource:
        "lerniqa_automatic_part_has_complete_answer" as const,
});
