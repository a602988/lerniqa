import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    parseAdminReportRange,
    resolveAdminReportQuery,
    type AdminReportRange,
} from "./admin-view-model.ts";
import type {
    AdminReportQuery,
    AdminReportSnapshot,
} from "./report-repository.ts";

export interface AdminReportRequestDependencies {
    withSnapshot: <T>(
        operation: (runner: AdminQueryRunner) => Promise<T>,
    ) => Promise<T>;
    authorize: (
        request: Request,
        runner: AdminQueryRunner,
    ) => Promise<unknown>;
    loadSnapshot: (
        runner: AdminQueryRunner,
        query: AdminReportQuery,
    ) => Promise<AdminReportSnapshot>;
    now?: () => Date;
}

export interface AdminReportRequestResult {
    range: AdminReportRange;
    query: AdminReportQuery;
    report: AdminReportSnapshot;
}

/**
 * Resolves a protected report request. Authorization intentionally runs before
 * any endpoint-specific validation or repository query.
 */
export async function loadAdminReportRequest(
    request: Request,
    dependencies: AdminReportRequestDependencies,
): Promise<AdminReportRequestResult> {
    return dependencies.withSnapshot(async (runner) => {
        await dependencies.authorize(request, runner);

        const url = new URL(request.url);
        const rangeValues = url.searchParams.getAll("range");
        const range = parseAdminReportRange({
            range: rangeValues.length > 1 ? rangeValues : rangeValues[0],
        });
        const query = resolveAdminReportQuery(
            range,
            (dependencies.now ?? (() => new Date()))(),
        );
        const report = await dependencies.loadSnapshot(runner, query);
        return { range, query, report };
    });
}
