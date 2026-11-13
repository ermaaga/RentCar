import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import type { PublicBookingInput } from "../application/booking-input";
import type { PeriodError } from "../domain/period-rules";
import { normalizePhone } from "../domain/phone";
import { price } from "../domain/pricing";
import { readSettings, resolvePeriod, type BookingSettings } from "./availability";
import { enqueueBookingCreated, type EmailStatus } from "./booking-emails";
import {
  advisoryLock,
  auditCreated,
  insertBooking,
  replayed,
  resolveCustomer,
  type NewBooking,
} from "./booking-writes";

// BKG-02 prepare and BKG-03 submit (docs/06-backend-api.md 6.x, 5.2, 5.6). The
// submit runs in one tenant transaction: idempotency lock + replay, vehicle row lock, rules and price
// re-checked, per-phone open-booking cap, customer resolved without overwriting, then the insert.
// The exclusion constraint is the final guarantee: a concurrent overlap fails with 23P01.

const MAX_OPEN_PER_PHONE = 3;

interface BookableVehicle {
  id: string;
  name: string;
  make: string;
  model: string;
  category: string;
  fuelType: string;
  seats: number;
}

type PeriodCode = PeriodError | "INVALID_LOCAL_TIME";

export type PrepareResult =
  | {
      ok: true;
      vehicle: BookableVehicle;
      billedDays: number;
      dailyPriceMinor: number;
      totalMinor: number;
    }
  | { ok: false; code: PeriodCode | "VEHICLE_TAKEN" };

interface VehicleRow {
  id: string;
  name: string;
  make: string;
  model: string;
  category: string;
  fuel_type: string;
  seats: number;
  daily_price_minor: string;
}

async function bookableVehicle(
  c: pg.ClientBase,
  q: { tenantId: string; vehicleId: string; start: Date; blockedUntil: Date; lock: boolean },
): Promise<VehicleRow | undefined> {
  const res = await c.query<VehicleRow>(
    `SELECT v.id, v.name, v.make, v.model, v.category, v.fuel_type, v.seats, v.daily_price_minor
       FROM vehicles v
      WHERE v.tenant_id = $1 AND v.id = $2 AND v.archived_at IS NULL AND v.status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.vehicle_id = v.id AND b.status <> 'cancelled'
             AND b.blocked_during && tstzrange($3, $4, '[)'))
      ${q.lock ? "FOR UPDATE OF v" : ""}`,
    [q.tenantId, q.vehicleId, q.start, q.blockedUntil],
  );
  return res.rows[0];
}

const toVehicle = (v: VehicleRow): BookableVehicle => ({
  id: v.id,
  name: v.name,
  make: v.make,
  model: v.model,
  category: v.category,
  fuelType: v.fuel_type,
  seats: v.seats,
});

/** BKG-02: the vehicle is still free for the period, with today's price. Read only. */
export async function prepareBooking(
  pool: pg.Pool,
  input: { vehicleId: string; pickup: string; return: string },
  ctx: { tenantId: string; now: Date },
): Promise<PrepareResult> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const s = await readSettings(c, ctx.tenantId);
    const period = resolvePeriod(s, input, ctx.now);
    if (!period.ok) return period;
    const v = await bookableVehicle(c, {
      ...ctx,
      ...period,
      vehicleId: input.vehicleId,
      lock: false,
    });
    if (!v) return { ok: false, code: "VEHICLE_TAKEN" };
    const p = price(period, Number(v.daily_price_minor), s.time_zone);
    return { ok: true, vehicle: toVehicle(v), ...p };
  });
}

export type SubmitResult =
  | { ok: true; code: string; replayed: boolean; emailStatus?: EmailStatus }
  | {
      ok: false;
      code:
        | PeriodCode
        | "VEHICLE_TAKEN"
        | "PHONE_INVALID"
        | "PHONE_BOOKING_LIMIT"
        | "IDEMPOTENCY_KEY_REUSED";
    }
  | { ok: false; code: "PRICE_CHANGED"; totalMinor: number };

async function replay(
  c: pg.ClientBase,
  tenantId: string,
  input: { idempotencyKey: string; vehicleId: string },
): Promise<SubmitResult | null> {
  const found = await replayed(c, tenantId, input);
  if (!found) return null;
  return found.ok
    ? { ok: true, code: found.code, replayed: true }
    : { ok: false, code: "IDEMPOTENCY_KEY_REUSED" };
}

async function openBookingsForPhone(c: pg.ClientBase, tenantId: string, phone: string, now: Date) {
  await advisoryLock(c, `phone:${tenantId}:${phone}`);
  const res = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings b JOIN customers cu ON cu.id = b.customer_id
      WHERE b.tenant_id = $1 AND cu.phone = $2 AND b.status IN ('confirmed', 'active') AND b.end_at > $3`,
    [tenantId, phone, now],
  );
  return res.rows[0]?.n ?? 0;
}

interface SubmitContext {
  tenantId: string;
  idempotencyKey: string;
  now: Date;
}

async function checkedBooking(
  c: pg.ClientBase,
  s: BookingSettings,
  input: PublicBookingInput,
  ctx: SubmitContext,
): Promise<
  { ok: true; booking: Omit<NewBooking, "customerId"> } | Exclude<SubmitResult, { ok: true }>
> {
  const period = resolvePeriod(s, input, ctx.now);
  if (!period.ok) return period;
  const v = await bookableVehicle(c, { ...ctx, ...period, vehicleId: input.vehicleId, lock: true });
  if (!v) return { ok: false, code: "VEHICLE_TAKEN" };
  const p = price(period, Number(v.daily_price_minor), s.time_zone);
  if (p.totalMinor !== input.expectedTotalMinor) {
    return { ok: false, code: "PRICE_CHANGED", totalMinor: p.totalMinor };
  }
  return {
    ok: true,
    booking: {
      tenantId: ctx.tenantId,
      vehicleId: v.id,
      customer: input,
      start: period.start,
      end: period.end,
      bufferMinutes: s.buffer_minutes,
      price: p,
      idempotencyKey: ctx.idempotencyKey,
      now: ctx.now,
      status: "confirmed",
      source: "public",
      createdByUserId: null,
      notes: null,
      paidWith: null,
    },
  };
}

async function submitInTx(
  c: pg.ClientBase,
  input: PublicBookingInput,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  const replayed = await replay(c, ctx.tenantId, { ...ctx, vehicleId: input.vehicleId });
  if (replayed) return replayed;
  const s = await readSettings(c, ctx.tenantId);
  const phone = normalizePhone(input.phone, s.country_code);
  if (!phone) return { ok: false, code: "PHONE_INVALID" };
  const checked = await checkedBooking(c, s, input, ctx);
  if (!checked.ok) return checked;
  if ((await openBookingsForPhone(c, ctx.tenantId, phone, ctx.now)) >= MAX_OPEN_PER_PHONE) {
    return { ok: false, code: "PHONE_BOOKING_LIMIT" };
  }
  const customerId = await resolveCustomer(c, ctx.tenantId, { ...input, phone });
  const booking = { ...checked.booking, customerId };
  const created = await insertBooking(c, booking);
  await auditCreated(c, booking, created, null);
  const emailStatus = await enqueueBookingCreated(c, {
    tenantId: ctx.tenantId,
    bookingId: created.id,
    customerEmail: input.email,
    now: ctx.now,
  });
  return { ok: true, code: created.code, replayed: false, emailStatus };
}

/** BKG-03 (after the form token, honeypot and schema checks of the entry point). */
export async function submitPublicBooking(
  pool: pg.Pool,
  input: PublicBookingInput,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  try {
    return await withTenantTx(pool, ctx.tenantId, (c) => submitInTx(c, input, ctx));
  } catch (err) {
    if ((err as { code?: string }).code === "23P01") return { ok: false, code: "VEHICLE_TAKEN" };
    throw err;
  }
}
