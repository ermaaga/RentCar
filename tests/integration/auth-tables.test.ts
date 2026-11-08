import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// users and sessions (docs/05-database.md 5.5, 5.6): isolation and key constraints, as the runtime role.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;

async function insertSession(
  admin: pg.Pool,
  tenant: string,
  user: string,
  tokenHash: Buffer,
): Promise<void> {
  await admin.query(
    `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, 'tenant', $3, $4, now() + interval '30 minutes', now() + interval '12 hours')`,
    [randomUUID(), tenant, user, tokenHash],
  );
}

async function asApp(tenantId: string, sql: string): Promise<number> {
  const client = new pg.Client({ connectionString: appUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const res = await client.query(sql);
    await client.query("COMMIT");
    return res.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

describe.skipIf(!adminUrl || !appUrl)("auth tables: users and sessions", () => {
  it("a tenant sees only its own users, and systemadmins are never visible to a tenant", async () => {
    const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    const a = randomUUID();
    const b = randomUUID();
    const tag = randomUUID().slice(0, 8);
    try {
      await admin.query(
        "INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'A'), ($3, $4, 'B')",
        [a, `ta-${tag}`, b, `tb-${tag}`],
      );
      await admin.query(
        `INSERT INTO users (id, tenant_id, role, username, display_name, email, password_hash, status)
         VALUES ($1, $2, 'admin', 'admin', 'A admin', 'a@example.test', 'x', 'active'),
                ($3, $4, 'admin', 'admin', 'B admin', 'b@example.test', 'x', 'active'),
                ($5, NULL, 'systemadmin', 'root-${tag}', 'Root', 'root@example.test', 'x', 'active')`,
        [randomUUID(), a, randomUUID(), b, randomUUID()],
      );
      expect(await asApp(a, "SELECT id FROM users")).toBe(1);
      expect(await asApp(a, "SELECT id FROM users WHERE tenant_id IS NULL")).toBe(0);
    } finally {
      await admin.query("DELETE FROM users WHERE tenant_id IN ($1, $2)", [a, b]);
      await admin.query("DELETE FROM users WHERE tenant_id IS NULL AND username = $1", [
        `root-${tag}`,
      ]);
      await admin.query("DELETE FROM tenants WHERE id IN ($1, $2)", [a, b]);
      await admin.end();
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("auth tables: constraints", () => {
  it("rejects a second admin for the same tenant and a bad username", async () => {
    const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    const t = randomUUID();
    const tag = randomUUID().slice(0, 8);
    try {
      await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'T')", [
        t,
        `tc-${tag}`,
      ]);
      await admin.query(
        "INSERT INTO users (id, tenant_id, role, username, display_name, email) VALUES ($1, $2, 'admin', 'owner', 'O', 'o@example.test')",
        [randomUUID(), t],
      );
      await expect(
        admin.query(
          "INSERT INTO users (id, tenant_id, role, username, display_name, email) VALUES ($1, $2, 'admin', 'second', 'S', 's@example.test')",
          [randomUUID(), t],
        ),
      ).rejects.toThrow();
      await expect(
        admin.query(
          "INSERT INTO users (id, tenant_id, role, username, display_name, email) VALUES ($1, $2, 'operator', 'Bad Name', 'X', 'x@example.test')",
          [randomUUID(), t],
        ),
      ).rejects.toThrow();
    } finally {
      await admin.query("DELETE FROM users WHERE tenant_id = $1", [t]);
      await admin.query("DELETE FROM tenants WHERE id = $1", [t]);
      await admin.end();
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("auth tables: sessions", () => {
  it("a session must belong to a user of the same tenant and stores a 32-byte token hash only", async () => {
    const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    const t = randomUUID();
    const u = randomUUID();
    try {
      await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'S')", [
        t,
        `td-${t.slice(0, 8)}`,
      ]);
      await admin.query(
        "INSERT INTO users (id, tenant_id, role, username, display_name, email) VALUES ($1, $2, 'operator', 'operator1', 'Op', 'op@example.test')",
        [u, t],
      );
      await insertSession(admin, t, u, Buffer.alloc(32, 1));
      await expect(insertSession(admin, t, randomUUID(), Buffer.alloc(32, 2))).rejects.toThrow();
      await expect(insertSession(admin, t, u, Buffer.alloc(16, 3))).rejects.toThrow();
    } finally {
      await admin.query("DELETE FROM sessions WHERE tenant_id = $1", [t]);
      await admin.query("DELETE FROM users WHERE tenant_id = $1", [t]);
      await admin.query("DELETE FROM tenants WHERE id = $1", [t]);
      await admin.end();
    }
  });
});
