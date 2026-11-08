import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 15_000,
  });
}

/** Readiness probe: one trivial query with a short timeout. Never returns row data. */
export async function isDatabaseReady(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
