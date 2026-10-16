import "server-only";

import { userInfo } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

const DEFAULT_PORT = 55432;
const DEFAULT_DATABASE = "lerniqa_local";

export class LocalPostgresUnavailableError extends Error {
  readonly code = "LOCAL_POSTGRES_UNAVAILABLE";

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LocalPostgresUnavailableError";

    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
      });
    }
  }
}

type LocalPostgresConfig = Readonly<{
  socket: string;
  port: number;
  database: string;
  user: string;
}>;

type GlobalWithLocalPostgres = typeof globalThis & {
  __lerniqaLocalPostgresPool?: Pool;
};

const globalWithLocalPostgres = globalThis as GlobalWithLocalPostgres;

function readOptionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();

  if (value === "") {
    throw new LocalPostgresUnavailableError(
      `${name} 不可為空字串；請移除它以使用本機預設值。`,
    );
  }

  return value;
}

function readPort(): number {
  const configuredPort = readOptionalEnvironmentValue("LOCAL_PG_PORT");
  if (configuredPort === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(configuredPort)) {
    throw new LocalPostgresUnavailableError(
      "LOCAL_PG_PORT 必須是 1 到 65535 的整數。",
    );
  }

  const port = Number(configuredPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new LocalPostgresUnavailableError(
      "LOCAL_PG_PORT 必須是 1 到 65535 的整數。",
    );
  }

  return port;
}

function readConfig(): LocalPostgresConfig {
  const socket =
    readOptionalEnvironmentValue("LOCAL_PG_SOCKET") ??
    path.join(process.cwd(), "local-data", "postgres-socket");

  if (!path.isAbsolute(socket)) {
    throw new LocalPostgresUnavailableError(
      "LOCAL_PG_SOCKET 必須是絕對路徑。",
    );
  }

  return {
    socket,
    port: readPort(),
    database:
      readOptionalEnvironmentValue("LOCAL_PG_DATABASE") ?? DEFAULT_DATABASE,
    user: readOptionalEnvironmentValue("LOCAL_PG_USER") ?? userInfo().username,
  };
}

function unavailableMessage(config: LocalPostgresConfig): string {
  return `無法使用本機 PostgreSQL（socket=${config.socket} port=${config.port} database=${config.database} user=${config.user}）。請先執行 npm run db:local:ensure。`;
}

function isUnavailableError(error: unknown): boolean {
  if (error instanceof LocalPostgresUnavailableError) {
    return true;
  }

  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = String(error.code);
  return (
    code.startsWith("08") ||
    code.startsWith("28") ||
    [
      "3D000",
      "53300",
      "57P01",
      "57P02",
      "57P03",
      "EACCES",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOENT",
      "ENOTDIR",
      "EPIPE",
      "ETIMEDOUT",
    ].includes(code)
  );
}

function rethrowDatabaseError(
  error: unknown,
  config: LocalPostgresConfig,
): never {
  if (error instanceof LocalPostgresUnavailableError) {
    throw error;
  }

  if (isUnavailableError(error)) {
    throw new LocalPostgresUnavailableError(
      unavailableMessage(config),
      error,
    );
  }

  throw error;
}

function createPool(): Pool {
  const config = readConfig();
  const pool = new Pool({
    host: config.socket,
    port: config.port,
    database: config.database,
    user: config.user,
    password: async () => {
      throw new LocalPostgresUnavailableError(
        "隔離 PostgreSQL 不應要求密碼；請確認連線指向 npm run db:local:ensure 建立的 Unix socket。",
      );
    },
    ssl: false,
    application_name: "lerniqa-local-app",
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    allowExitOnIdle: true,
  });

  pool.on("error", (error) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "UNKNOWN";
    console.error(`[local-postgres] idle connection error (${code})`);
  });

  return pool;
}

function getPool(): Pool {
  if (globalWithLocalPostgres.__lerniqaLocalPostgresPool === undefined) {
    globalWithLocalPostgres.__lerniqaLocalPostgresPool = createPool();
  }

  return globalWithLocalPostgres.__lerniqaLocalPostgresPool;
}

export async function queryLocalPostgres<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  if (text.trim() === "") {
    throw new TypeError("PostgreSQL query 不可為空字串。");
  }

  const config = readConfig();
  try {
    return await getPool().query<T>(text, [...params]);
  } catch (error) {
    rethrowDatabaseError(error, config);
  }
}

export async function withLocalPostgresTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const config = readConfig();
  let client: PoolClient;

  try {
    client = await getPool().connect();
  } catch (error) {
    rethrowDatabaseError(error, config);
  }

  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure; the broken connection is discarded below.
      }
    }

    rethrowDatabaseError(error, config);
  } finally {
    client.release();
  }
}

export async function closeLocalPostgresPool(): Promise<void> {
  const pool = globalWithLocalPostgres.__lerniqaLocalPostgresPool;
  if (pool === undefined) {
    return;
  }

  delete globalWithLocalPostgres.__lerniqaLocalPostgresPool;
  const config = readConfig();

  try {
    await pool.end();
  } catch (error) {
    rethrowDatabaseError(error, config);
  }
}
