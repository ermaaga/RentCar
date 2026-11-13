import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getAdminBooking,
  listAdminBookings,
  parseAdminBookingQuery,
  submitPublicBooking,
} from "../../src/modules/booking";
import { addShop, addVehicle, ctx, input, now } from "../support/booking-fixtures";

// BKG-11 listBookings and BKG-12 getBooking as the runtime role (W-D3/W-D4, FR-BKG-01/02,
// ABU-M3 tenant isolation).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const enabled = Boolean(adminUrl && appUrl);

let shop: { tenantId: string; vehicleId: string };
let otherVehicle = "";
const codes: Record<string, string> = {};

async function book(vehicleId: string, extra: Record<string, unknown>): Promise<string> {
  const result = await submitPublicBooking(app, input(vehicleId, extra), ctx(shop.tenantId));
  if (!result.ok) throw new Error(result.code);
  return result.code;
}

beforeAll(async () => {
  if (!enabled) return;
  shop = await addShop(admin);
  otherVehicle = await addVehicle(admin, shop.tenantId);
  codes.june = await book(shop.vehicleId, {});
  codes.july = await book(shop.vehicleId, {
    pickup: "2026-07-10T10:00",
    return: "2026-07-11T10:00",
    expectedTotalMinor: 8000,
    firstName: "Anna",
    lastName: "Bianchi",
    phone: "333 765 4321",
  });
  codes.other = await book(otherVehicle, {
    pickup: "2026-06-20T10:00",
    return: "2026-06-21T10:00",
    expectedTotalMinor: 8000,
  });
  await admin.query(
    "UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE code = $1",
    [codes.other],
  );
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const at = (iso: string) => ({
  tenantId: shop.tenantId,
  now: new Date(iso),
  timeZone: "Europe/Rome",
});
const list = (params: Record<string, string>, when = now.toISOString()) =>
  listAdminBookings(app, parseAdminBookingQuery(params), at(when));
const listed = async (params: Record<string, string>, when?: string) =>
  (await list(params, when)).rows.map((r) => r.code);

describe.skipIf(!enabled)("admin bookings: list (BKG-11)", () => {
  it("lists the tenant's bookings newest pickup first with local times", async () => {
    const { rows, total } = await list({});
    expect(total).toBe(3);
    expect(rows.map((r) => r.code)).toEqual([codes.july, codes.other, codes.june]);
    expect(rows[2]).toMatchObject({
      customerName: "Mario Rossi",
      phone: "+393331234567",
      vehicleName: "Fiat Panda",
      pickup: "2026-06-03T10:00",
      totalMinor: 12000,
      isPaid: false,
      status: "confirmed",
    });
  });

  it("filters by effective status at the given time", async () => {
    expect(await listed({ status: "active" }, "2026-06-04T08:00:00Z")).toEqual([codes.june]);
    expect(await listed({ status: "completed" }, "2026-06-06T08:00:00Z")).toEqual([codes.june]);
    expect(await listed({ status: "cancelled" })).toEqual([codes.other]);
  });

  it("searches by code, name and phone digits", async () => {
    expect(await listed({ q: (codes.july ?? "").toLowerCase() })).toEqual([codes.july]);
    expect(await listed({ q: "bianc" })).toEqual([codes.july]);
    expect(await listed({ q: "765 43" })).toEqual([codes.july]);
    expect(await listed({ q: "%" })).toEqual([]);
  });
});

describe.skipIf(!enabled)("admin bookings: list filters and isolation (BKG-11)", () => {
  it("filters by vehicle and by local date overlap, and sorts by total", async () => {
    expect(await listed({ vehicle: otherVehicle })).toEqual([codes.other]);
    expect(await listed({ from: "2026-06-05", to: "2026-06-20" })).toEqual([
      codes.other,
      codes.june,
    ]);
    expect(await listed({ from: "2026-06-06", to: "2026-06-19" })).toEqual([]);
    expect((await listed({ sort: "total-asc" })).at(-1)).toBe(codes.june);
    expect((await listed({ sort: "total-desc" }))[0]).toBe(codes.june);
  });

  it("shows nothing of another tenant", async () => {
    const other = await addShop(admin);
    const res = await listAdminBookings(app, parseAdminBookingQuery({}), {
      tenantId: other.tenantId,
      now,
      timeZone: "Europe/Rome",
    });
    expect(res).toEqual({ rows: [], total: 0 });
  });
});

describe.skipIf(!enabled)("admin bookings: detail (BKG-12)", () => {
  it("returns the booking with price, email state and history for the admin", async () => {
    const b = await getAdminBooking(
      app,
      { code: codes.june ?? "", withHistory: true },
      at(now.toISOString()),
    );
    expect(b).toMatchObject({
      code: codes.june,
      email: "mario@example.test",
      billedDays: 3,
      dailyPriceMinor: 4000,
      totalMinor: 12000,
      source: "public",
      status: "confirmed",
      paidAmountMinor: 0,
    });
    expect(b?.history?.map((h) => h.action)).toEqual(["booking.created"]);
  });

  it("hides the history from operators and misses another tenant's code", async () => {
    const b = await getAdminBooking(
      app,
      { code: codes.june ?? "", withHistory: false },
      at(now.toISOString()),
    );
    expect(b?.history).toBeNull();
    const other = await addShop(admin);
    const miss = await getAdminBooking(
      app,
      { code: codes.june ?? "", withHistory: true },
      { tenantId: other.tenantId, now, timeZone: "Europe/Rome" },
    );
    expect(miss).toBeNull();
    expect(
      await getAdminBooking(app, { code: "not a code", withHistory: true }, at(now.toISOString())),
    ).toBeNull();
  });
});
