import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Subscriptions (docs/05-database.md 5.4): no overlapping active periods per tenant, tenant read-only.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

async function newTenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Subs')", [
    id,
    `sb-${id.slice(0, 8)}`,
  ]);
  return id;
}

async function addSub(
  tenant: string,
  start: string,
  end: string,
  status = "active",
): Promise<void> {
  await admin.query(
    `INSERT INTO subscriptions (id, tenant_id, max_vehicles, max_operators, start_date, end_date, price_minor, price_currency, status, cancelled_at)
     VALUES ($1, $2, 10, 3, $3, $4, 12000, 'EUR', $5, $6)`,
    [randomUUID(), tenant, start, end, status, status === "cancelled" ? new Date() : null],
  );
}

async function asTenant<T>(tenant: string, run: (c: pg.Client) => Promise<T>): Promise<T> {
  const app = new pg.Client({ connectionString: appUrl });
  await app.connect();
  try {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    const result = await run(app);
    await app.query("COMMIT");
    return result;
  } finally {
    await app.end();
  }
}

async function removeTenant(tenant: string): Promise<void> {
  await admin.query("DELETE FROM subscriptions WHERE tenant_id = $1", [tenant]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [tenant]);
}

describe.skipIf(!adminUrl || !appUrl)("subscriptions: periods", () => {
  it("refuses an overlapping active period, including a shared end day", async () => {
    const t = await newTenant();
    try {
      await addSub(t, "2027-01-01", "2027-06-30");
      await expect(addSub(t, "2027-06-30", "2027-12-31")).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });

  it("allows the next period starting the day after", async () => {
    const t = await newTenant();
    try {
      await addSub(t, "2027-01-01", "2027-06-30");
      await addSub(t, "2027-07-01", "2027-12-31");
      const n = await admin.query(
        "SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1",
        [t],
      );
      expect(n.rows[0]).toEqual({ n: 2 });
    } finally {
      await removeTenant(t);
    }
  });

  it("ignores cancelled periods in the overlap rule", async () => {
    const t = await newTenant();
    try {
      await addSub(t, "2027-01-01", "2027-06-30", "cancelled");
      await addSub(t, "2027-02-01", "2027-03-31");
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("subscriptions: dates", () => {
  it("rejects an end date before the start date", async () => {
    const t = await newTenant();
    try {
      await expect(addSub(t, "2027-06-30", "2027-01-01")).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("subscriptions: access", () => {
  it("a tenant reads its own subscriptions and cannot write them", async () => {
    const t = await newTenant();
    try {
      await addSub(t, "2027-01-01", "2027-06-30");
      const result = await asTenant(t, async (c) => ({
        seen: (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM subscriptions"))
          .rows[0],
        changed: (
          await c.query("UPDATE subscriptions SET max_vehicles = 999 WHERE tenant_id = $1", [t])
        ).rowCount,
      }));
      expect(result.seen).toEqual({ n: 1 });
      expect(result.changed).toBe(0);
    } finally {
      await removeTenant(t);
    }
  });
});
