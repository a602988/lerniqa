import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";

import type {
    AdminQueryResult,
    AdminQueryRunner,
} from "../app/lib/admin/admin-auth.ts";
import {
    ADMIN_REPORT_PRIVACY_POLICY_KEY,
    getAdminReportSnapshot,
} from "../app/lib/admin/report-repository.ts";

interface QueryCall {
    text: string;
    values: readonly unknown[];
}

class FakeRunner implements AdminQueryRunner {
    readonly calls: QueryCall[] = [];
    private readonly rowsByCall: readonly (readonly QueryResultRow[])[];

    constructor(
        rowsByCall: readonly (readonly QueryResultRow[])[],
    ) {
        this.rowsByCall = rowsByCall;
    }

    async query<Row extends QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
    ): Promise<AdminQueryResult<Row>> {
        const callIndex = this.calls.length;
        this.calls.push({ text, values });
        return {
            rows: [...(this.rowsByCall[callIndex] ?? [])] as Row[],
        };
    }
}

const configuredPolicyRows = [{
    snapshot_at: "2026-10-16T08:30:00.000Z",
    min_distinct_learners: "3",
    effective_at: "2026-10-01T00:00:00.000Z",
}];

const representativeRows: readonly (readonly QueryResultRow[])[] = [
    configuredPolicyRows,
    [
        { bucket_key: "2026-10-01", count_value: "2" },
        { bucket_key: "2026-10-02", count_value: "3" },
    ],
    [
        { category: "account_status", dimension_key: "active", count_value: "4" },
        { category: "account_status", dimension_key: "suspended", count_value: "1" },
        { category: "active_role", dimension_key: "parent", count_value: "3" },
        { category: "active_role", dimension_key: "learner", count_value: "2" },
        { category: "active_role", dimension_key: "system_admin", count_value: "1" },
    ],
    [
        {
            dimension_kind: "grade",
            dimension_key: "junior-high-1",
            dimension_label: "七年級",
            learner_count: "4",
        },
        {
            dimension_kind: "not_enrolled",
            dimension_key: "not_enrolled",
            dimension_label: "不在學",
            learner_count: "2",
        },
    ],
    [{
        completed_in_period: "5",
        completed_in_period_learners: "4",
        started_cohort_sessions: "10",
        completed_started_cohort_sessions: "4",
        started_cohort_learners: "4",
        non_score_active_learners: "4",
        non_score_attempts: "7",
        correct_attempts: "4",
        correct_learners: "3",
        wrong_attempts: "2",
        wrong_learners: "2",
        pending_attempts: "1",
        pending_learners: "1",
    }],
    [
        {
            category: "question_origin_status",
            dimension_key: "system",
            secondary_key: "published",
            count_value: "279",
        },
        {
            category: "current_revision_state",
            dimension_key: "published",
            secondary_key: null,
            count_value: "279",
        },
        {
            category: "revision_status",
            dimension_key: "draft",
            secondary_key: null,
            count_value: "2",
        },
        {
            category: "revision_review_coverage",
            dimension_key: "reviewed",
            secondary_key: null,
            count_value: "279",
        },
        {
            category: "latest_review_decision",
            dimension_key: "approved",
            secondary_key: null,
            count_value: "279",
        },
        {
            category: "import_batch_status",
            dimension_key: "confirmed",
            secondary_key: null,
            count_value: "1",
        },
        {
            category: "import_item_review_status",
            dimension_key: "approved",
            secondary_key: null,
            count_value: "279",
        },
        {
            category: "source_document_status",
            dimension_key: "ready",
            secondary_key: null,
            count_value: "1",
        },
        {
            category: "current_revision_source_coverage",
            dimension_key: "with_primary_source",
            secondary_key: null,
            count_value: "279",
        },
    ],
];

test("returns an explicit 0001-0007 report DTO and suppresses small learner groups", async () => {
    const runner = new FakeRunner(representativeRows);

    const report = await getAdminReportSnapshot(runner, {
        startLocalDate: "2026-10-01",
        endLocalDate: "2026-10-02",
        granularity: "day",
    });

    assert.equal(report.generatedAt, "2026-10-16T08:30:00.000Z");
    assert.deepEqual(report.range, {
        timeZone: "Asia/Taipei",
        granularity: "day",
        startLocalDate: "2026-10-01",
        endLocalDate: "2026-10-02",
        startInclusive: "2026-09-30T16:00:00.000Z",
        endExclusive: "2026-10-02T16:00:00.000Z",
    });
    assert.deepEqual(report.privacyPolicy, {
        state: "configured",
        policyKey: ADMIN_REPORT_PRIVACY_POLICY_KEY,
        minimumDistinctLearners: 3,
        effectiveAt: "2026-10-01T00:00:00.000Z",
    });

    assert.equal(report.registrations.state, "available");
    assert.deepEqual(report.registrations.total, { state: "available", value: 5 });
    assert.deepEqual(
        report.registrations.trend.map((row) => [row.bucketKey, row.count.value]),
        [["2026-10-01", 2], ["2026-10-02", 3]],
    );
    assert.deepEqual(
        report.accounts.statuses.rows.map((row) => [row.key, row.count.value]),
        [["active", 4], ["suspended", 1]],
    );
    assert.deepEqual(
        report.accounts.activeRoles.rows.map((row) => [row.key, row.count.value]),
        [["parent", 3], ["learner", 2], ["system_admin", 1]],
    );

    assert.equal(report.learners.grades.state, "available");
    assert.deepEqual(report.learners.grades.rows[0], {
        key: "grade:junior-high-1",
        label: "七年級",
        count: { state: "available", value: 4 },
    });
    assert.deepEqual(report.learners.grades.rows[1], {
        key: "not_enrolled",
        label: "不在學",
        count: { state: "suppressed", value: null, reason: "未達顯示門檻" },
    });
    assert.deepEqual(report.learners.region, {
        state: "not_collected",
        sourceField: null,
        rows: [],
        reason: "現有正式資料契約沒有地區欄位；不以學校名稱推測地區。",
    });

    assert.deepEqual(report.practice.completion, {
        completedInPeriod: { state: "available", value: 5 },
        startedCohortSessions: { state: "available", value: 10 },
        completedStartedCohortSessions: { state: "available", value: 4 },
        startedCohortCompletionRate: { state: "available", value: 0.4 },
    });
    assert.deepEqual(report.practice.nonScoreActivity.activeLearners, {
        state: "available",
        value: 4,
    });
    assert.deepEqual(report.practice.nonScoreActivity.results.rows[0]?.count, {
        state: "available",
        value: 4,
    });
    assert.deepEqual(report.practice.nonScoreActivity.results.rows[1]?.count, {
        state: "suppressed",
        value: null,
        reason: "未達顯示門檻",
    });
    assert.equal(report.practice.scoreActivity.state, "integration_pending");
    assert.match(report.practice.scoreActivity.reason, /0011/u);

    assert.deepEqual(report.questionQuality.originAndStatus[0], {
        origin: "system",
        status: "published",
        count: { state: "available", value: 279 },
    });
    assert.equal(report.questionQuality.currentRevisionStates.rows[0]?.key, "published");
    assert.equal(report.questionQuality.latestReviewDecisions.rows[0]?.key, "approved");
    assert.equal(report.questionQuality.importBatchStatuses.rows[0]?.key, "confirmed");
    assert.equal(report.questionQuality.sourceDocumentStatuses.rows[0]?.key, "ready");
    assert.equal(
        report.questionQuality.currentRevisionSourceCoverage.rows[0]?.key,
        "with_primary_source",
    );
    assert.equal(report.questionQuality.automaticAnswerCompleteness.state, "integration_pending");

    assert.equal(runner.calls.length, 6);
    assert.deepEqual(runner.calls[0]?.values, [ADMIN_REPORT_PRIVACY_POLICY_KEY]);
    assert.deepEqual(runner.calls[1]?.values, [
        new Date("2026-09-30T16:00:00.000Z"),
        new Date("2026-10-02T16:00:00.000Z"),
        "day",
    ]);
    assert.deepEqual(runner.calls[4]?.values, [
        new Date("2026-09-30T16:00:00.000Z"),
        new Date("2026-10-02T16:00:00.000Z"),
    ]);
    assert.match(runner.calls[1]?.text ?? "", /created_at\s*>=\s*\$1/iu);
    assert.match(runner.calls[1]?.text ?? "", /created_at\s*<\s*\$2/iu);
    assert.match(runner.calls[1]?.text ?? "", /generate_series/iu);
    assert.match(runner.calls[1]?.text ?? "", /coalesce\(registration\.count_value,\s*0\)/iu);
    assert.match(runner.calls[4]?.text ?? "", /check_mode\s*<>\s*'score'/iu);
    assert.doesNotMatch(runner.calls[4]?.text ?? "", /practice_score_receipts/iu);
    assert.doesNotMatch(runner.calls[1]?.text ?? "", /2026-10-01/u);

    const forbiddenLocationColumn = ["school", "name"].join("_");
    for (const call of runner.calls) {
        assert.equal(call.text.toLowerCase().includes(forbiddenLocationColumn), false);
    }
});

test("distinguishes empty rows, real zero counts, a zero denominator, and missing privacy policy", async () => {
    const runner = new FakeRunner([
        [{
            snapshot_at: "2026-10-16T08:30:00.000Z",
            min_distinct_learners: null,
            effective_at: null,
        }],
        [{ bucket_key: "2026-10-16", count_value: "0" }],
        [],
        [],
        [{
            completed_in_period: "0",
            completed_in_period_learners: "0",
            started_cohort_sessions: "0",
            completed_started_cohort_sessions: "0",
            started_cohort_learners: "0",
            non_score_active_learners: "0",
            non_score_attempts: "0",
            correct_attempts: "0",
            correct_learners: "0",
            wrong_attempts: "0",
            wrong_learners: "0",
            pending_attempts: "0",
            pending_learners: "0",
        }],
        [],
    ]);

    const report = await getAdminReportSnapshot(runner, {
        startLocalDate: "2026-10-16",
        endLocalDate: "2026-10-16",
        granularity: "day",
    });

    assert.equal(report.privacyPolicy.state, "not_configured");
    assert.equal(report.registrations.state, "available");
    assert.deepEqual(report.registrations.total, {
        state: "available",
        value: 0,
    });
    assert.deepEqual(report.registrations.trend, [{
        bucketKey: "2026-10-16",
        count: { state: "available", value: 0 },
    }]);
    assert.equal(report.accounts.statuses.state, "no_data");
    assert.equal(report.accounts.activeRoles.state, "no_data");
    assert.equal(report.learners.grades.state, "policy_required");
    assert.deepEqual(report.learners.grades.rows, []);

    assert.deepEqual(report.practice.completion.completedInPeriod, {
        state: "policy_required",
        value: null,
        reason: "尚未啟用管理報表的統計隱私政策。",
    });
    assert.deepEqual(report.practice.completion.startedCohortCompletionRate, {
        state: "policy_required",
        value: null,
        reason: "尚未啟用管理報表的統計隱私政策。",
    });
    assert.equal(report.practice.nonScoreActivity.activeLearners.state, "policy_required");
    assert.equal(report.practice.nonScoreActivity.attempts.state, "policy_required");
    assert.equal(report.practice.nonScoreActivity.results.state, "policy_required");
    assert.deepEqual(report.practice.nonScoreActivity.results.rows, []);
    assert.equal(report.practice.scoreActivity.state, "integration_pending");
    assert.equal(report.questionQuality.state, "no_data");
    assert.equal(report.questionQuality.currentRevisionStates.state, "no_data");
});

test("preserves a real zero completion ratio when the started cohort is non-empty", async () => {
    const runner = new FakeRunner([
        configuredPolicyRows,
        [],
        [],
        [],
        [{
            completed_in_period: "0",
            completed_in_period_learners: "0",
            started_cohort_sessions: "4",
            completed_started_cohort_sessions: "0",
            started_cohort_learners: "3",
            non_score_active_learners: "3",
            non_score_attempts: "3",
            correct_attempts: "3",
            correct_learners: "3",
            wrong_attempts: "0",
            wrong_learners: "0",
            pending_attempts: "0",
            pending_learners: "0",
        }],
        [],
    ]);

    const report = await getAdminReportSnapshot(runner, {
        startLocalDate: "2026-10-01",
        endLocalDate: "2026-10-07",
        granularity: "week",
    });

    assert.deepEqual(report.practice.completion.startedCohortCompletionRate, {
        state: "available",
        value: 0,
    });
    assert.deepEqual(runner.calls[1]?.values.slice(2), ["week"]);
});

test("suppresses the complete practice cohort group below the learner threshold", async () => {
    const runner = new FakeRunner([
        configuredPolicyRows,
        [{ bucket_key: "2026-10-01", count_value: "0" }],
        [],
        [],
        [{
            completed_in_period: "5",
            completed_in_period_learners: "2",
            started_cohort_sessions: "10",
            completed_started_cohort_sessions: "4",
            started_cohort_learners: "2",
            non_score_active_learners: "3",
            non_score_attempts: "3",
            correct_attempts: "3",
            correct_learners: "3",
            wrong_attempts: "0",
            wrong_learners: "0",
            pending_attempts: "0",
            pending_learners: "0",
        }],
        [],
    ]);

    const report = await getAdminReportSnapshot(runner, {
        startLocalDate: "2026-10-01",
        endLocalDate: "2026-10-01",
        granularity: "day",
    });

    for (const metric of Object.values(report.practice.completion)) {
        assert.deepEqual(metric, {
            state: "suppressed",
            value: null,
            reason: "未達顯示門檻",
        });
    }
    assert.match(
        runner.calls[4]?.text ?? "",
        /count\(DISTINCT session\.learner_id\) AS learner_count/iu,
    );
});

test("rejects invalid date and granularity filters before issuing SQL", async () => {
    const invalidRangeRunner = new FakeRunner([]);
    await assert.rejects(
        () => getAdminReportSnapshot(invalidRangeRunner, {
            startLocalDate: "2026-10-17",
            endLocalDate: "2026-10-16",
            granularity: "day",
        }),
        RangeError,
    );
    assert.equal(invalidRangeRunner.calls.length, 0);

    const invalidGranularityRunner = new FakeRunner([]);
    await assert.rejects(
        () => getAdminReportSnapshot(invalidGranularityRunner, {
            startLocalDate: "2026-10-16",
            endLocalDate: "2026-10-16",
            granularity: "quarter" as never,
        }),
        RangeError,
    );
    assert.equal(invalidGranularityRunner.calls.length, 0);
});
