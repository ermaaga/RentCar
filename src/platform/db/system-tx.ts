import type pg from "pg";

import { withScopedTx } from "./scoped-tx";

/**
 * Runs fn in one transaction in the system scope (systemadmin console, provisioning). No tenant id is
 * set, so tenant_isolation policies match nothing and only system_* policies apply (05-database 4.3).
 * Every caller is listed in tests/security/system-paths.md.
 */
export async function withSystemTx<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withScopedTx(pool, { tenantId: "", scope: "system" }, fn);
}
