import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Tenant isolation at the database (docs/05-database.md 4.3, 5.1). Real Postgres, as the runtime role.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;

async function asApp<T>(
  setup: { tenantId?: string; scope?: string },
  run: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: appUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    if (setup.tenantId)
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [setup.tenantId]);
    if (setup.scope) await client.query("SELECT set_config('app.scope', $1, true)", [setup.scope]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

async function seedTenant(admin: pg.Client, slug: string): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [id, slug, slug]);
  return id;
}

describe.skipIf(!adminUrl || !appUrl)("tenancy: tenants table and isolation", () => {
  it("a tenant session sees only its own row, and no row without a tenant", async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const a = await seedTenant(admin, `t-a-${randomUUID().slice(0, 8)}`);
      const b = await seedTenant(admin, `t-b-${randomUUID().slice(0, 8)}`);
      const seenByA = await asApp({ tenantId: a }, async (c) => {
        const r = await c.query<{ id: string }>("SELECT id FROM tenants");
        return r.rows.map((x) => x.id);
      });
      expect(seenByA).toEqual([a]);
      expect(seenByA).not.toContain(b);
      const withoutTenant = await asApp(
        {},
        async (c) => (await c.query("SELECT id FROM tenants")).rowCount,
      );
      expect(withoutTenant).toBe(0);
    } finally {
      await admin.query("DELETE FROM tenants WHERE slug LIKE 't-%'");
      await admin.end();
    }
  });

  it("a tenant cannot change its own row", async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const a = await seedTenant(admin, `t-u-${randomUUID().slice(0, 8)}`);
    try {
      const updated = await asApp(
        { tenantId: a },
        async (c) =>
          (await c.query("UPDATE tenants SET name = 'hacked' WHERE id = $1", [a])).rowCount,
      );
      expect(updated).toBe(0);
    } finally {
      await admin.query("DELETE FROM tenants WHERE id = $1", [a]);
      await admin.end();
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenancy: scope and constraints", () => {
  it("the system scope can create a tenant", async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const slug = `t-s-${randomUUID().slice(0, 8)}`;
    try {
      await asApp({ scope: "system" }, async (c) => {
        await c.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'System made')", [
          randomUUID(),
          slug,
        ]);
      });
      const created = await admin.query("SELECT count(*)::int AS n FROM tenants WHERE slug = $1", [
        slug,
      ]);
      expect(created.rows[0]).toEqual({ n: 1 });
    } finally {
      await admin.query("DELETE FROM tenants WHERE slug = $1", [slug]);
      await admin.end();
    }
  });

  it("a tenant scope cannot create a tenant", async () => {
    const outcome = await asApp({ tenantId: randomUUID() }, async (c) => {
      await c.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Forbidden')", [
        randomUUID(),
        `t-f-${randomUUID().slice(0, 8)}`,
      ]);
    }).then(
      () => "allowed",
      () => "denied",
    );
    expect(outcome).toBe("denied");
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenancy: constraints", () => {
  it("rejects an invalid slug and inconsistent termination state", async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await expect(seedTenant(admin, "Bad_Slug")).rejects.toThrow();
      await expect(
        admin.query(
          "INSERT INTO tenants (id, slug, name, status) VALUES ($1, 't-x-badstate', 'x', 'terminated')",
          [randomUUID()],
        ),
      ).rejects.toThrow();
    } finally {
      await admin.end();
    }
  });
});
