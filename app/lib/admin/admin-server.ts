import "server-only";

import type { QueryResultRow } from "pg";

import {
    LocalPostgresUnavailableError,
    queryLocalPostgres,
} from "../local-postgres.ts";
import {
    type AdminQueryResult,
    type AdminQueryRunner,
    requireSystemAdmin,
    type SystemAdminActor,
} from "./admin-auth.ts";
import { AdminApiError } from "./admin-types.ts";

type LocalPostgresQuery = <Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
) => Promise<AdminQueryResult<Row>>;

/**
 * Adapts the shared PostgreSQL connection to the deliberately small admin
 * repository interface. Connection details stay on the server and are never
 * copied into an HTTP response.
 */
export function createAdminPostgresRunner(
    query: LocalPostgresQuery = queryLocalPostgres,
): AdminQueryRunner {
    return {
        async query<Row extends QueryResultRow>(
            text: string,
            values: readonly unknown[] = [],
        ): Promise<AdminQueryResult<Row>> {
            try {
                return await query<Row>(text, values);
            }
            catch (error) {
                if (error instanceof LocalPostgresUnavailableError) {
                    throw new AdminApiError(
                        "INTERNAL_ERROR",
                        "管理後台資料庫暫時無法使用，請稍後再試。",
                        503,
                    );
                }
                throw error;
            }
        },
    };
}

export const adminPostgresRunner = createAdminPostgresRunner();

export interface AdminReadContext {
    actor: SystemAdminActor;
    runner: AdminQueryRunner;
}

/**
 * Every production admin endpoint must create this context before parsing
 * endpoint-specific input or reading admin data.
 */
export async function requireAdminReadContext(
    request: Request,
    runner: AdminQueryRunner = adminPostgresRunner,
): Promise<AdminReadContext> {
    const actor = await requireSystemAdmin(request, runner);
    return { actor, runner };
}
