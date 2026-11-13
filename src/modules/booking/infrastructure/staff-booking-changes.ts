import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { normalizeCode } from "../domain/booking-code";
import type { BookingStatus } from "../domain/booking-status";
import {
  decidePayment,
  decideStatusChange,
  type PaymentChange,
  type StatusError,
  type StatusTarget,
} from "../domain/status-change";

// BKG-09 changeBookingStatus and BKG-10 setPayment (docs/06-backend-api.md 5.3, FR-BKG-03/04/07/09).
// One tenant transaction each: the booking row is locked, the version checked (FR-BKG-19), a stale
// stored status is materialised first with an automatic audit row, then the change and its audit row
// are written. Both are allowed while the tenant is read-only (BE-1).

interface Actor {
  userId: string;
  role: string;
}

export interface ChangeCtx {
  tenantId: string;
  now: Date;
  timeZone: string;
  actor: Actor;
}

interface Locked {
  id: string;
  code: string;
  status: BookingStatus;
  start_at: Date;
  end_at: Date;
  daily_price_minor: string;
  billed_days: number;
  total_minor: string;
  is_paid: boolean;
  payment_method: "card" | "cash" | null;
  paid_amount_minor: string;
  version: number;
}

export type ChangeError =
  StatusError | "NOT_FOUND" | "BOOKING_STALE" | "PAYMENT_CONFIRMATION_REQUIRED";
export type ChangeResult =
  { ok: true; changed: boolean; refundOutsideSystem: boolean } | { ok: false; code: ChangeError };

async function lock(c: pg.ClientBase, tenantId: string, code: string): Promise<Locked | null> {
  const res = await c.query<Locked>(
    `SELECT id, code, status, start_at, end_at, daily_price_minor, billed_days, total_minor, is_paid,
            payment_method, paid_amount_minor, version
       FROM bookings WHERE tenant_id = $1 AND code = $2 FOR UPDATE`,
    [tenantId, code],
  );
  return res.rows[0] ?? null;
}

async function audit(
  c: pg.ClientBase,
  ctx: ChangeCtx,
  b: Locked,
  entry: { action: string; changes: Record<string, unknown>; auto?: boolean },
): Promise<void> {
  const user = entry.auto ? null : ctx.actor;
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, actor_user_id, actor_username,
                            actor_role, action, entity_type, entity_id, entity_ref, changes)
     VALUES ($1, $2, $3, $4, $5, (SELECT username FROM users WHERE id = $5), $6, $7, 'booking', $8,
             $9, $10)`,
    [
      randomUUID(),
      ctx.tenantId,
      ctx.now,
      user ? "user" : "system",
      user?.userId ?? null,
      user?.role ?? null,
      entry.action,
      b.id,
      b.code,
      JSON.stringify(entry.changes),
    ],
  );
}

/** Lock, check the version, and hand the row to `apply`; misses and stale versions end here. */
async function withLockedBooking(
  pool: pg.Pool,
  input: { code: string; expectedVersion: number },
  ctx: ChangeCtx,
  apply: (c: pg.ClientBase, b: Locked) => Promise<ChangeResult>,
): Promise<ChangeResult> {
  const code = normalizeCode(input.code);
  if (!code) return { ok: false, code: "NOT_FOUND" };
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const b = await lock(c, ctx.tenantId, code);
    if (!b) return { ok: false, code: "NOT_FOUND" };
    if (b.version !== input.expectedVersion) return { ok: false, code: "BOOKING_STALE" };
    return apply(c, b);
  });
}

/** 5.3: an automatic transition the job has not written yet is written before any manual change. */
async function materialise(c: pg.ClientBase, ctx: ChangeCtx, b: Locked, effective: BookingStatus) {
  if (effective === b.status) return;
  await c.query("UPDATE bookings SET status = $2, status_changed_at = $3 WHERE id = $1", [
    b.id,
    effective,
    ctx.now,
  ]);
  await audit(c, ctx, b, {
    action: "booking.status_changed",
    changes: { status: { from: b.status, to: effective }, auto: true },
    auto: true,
  });
}

/** BKG-09: mark active, complete (early completion re-prices) or cancel. */
export function changeBookingStatus(
  pool: pg.Pool,
  input: { code: string; expectedVersion: number; target: StatusTarget; reason: string | null },
  ctx: ChangeCtx,
): Promise<ChangeResult> {
  return withLockedBooking(pool, input, ctx, async (c, b) => {
    const state = {
      status: b.status,
      startAt: b.start_at,
      endAt: b.end_at,
      dailyPriceMinor: Number(b.daily_price_minor),
      isPaid: b.is_paid,
    };
    const outcome = decideStatusChange(state, input.target, ctx.now, ctx.timeZone);
    if (outcome.kind === "error") return { ok: false, code: outcome.code };
    await materialise(c, ctx, b, outcome.effective);
    if (outcome.kind === "noop") return { ok: true, changed: false, refundOutsideSystem: false };
    await applyStatus(c, ctx, b, { outcome, reason: input.reason });
    return { ok: true, changed: true, refundOutsideSystem: outcome.refundOutsideSystem };
  });
}

type Change = Extract<ReturnType<typeof decideStatusChange>, { kind: "change" }>;

interface StatusWrite {
  outcome: Change;
  reason: string | null;
}

async function updateStatusRow(c: pg.ClientBase, ctx: ChangeCtx, b: Locked, w: StatusWrite) {
  const cancel = w.outcome.status === "cancelled";
  const short = w.outcome.shortened;
  await c.query(
    `UPDATE bookings
        SET status = $2, status_changed_at = $3, version = version + 1, updated_at = $3,
            cancelled_at = CASE WHEN $4 THEN $3 ELSE cancelled_at END,
            cancel_reason = CASE WHEN $4 THEN $5 ELSE cancel_reason END,
            end_at = coalesce($6, end_at), billed_days = coalesce($7, billed_days),
            total_minor = coalesce($8, total_minor)
      WHERE id = $1`,
    [
      b.id,
      w.outcome.status,
      ctx.now,
      cancel,
      w.reason,
      short?.endAt ?? null,
      short?.billedDays ?? null,
      short?.totalMinor ?? null,
    ],
  );
}

async function applyStatus(c: pg.ClientBase, ctx: ChangeCtx, b: Locked, w: StatusWrite) {
  await updateStatusRow(c, ctx, b, w);
  const short = w.outcome.shortened;
  if (short) {
    await audit(c, ctx, b, {
      action: "booking.updated",
      changes: {
        endAt: { from: b.end_at.toISOString(), to: short.endAt.toISOString() },
        billedDays: { from: b.billed_days, to: short.billedDays },
        totalMinor: { from: Number(b.total_minor), to: short.totalMinor },
      },
    });
  }
  const cancel = w.outcome.status === "cancelled";
  await audit(c, ctx, b, {
    action: cancel ? "booking.cancelled" : "booking.status_changed",
    changes: {
      status: { from: w.outcome.effective, to: w.outcome.status },
      ...(cancel && w.reason ? { reason: w.reason } : {}),
    },
  });
}

/** BKG-10: record the payment at the current total, or clear it after a confirmation. */
export function setPayment(
  pool: pg.Pool,
  input: { code: string; expectedVersion: number; change: PaymentChange },
  ctx: ChangeCtx,
): Promise<ChangeResult> {
  return withLockedBooking(pool, input, ctx, async (c, b) => {
    const outcome = decidePayment(
      { status: b.status, totalMinor: Number(b.total_minor) },
      input.change,
    );
    if (outcome.kind === "error") return { ok: false, code: outcome.code };
    await c.query(
      `UPDATE bookings
          SET is_paid = $2, payment_method = $3, paid_amount_minor = $4,
              paid_at = CASE WHEN $2 THEN $5::timestamptz ELSE NULL END, version = version + 1, updated_at = $5
        WHERE id = $1`,
      [b.id, outcome.isPaid, outcome.method, outcome.paidAmountMinor, ctx.now],
    );
    await audit(c, ctx, b, {
      action: outcome.isPaid ? "payment.recorded" : "payment.cleared",
      changes: {
        isPaid: { from: b.is_paid, to: outcome.isPaid },
        paymentMethod: { from: b.payment_method, to: outcome.method },
        paidAmountMinor: { from: Number(b.paid_amount_minor), to: outcome.paidAmountMinor },
      },
    });
    return { ok: true, changed: true, refundOutsideSystem: false };
  });
}
