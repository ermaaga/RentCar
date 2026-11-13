import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { effectiveStatus } from "../domain/booking-status";
import { formatLocal } from "../domain/local-time";
import type { PeriodError } from "../domain/period-rules";
import { normalizePhone } from "../domain/phone";
import { price } from "../domain/pricing";
import { readSettings, resolvePeriod, type BookingSettings } from "./availability";
import { auditCreated, insertBooking, replayed, resolveCustomer } from "./booking-writes";

// BKG-06 createAdminBooking (docs/06-backend-api.md, W-D5, FR-BKG-06/08, US-051/055): the public
// rules with the staff exceptions of A-24 (a past pickup is allowed and skips the lead time), the
// maintenance rule (only bookings ending after now are refused), status derived from time, an
// optional payment in full, no customer notification. The conflicting booking is named.

type PeriodCode = PeriodError | "INVALID_LOCAL_TIME";

interface Conflict {
  code: string;
  pickup: string;
  return: string;
}

export interface StaffVehicleOption {
  id: string;
  name: string;
  plate: string;
  dailyPriceMinor: number;
  totalMinor: number;
  state: "available" | "booked" | "maintenance";
  conflict: Conflict | null;
}

interface OptionRow {
  id: string;
  name: string;
  plate: string;
  status: string;
  daily_price_minor: string;
  conflict_code: string | null;
  conflict_start: Date | null;
  conflict_end: Date | null;
}

/** First non-cancelled booking of the vehicle overlapping the blocked range, if any. */
const CONFLICT_SQL = `LEFT JOIN LATERAL (
    SELECT b.code, b.start_at, b.end_at FROM bookings b
     WHERE b.vehicle_id = v.id AND b.status <> 'cancelled' AND b.blocked_during && tstzrange($2, $3, '[)')
     ORDER BY b.start_at LIMIT 1) x ON true`;

function toConflict(r: OptionRow, timeZone: string): Conflict | null {
  if (!r.conflict_code || !r.conflict_start || !r.conflict_end) return null;
  return {
    code: r.conflict_code,
    pickup: formatLocal(r.conflict_start, timeZone),
    return: formatLocal(r.conflict_end, timeZone),
  };
}

function optionState(r: OptionRow, end: Date, now: Date): StaffVehicleOption["state"] {
  if (r.conflict_code) return "booked";
  return r.status === "maintenance" && end.getTime() > now.getTime() ? "maintenance" : "available";
}

export type StaffOptionsResult =
  | { ok: true; billedDays: number; past: boolean; options: StaffVehicleOption[] }
  | { ok: false; code: PeriodCode };

/** W-D5 section 2: every live vehicle for the period, available or with the reason it is not. */
export async function staffVehicleOptions(
  pool: pg.Pool,
  local: { pickup: string; return: string },
  ctx: { tenantId: string; now: Date },
): Promise<StaffOptionsResult> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const s = await readSettings(c, ctx.tenantId);
    const period = resolvePeriod(s, local, ctx.now, true);
    if (!period.ok) return period;
    const res = await c.query<OptionRow>(
      `SELECT v.id, v.name, v.plate, v.status, v.daily_price_minor, x.code AS conflict_code,
              x.start_at AS conflict_start, x.end_at AS conflict_end
         FROM vehicles v ${CONFLICT_SQL}
        WHERE v.tenant_id = $1 AND v.archived_at IS NULL
        ORDER BY lower(v.name), v.id`,
      [ctx.tenantId, period.start, period.blockedUntil],
    );
    return {
      ok: true,
      billedDays: period.billedDays,
      past: period.end.getTime() <= ctx.now.getTime(),
      options: res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        plate: r.plate,
        dailyPriceMinor: Number(r.daily_price_minor),
        totalMinor: price(period, Number(r.daily_price_minor), s.time_zone).totalMinor,
        state: optionState(r, period.end, ctx.now),
        conflict: toConflict(r, s.time_zone),
      })),
    };
  });
}

export interface AdminCreateInput {
  vehicleId: string;
  pickup: string;
  return: string;
  customer: { firstName: string; lastName: string; phone: string; email?: string | undefined };
  paidWith: "card" | "cash" | null;
  notes: string | null;
  idempotencyKey: string;
}

export interface AdminCreateCtx {
  tenantId: string;
  now: Date;
  actor: { userId: string; role: string };
}

export type AdminCreateResult =
  | { ok: true; code: string; replayed: boolean }
  | {
      ok: false;
      code:
        | PeriodCode
        | "NOT_FOUND"
        | "VEHICLE_ARCHIVED"
        | "VEHICLE_IN_MAINTENANCE"
        | "PHONE_INVALID"
        | "IDEMPOTENCY_KEY_REUSED";
    }
  | { ok: false; code: "BOOKING_CONFLICT"; conflict: Conflict | null };

type Checked =
  | { ok: true; row: OptionRow; period: { start: Date; end: Date; blockedUntil: Date } }
  | Exclude<AdminCreateResult, { ok: true }>;

/** The locked vehicle row and the period, or the first rule the request breaks. */
async function checkVehicle(
  c: pg.ClientBase,
  s: BookingSettings,
  input: AdminCreateInput,
  ctx: AdminCreateCtx,
): Promise<Checked> {
  const period = resolvePeriod(s, input, ctx.now, true);
  if (!period.ok) return period;
  const res = await c.query<OptionRow & { archived: boolean }>(
    `SELECT v.id, v.name, v.plate, v.status, v.daily_price_minor, v.archived_at IS NOT NULL AS archived,
            x.code AS conflict_code, x.start_at AS conflict_start, x.end_at AS conflict_end
       FROM vehicles v ${CONFLICT_SQL}
      WHERE v.tenant_id = $1 AND v.id = $4
        FOR UPDATE OF v`,
    [ctx.tenantId, period.start, period.blockedUntil, input.vehicleId],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, code: "NOT_FOUND" };
  if (row.archived) return { ok: false, code: "VEHICLE_ARCHIVED" };
  const state = optionState(row, period.end, ctx.now);
  if (state === "maintenance") return { ok: false, code: "VEHICLE_IN_MAINTENANCE" };
  if (state === "booked") {
    return { ok: false, code: "BOOKING_CONFLICT", conflict: toConflict(row, s.time_zone) };
  }
  return { ok: true, row, period };
}

async function createInTx(
  c: pg.ClientBase,
  input: AdminCreateInput,
  ctx: AdminCreateCtx,
): Promise<AdminCreateResult> {
  const found = await replayed(c, ctx.tenantId, input);
  if (found) {
    return found.ok
      ? { ok: true, code: found.code, replayed: true }
      : { ok: false, code: "IDEMPOTENCY_KEY_REUSED" };
  }
  const s = await readSettings(c, ctx.tenantId);
  const phone = normalizePhone(input.customer.phone, s.country_code);
  if (!phone) return { ok: false, code: "PHONE_INVALID" };
  const checked = await checkVehicle(c, s, input, ctx);
  if (!checked.ok) return checked;
  const { start, end } = checked.period;
  const booking = {
    tenantId: ctx.tenantId,
    vehicleId: checked.row.id,
    customerId: await resolveCustomer(c, ctx.tenantId, { ...input.customer, phone }),
    customer: input.customer,
    start,
    end,
    bufferMinutes: s.buffer_minutes,
    price: price({ start, end }, Number(checked.row.daily_price_minor), s.time_zone),
    idempotencyKey: input.idempotencyKey,
    now: ctx.now,
    status: effectiveStatus("confirmed", start, end, ctx.now),
    source: "admin" as const,
    createdByUserId: ctx.actor.userId,
    notes: input.notes,
    paidWith: input.paidWith,
  };
  const created = await insertBooking(c, booking);
  await auditCreated(c, booking, created, ctx.actor);
  return { ok: true, code: created.code, replayed: false };
}

/** BKG-06; the exclusion constraint still guards a concurrent overlap (23P01). */
export async function createAdminBooking(
  pool: pg.Pool,
  input: AdminCreateInput,
  ctx: AdminCreateCtx,
): Promise<AdminCreateResult> {
  try {
    return await withTenantTx(pool, ctx.tenantId, (c) => createInTx(c, input, ctx));
  } catch (err) {
    if ((err as { code?: string }).code === "23P01") {
      return { ok: false, code: "BOOKING_CONFLICT", conflict: null };
    }
    throw err;
  }
}
