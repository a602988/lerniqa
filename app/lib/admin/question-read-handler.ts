import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    parseQuestionDetailQuery,
    parseQuestionListQuery,
    parseUuid,
} from "./admin-input.ts";
import type {
    AdminQuestionDetail,
    AdminQuestionPage,
} from "./question-repository.ts";

type AdminReadSnapshot = <T>(
    operation: (runner: AdminQueryRunner) => Promise<T>,
) => Promise<T>;

type AdminReadAuthorization = (
    request: Request,
    runner: AdminQueryRunner,
) => Promise<unknown>;

export interface AdminQuestionListRequestDependencies {
    withSnapshot: AdminReadSnapshot;
    authorize: AdminReadAuthorization;
    loadPage: (
        runner: AdminQueryRunner,
        query: ReturnType<typeof parseQuestionListQuery>,
    ) => Promise<AdminQuestionPage>;
}

export interface AdminQuestionDetailRequestDependencies {
    withSnapshot: AdminReadSnapshot;
    authorize: AdminReadAuthorization;
    loadDetail: (
        runner: AdminQueryRunner,
        questionId: string,
        query: ReturnType<typeof parseQuestionDetailQuery>,
    ) => Promise<AdminQuestionDetail>;
}

/**
 * Resolves a protected question list in one authorization-bound database
 * snapshot. Authorization deliberately precedes validation of protected query
 * parameters so unauthenticated callers cannot use validation as an oracle.
 */
export async function loadAdminQuestionListRequest(
    request: Request,
    dependencies: AdminQuestionListRequestDependencies,
): Promise<AdminQuestionPage> {
    return dependencies.withSnapshot(async (runner) => {
        await dependencies.authorize(request, runner);
        const query = parseQuestionListQuery(new URL(request.url).searchParams);
        return dependencies.loadPage(runner, query);
    });
}

/**
 * Resolves a protected question detail in the same snapshot that proved the
 * administrator grant. The path identifier and revision selector are parsed
 * only after that grant succeeds.
 */
export async function loadAdminQuestionDetailRequest(
    request: Request,
    resolveParams: () => Promise<{ questionId: string }>,
    dependencies: AdminQuestionDetailRequestDependencies,
): Promise<AdminQuestionDetail> {
    return dependencies.withSnapshot(async (runner) => {
        await dependencies.authorize(request, runner);
        const { questionId: rawQuestionId } = await resolveParams();
        const questionId = parseUuid(rawQuestionId, "題目識別碼");
        const query = parseQuestionDetailQuery(new URL(request.url).searchParams);
        return dependencies.loadDetail(runner, questionId, query);
    });
}
