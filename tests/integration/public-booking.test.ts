import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import {
  getPublicConfirmation,
  prepareBooking,
  publicBookingInput,
  submitPublicBooking,
} from "../../src/modules/booking";

// BKG-02/03/04 as the runtime role (docs/06-backend-api.md 5.2, 5.6; ABU-M2-01..09).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 6 });
const now = new Date("2026-06-01T06:00:00Z");

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function shop(): Promise<{ tenantId: string; vehicleId: string }> {
  const tenantId = randomUUID();
  await admin.query(
    "INSERT INTO tenants (id, slug, name, time_zone) VALUES ($1, $2, 'Shop', 'Europe/Rome')",
    [tenantId, `pb-${tenantId.slice(0, 8)}`],
  );
  await admin.query(
    `INSERT INTO tenant_settings (tenant_id, contact_email, contact_phone, title, lead_time_minutes)
     VALUES ($1, 'a@example.test', '+390612345678', 'Shop', 60)`,
    [tenantId],
  );
  return { tenantId, vehicleId: await vehicle(tenantId) };
}

async function vehicle(tenantId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO vehicles (id, tenant_id, name, plate, make, model, category, fuel_type, seats, daily_price_minor)
     VALUES ($1, $2, 'Fiat Panda', $3, 'Fiat', 'Panda', 'city', 'petrol', 4, 4000)`,
    [id, tenantId, `P${id.slice(0, 6)}`],
  );
  return id;
}

function input(vehicleId: string, extra: Record<string, unknown> = {}) {
  return publicBookingInput.parse({
    formToken: "checked-by-the-entry-point",
    vehicleId,
    pickup: "2026-06-03T10:00",
    return: "2026-06-05T10:00",
    expectedTotalMinor: 12000,
    firstName: "Mario",
    lastName: "Rossi",
    phone: "333 123 4567",
    email: "mario@example.test",
    acknowledge: true,
    ...extra,
  });
}

const ctx = (tenantId: string, idempotencyKey = randomUUID()) => ({
  tenantId,
  idempotencyKey,
  now,
});

describe.skipIf(!adminUrl || !appUrl)("public booking: prepare and submit", () => {
  it("prepares with today's price and books with snapshots, a new customer and an audit row", async () => {
    const { tenantId, vehicleId } = await shop();
    const prepared = await prepareBooking(
      app,
      { vehicleId, pickup: "2026-06-03T10:00", return: "2026-06-05T10:00" },
      { tenantId, now },
    );
    expect(prepared).toMatchObject({ ok: true, billedDays: 3, totalMinor: 12000 });
    const result = await submitPublicBooking(app, input(vehicleId), ctx(tenantId));
    expect(result).toMatchObject({ ok: true, replayed: false });
    const code = result.ok ? result.code : "";
    const row = await admin.query(
      `SELECT b.status, b.source, b.total_minor, b.customer_first_name, c.phone,
              (SELECT count(*)::int FROM audit_log a WHERE a.entity_ref = b.code
                 AND a.action = 'booking.created' AND a.actor_type = 'public') AS audits
         FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.tenant_id = $1 AND b.code = $2`,
      [tenantId, code],
    );
    expect(row.rows[0]).toEqual({
      status: "confirmed",
      source: "public",
      total_minor: "12000",
      customer_first_name: "Mario",
      phone: "+393331234567",
      audits: 1,
    });
  });
});

describe.skipIf(!adminUrl || !appUrl)("public booking: replay and refusals", () => {
  it("replays the same idempotency key and refuses it for another vehicle", async () => {
    const { tenantId, vehicleId } = await shop();
    const key = randomUUID();
    const first = await submitPublicBooking(app, input(vehicleId), ctx(tenantId, key));
    const again = await submitPublicBooking(app, input(vehicleId), ctx(tenantId, key));
    expect(again).toEqual({ ok: true, code: first.ok ? first.code : "", replayed: true });
    const other = await vehicle(tenantId);
    expect(await submitPublicBooking(app, input(other), ctx(tenantId, key))).toEqual({
      ok: false,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("refuses a changed price, a past pickup and a phone it cannot read", async () => {
    const { tenantId, vehicleId } = await shop();
    expect(
      await submitPublicBooking(app, input(vehicleId, { expectedTotalMinor: 8000 }), ctx(tenantId)),
    ).toEqual({ ok: false, code: "PRICE_CHANGED", totalMinor: 12000 });
    expect(
      await submitPublicBooking(
        app,
        input(vehicleId, { pickup: "2026-05-30T10:00" }),
        ctx(tenantId),
      ),
    ).toEqual({ ok: false, code: "PICKUP_IN_PAST" });
    expect(
      await submitPublicBooking(app, input(vehicleId, { phone: "+0 123 4567" }), ctx(tenantId)),
    ).toEqual({ ok: false, code: "PHONE_INVALID" });
  });
});

describe.skipIf(!adminUrl || !appUrl)("public booking: concurrency and customers", () => {
  it("books a car once when two customers submit the same period at the same time", async () => {
    const { tenantId, vehicleId } = await shop();
    const results = await Promise.all([
      submitPublicBooking(app, input(vehicleId), ctx(tenantId)),
      submitPublicBooking(app, input(vehicleId, { phone: "+393339999999" }), ctx(tenantId)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "VEHICLE_TAKEN" }]);
  });

  it("never overwrites an existing customer and caps open bookings per phone at 3", async () => {
    const { tenantId } = await shop();
    const days = ["03", "06", "09", "12"];
    const results = [];
    for (const [i, d] of days.entries()) {
      const car = await vehicle(tenantId);
      const names = { firstName: `Name${String(i)}`, expectedTotalMinor: 4000 };
      const period = { pickup: `2026-06-${d}T10:00`, return: `2026-06-${d}T18:00` };
      results.push(
        await submitPublicBooking(app, input(car, { ...names, ...period }), ctx(tenantId)),
      );
    }
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ ok: false, code: "PHONE_BOOKING_LIMIT" });
    const customer = await admin.query("SELECT first_name FROM customers WHERE tenant_id = $1", [
      tenantId,
    ]);
    expect(customer.rows).toEqual([{ first_name: "Name0" }]);
  });
});

describe.skipIf(!adminUrl || !appUrl)("public booking: confirmation", () => {
  it("shows the first name and the booking to its own tenant only", async () => {
    const { tenantId, vehicleId } = await shop();
    const booked = await submitPublicBooking(app, input(vehicleId), ctx(tenantId));
    const code = booked.ok ? booked.code : "";
    const confirmation = await getPublicConfirmation(app, { tenantId, code: code.toLowerCase() });
    expect(confirmation).toEqual({
      code,
      firstName: "Mario",
      vehicleName: "Fiat Panda",
      pickup: "2026-06-03T10:00",
      return: "2026-06-05T10:00",
      billedDays: 3,
      totalMinor: 12000,
      status: "confirmed",
    });
    expect(JSON.stringify(confirmation)).not.toContain("example.test");
    const other = await shop();
    expect(await getPublicConfirmation(app, { tenantId: other.tenantId, code })).toBeNull();
    expect(await getPublicConfirmation(app, { tenantId, code: "not-a-code" })).toBeNull();
  });
});
