import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { searchAvailability } from "../../src/modules/booking";

// BKG-01 as the runtime role (docs/06-backend-api.md 5.2, FR-PUB-02..04, US-020/021).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const now = new Date("2026-06-01T06:00:00Z"); // 08:00 in Rome

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function vehicle(tenantId: string, name: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  const v = {
    category: "city",
    fuel_type: "petrol",
    seats: 4,
    price: 4000,
    status: "available",
    ...extra,
  };
  await admin.query(
    `INSERT INTO vehicles (id, tenant_id, name, plate, make, model, category, fuel_type, seats,
                           daily_price_minor, status, archived_at)
     VALUES ($1, $2, $3, $4, 'Make', 'Model', $5, $6, $7, $8, $9, $10)`,
    [
      id,
      tenantId,
      name,
      `P${id.slice(0, 6)}`,
      v.category,
      v.fuel_type,
      v.seats,
      v.price,
      v.status,
      extra.archived ? new Date() : null,
    ],
  );
  return id;
}

async function shop(buffer = 0) {
  const tenantId = randomUUID();
  await admin.query(
    "INSERT INTO tenants (id, slug, name, time_zone) VALUES ($1, $2, 'Shop', 'Europe/Rome')",
    [tenantId, `av-${tenantId.slice(0, 8)}`],
  );
  await admin.query(
    `INSERT INTO tenant_settings (tenant_id, contact_email, contact_phone, title, buffer_minutes, lead_time_minutes)
     VALUES ($1, 'a@example.test', '+390612345678', 'Shop', $2, 60)`,
    [tenantId, buffer],
  );
  const customer = randomUUID();
  await admin.query(
    "INSERT INTO customers (id, tenant_id, first_name, last_name, phone) VALUES ($1, $2, 'A', 'B', '+393331112222')",
    [customer, tenantId],
  );
  return { tenantId, customer, ctx: { tenantId, now } };
}

async function booking(
  t: { tenantId: string; customer: string },
  vehicleId: string,
  range: { start: string; end: string; buffer?: number },
) {
  const { start, end, buffer = 0 } = range;
  await admin.query(
    `INSERT INTO bookings (id, tenant_id, code, vehicle_id, customer_id, customer_first_name, customer_last_name,
                           start_at, end_at, buffer_minutes, daily_price_minor, billed_days, total_minor, source)
     VALUES ($1, $2, $3, $4, $5, 'A', 'B', $6, $7, $8, 4000, 1, 4000, 'public')`,
    [
      randomUUID(),
      t.tenantId,
      randomUUID()
        .replace(/-/g, "")
        .slice(0, 10)
        .toUpperCase()
        .replace(/[ILOU]/g, "1"),
      vehicleId,
      t.customer,
      start,
      end,
      buffer,
    ],
  );
}

const names = (r: Awaited<ReturnType<typeof searchAvailability>>) =>
  r.ok ? r.items.map((i) => i.name) : r.code;

describe.skipIf(!adminUrl || !appUrl)("searchAvailability (BKG-01)", () => {
  it("offers free vehicles with price and leaves out booked, maintenance and archived ones", async () => {
    const t = await shop();
    const free = await vehicle(t.tenantId, "Free", { price: 4550 });
    const busy = await vehicle(t.tenantId, "Busy");
    await vehicle(t.tenantId, "Workshop", { status: "maintenance" });
    await vehicle(t.tenantId, "Old", { archived: true });
    await booking(t, busy, { start: "2026-06-02T08:00Z", end: "2026-06-04T08:00Z" });
    const r = await searchAvailability(
      app,
      { pickup: "2026-06-03T10:00", return: "2026-06-05T09:00" },
      t.ctx,
    );
    expect(r.ok && r.items).toEqual([
      expect.objectContaining({ id: free, name: "Free", billedDays: 3, totalMinor: 13650 }),
    ]);
  });
});

describe.skipIf(!adminUrl || !appUrl)("searchAvailability: buffer and isolation", () => {
  it("frees a vehicle at the return of a booking, after that booking's buffer", async () => {
    const t = await shop(60);
    const v = await vehicle(t.tenantId, "Car");
    await booking(t, v, { start: "2026-06-02T06:00Z", end: "2026-06-03T08:00Z", buffer: 60 }); // returns 10:00 Rome
    const search = (pickup: string) =>
      searchAvailability(app, { pickup, return: "2026-06-05T10:00" }, t.ctx);
    expect(names(await search("2026-06-03T10:30"))).toEqual([]);
    expect(names(await search("2026-06-03T11:00"))).toEqual(["Car"]);
  });

  it("ignores cancelled bookings and another tenant's bookings", async () => {
    const t = await shop();
    const other = await shop();
    const v = await vehicle(t.tenantId, "Car");
    const o = await vehicle(other.tenantId, "Elsewhere");
    await booking(other, o, { start: "2026-06-02T08:00Z", end: "2026-06-09T08:00Z" });
    expect(
      names(
        await searchAvailability(
          app,
          { pickup: "2026-06-03T10:00", return: "2026-06-04T10:00" },
          t.ctx,
        ),
      ),
    ).toEqual(["Car"]);
    expect(v).toBeTruthy();
  });
});

describe.skipIf(!adminUrl || !appUrl)("searchAvailability filters and rules", () => {
  it("filters by category, fuel and minimum seats and sorts by total then name", async () => {
    const t = await shop();
    await vehicle(t.tenantId, "B van", { category: "van", seats: 9, price: 9000 });
    await vehicle(t.tenantId, "A city", { price: 3000 });
    await vehicle(t.tenantId, "C ev", { fuel_type: "electric", price: 3000 });
    const base = { pickup: "2026-06-03T10:00", return: "2026-06-04T10:00" };
    expect(names(await searchAvailability(app, base, t.ctx))).toEqual(["A city", "C ev", "B van"]);
    expect(names(await searchAvailability(app, { ...base, sort: "price-desc" }, t.ctx))).toEqual([
      "B van",
      "A city",
      "C ev",
    ]);
    expect(names(await searchAvailability(app, { ...base, category: ["van"] }, t.ctx))).toEqual([
      "B van",
    ]);
    expect(names(await searchAvailability(app, { ...base, fuel: "electric" }, t.ctx))).toEqual([
      "C ev",
    ]);
    expect(names(await searchAvailability(app, { ...base, seats: 7 }, t.ctx))).toEqual(["B van"]);
  });

  it("returns the first broken rule and refuses a non-existent local time", async () => {
    const t = await shop();
    const search = (pickup: string, ret: string) =>
      searchAvailability(app, { pickup, return: ret }, t.ctx);
    expect(names(await search("2026-06-01T08:30", "2026-06-02T10:00"))).toBe("LEAD_TIME_NOT_MET");
    expect(names(await search("2026-06-03T10:00", "2026-07-30T10:00"))).toBe("DURATION_TOO_LONG");
    expect(names(await search("2027-03-28T02:30", "2027-03-29T10:00"))).toBe("INVALID_LOCAL_TIME");
  });
});
