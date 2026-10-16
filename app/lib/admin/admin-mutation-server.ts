import "server-only";

import type { PoolClient, QueryResultRow } from "pg";

import { withLocalPostgresTransaction } from "../local-postgres.ts";
import type { AdminQueryRunner } from "./admin-auth.ts";
import type { AdminMutationTransactionProvider } from "./admin-mutation-security.ts";
import { adminPostgresRunner } from "./admin-server.ts";

type LocalTransaction = <Result>(
    operation: (client: PoolClient) => Promise<Result>,
) => Promise<Result>;

export function createAdminMutationTransactionProvider(
    withTransaction: LocalTransaction = withLocalPostgresTransaction,
): AdminMutationTransactionProvider {
    return {
        async runInTransaction<Result>(
            operation: (runner: AdminQueryRunner) => Promise<Result>,
        ): Promise<Result> {
            return withTransaction(async (client) => operation({
                async query<Row extends QueryResultRow>(
                    text: string,
                    values: readonly unknown[] = [],
                ) {
                    return client.query<Row>(text, [...values]);
                },
            }));
        },
    };
}

export const adminMutationDependencies = {
    readRunner: adminPostgresRunner,
    transactions: createAdminMutationTransactionProvider(),
} as const;
