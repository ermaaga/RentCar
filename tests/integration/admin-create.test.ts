import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  createAdminBooking,
  staffVehicleOptions,
  submitPublicBooking,
} from "../../src/modules/booking";
import { addShop, addVehicle, ctx, input, now } from "../support/booking-fixtures";

// BKG-06 createAdminBooking and the W-D5 vehicle list as the runtime role: staff period rules
// (A-24), maintenance and archive rules, conflicts named, status from time, payment, idempotency.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const enabled = Boolean(adminUrl && appUrl);

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function setup() {
  const shop = await addShop(admin);
  const user = await admin.query<{ id: string }>(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, status)
     VALUES (gen_random_uuid(), $1, 'admin', $2, 'Boss', 'boss@example.test', 'pending') RETURNING id`,
    [shop.tenantId, `boss-${shop.tenantId.slice(0, 8)}`],
  );
  const actor = { userId: user.rows[0]?.id ?? "", role: "admin" };
  const create = (extra: Partial<Parameters<typeof createAdminBooking>[1]> = {}) =>
    createAdminBooking(
      app,
      {
        vehicleId: shop.vehicleId,
        pickup: "2026-06-03T10:00",
        return: "2026-06-05T10:00",
        customer: { firstName: "Anna", lastName: "Bianchi", phone: "333 765 4321" },
        paidWith: null,
        notes: null,
        idempotencyKey: randomUUID(),
        ...extra,
      },
      { tenantId: shop.tenantId, now, actor },
    );
  const row = async (code: string) =>
    (
      await admin.query<Record<string, unknown>>(
        `SELECT status, source, is_paid, payment_method, paid_amount_minor, total_minor, notes,
                created_by_user_id IS NOT NULL AS by_user,
                (SELECT count(*)::int FROM email_log e WHERE e.related_id = b.id) AS emails,
                (SELECT actor_type FROM audit_log a WHERE a.entity_id = b.id) AS actor
           FROM bookings b WHERE code = $1`,
        [code],
      )
    ).rows[0];
  return { shop, create, row };
}

describe.skipIf(!enabled)("admin create (BKG-06): status, payment and audit", () => {
  it("creates a future booking paid in full, with no email and a user audit row", async () => {
    const s = await setup();
    const result = await s.create({ paidWith: "cash", notes: "Child seat" });
    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(await s.row(result.ok ? result.code : "")).toEqual({
      status: "confirmed",
      source: "admin",
      is_paid: true,
      payment_method: "cash",
      paid_amount_minor: "12000",
      total_minor: "12000",
      notes: "Child seat",
      by_user: true,
      emails: 0,
      actor: "user",
    });
  });

  it("records a past period as completed and one spanning now as active, ignoring the lead time", async () => {
    const s = await setup();
    const past = await s.create({ pickup: "2026-05-20T10:00", return: "2026-05-22T10:00" });
    const spanning = await s.create({ pickup: "2026-05-31T10:00", return: "2026-06-02T10:00" });
    expect((await s.row(past.ok ? past.code : ""))?.status).toBe("completed");
    expect((await s.row(spanning.ok ? spanning.code : ""))?.status).toBe("active");
  });

  it("still applies the lead time to a future pickup", async () => {
    const s = await setup();
    expect(await s.create({ pickup: "2026-06-01T08:30", return: "2026-06-02T10:00" })).toEqual({
      ok: false,
      code: "LEAD_TIME_NOT_MET",
    });
  });
});

describe.skipIf(!enabled)("admin create (BKG-06): refusals", () => {
  it("names the conflicting booking", async () => {
    const s = await setup();
    const taken = await submitPublicBooking(app, input(s.shop.vehicleId), ctx(s.shop.tenantId));
    const result = await s.create();
    expect(result).toEqual({
      ok: false,
      code: "BOOKING_CONFLICT",
      conflict: {
        code: taken.ok ? taken.code : "",
        pickup: "2026-06-03T10:00",
        return: "2026-06-05T10:00",
      },
    });
  });

  it("refuses maintenance for future periods only, archived vehicles and other tenants' vehicles", async () => {
    const s = await setup();
    await admin.query("UPDATE vehicles SET status = 'maintenance' WHERE id = $1", [
      s.shop.vehicleId,
    ]);
    expect(await s.create()).toEqual({ ok: false, code: "VEHICLE_IN_MAINTENANCE" });
    expect((await s.create({ pickup: "2026-05-20T10:00", return: "2026-05-22T10:00" })).ok).toBe(
      true,
    );
    const archived = await addVehicle(admin, s.shop.tenantId);
    await admin.query("UPDATE vehicles SET archived_at = now() WHERE id = $1", [archived]);
    expect(await s.create({ vehicleId: archived })).toEqual({
      ok: false,
      code: "VEHICLE_ARCHIVED",
    });
    const other = await addShop(admin);
    expect(await s.create({ vehicleId: other.vehicleId })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe.skipIf(!enabled)("admin create (BKG-06): idempotency", () => {
  it("replays the same key and refuses it for another vehicle", async () => {
    const s = await setup();
    const key = randomUUID();
    const first = await s.create({ idempotencyKey: key });
    expect(await s.create({ idempotencyKey: key })).toEqual({
      ok: true,
      code: first.ok ? first.code : "",
      replayed: true,
    });
    const second = await addVehicle(admin, s.shop.tenantId);
    expect(await s.create({ idempotencyKey: key, vehicleId: second })).toEqual({
      ok: false,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });
});

describe.skipIf(!enabled)("admin create (BKG-06): vehicle options (W-D5)", () => {
  it("lists every live vehicle with its state, price and conflicting booking", async () => {
    const s = await setup();
    const taken = await submitPublicBooking(app, input(s.shop.vehicleId), ctx(s.shop.tenantId));
    const spare = await addVehicle(admin, s.shop.tenantId);
    await admin.query("UPDATE vehicles SET status = 'maintenance' WHERE id = $1", [spare]);
    const free = await addVehicle(admin, s.shop.tenantId);
    const result = await staffVehicleOptions(
      app,
      { pickup: "2026-06-04T10:00", return: "2026-06-06T10:00" },
      { tenantId: s.shop.tenantId, now },
    );
    if (!result.ok) throw new Error(result.code);
    const byId = Object.fromEntries(result.options.map((o) => [o.id, o]));
    expect(byId[s.shop.vehicleId]).toMatchObject({
      state: "booked",
      conflict: { code: taken.ok ? taken.code : "" },
    });
    expect(byId[spare]?.state).toBe("maintenance");
    expect(byId[free]).toMatchObject({ state: "available", totalMinor: 12000, conflict: null });
    expect(result).toMatchObject({ billedDays: 3, past: false });
  });
});
