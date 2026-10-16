import type { PoolClient } from "pg";

/**
 * Reports contain several related aggregates. A repeatable-read snapshot keeps
 * those aggregates on one database view while READ ONLY prevents accidental
 * writes from being added to the reporting path later.
 */
export const READ_ONLY_REPEATABLE_READ_BEGIN =
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY" as const;

type ReadTransactionClient = Pick<PoolClient, "query" | "release">;

/**
 * Runs one read-only snapshot and owns the client lifecycle. The original
 * operation error is preserved if rollback also fails; in that case the pool
 * is told to discard the broken connection.
 */
export async function runReadOnlyRepeatableReadTransaction<
    T,
    Client extends ReadTransactionClient,
>(
    client: Client,
    operation: (client: Client) => Promise<T>,
): Promise<T> {
    let transactionStarted = false;
    let discardConnection = false;

    try {
        await client.query(READ_ONLY_REPEATABLE_READ_BEGIN);
        transactionStarted = true;
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        if (transactionStarted) {
            try {
                await client.query("ROLLBACK");
            }
            catch {
                discardConnection = true;
            }
        }
        throw error;
    }
    finally {
        client.release(discardConnection);
    }
}
