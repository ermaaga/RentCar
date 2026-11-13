import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { changeBookingStatus, setPayment, submitPublicBooking } from "../../src/modules/booking";
import { addShop, ctx, input } from "../support/booking-fixtures";

// BKG-09 changeBookingStatus and BKG-10 setPayment as the runtime role: version check, row state,
// audit rows, vehicle freed on cancel, materialisation of the automatic status, tenant isolation.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const enabled = Boolean(adminUrl && appUrl);

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function staffUser(tenantId: string): Promise<string> {
  const res = await admin.query<{ id: string }>(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, status)
     VALUES (gen_random_uuid(), $1, 'admin', $2, 'Boss', 'boss@example.test', 'pending')
     RETURNING id`,
    [tenantId, `boss-${tenantId.slice(0, 8)}`],
  );
  return res.rows[0]?.id ?? "";
}

async function setup() {
  const shop = await addShop(admin);
  const booked = await submitPublicBooking(app, input(shop.vehicleId), ctx(shop.tenantId));
  if (!booked.ok) throw new Error(booked.code);
  const userId = await staffUser(shop.tenantId);
  const at = (iso: string) => ({
    tenantId: shop.tenantId,
    now: new Date(iso),
    timeZone: "Europe/Rome",
    actor: { userId, role: "admin" },
  });
  const row = async () =>
    (
      await admin.query<Record<string, unknown>>(
        `SELECT status, version, is_paid, payment_method, paid_amount_minor, total_minor, billed_days,
                end_at, cancel_reason
           FROM bookings WHERE code = $1`,
        [booked.code],
      )
    ).rows[0];
  const audits = async () =>
    (
      await admin.query<{ action: string; actor_type: string; actor_username: string | null }>(
        "SELECT action, actor_type, actor_username FROM audit_log WHERE entity_ref = $1 ORDER BY created_at, action",
        [booked.code],
      )
    ).rows;
  return { shop, code: booked.code, at, row, audits };
}

describe.skipIf(!enabled)("staff booking changes: payment (BKG-10)", () => {
  it("records a payment at the total, refuses a stale version and clears only when confirmed", async () => {
    const s = await setup();
    const paid = await setPayment(
      app,
      { code: s.code, expectedVersion: 1, change: { paid: true, method: "card" } },
      s.at("2026-06-01T07:00:00Z"),
    );
    expect(paid).toEqual({ ok: true, changed: true, refundOutsideSystem: false });
    expect(await s.row()).toMatchObject({
      is_paid: true,
      payment_method: "card",
      paid_amount_minor: "12000",
      version: 2,
    });
    const stale = await setPayment(
      app,
      { code: s.code, expectedVersion: 1, change: { paid: false, confirm: true } },
      s.at("2026-06-01T07:00:00Z"),
    );
    expect(stale).toEqual({ ok: false, code: "BOOKING_STALE" });
    const cleared = await setPayment(
      app,
      { code: s.code, expectedVersion: 2, change: { paid: false, confirm: true } },
      s.at("2026-06-01T07:00:00Z"),
    );
    expect(cleared.ok).toBe(true);
    expect(await s.row()).toMatchObject({
      is_paid: false,
      payment_method: null,
      paid_amount_minor: "0",
      version: 3,
    });
  });
});

describe.skipIf(!enabled)("staff booking changes: payment audit (BKG-10)", () => {
  it("writes one audit row per change, naming the acting user", async () => {
    const s = await setup();
    const change = { paid: true, method: "cash" } as const;
    await setPayment(
      app,
      { code: s.code, expectedVersion: 1, change },
      s.at("2026-06-01T07:00:00Z"),
    );
    const rows = await s.audits();
    expect(rows.map((a) => a.action)).toEqual(["booking.created", "payment.recorded"]);
    expect(rows[1]?.actor_type).toBe("user");
    expect(rows[1]?.actor_username).toMatch(/^boss-/);
  });
});

describe.skipIf(!enabled)("staff booking changes: status (BKG-09)", () => {
  it("materialises the automatic status, then completes early and re-prices", async () => {
    const s = await setup();
    const done = await changeBookingStatus(
      app,
      { code: s.code, expectedVersion: 1, target: "complete", reason: null },
      s.at("2026-06-04T12:00:00Z"),
    );
    expect(done.ok).toBe(true);
    expect(await s.row()).toMatchObject({
      status: "completed",
      billed_days: 2,
      total_minor: "8000",
      version: 2,
    });
    const audits = await s.audits();
    expect(
      audits.filter((a) => a.action === "booking.status_changed").map((a) => a.actor_type),
    ).toEqual(["system", "user"]);
    expect(audits.map((a) => a.action)).toContain("booking.updated");
  });
});

describe.skipIf(!enabled)("staff booking changes: cancel and isolation (BKG-09)", () => {
  it("cancels with a reason, frees the vehicle and refuses further changes", async () => {
    const s = await setup();
    const cancelled = await changeBookingStatus(
      app,
      { code: s.code, expectedVersion: 1, target: "cancel", reason: "Customer called" },
      s.at("2026-06-01T07:00:00Z"),
    );
    expect(cancelled).toEqual({ ok: true, changed: true, refundOutsideSystem: false });
    expect(await s.row()).toMatchObject({ status: "cancelled", cancel_reason: "Customer called" });
    const again = await submitPublicBooking(app, input(s.shop.vehicleId), ctx(s.shop.tenantId));
    expect(again.ok).toBe(true);
    const after = await setPayment(
      app,
      { code: s.code, expectedVersion: 2, change: { paid: true, method: "cash" } },
      s.at("2026-06-01T07:00:00Z"),
    );
    expect(after).toEqual({ ok: false, code: "BOOKING_NOT_EDITABLE" });
  });

  it("misses a booking of another tenant without changing it", async () => {
    const s = await setup();
    const other = await setup();
    const result = await changeBookingStatus(
      app,
      { code: s.code, expectedVersion: 1, target: "cancel", reason: null },
      other.at("2026-06-01T07:00:00Z"),
    );
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await s.row()).toMatchObject({ status: "confirmed", version: 1 });
  });
});
