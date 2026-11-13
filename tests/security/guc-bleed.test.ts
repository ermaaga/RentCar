import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withTenantTx } from "../../src/platform/db/tenant-tx";
import { addShop } from "../support/booking-fixtures";

// Spike S1, local part (docs/08-security.md SR-DB-03, ABU-M0-04/05; docs/10-test-plan.md "GUC bleed"):
// the runtime role reaches Postgres through PgBouncer in transaction mode with two server
// connections (tests/security/pgbouncer/start.sh), so transactions of different tenants share
// server connections. The tenant set by withTenantTx must never survive its transaction there.
// The real provider pooler is the remote part of S1 (decision CSM-5).
const poolerUrl = process.env.TEST_POOLER_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const volume = Number(process.env.GUC_BLEED_VOLUME ?? "200");

const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const viaPooler = new pg.Pool({ connectionString: poolerUrl, max: 20 });
let a: { tenantId: string; vehicleId: string };
let b: { tenantId: string; vehicleId: string };

const leftover = `SELECT nullif(current_setting('app.tenant_id', true), '') AS tenant,
                         (SELECT count(*)::int FROM vehicles) AS vehicles`;

async function contextOutside(): Promise<{ tenant: string | null; vehicles: number }> {
  const res = await viaPooler.query<{ tenant: string | null; vehicles: number }>(leftover);
  return res.rows[0] ?? { tenant: "missing", vehicles: -1 };
}

const enabled = Boolean(poolerUrl && adminUrl);

beforeAll(async () => {
  if (enabled) [a, b] = [await addShop(admin), await addShop(admin)];
});

afterAll(async () => {
  await Promise.all([admin.end(), viaPooler.end()]);
});

describe.skipIf(!enabled)("GUC bleed through a transaction pooler (S1): one connection", () => {
  it("multiplexes many transactions over the two server connections", async () => {
    const pids = new Set<number>();
    await Promise.all(
      Array.from({ length: 40 }, () =>
        withTenantTx(viaPooler, a.tenantId, async (c) => {
          const res = await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          pids.add(res.rows[0]?.pid ?? 0);
        }),
      ),
    );
    expect(pids.size).toBeGreaterThan(0);
    expect(pids.size).toBeLessThanOrEqual(2);
  });

  it("leaves no tenant after a commit, a rollback or an error (ABU-M0-04)", async () => {
    await withTenantTx(viaPooler, a.tenantId, (c) => c.query("SELECT 1 FROM vehicles"));
    expect(await contextOutside()).toEqual({ tenant: null, vehicles: 0 });

    await expect(
      withTenantTx(viaPooler, a.tenantId, () => Promise.reject(new Error("rolled back"))),
    ).rejects.toThrow("rolled back");
    expect(await contextOutside()).toEqual({ tenant: null, vehicles: 0 });

    await expect(
      withTenantTx(viaPooler, a.tenantId, (c) => c.query("SELECT * FROM no_such_table")),
    ).rejects.toThrow();
    expect(await contextOutside()).toEqual({ tenant: null, vehicles: 0 });
  });
});

describe.skipIf(!enabled)("GUC bleed through a transaction pooler (S1): concurrency", () => {
  it("returns only the caller's rows under concurrent alternating tenants (ABU-M0-05)", async () => {
    const tenants = [a, b];
    const foreign = await Promise.all(
      Array.from({ length: volume }, async (_, i) => {
        const own = tenants[i % 2] ?? a;
        const rows = await withTenantTx(viaPooler, own.tenantId, async (c) => {
          await c.query("SELECT pg_sleep(random() / 200)");
          const res = await c.query<{ tenant_id: string }>("SELECT tenant_id FROM vehicles");
          return res.rows;
        });
        expect(rows.length).toBeGreaterThan(0);
        return rows.filter((r) => r.tenant_id !== own.tenantId).length;
      }),
    );
    expect(foreign.reduce((sum, n) => sum + n, 0)).toBe(0);
  });
});
