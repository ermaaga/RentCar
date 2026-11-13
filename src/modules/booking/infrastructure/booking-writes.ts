import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

import { codeFromBytes } from "../domain/booking-code";
import type { BookingStatus } from "../domain/booking-status";

// Writes shared by the public submit (BKG-03) and the admin create (BKG-06): idempotency replay,
// customer resolution without overwrite (CUS-06, 5.6), the insert with a fresh code, and the
// `booking.created` audit row. Every function runs inside the caller's tenant transaction.

const CODE_ATTEMPTS = 5;

export async function advisoryLock(c: pg.ClientBase, key: string): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

/** The booking already made with this idempotency key: same vehicle replays, another is refused. */
export async function replayed(
  c: pg.ClientBase,
  tenantId: string,
  input: { idempotencyKey: string; vehicleId: string },
): Promise<{ ok: true; code: string } | { ok: false } | null> {
  await advisoryLock(c, `idem:${tenantId}:${input.idempotencyKey}`);
  const res = await c.query<{ code: string; vehicle_id: string }>(
    "SELECT code, vehicle_id FROM bookings WHERE tenant_id = $1 AND idempotency_key = $2",
    [tenantId, input.idempotencyKey],
  );
  const row = res.rows[0];
  if (!row) return null;
  return row.vehicle_id === input.vehicleId ? { ok: true, code: row.code } : { ok: false };
}

/** CUS-06: an existing customer (same phone) is reused and never overwritten (5.6). */
export async function resolveCustomer(
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

export interface NewBooking {
  tenantId: string;
  vehicleId: string;
  customerId: string;
  /** Snapshot of the names and email as entered for this booking (5.6). */
  customer: { firstName: string; lastName: string; email?: string | undefined };
  start: Date;
  end: Date;
  bufferMinutes: number;
  price: { billedDays: number; dailyPriceMinor: number; totalMinor: number };
  idempotencyKey: string | null;
  now: Date;
  status: BookingStatus;
  source: "public" | "admin";
  createdByUserId: string | null;
  notes: string | null;
  /** Paid in full at creation (admin only). */
  paidWith: "card" | "cash" | null;
}

function insertValues(b: NewBooking, id: string, code: string): unknown[] {
  const paid = b.paidWith !== null;
  return [
    id,
    b.tenantId,
    code,
    b.vehicleId,
    b.customerId,
    b.customer.firstName,
    b.customer.lastName,
    b.customer.email ?? null,
    b.start,
    b.end,
    b.bufferMinutes,
    b.status,
    b.now,
    b.price.dailyPriceMinor,
    b.price.billedDays,
    b.price.totalMinor,
    b.source,
    b.idempotencyKey,
    b.createdByUserId,
    b.notes,
    paid,
    b.paidWith,
    paid ? b.price.totalMinor : 0,
    paid ? b.now : null,
  ];
}

export async function insertBooking(
  c: pg.ClientBase,
  b: NewBooking,
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const id = randomUUID();
    const code = codeFromBytes(randomBytes(10));
    const res = await c.query(
      `INSERT INTO bookings (id, tenant_id, code, vehicle_id, customer_id, customer_first_name,
          customer_last_name, customer_email, start_at, end_at, buffer_minutes, status, status_changed_at,
          daily_price_minor, billed_days, total_minor, source, idempotency_key, created_by_user_id, notes,
          is_paid, payment_method, paid_amount_minor, paid_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
               $21, $22, $23, $24, $13, $13)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      insertValues(b, id, code),
    );
    if (res.rowCount === 1) return { id, code };
  }
  throw new Error("could not generate a unique booking code");
}

/** The `booking.created` audit row; staff creations name the user (actor from `users`). */
export async function auditCreated(
  c: pg.ClientBase,
  b: NewBooking,
  created: { id: string; code: string },
  actor: { userId: string; role: string } | null,
): Promise<void> {
  const changes = {
    vehicleId: b.vehicleId,
    startAt: b.start.toISOString(),
    endAt: b.end.toISOString(),
    ...b.price,
    status: b.status,
    source: b.source,
    customerId: b.customerId,
    ...(b.paidWith ? { paymentMethod: b.paidWith, isPaid: true } : {}),
  };
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, actor_user_id, actor_username,
                            actor_role, action, entity_type, entity_id, entity_ref, changes)
     VALUES ($1, $2, $3, $4, $5, (SELECT username FROM users WHERE id = $5), $6, 'booking.created',
             'booking', $7, $8, $9)`,
    [
      randomUUID(),
      b.tenantId,
      b.now,
      actor ? "user" : "public",
      actor?.userId ?? null,
      actor?.role ?? null,
      created.id,
      created.code,
      JSON.stringify(changes),
    ],
  );
}
