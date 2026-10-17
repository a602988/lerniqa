import type { AdminQueryRunner } from "./admin-auth.ts";
import {
    type AdminAccountDetail,
    type AdminAccountPage,
} from "./account-repository.ts";
import {
    parseAccountListQuery,
    parseUuid,
} from "./admin-input.ts";
import type { AccountListQuery } from "./admin-types.ts";

interface AdminAccountReadDependencies {
    withSnapshot: <T>(
        operation: (runner: AdminQueryRunner) => Promise<T>,
    ) => Promise<T>;
    authorize: (
        request: Request,
        runner: AdminQueryRunner,
    ) => Promise<unknown>;
}

export interface AdminAccountListRequestDependencies
    extends AdminAccountReadDependencies {
    list: (
        runner: AdminQueryRunner,
        query: AccountListQuery,
    ) => Promise<AdminAccountPage>;
}

export interface AdminAccountDetailRequestDependencies
    extends AdminAccountReadDependencies {
    load: (
        runner: AdminQueryRunner,
        userId: string,
    ) => Promise<AdminAccountDetail>;
}

/** Authorizes and reads one account-list response from the same DB snapshot. */
export async function loadAdminAccountListRequest(
    request: Request,
    dependencies: AdminAccountListRequestDependencies,
): Promise<{ query: AccountListQuery; page: AdminAccountPage }> {
    return dependencies.withSnapshot(async (runner) => {
        await dependencies.authorize(request, runner);
        const query = parseAccountListQuery(new URL(request.url).searchParams);
        const page = await dependencies.list(runner, query);
        return { query, page };
    });
}

/** Authorizes and reads all detail queries from one consistent DB snapshot. */
export async function loadAdminAccountDetailRequest(
    request: Request,
    resolveParams: () => Promise<{ userId: string }> | { userId: string },
    dependencies: AdminAccountDetailRequestDependencies,
): Promise<{ userId: string; account: AdminAccountDetail }> {
    return dependencies.withSnapshot(async (runner) => {
        await dependencies.authorize(request, runner);
        const { userId: rawUserId } = await resolveParams();
        const userId = parseUuid(rawUserId, "帳號識別碼");
        const account = await dependencies.load(runner, userId);
        return { userId, account };
    });
}
