import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildReportsViewModel,
    resolveAdminReportQuery,
} from "../app/lib/admin/admin-view-model.ts";
import { loadAdminReportRequest } from "../app/lib/admin/admin-report-handler.ts";
import type { AdminQueryRunner } from "../app/lib/admin/admin-auth.ts";
import type { AdminReportSnapshot } from "../app/lib/admin/report-repository.ts";
import { AdminApiError } from "../app/lib/admin/admin-types.ts";

const noDataDistribution = () => ({ state: "no_data" as const, rows: [] });

function reportFixture(): AdminReportSnapshot {
    return {
        generatedAt: "2026-10-16T08:30:00.000Z",
        range: {
            timeZone: "Asia/Taipei",
            granularity: "day",
            startLocalDate: "2026-09-17",
            endLocalDate: "2026-10-16",
            startInclusive: "2026-09-16T16:00:00.000Z",
            endExclusive: "2026-10-16T16:00:00.000Z",
        },
        privacyPolicy: {
            state: "configured",
            policyKey: "admin_platform_reporting",
            minimumDistinctLearners: 3,
            effectiveAt: "2026-10-01T00:00:00.000Z",
        },
        registrations: {
            state: "available",
            total: { state: "available", value: 5 },
            trend: [
                {
                    bucketKey: "2026-10-15",
                    count: { state: "available", value: 2 },
                },
                {
                    bucketKey: "2026-10-16",
                    count: { state: "available", value: 3 },
                },
            ],
        },
        accounts: {
            statuses: {
                state: "available",
                rows: [{
                    key: "active",
                    label: "active",
                    count: { state: "available", value: 4 },
                }],
            },
            activeRoles: {
                state: "available",
                rows: [{
                    key: "parent",
                    label: "parent",
                    count: { state: "available", value: 3 },
                }],
            },
            roleCountingNote: "只計未撤銷角色；同一帳號有多個角色時會分別計入。",
        },
        learners: {
            grades: {
                state: "available",
                rows: [
                    {
                        key: "grade:g7",
                        label: "七年級",
                        count: { state: "available", value: 4 },
                    },
                    {
                        key: "not_enrolled",
                        label: "不在學",
                        count: {
                            state: "suppressed",
                            value: null,
                            reason: "未達顯示門檻",
                        },
                    },
                ],
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
                completedInPeriod: { state: "available", value: 5 },
                startedCohortSessions: { state: "available", value: 0 },
                completedStartedCohortSessions: { state: "available", value: 0 },
                startedCohortCompletionRate: {
                    state: "no_data",
                    value: null,
                    reason: "無資料",
                },
            },
            nonScoreActivity: {
                activeLearners: { state: "available", value: 4 },
                attempts: {
                    state: "suppressed",
                    value: null,
                    reason: "未達顯示門檻",
                },
                results: {
                    state: "available",
                    rows: [{
                        key: "pending",
                        label: "pending",
                        count: {
                            state: "suppressed",
                            value: null,
                            reason: "未達顯示門檻",
                        },
                    }],
                },
            },
            scoreActivity: {
                state: "integration_pending",
                value: null,
                reason: "score 模式等待正式 0011 契約整合。",
            },
        },
        questionQuality: {
            state: "available",
            originAndStatus: [{
                origin: "system",
                status: "published",
                count: { state: "available", value: 279 },
            }],
            currentRevisionStates: noDataDistribution(),
            revisionStatuses: noDataDistribution(),
            revisionReviewCoverage: noDataDistribution(),
            latestReviewDecisions: noDataDistribution(),
            importBatchStatuses: noDataDistribution(),
            importItemReviewStatuses: noDataDistribution(),
            sourceDocumentStatuses: noDataDistribution(),
            currentRevisionSourceCoverage: noDataDistribution(),
            automaticAnswerCompleteness: {
                state: "integration_pending",
                value: null,
                reason: "自動答案完整性等待正式 0009 契約整合。",
            },
        },
    };
}

describe("admin report range and view model", () => {
    it("authorizes the API request before parsing its protected range", async () => {
        const events: string[] = [];
        const forbidden = new AdminApiError(
            "FORBIDDEN",
            "這個帳號沒有管理後台權限。",
            403,
        );

        await assert.rejects(
            () => loadAdminReportRequest(
                new Request("https://example.test/api/v1/admin/reports?range=invalid"),
                {
                    withSnapshot: async (operation) => {
                        events.push("snapshot");
                        return operation({} as AdminQueryRunner);
                    },
                    authorize: async () => {
                        events.push("authorize");
                        throw forbidden;
                    },
                    loadSnapshot: async () => {
                        events.push("load");
                        return reportFixture();
                    },
                    now: () => new Date("2026-10-16T08:00:00.000Z"),
                },
            ),
            (error) => error === forbidden,
        );
        assert.deepEqual(events, ["snapshot", "authorize"]);
    });

    it("loads a valid API range only after authorization", async () => {
        const events: string[] = [];
        const runner = {} as AdminQueryRunner;
        const fixture = reportFixture();
        const result = await loadAdminReportRequest(
            new Request("https://example.test/api/v1/admin/reports?range=7d"),
            {
                withSnapshot: async (operation) => {
                    events.push("snapshot");
                    return operation(runner);
                },
                authorize: async (_request, receivedRunner) => {
                    events.push("authorize");
                    assert.equal(receivedRunner, runner);
                    return {};
                },
                loadSnapshot: async (receivedRunner, query) => {
                    events.push("load");
                    assert.equal(receivedRunner, runner);
                    assert.deepEqual(query, {
                        startLocalDate: "2026-10-10",
                        endLocalDate: "2026-10-16",
                        granularity: "day",
                    });
                    return fixture;
                },
                now: () => new Date("2026-10-16T08:00:00.000Z"),
            },
        );

        assert.deepEqual(events, ["snapshot", "authorize", "load"]);
        assert.equal(result.range, "7d");
        assert.equal(result.report, fixture);
    });

    it("turns relative ranges into inclusive Taipei dates using an injectable clock", () => {
        const beforeTaipeiMidnight = new Date("2026-10-16T15:59:59.999Z");
        const afterTaipeiMidnight = new Date("2026-10-16T16:00:00.000Z");

        assert.deepEqual(resolveAdminReportQuery("7d", beforeTaipeiMidnight), {
            startLocalDate: "2026-10-10",
            endLocalDate: "2026-10-16",
            granularity: "day",
        });
        assert.deepEqual(resolveAdminReportQuery("7d", afterTaipeiMidnight), {
            startLocalDate: "2026-10-11",
            endLocalDate: "2026-10-17",
            granularity: "day",
        });
        assert.deepEqual(resolveAdminReportQuery("30d", beforeTaipeiMidnight), {
            startLocalDate: "2026-09-17",
            endLocalDate: "2026-10-16",
            granularity: "day",
        });
        assert.deepEqual(resolveAdminReportQuery("90d", beforeTaipeiMidnight), {
            startLocalDate: "2026-07-19",
            endLocalDate: "2026-10-16",
            granularity: "week",
        });
    });

    it("maps real report values and preserves unavailable states without stand-in numbers", () => {
        const report = reportFixture();
        const query = resolveAdminReportQuery(
            "30d",
            new Date("2026-10-16T08:00:00.000Z"),
        );
        const view = buildReportsViewModel({ range: "30d", query, report });

        assert.deepEqual(view.state, { kind: "ready" });
        assert.equal(view.startLocalDate, "2026-09-17");
        assert.equal(view.endLocalDate, "2026-10-16");
        assert.equal(view.generatedAt, "2026/10/16 16:30");
        assert.equal(view.timeZone, "Asia/Taipei");
        assert.equal(view.registrationTrend.summary?.value.value, 5);
        assert.deepEqual(
            view.registrationTrend.rows.map((row) =>
                row.barPercent === null ? null : Math.round(row.barPercent * 100) / 100),
            [66.67, 100],
        );
        assert.equal(view.accountStatusDistribution.rows[0]?.label, "啟用");
        assert.equal(view.activeRoleDistribution.rows[0]?.label, "家長");
        assert.equal(view.gradeDistribution.rows[1]?.value.state, "suppressed");
        assert.equal(view.gradeDistribution.rows[1]?.barPercent, null);
        assert.equal(view.region.state, "not_collected");

        const activeLearners = view.activity.metrics.find((metric) =>
            metric.key === "active-learners");
        const attempts = view.activity.metrics.find((metric) =>
            metric.key === "non-score-attempts");
        const score = view.activity.metrics.find((metric) =>
            metric.key === "score-activity");
        assert.deepEqual(activeLearners?.value, { state: "available", value: 4 });
        assert.equal(attempts?.value.state, "suppressed");
        assert.equal(score?.value.state, "integration_pending");
        assert.match(score?.value.reason ?? "", /0011/u);

        const completionRate = view.completion.metrics.find((metric) =>
            metric.key === "started-cohort-completion-rate");
        assert.equal(completionRate?.value.state, "no_data");
        assert.notEqual(completionRate?.value.value, "0%");

        const published = view.questionQuality.metrics.find((metric) =>
            metric.key === "question-origin-system-published");
        const answerCompleteness = view.questionQuality.metrics.find((metric) =>
            metric.key === "automatic-answer-completeness");
        assert.deepEqual(published?.value, { state: "available", value: 279 });
        assert.equal(answerCompleteness?.value.state, "integration_pending");
        assert.match(answerCompleteness?.value.reason ?? "", /0009/u);
    });

    it("keeps policy-required and no-data datasets distinct", () => {
        const report = reportFixture();
        report.privacyPolicy = {
            state: "not_configured",
            policyKey: "admin_platform_reporting",
            minimumDistinctLearners: null,
            effectiveAt: null,
        };
        report.registrations = {
            state: "no_data",
            total: { state: "no_data", value: null, reason: "無資料" },
            trend: [],
        };
        report.learners.grades = { state: "policy_required", rows: [] };
        report.practice.nonScoreActivity = {
            activeLearners: {
                state: "policy_required",
                value: null,
                reason: "尚未啟用管理報表的統計隱私政策。",
            },
            attempts: {
                state: "policy_required",
                value: null,
                reason: "尚未啟用管理報表的統計隱私政策。",
            },
            results: { state: "policy_required", rows: [] },
        };
        const query = resolveAdminReportQuery(
            "30d",
            new Date("2026-10-16T08:00:00.000Z"),
        );
        const view = buildReportsViewModel({ range: "30d", query, report });

        assert.equal(view.registrationTrend.rows[0]?.value.state, "no_data");
        assert.equal(view.gradeDistribution.rows[0]?.value.state, "policy_required");
        assert.equal(
            view.activity.metrics.find((metric) => metric.key === "active-learners")?.value.state,
            "policy_required",
        );
        assert.equal(view.privacyPolicyNotice?.tone, "warning");
    });
});
