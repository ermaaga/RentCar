import type pg from "pg";

/**
 * Runs fn in one transaction after setting the session GUCs. They are transaction-local
 * (set_config(..., true)) because the pooler reuses connections (05-database 4.2). Rolls back on error.
 */
export async function withScopedTx<T>(
  pool: pg.Pool,
  gucs: { tenantId: string; scope: "tenant" | "system" },
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope', $2, true)",
      [gucs.tenantId, gucs.scope],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
