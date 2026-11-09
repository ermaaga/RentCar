import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { parseLocal } from "../domain/local-time";
import { applyOfferFilter, type Offer } from "../domain/offers";
import { checkPeriod, type PeriodError } from "../domain/period-rules";
import { price } from "../domain/pricing";

// BKG-01 searchAvailability (docs/06-backend-api.md 5.2, 05-database 7.1). A vehicle is offered when
// it is not archived, not in maintenance, and no non-cancelled booking blocks [pickup, return + buffer).
// The literal `status <> 'cancelled'` lets the planner use the partial GiST index of the constraint.
// The query only informs; the exclusion constraint is the guarantee at booking time.

export interface SearchInput {
  pickup: string;
  return: string;
  category?: readonly string[] | undefined;
  fuel?: string | undefined;
  seats?: number | undefined;
  sort?: "price-asc" | "price-desc" | undefined;
}

export type SearchResult =
  | { ok: true; items: Offer[]; billedDays: number; timeZone: string }
  | { ok: false; code: PeriodError | "INVALID_LOCAL_TIME" };

interface Settings {
  time_zone: string;
  min_rental_days: number;
  max_rental_days: number;
  lead_time_minutes: number;
  buffer_minutes: number;
}

async function readSettings(c: pg.ClientBase, tenantId: string): Promise<Settings> {
  const res = await c.query<Settings>(
    `SELECT t.time_zone, s.min_rental_days, s.max_rental_days, s.lead_time_minutes, s.buffer_minutes
       FROM tenants t JOIN tenant_settings s ON s.tenant_id = t.id WHERE t.id = $1`,
    [tenantId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("tenant settings missing");
  return row;
}

interface VehicleDb {
  id: string;
  name: string;
  make: string;
  model: string;
  category: string;
  fuel_type: string;
  seats: number;
  daily_price_minor: string;
}

async function freeVehicles(
  c: pg.ClientBase,
  q: { tenantId: string; start: Date; blockedUntil: Date; input: SearchInput },
): Promise<VehicleDb[]> {
  const res = await c.query<VehicleDb>(
    `SELECT v.id, v.name, v.make, v.model, v.category, v.fuel_type, v.seats, v.daily_price_minor
       FROM vehicles v
      WHERE v.tenant_id = $1 AND v.archived_at IS NULL AND v.status = 'available'
        AND (cardinality($4::text[]) = 0 OR v.category = ANY($4::text[]))
        AND ($5::text IS NULL OR v.fuel_type = $5)
        AND ($6::int IS NULL OR v.seats >= $6)
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.vehicle_id = v.id AND b.status <> 'cancelled'
             AND b.blocked_during && tstzrange($2, $3, '[)'))`,
    [
      q.tenantId,
      q.start,
      q.blockedUntil,
      [...(q.input.category ?? [])],
      q.input.fuel ?? null,
      q.input.seats ?? null,
    ],
  );
  return res.rows;
}

export async function searchAvailability(
  pool: pg.Pool,
  input: SearchInput,
  ctx: { tenantId: string; now: Date },
): Promise<SearchResult> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const s = await readSettings(c, ctx.tenantId);
    const start = parseLocal(input.pickup, s.time_zone);
    const end = parseLocal(input.return, s.time_zone);
    if (!start || !end) return { ok: false, code: "INVALID_LOCAL_TIME" };
    const rules = {
      minRentalDays: s.min_rental_days,
      maxRentalDays: s.max_rental_days,
      leadTimeMinutes: s.lead_time_minutes,
    };
    const period = checkPeriod({ start, end }, rules, { now: ctx.now, timeZone: s.time_zone });
    if (!period.ok) return period;
    const blockedUntil = new Date(end.getTime() + s.buffer_minutes * 60_000);
    const rows = await freeVehicles(c, { tenantId: ctx.tenantId, start, blockedUntil, input });
    const items = rows.map((v) => ({
      id: v.id,
      name: v.name,
      make: v.make,
      model: v.model,
      category: v.category,
      fuelType: v.fuel_type,
      seats: v.seats,
      ...price({ start, end }, Number(v.daily_price_minor), s.time_zone),
    }));
    return {
      ok: true,
      items: applyOfferFilter(items, { sort: input.sort ?? "price-asc", category: [] }),
      billedDays: period.billedDays,
      timeZone: s.time_zone,
    };
  });
}
