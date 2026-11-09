import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { getEffectiveAccess, type EffectiveAccess } from "../domain/effective-access";

// getEffectiveAccess once per request (docs/06-backend-api.md 4.4): the tenant realm reads its own
// subscriptions (SELECT policy) and time zone; the decision itself is the pure domain function.

export async function loadEffectiveAccess(
  pool: pg.Pool,
  tenant: { tenantId: string; status: "active" | "suspended" | "terminated" },
  now: Date,
): Promise<EffectiveAccess> {
  return withTenantTx(pool, tenant.tenantId, async (c) => {
    const tz = await c.query<{ time_zone: string }>("SELECT time_zone FROM tenants WHERE id = $1", [
      tenant.tenantId,
    ]);
    const subs = await c.query<{
      start_date: string;
      end_date: string;
      status: "active" | "cancelled";
    }>(
      `SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
              status
         FROM subscriptions WHERE tenant_id = $1`,
      [tenant.tenantId],
    );
    return getEffectiveAccess(
      { status: tenant.status, timeZone: tz.rows[0]?.time_zone ?? "UTC" },
      subs.rows.map((r) => ({ startDate: r.start_date, endDate: r.end_date, status: r.status })),
      now,
    );
  });
}
