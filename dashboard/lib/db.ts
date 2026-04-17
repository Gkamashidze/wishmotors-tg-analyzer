import "server-only";
import { Pool, type PoolConfig } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function buildPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.local.example to .env.local and configure it.",
    );
  }

  const config: PoolConfig = {
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
  };

  const forceSSL = process.env.PGSSL === "true" || url.includes("railway");
  if (forceSSL) {
    config.ssl = { rejectUnauthorized: false };
  }

  return new Pool(config);
}

const pool: Pool = global.__pgPool ?? buildPool();
if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

pool.on("error", (err) => {
  console.error("[pg] idle client error:", err.message);
});

export async function query<T = unknown>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<T[]> {
  const res = await pool.query(text, params as unknown[] | undefined);
  return res.rows as T[];
}

export async function queryOne<T = unknown>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
