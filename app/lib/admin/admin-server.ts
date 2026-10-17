import "server-only";

import type { PoolClient, QueryResultRow } from "pg";

import {
    LocalPostgresUnavailableError,
    queryLocalPostgres,
    withLocalPostgresReadTransaction,
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

type LocalPostgresReadTransaction = <T>(
    operation: (client: PoolClient) => Promise<T>,
) => Promise<T>;

function unavailableAdminDatabaseError(): AdminApiError {
    return new AdminApiError(
        "INTERNAL_ERROR",
        "管理後台資料庫暫時無法使用，請稍後再試。",
        503,
    );
}

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
                    throw unavailableAdminDatabaseError();
                }
                throw error;
            }
        },
    };
}

export const adminPostgresRunner = createAdminPostgresRunner();

/**
 * Keeps authorization and every aggregate in one read-only repeatable-read
 * database snapshot. The callback receives only the repository-sized query
 * interface, never the connection lifecycle methods.
 */
export async function withAdminReadOnlySnapshot<T>(
    operation: (runner: AdminQueryRunner) => Promise<T>,
    transaction: LocalPostgresReadTransaction = withLocalPostgresReadTransaction,
): Promise<T> {
    try {
        return await transaction(async (client) => {
            const runner = createAdminPostgresRunner(
                async <Row extends QueryResultRow>(
                    text: string,
                    values: readonly unknown[] = [],
                ): Promise<AdminQueryResult<Row>> => client.query<Row>(text, [...values]),
            );
            return operation(runner);
        });
    }
    catch (error) {
        if (error instanceof LocalPostgresUnavailableError) {
            throw unavailableAdminDatabaseError();
        }
        throw error;
    }
}

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
