import type pg from "pg";

import { withScopedTx } from "./scoped-tx";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs fn in one transaction scoped to a tenant (RLS tenant_isolation policies apply). */
export async function withTenantTx<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) {
    throw new Error("tenant id must be a uuid");
  }
  return withScopedTx(pool, { tenantId, scope: "tenant" }, fn);
}
