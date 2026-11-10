import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import type { PublicBookingInput } from "../application/booking-input";
import { codeFromBytes } from "../domain/booking-code";
import type { PeriodError } from "../domain/period-rules";
import { normalizePhone } from "../domain/phone";
import { price } from "../domain/pricing";
import { readSettings, resolvePeriod, type BookingSettings } from "./availability";

// BKG-02 prepare and BKG-03 submit (docs/06-backend-api.md 6.x, 5.2, 5.6). The
// submit runs in one tenant transaction: idempotency lock + replay, vehicle row lock, rules and price
// re-checked, per-phone open-booking cap, customer resolved without overwriting, then the insert.
// The exclusion constraint is the final guarantee: a concurrent overlap fails with 23P01.

const MAX_OPEN_PER_PHONE = 3;
const CODE_ATTEMPTS = 5;

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
  | { ok: true; code: string; replayed: boolean }
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

async function lock(c: pg.ClientBase, key: string): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function replay(
  c: pg.ClientBase,
  tenantId: string,
  input: { idempotencyKey: string; vehicleId: string },
): Promise<SubmitResult | null> {
  await lock(c, `idem:${tenantId}:${input.idempotencyKey}`);
  const res = await c.query<{ code: string; vehicle_id: string }>(
    "SELECT code, vehicle_id FROM bookings WHERE tenant_id = $1 AND idempotency_key = $2",
    [tenantId, input.idempotencyKey],
  );
  const row = res.rows[0];
  if (!row) return null;
  return row.vehicle_id === input.vehicleId
    ? { ok: true, code: row.code, replayed: true }
    : { ok: false, code: "IDEMPOTENCY_KEY_REUSED" };
}

async function openBookingsForPhone(c: pg.ClientBase, tenantId: string, phone: string, now: Date) {
  await lock(c, `phone:${tenantId}:${phone}`);
  const res = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings b JOIN customers cu ON cu.id = b.customer_id
      WHERE b.tenant_id = $1 AND cu.phone = $2 AND b.status IN ('confirmed', 'active') AND b.end_at > $3`,
    [tenantId, phone, now],
  );
  return res.rows[0]?.n ?? 0;
}

/** CUS-06: an existing customer (same phone) is reused and never overwritten (5.6). */
async function resolveCustomer(
  c: pg.ClientBase,
  tenantId: string,
  input: { firstName: string; lastName: string; phone: string; email?: string | undefined },
): Promise<string> {
  await c.query(
    `INSERT INTO customers (id, tenant_id, first_name, last_name, phone, email)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, phone) DO NOTHING`,
    [randomUUID(), tenantId, input.firstName, input.lastName, input.phone, input.email ?? null],
  );
  const res = await c.query<{ id: string }>(
    "SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2",
    [tenantId, input.phone],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("customer not resolved");
  return id;
}

interface NewBooking {
  tenantId: string;
  vehicleId: string;
  customerId: string;
  input: PublicBookingInput;
  start: Date;
  end: Date;
  bufferMinutes: number;
  price: { billedDays: number; dailyPriceMinor: number; totalMinor: number };
  idempotencyKey: string;
  now: Date;
}

async function insertBooking(
  c: pg.ClientBase,
  b: NewBooking,
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const id = randomUUID();
    const code = codeFromBytes(randomBytes(10));
    const res = await c.query(
      `INSERT INTO bookings (id, tenant_id, code, vehicle_id, customer_id, customer_first_name,
          customer_last_name, customer_email, start_at, end_at, buffer_minutes, status, status_changed_at,
          daily_price_minor, billed_days, total_minor, source, idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', $12, $13, $14, $15, 'public', $16, $12, $12)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [
        id,
        b.tenantId,
        code,
        b.vehicleId,
        b.customerId,
        b.input.firstName,
        b.input.lastName,
        b.input.email ?? null,
        b.start,
        b.end,
        b.bufferMinutes,
        b.now,
        b.price.dailyPriceMinor,
        b.price.billedDays,
        b.price.totalMinor,
        b.idempotencyKey,
      ],
    );
    if (res.rowCount === 1) return { id, code };
  }
  throw new Error("could not generate a unique booking code");
}

async function auditCreated(
  c: pg.ClientBase,
  b: NewBooking,
  created: { id: string; code: string },
) {
  const changes = {
    vehicleId: b.vehicleId,
    startAt: b.start.toISOString(),
    endAt: b.end.toISOString(),
    ...b.price,
    status: "confirmed",
    source: "public",
    customerId: b.customerId,
  };
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, action, entity_type, entity_id, entity_ref, changes)
     VALUES ($1, $2, $3, 'public', 'booking.created', 'booking', $4, $5, $6)`,
    [randomUUID(), b.tenantId, b.now, created.id, created.code, JSON.stringify(changes)],
  );
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
      input,
      start: period.start,
      end: period.end,
      bufferMinutes: s.buffer_minutes,
      price: p,
      idempotencyKey: ctx.idempotencyKey,
      now: ctx.now,
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
  await auditCreated(c, booking, created);
  return { ok: true, code: created.code, replayed: false };
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
