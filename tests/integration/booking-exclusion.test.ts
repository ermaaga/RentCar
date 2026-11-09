import pg from "pg";
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { withSystemTx } from "../../src/platform/db/system-tx";
import { withTenantTx } from "../../src/platform/db/tenant-tx";

// Spike S5 kept as a permanent test (docs/03-architettura.md S5, 05-database 6.1, ADR-0004): the
// exclusion constraint under 50 parallel conflicting inserts and crossing edits, as the runtime role.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 20 });

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(32)]).join("");

async function fleet(vehicles = 1) {
  const tenantId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Fleet')", [
    tenantId,
    `fl-${tenantId.slice(0, 8)}`,
  ]);
  const vehicleIds: string[] = [];
  for (let i = 0; i < vehicles; i += 1) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO vehicles (id, tenant_id, name, plate, make, model, category, fuel_type, seats, daily_price_minor)
       VALUES ($1, $2, $3, $4, 'Fiat', 'Panda', 'city', 'petrol', 4, 4000)`,
      [id, tenantId, `Car ${String(i)}`, `AB${String(i)}${id.slice(0, 4)}`],
    );
    vehicleIds.push(id);
  }
  const customerId = randomUUID();
  await admin.query(
    `INSERT INTO customers (id, tenant_id, first_name, last_name, phone)
     VALUES ($1, $2, 'Ann', 'Lee', $3)`,
    [customerId, tenantId, `+3933${String(randomInt(10_000_000, 99_999_999))}`],
  );
  return { tenantId, vehicleIds: vehicleIds.sort(), customerId };
}

type Fleet = Awaited<ReturnType<typeof fleet>>;

async function book(
  c: pg.ClientBase,
  f: Fleet,
  vehicleId: string,
  range: { start: string; end: string; buffer?: number },
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO bookings (id, tenant_id, code, vehicle_id, customer_id, customer_first_name, customer_last_name,
                           start_at, end_at, buffer_minutes, daily_price_minor, billed_days, total_minor, source)
     VALUES ($1, $2, $3, $4, $5, 'Ann', 'Lee', $6, $7, $8, 4000, 1, 4000, 'public')`,
    [id, f.tenantId, code(), vehicleId, f.customerId, range.start, range.end, range.buffer ?? 0],
  );
  return id;
}

/** Per-vehicle advisory locks in ascending id order (05-database 6.1, belt and braces). */
async function lockVehicles(c: pg.ClientBase, vehicleIds: string[]): Promise<void> {
  for (const id of [...vehicleIds].sort()) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`veh:${id}`]);
  }
}

const sqlState = (err: unknown) => (err as { code?: string }).code ?? "none";

async function settle(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  return {
    won: results.filter((r) => r.status === "fulfilled").length,
    codes: results.flatMap((r) => (r.status === "rejected" ? [sqlState(r.reason)] : [])),
  };
}

describe.skipIf(!adminUrl || !appUrl)("spike S5: 50 parallel conflicting inserts", () => {
  it.each([false, true])(
    "gives exactly one winner (with vehicle lock: %s) and no deadlock",
    async (lock) => {
      const f = await fleet();
      const vehicle = f.vehicleIds[0] ?? "";
      const tasks = Array.from({ length: 50 }, (_, i) =>
        withTenantTx(app, f.tenantId, async (c) => {
          if (lock) await lockVehicles(c, [vehicle]);
          // Overlapping but different ranges, so no two are identical.
          await book(c, f, vehicle, {
            start: `2030-06-01T${String(8 + (i % 4)).padStart(2, "0")}:00Z`,
            end: "2030-06-03T10:00Z",
          });
        }),
      );
      const { won, codes } = await settle(tasks);
      expect(won).toBe(1);
      expect(new Set(codes)).toEqual(new Set(["23P01"]));
    },
    30_000,
  );
});

describe.skipIf(!adminUrl || !appUrl)("spike S5: crossing edits", () => {
  it("swapping two bookings' vehicles concurrently never deadlocks with ascending locks", async () => {
    const f = await fleet(2);
    const [v1 = "", v2 = ""] = f.vehicleIds;
    const range = { start: "2030-07-01T10:00Z", end: "2030-07-02T10:00Z" };
    const a = await withTenantTx(app, f.tenantId, (c) => book(c, f, v1, range));
    const b = await withTenantTx(app, f.tenantId, (c) => book(c, f, v2, range));
    const move = (id: string, from: string, to: string) =>
      withTenantTx(app, f.tenantId, async (c) => {
        await lockVehicles(c, [from, to]);
        await c.query("UPDATE bookings SET vehicle_id = $2, version = version + 1 WHERE id = $1", [
          id,
          to,
        ]);
      });
    const { won, codes } = await settle([move(a, v1, v2), move(b, v2, v1)]);
    expect(codes).not.toContain("40P01");
    expect(won + codes.length).toBe(2);
    expect(codes.every((c) => c === "23P01")).toBe(true);
  }, 30_000);
});

describe.skipIf(!adminUrl || !appUrl)("exclusion rules (05-database 6.1)", () => {
  it("uses half-open ranges and each booking's buffer after its return", async () => {
    const f = await fleet();
    const v = f.vehicleIds[0] ?? "";
    await withTenantTx(app, f.tenantId, (c) =>
      book(c, f, v, { start: "2030-08-01T08:00Z", end: "2030-08-01T10:00Z", buffer: 60 }),
    );
    const at = (start: string) =>
      withTenantTx(app, f.tenantId, (c) => book(c, f, v, { start, end: "2030-08-01T20:00Z" }));
    await expect(at("2030-08-01T10:30Z")).rejects.toMatchObject({ code: "23P01" });
    await expect(at("2030-08-01T11:00Z")).resolves.toBeTruthy();
  });

  it("frees the vehicle on cancellation and recomputes a hand-set blocked range", async () => {
    const f = await fleet();
    const v = f.vehicleIds[0] ?? "";
    const range = { start: "2030-09-01T08:00Z", end: "2030-09-02T08:00Z" };
    const id = await withTenantTx(app, f.tenantId, (c) => book(c, f, v, range));
    await withTenantTx(app, f.tenantId, (c) =>
      c.query(
        "UPDATE bookings SET blocked_during = tstzrange('2000-01-01', '2000-01-02') WHERE id = $1",
        [id],
      ),
    );
    await expect(withTenantTx(app, f.tenantId, (c) => book(c, f, v, range))).rejects.toMatchObject({
      code: "23P01",
    });
    await withTenantTx(app, f.tenantId, (c) =>
      c.query("UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]),
    );
    await expect(withTenantTx(app, f.tenantId, (c) => book(c, f, v, range))).resolves.toBeTruthy();
  });
});

describe.skipIf(!adminUrl || !appUrl)("fleet and booking isolation (ABU-M1-28)", () => {
  it("another tenant and the system scope see none of a tenant's rows", async () => {
    const a = await fleet();
    const b = await fleet();
    await withTenantTx(app, a.tenantId, (c) =>
      book(c, a, a.vehicleIds[0] ?? "", { start: "2030-10-01T08:00Z", end: "2030-10-02T08:00Z" }),
    );
    const count = (c: pg.ClientBase) =>
      c.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM bookings) + (SELECT count(*) FROM vehicles)
              + (SELECT count(*) FROM customers) + (SELECT count(*) FROM vehicle_photos) AS n`,
      );
    const fromB = await withTenantTx(app, b.tenantId, (c) =>
      c.query<{ n: string }>("SELECT count(*) AS n FROM bookings WHERE tenant_id = $1", [
        a.tenantId,
      ]),
    );
    expect(Number(fromB.rows[0]?.n)).toBe(0);
    const fromSystem = await withSystemTx(app, count);
    expect(Number(fromSystem.rows[0]?.n)).toBe(0);
  });

  it("refuses a booking that points at another tenant's vehicle", async () => {
    const a = await fleet();
    const b = await fleet();
    await expect(
      withTenantTx(app, a.tenantId, (c) =>
        book(c, a, b.vehicleIds[0] ?? "", { start: "2030-11-01T08:00Z", end: "2030-11-02T08:00Z" }),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
