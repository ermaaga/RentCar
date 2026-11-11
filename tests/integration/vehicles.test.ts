import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import {
  createVehicle,
  getVehicle,
  listVehicles,
  removeVehicle,
  setMaintenance,
  updateVehicle,
  vehicleUsage,
} from "../../src/modules/fleet";
import type { VehicleInput } from "../../src/modules/fleet/application/vehicle-input";

// Vehicles as the runtime role (docs/06-backend-api.md FLT-01..06, US-013, US-040..042).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 8 });
const now = new Date();

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function tenant(maxVehicles: number) {
  const tenantId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Fleet')", [
    tenantId,
    `vh-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO subscriptions (id, tenant_id, max_vehicles, max_operators, start_date, end_date,
                                price_minor, price_currency)
     VALUES ($1, $2, $3, 1, current_date - 1, current_date + 300, 1, 'EUR')`,
    [randomUUID(), tenantId, maxVehicles],
  );
  return { tenantId, now };
}

const panda = (plate = "AB 123 CD"): VehicleInput => ({
  name: "Fiat Panda",
  plate,
  make: "Fiat",
  model: "Panda",
  category: "city",
  fuelType: "petrol",
  seats: 4,
  dailyPriceMinor: 4500,
});

describe.skipIf(!adminUrl || !appUrl)("createVehicle (FLT-01)", () => {
  it("creates, refuses the same plate written differently, and respects the plan limit", async () => {
    const ctx = await tenant(2);
    const first = await createVehicle(app, panda(), ctx);
    expect(first.ok).toBe(true);
    expect(await createVehicle(app, panda("ab-123-cd"), ctx)).toEqual({
      ok: false,
      code: "PLATE_TAKEN",
    });
    expect((await createVehicle(app, panda("ZZ 999"), ctx)).ok).toBe(true);
    expect(await createVehicle(app, panda("YY 888"), ctx)).toEqual({
      ok: false,
      code: "PLAN_LIMIT_REACHED",
    });
    expect(await vehicleUsage(app, ctx)).toEqual({ used: 2, max: 2 });
  });

  it("gives one success to two parallel creates at limit - 1", async () => {
    const ctx = await tenant(1);
    const results = await Promise.all([
      createVehicle(app, panda("P1"), ctx),
      createVehicle(app, panda("P2"), ctx),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe.skipIf(!adminUrl || !appUrl)("updateVehicle and maintenance (FLT-02/03)", () => {
  it("refuses a stale save and saves with the current version", async () => {
    const ctx = await tenant(3);
    const created = await createVehicle(app, panda(), ctx);
    if (!created.ok) throw new Error(created.code);
    const v = await getVehicle(app, created.id, ctx);
    const save = (expectedUpdatedAt: string, price: number) =>
      updateVehicle(
        app,
        { ...panda(), dailyPriceMinor: price, id: created.id, expectedUpdatedAt },
        { ...ctx, now: new Date(Date.now() + 1000) },
      );
    expect(await save(v?.updatedAt ?? "", 5000)).toEqual({ ok: true, id: created.id });
    expect(await save(v?.updatedAt ?? "", 6000)).toEqual({ ok: false, code: "STALE_RECORD" });
    expect((await getVehicle(app, created.id, ctx))?.dailyPriceMinor).toBe(5000);
  });
});

describe.skipIf(!adminUrl || !appUrl)("maintenance, delete and archive (FLT-03/04)", () => {
  it("puts a vehicle in maintenance and lists its future bookings", async () => {
    const ctx = await tenant(3);
    const created = await createVehicle(app, panda(), ctx);
    if (!created.ok) throw new Error(created.code);
    const customer = randomUUID();
    await admin.query(
      `INSERT INTO customers (id, tenant_id, first_name, last_name, phone) VALUES ($1, $2, 'A', 'B', '+393331234567')`,
      [customer, ctx.tenantId],
    );
    await admin.query(
      `INSERT INTO bookings (id, tenant_id, code, vehicle_id, customer_id, customer_first_name, customer_last_name,
                             start_at, end_at, daily_price_minor, billed_days, total_minor, source)
       VALUES ($1, $2, 'K7M29QXA00', $3, $4, 'A', 'B', now() + interval '1 day', now() + interval '2 days', 4500, 1, 4500, 'public')`,
      [randomUUID(), ctx.tenantId, created.id, customer],
    );
    const on = await setMaintenance(app, { id: created.id, on: true }, ctx);
    expect(on.ok && on.affected.map((b) => b.code)).toEqual(["K7M29QXA00"]);
    expect((await getVehicle(app, created.id, ctx))?.state).toBe("maintenance");
    expect(await removeVehicle(app, { id: created.id, mode: "delete" }, ctx)).toEqual({
      ok: false,
      code: "VEHICLE_HAS_HISTORY",
    });
    expect(await removeVehicle(app, { id: created.id, mode: "archive" }, ctx)).toEqual({
      ok: true,
      photoKeys: [],
    });
    expect(await listVehicles(app, {}, ctx)).toEqual([]);
    expect((await listVehicles(app, { includeArchived: true }, ctx))[0]?.state).toBe("archived");
  });
});

describe.skipIf(!adminUrl || !appUrl)("vehicle list and isolation (FLT-04/05)", () => {
  it("deletes a vehicle without history, searches by name or plate, and isolates tenants", async () => {
    const a = await tenant(5);
    const b = await tenant(5);
    const x = await createVehicle(app, { ...panda("XX 111"), name: "Audi A3" }, a);
    await createVehicle(app, panda("YY 222"), a);
    if (!x.ok) throw new Error(x.code);
    expect((await listVehicles(app, { q: "audi" }, a)).map((v) => v.name)).toEqual(["Audi A3"]);
    expect((await listVehicles(app, { q: "yy-222" }, a)).map((v) => v.plate)).toEqual(["YY 222"]);
    expect(await listVehicles(app, {}, b)).toEqual([]);
    expect(await getVehicle(app, x.id, b)).toBeNull();
    expect(await removeVehicle(app, { id: x.id, mode: "delete" }, b)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await removeVehicle(app, { id: x.id, mode: "delete" }, a)).toEqual({
      ok: true,
      photoKeys: [],
    });
    expect(await getVehicle(app, x.id, a)).toBeNull();
  });
});
