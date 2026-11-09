import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { localDate } from "../../subscriptions";
import type { VehicleInput } from "../application/vehicle-input";

// Vehicles (docs/06-backend-api.md FLT-01..06, 05-database 5.8). Tenant scope only. The plan limit
// counts non-archived vehicles under the `limit:vehicles` lock (SUB-04, US-013). "Rented" is derived
// from a booking that is effectively active now, never stored.

type VehicleState = "available" | "maintenance" | "rented" | "archived";

export interface VehicleRow {
  id: string;
  name: string;
  plate: string;
  make: string;
  model: string;
  category: string;
  fuelType: string;
  seats: number;
  dailyPriceMinor: number;
  notes: string | null;
  state: VehicleState;
  updatedAt: string;
}

interface DbRow {
  id: string;
  name: string;
  plate: string;
  make: string;
  model: string;
  category: string;
  fuel_type: string;
  seats: number;
  daily_price_minor: string;
  notes: string | null;
  status: "available" | "maintenance";
  archived_at: Date | null;
  rented: boolean;
  updated_at: Date;
}

const SELECT = `
  SELECT v.id, v.name, v.plate, v.make, v.model, v.category, v.fuel_type, v.seats, v.daily_price_minor,
         v.notes, v.status, v.archived_at, v.updated_at,
         EXISTS (SELECT 1 FROM bookings b
                  WHERE b.tenant_id = v.tenant_id AND b.vehicle_id = v.id AND b.status <> 'cancelled'
                    AND b.status <> 'completed' AND b.start_at <= $2 AND b.end_at > $2) AS rented
    FROM vehicles v`;

function toRow(r: DbRow): VehicleRow {
  const state: VehicleState = r.archived_at
    ? "archived"
    : r.status === "maintenance"
      ? "maintenance"
      : r.rented
        ? "rented"
        : "available";
  return {
    id: r.id,
    name: r.name,
    plate: r.plate,
    make: r.make,
    model: r.model,
    category: r.category,
    fuelType: r.fuel_type,
    seats: r.seats,
    dailyPriceMinor: Number(r.daily_price_minor),
    notes: r.notes,
    state,
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface Ctx {
  tenantId: string;
  now: Date;
}

/** FLT-05: the tenant's vehicles, archived ones only on request, natural order by name. */
export async function listVehicles(
  pool: pg.Pool,
  input: { q?: string; includeArchived?: boolean },
  ctx: Ctx,
): Promise<VehicleRow[]> {
  const res = await withTenantTx(pool, ctx.tenantId, (c) =>
    c.query<DbRow>(
      `${SELECT}
        WHERE v.tenant_id = $1 AND ($3::boolean OR v.archived_at IS NULL)
          AND ($4::text = '' OR v.name ILIKE '%' || $4 || '%' OR v.plate_normalized LIKE '%' || upper(regexp_replace($4, '[^A-Za-z0-9]', '', 'g')) || '%')
        ORDER BY (v.archived_at IS NOT NULL), lower(v.name), v.id`,
      [ctx.tenantId, ctx.now, input.includeArchived ?? false, (input.q ?? "").slice(0, 64)],
    ),
  );
  return res.rows.map(toRow);
}

/** FLT-06 (without photos and expenses yet). */
export async function getVehicle(pool: pg.Pool, id: string, ctx: Ctx): Promise<VehicleRow | null> {
  const res = await withTenantTx(pool, ctx.tenantId, (c) =>
    c.query<DbRow>(`${SELECT} WHERE v.tenant_id = $1 AND v.id = $3`, [ctx.tenantId, ctx.now, id]),
  );
  const row = res.rows[0];
  return row ? toRow(row) : null;
}

async function vehicleLimit(c: pg.ClientBase, tenantId: string, now: Date) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `limit:vehicles:${tenantId}`,
  ]);
  const tz = await c.query<{ time_zone: string }>("SELECT time_zone FROM tenants WHERE id = $1", [
    tenantId,
  ]);
  const today = localDate(now, tz.rows[0]?.time_zone ?? "UTC");
  const max = await c.query<{ max_vehicles: number }>(
    `SELECT max_vehicles FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled'
      ORDER BY (start_date <= $2::date AND end_date >= $2::date) DESC, end_date DESC LIMIT 1`,
    [tenantId, today],
  );
  const used = await c.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM vehicles WHERE tenant_id = $1 AND archived_at IS NULL",
    [tenantId],
  );
  return { used: used.rows[0]?.n ?? 0, max: max.rows[0]?.max_vehicles ?? 0 };
}

export async function vehicleUsage(
  pool: pg.Pool,
  ctx: Ctx,
): Promise<{ used: number; max: number }> {
  return withTenantTx(pool, ctx.tenantId, (c) => vehicleLimit(c, ctx.tenantId, ctx.now));
}

const isPlateTaken = (err: unknown) =>
  (err as { code?: string; constraint?: string }).code === "23505" &&
  (err as { constraint?: string }).constraint === "vehicles_tenant_plate";

export type SaveVehicleResult =
  | { ok: true; id: string }
  | { ok: false; code: "PLATE_TAKEN" | "PLAN_LIMIT_REACHED" | "NOT_FOUND" | "STALE_RECORD" };

const COLUMNS = (input: VehicleInput) => [
  input.name,
  input.plate,
  input.make,
  input.model,
  input.category,
  input.fuelType,
  input.seats,
  input.dailyPriceMinor,
  input.notes === "" ? null : (input.notes ?? null),
];

/** FLT-01. */
export async function createVehicle(
  pool: pg.Pool,
  input: VehicleInput,
  ctx: Ctx,
): Promise<SaveVehicleResult> {
  try {
    return await withTenantTx(pool, ctx.tenantId, async (c) => {
      const limit = await vehicleLimit(c, ctx.tenantId, ctx.now);
      if (limit.used >= limit.max) {
        return { ok: false, code: "PLAN_LIMIT_REACHED" };
      }
      const id = randomUUID();
      await c.query(
        `INSERT INTO vehicles (id, tenant_id, name, plate, make, model, category, fuel_type, seats,
                               daily_price_minor, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
        [id, ctx.tenantId, ...COLUMNS(input), ctx.now],
      );
      return { ok: true, id };
    });
  } catch (err) {
    if (isPlateTaken(err)) return { ok: false, code: "PLATE_TAKEN" };
    throw err;
  }
}

/** FLT-02: refused when someone saved the vehicle since the form was loaded (expectedUpdatedAt). */
export async function updateVehicle(
  pool: pg.Pool,
  input: VehicleInput & { id: string; expectedUpdatedAt: string },
  ctx: Ctx,
): Promise<SaveVehicleResult> {
  try {
    return await withTenantTx(pool, ctx.tenantId, async (c) => {
      const current = await c.query<{ updated_at: Date }>(
        "SELECT updated_at FROM vehicles WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [ctx.tenantId, input.id],
      );
      const row = current.rows[0];
      if (!row) return { ok: false, code: "NOT_FOUND" };
      if (row.updated_at.toISOString() !== input.expectedUpdatedAt) {
        return { ok: false, code: "STALE_RECORD" };
      }
      await c.query(
        `UPDATE vehicles SET name = $3, plate = $4, make = $5, model = $6, category = $7, fuel_type = $8,
                seats = $9, daily_price_minor = $10, notes = $11, updated_at = $12
          WHERE tenant_id = $1 AND id = $2`,
        [ctx.tenantId, input.id, ...COLUMNS(input), ctx.now],
      );
      return { ok: true, id: input.id };
    });
  } catch (err) {
    if (isPlateTaken(err)) return { ok: false, code: "PLATE_TAKEN" };
    throw err;
  }
}

export interface AffectedBooking {
  code: string;
  startAt: string;
  endAt: string;
}

/** FLT-03: turning maintenance on returns the bookings that stay confirmed (US-041). */
export async function setMaintenance(
  pool: pg.Pool,
  input: { id: string; on: boolean },
  ctx: Ctx,
): Promise<{ ok: true; affected: AffectedBooking[] } | { ok: false; code: "NOT_FOUND" }> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const res = await c.query(
      `UPDATE vehicles SET status = $3, updated_at = $4
        WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`,
      [ctx.tenantId, input.id, input.on ? "maintenance" : "available", ctx.now],
    );
    if ((res.rowCount ?? 0) === 0) return { ok: false, code: "NOT_FOUND" };
    if (!input.on) return { ok: true, affected: [] };
    const affected = await c.query<{ code: string; start_at: Date; end_at: Date }>(
      `SELECT code, start_at, end_at FROM bookings
        WHERE tenant_id = $1 AND vehicle_id = $2 AND status <> 'cancelled' AND end_at > $3
        ORDER BY start_at LIMIT 50`,
      [ctx.tenantId, input.id, ctx.now],
    );
    return {
      ok: true,
      affected: affected.rows.map((b) => ({
        code: b.code,
        startAt: b.start_at.toISOString(),
        endAt: b.end_at.toISOString(),
      })),
    };
  });
}

/** FLT-04: delete only a vehicle with no history; otherwise the UI offers archiving. */
export async function removeVehicle(
  pool: pg.Pool,
  input: { id: string; mode: "delete" | "archive" },
  ctx: Ctx,
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "VEHICLE_HAS_HISTORY" }> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const found = await c.query<{ history: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM bookings b WHERE b.tenant_id = v.tenant_id AND b.vehicle_id = v.id) AS history
         FROM vehicles v WHERE v.tenant_id = $1 AND v.id = $2 FOR UPDATE`,
      [ctx.tenantId, input.id],
    );
    const vehicle = found.rows[0];
    if (!vehicle) return { ok: false, code: "NOT_FOUND" };
    if (input.mode === "archive") {
      await c.query(
        "UPDATE vehicles SET archived_at = COALESCE(archived_at, $3), updated_at = $3 WHERE tenant_id = $1 AND id = $2",
        [ctx.tenantId, input.id, ctx.now],
      );
      return { ok: true };
    }
    if (vehicle.history) return { ok: false, code: "VEHICLE_HAS_HISTORY" };
    await c.query("DELETE FROM vehicles WHERE tenant_id = $1 AND id = $2", [
      ctx.tenantId,
      input.id,
    ]);
    return { ok: true };
  });
}
