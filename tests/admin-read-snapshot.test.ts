import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string): string {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const DATA_PAGES = [
    "app/admin/page.tsx",
    "app/admin/accounts/page.tsx",
    "app/admin/questions/page.tsx",
    "app/admin/subscription-plans/page.tsx",
    "app/admin/reports/page.tsx",
    "app/admin/audit/page.tsx",
] as const;

test("every data-bearing admin page reauthorizes and reads in one snapshot", () => {
    for (const path of DATA_PAGES) {
        const page = source(path);
        assert.match(
            page,
            /withAdminReadOnlySnapshot\(async \(runner\) => \{/u,
            `${path} must open a read-only snapshot`,
        );
        assert.match(
            page,
            /const access = await readAdminPageAccessInSnapshot\(runner\);/u,
            `${path} must reauthorize with its snapshot runner`,
        );
        assert.match(
            page,
            /catch \(error\) \{\s*unstable_rethrow\(error\);/u,
            `${path} must preserve Next redirect and not-found control flow`,
        );
        assert.doesNotMatch(
            page,
            /adminPostgresRunner/u,
            `${path} must not bypass its transaction-scoped runner`,
        );
    }
});

test("dashboard, audit and report pages pass only the snapshot runner to repositories", () => {
    const dashboard = source("app/admin/page.tsx");
    assert.match(dashboard, /listAccounts\(\s*runner,/u);
    assert.match(dashboard, /listQuestions\(\s*runner,/u);
    assert.match(dashboard, /listAuditLogs\(\s*runner,/u);

    const audit = source("app/admin/audit/page.tsx");
    assert.match(audit, /listAuditLogs\(runner, query\)/u);

    const reports = source("app/admin/reports/page.tsx");
    assert.match(reports, /getAdminReportSnapshot\(runner, query\)/u);
});

const DIRECT_GET_ROUTES = [
    "app/api/v1/admin/audit/route.ts",
    "app/api/v1/admin/subscription-plans/route.ts",
    "app/api/v1/admin/subscription-plans/[planId]/route.ts",
    "app/api/v1/admin/subscription-plans/feature-definitions/route.ts",
] as const;

test("direct admin GET routes authorize before protected parsing and reads in one snapshot", () => {
    for (const path of DIRECT_GET_ROUTES) {
        const route = source(path);
        const snapshotAt = route.indexOf("withAdminReadOnlySnapshot(async (runner)");
        const authorizeAt = route.indexOf("requireAdminReadContext(request, runner)");
        assert.ok(snapshotAt >= 0, `${path} must open a read-only snapshot`);
        assert.ok(authorizeAt > snapshotAt, `${path} must authorize inside the snapshot`);
        assert.doesNotMatch(
            route,
            /adminPostgresRunner/u,
            `${path} must not bypass its transaction-scoped runner`,
        );

        const firstParseOrRead = [
            route.indexOf("new URL(request.url)"),
            route.indexOf("parseUuid("),
            route.indexOf("await context.params"),
            route.indexOf("listAuditLogs("),
            route.indexOf("listSubscriptionPlans("),
            route.indexOf("getSubscriptionPlan("),
            route.indexOf("listSubscriptionFeatureDefinitions("),
        ].filter((index) => index >= 0).sort((left, right) => left - right)[0];

        assert.ok(
            firstParseOrRead !== undefined && firstParseOrRead > authorizeAt,
            `${path} must authorize before resolving input or reading protected data`,
        );
    }
});

test("handler-backed GET routes inject the production snapshot and authorization pair", () => {
    for (const path of [
        "app/api/v1/admin/accounts/route.ts",
        "app/api/v1/admin/accounts/[userId]/route.ts",
        "app/api/v1/admin/questions/route.ts",
        "app/api/v1/admin/questions/[questionId]/route.ts",
        "app/api/v1/admin/reports/route.ts",
    ]) {
        const route = source(path);
        assert.match(route, /withSnapshot:\s*withAdminReadOnlySnapshot/u);
        assert.match(route, /authorize:\s*requireAdminReadContext/u);
        assert.doesNotMatch(route, /adminPostgresRunner/u);
    }

    const assetRoute = source("app/api/v1/admin/assets/[assetId]/route.ts");
    assert.match(assetRoute, /withSnapshot:\s*withAdminReadOnlySnapshot/u);
    assert.match(assetRoute, /authorize:\s*requireAdminReadContext/u);
    assert.doesNotMatch(assetRoute, /adminPostgresRunner/u);
});
