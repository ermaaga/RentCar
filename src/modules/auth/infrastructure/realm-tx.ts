import type pg from "pg";

import { withSystemTx } from "../../../platform/db/system-tx";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import type { Realm } from "../domain/realm";

/** Runs fn in the database scope of the realm: the tenant scope, or the system scope. */
export function withRealmTx<T>(
  pool: pg.Pool,
  realm: Realm,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return realm.kind === "tenant" ? withTenantTx(pool, realm.tenantId, fn) : withSystemTx(pool, fn);
}
