import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { normalizeCode } from "../domain/booking-code";
import { formatLocal } from "../domain/local-time";

// BKG-04 getPublicConfirmation (docs/06-backend-api.md 6.x, FR-PUB-07).

export interface PublicConfirmation {
  code: string;
  firstName: string;
  vehicleName: string;
  pickup: string;
  return: string;
  billedDays: number;
  totalMinor: number;
  status: string;
}

/** BKG-04: by tenant and code only; first name only, never phone or email (UX-7). */
export async function getPublicConfirmation(
  pool: pg.Pool,
  input: { tenantId: string; code: string },
): Promise<PublicConfirmation | null> {
  const code = normalizeCode(input.code);
  if (!code) return null;
  return withTenantTx(pool, input.tenantId, async (c) => {
    const res = await c.query<{
      first: string;
      vehicle: string;
      start_at: Date;
      end_at: Date;
      billed_days: number;
      total_minor: string;
      status: string;
      time_zone: string;
    }>(
      `SELECT b.customer_first_name AS first, v.name AS vehicle, b.start_at, b.end_at, b.billed_days,
              b.total_minor, b.status, t.time_zone
         FROM bookings b JOIN vehicles v ON v.id = b.vehicle_id JOIN tenants t ON t.id = b.tenant_id
        WHERE b.tenant_id = $1 AND b.code = $2`,
      [input.tenantId, code],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      code,
      firstName: row.first,
      vehicleName: row.vehicle,
      pickup: formatLocal(row.start_at, row.time_zone),
      return: formatLocal(row.end_at, row.time_zone),
      billedDays: row.billed_days,
      totalMinor: Number(row.total_minor),
      status: row.status,
    };
  });
}
