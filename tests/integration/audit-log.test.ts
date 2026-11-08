import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Append-only audit log (docs/05-database.md 5.14). Tested as the runtime role and as the owner.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

async function tenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Audit')", [
    id,
    `au-${id.slice(0, 8)}`,
  ]);
  return id;
}

async function writeEntry(t: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type, changes)
     VALUES ($1, $2, 'system', 'tenant.created', 'tenant', '{"name": {"old": null, "new": "X"}}')`,
    [id, t],
  );
  return id;
}

async function removeTenant(t: string): Promise<void> {
  await admin.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete");
  try {
    await admin.query("DELETE FROM audit_log WHERE tenant_id = $1", [t]);
  } finally {
    await admin.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete");
  }
  await admin.query("DELETE FROM tenants WHERE id = $1", [t]);
}

describe.skipIf(!adminUrl || !appUrl)("audit log is append-only", () => {
  it("the runtime role can read and insert its own entries", async () => {
    const t = await tenant();
    try {
      await writeEntry(t);
      const client = new pg.Client({ connectionString: appUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
        await client.query(
          `INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type)
           VALUES (gen_random_uuid(), $1, 'user', 'booking.updated', 'booking')`,
          [t],
        );
        const seen = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log");
        await client.query("COMMIT");
        expect(seen.rows[0]?.n).toBe(2);
      } finally {
        await client.end();
      }
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("audit log: immutability", () => {
  it("the runtime role cannot update or delete entries", async () => {
    const t = await tenant();
    try {
      const id = await writeEntry(t);
      const client = new pg.Client({ connectionString: appUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
        await expect(
          client.query("UPDATE audit_log SET action = 'x' WHERE id = $1", [id]),
        ).rejects.toThrow();
        await client.query("ROLLBACK").catch(() => undefined);
      } finally {
        await client.end();
      }
      await expect(
        admin.query("UPDATE audit_log SET action = 'x' WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/);
      await expect(admin.query("DELETE FROM audit_log WHERE id = $1", [id])).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("audit log: limits", () => {
  it("rejects an oversized changes payload", async () => {
    const t = await tenant();
    try {
      const big = JSON.stringify({ note: { old: null, new: "x".repeat(17_000) } });
      await expect(
        admin.query(
          `INSERT INTO audit_log (id, tenant_id, actor_type, action, entity_type, changes)
           VALUES (gen_random_uuid(), $1, 'system', 'x', 'x', $2)`,
          [t, big],
        ),
      ).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });
});
