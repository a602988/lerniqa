import assert from "node:assert/strict";
import test from "node:test";

import {
    ADMIN_REPORT_TIME_ZONE,
    REPORT_MISSING_VALUE_LABEL,
    REPORT_NO_DATA_LABEL,
    REPORT_PRIVACY_SUPPRESSED_LABEL,
    calculateReportRatio,
    createTaipeiDateRange,
    formatReportDimensionValue,
    formatReportMetricValue,
    getEmptyReportLabel,
    getPrivacySuppressionLabel,
    getTaipeiReportBucket,
} from "../app/lib/admin/admin-reporting.ts";

test("builds an inclusive-start and exclusive-next-day range in Asia/Taipei", () => {
    assert.equal(ADMIN_REPORT_TIME_ZONE, "Asia/Taipei");

    const singleDay = createTaipeiDateRange("2026-03-01", "2026-03-01");
    assert.equal(singleDay.startInclusive.toISOString(), "2026-02-28T16:00:00.000Z");
    assert.equal(singleDay.endExclusive.toISOString(), "2026-03-01T16:00:00.000Z");
    assert.equal(singleDay.startLocalDate, "2026-03-01");
    assert.equal(singleDay.endLocalDate, "2026-03-01");

    const leapRange = createTaipeiDateRange("2024-02-28", "2024-02-29");
    assert.equal(leapRange.startInclusive.toISOString(), "2024-02-27T16:00:00.000Z");
    assert.equal(leapRange.endExclusive.toISOString(), "2024-02-29T16:00:00.000Z");
});

test("rejects malformed, impossible, and reversed local date ranges", () => {
    for (const [start, end] of [
        ["2026-2-01", "2026-02-02"],
        ["2026-02-30", "2026-03-01"],
        ["2023-02-29", "2023-03-01"],
        ["0000-01-01", "0000-01-01"],
        ["2026-10-17", "2026-10-16"],
    ]) {
        assert.throws(() => createTaipeiDateRange(start, end), RangeError);
    }
});

test("assigns instants to Taipei day buckets at the UTC+8 boundary", () => {
    assert.deepEqual(
        getTaipeiReportBucket("2026-10-15T15:59:59.999Z", "day"),
        {
            granularity: "day",
            key: "2026-10-15",
            startLocalDate: "2026-10-15",
            endExclusiveLocalDate: "2026-10-16",
        },
    );
    assert.deepEqual(
        getTaipeiReportBucket("2026-10-15T16:00:00.000Z", "day"),
        {
            granularity: "day",
            key: "2026-10-16",
            startLocalDate: "2026-10-16",
            endExclusiveLocalDate: "2026-10-17",
        },
    );
});

test("uses Monday week starts and calendar month starts in Taipei", () => {
    assert.deepEqual(
        getTaipeiReportBucket("2026-10-18T12:00:00+08:00", "week"),
        {
            granularity: "week",
            key: "2026-10-12",
            startLocalDate: "2026-10-12",
            endExclusiveLocalDate: "2026-10-19",
        },
    );
    assert.deepEqual(
        getTaipeiReportBucket("2026-10-19T00:00:00+08:00", "week"),
        {
            granularity: "week",
            key: "2026-10-19",
            startLocalDate: "2026-10-19",
            endExclusiveLocalDate: "2026-10-26",
        },
    );
    assert.deepEqual(
        getTaipeiReportBucket("2026-09-30T16:00:00Z", "month"),
        {
            granularity: "month",
            key: "2026-10",
            startLocalDate: "2026-10-01",
            endExclusiveLocalDate: "2026-11-01",
        },
    );
});

test("requires explicit timezone information and rejects invalid instants", () => {
    assert.throws(
        () => getTaipeiReportBucket("2026-10-16T00:00:00", "day"),
        RangeError,
    );
    assert.throws(
        () => getTaipeiReportBucket("not-a-dateZ", "day"),
        RangeError,
    );
    assert.throws(
        () => getTaipeiReportBucket(new Date(Number.NaN), "day"),
        RangeError,
    );
    assert.throws(
        () => getTaipeiReportBucket("2026-10-16T00:00:00Z", "quarter" as never),
        RangeError,
    );
});

test("does not depend on the process timezone", () => {
    const originalTimezone = process.env.TZ;
    try {
        const results = ["UTC", "America/Los_Angeles", "Pacific/Auckland"].map((timezone) => {
            process.env.TZ = timezone;
            const range = createTaipeiDateRange("2026-10-16", "2026-10-16");
            return {
                start: range.startInclusive.toISOString(),
                end: range.endExclusive.toISOString(),
                bucket: getTaipeiReportBucket("2026-10-15T16:30:00Z", "day"),
            };
        });

        assert.deepEqual(results[1], results[0]);
        assert.deepEqual(results[2], results[0]);
    } finally {
        if (originalTimezone === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTimezone;
        }
    }
});

test("distinguishes missing dimensions, empty queries, and an actual zero", () => {
    assert.equal(formatReportDimensionValue(null), REPORT_MISSING_VALUE_LABEL);
    assert.equal(formatReportDimensionValue(undefined), REPORT_MISSING_VALUE_LABEL);
    assert.equal(formatReportDimensionValue("   \n\t"), REPORT_MISSING_VALUE_LABEL);
    assert.equal(formatReportDimensionValue("  七年級  "), "七年級");
    assert.equal(formatReportDimensionValue(0), "0");
    assert.throws(() => formatReportDimensionValue(Number.NaN), RangeError);

    assert.equal(getEmptyReportLabel([]), REPORT_NO_DATA_LABEL);
    assert.equal(getEmptyReportLabel([0]), null);
    assert.equal(formatReportMetricValue(null), REPORT_NO_DATA_LABEL);
    assert.equal(formatReportMetricValue(undefined), REPORT_NO_DATA_LABEL);
    assert.equal(formatReportMetricValue(0), "0");
});

test("returns no ratio for a zero denominator while preserving a valid zero ratio", () => {
    assert.equal(calculateReportRatio(0, 0), null);
    assert.equal(formatReportMetricValue(calculateReportRatio(0, 0)), REPORT_NO_DATA_LABEL);
    assert.equal(calculateReportRatio(0, 8), 0);
    assert.equal(formatReportMetricValue(calculateReportRatio(0, 8)), "0");
    assert.equal(calculateReportRatio(1, 4), 0.25);

    for (const [numerator, denominator] of [
        [-1, 3],
        [4, 3],
        [1, -1],
        [Number.NaN, 1],
        [1, Number.POSITIVE_INFINITY],
    ]) {
        assert.throws(() => calculateReportRatio(numerator, denominator), RangeError);
    }
});

test("suppresses small samples before exposing zero or no-data states", () => {
    assert.equal(getPrivacySuppressionLabel(2, 3), REPORT_PRIVACY_SUPPRESSED_LABEL);
    assert.equal(getPrivacySuppressionLabel(3, 3), null);
    assert.equal(
        formatReportMetricValue(0, {
            privacy: { distinctLearnerCount: 2, minimumDistinctLearners: 3 },
        }),
        REPORT_PRIVACY_SUPPRESSED_LABEL,
    );
    assert.equal(
        formatReportMetricValue(null, {
            privacy: { distinctLearnerCount: 2, minimumDistinctLearners: 3 },
        }),
        REPORT_PRIVACY_SUPPRESSED_LABEL,
    );
    assert.equal(
        formatReportMetricValue(0, {
            privacy: { distinctLearnerCount: 3, minimumDistinctLearners: 3 },
        }),
        "0",
    );

    assert.throws(() => getPrivacySuppressionLabel(-1, 3), RangeError);
    assert.throws(() => getPrivacySuppressionLabel(2.5, 3), RangeError);
    assert.throws(() => getPrivacySuppressionLabel(2, 1), RangeError);
    assert.throws(() => formatReportMetricValue(Number.NaN), RangeError);
    assert.throws(() => formatReportMetricValue(1.234, { maximumFractionDigits: 21 }), RangeError);
});
