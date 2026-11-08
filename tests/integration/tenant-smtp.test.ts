import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// SMTP configuration (docs/05-database.md 5.3): allowed ports and security, ciphertext-only password.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const CIPHERTEXT = "v1.0a1b2c3d.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB";

async function tenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Smtp')", [
    id,
    `sm-${id.slice(0, 8)}`,
  ]);
  return id;
}

async function config(t: string, port: number, security: string, password: string): Promise<void> {
  await admin.query(
    `INSERT INTO tenant_smtp_configs (tenant_id, host, port, security, username, password_enc, from_address)
     VALUES ($1, 'smtp.example.test', $2, $3, 'mailer', $4, 'noreply@example.test')`,
    [t, port, security, password],
  );
}

async function removeTenant(t: string): Promise<void> {
  await admin.query("DELETE FROM tenant_smtp_configs WHERE tenant_id = $1", [t]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [t]);
}

describe.skipIf(!adminUrl || !appUrl)("tenant SMTP configuration", () => {
  it("accepts a configuration with ciphertext only", async () => {
    const t = await tenant();
    try {
      await config(t, 587, "starttls", CIPHERTEXT);
    } finally {
      await removeTenant(t);
    }
  });

  it("refuses a port outside the allowed set and an insecure security mode", async () => {
    const t = await tenant();
    try {
      await expect(config(t, 110, "tls", CIPHERTEXT)).rejects.toThrow();
      await expect(config(t, 587, "none", CIPHERTEXT)).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });

  it("refuses a plaintext password (not in the v1 ciphertext format)", async () => {
    const t = await tenant();
    try {
      await expect(config(t, 587, "tls", "plaintext-password")).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenant SMTP isolation", () => {
  it("a tenant cannot read another tenant's SMTP configuration", async () => {
    const mine = await tenant();
    const other = await tenant();
    try {
      await config(mine, 465, "tls", CIPHERTEXT);
      await config(other, 465, "tls", CIPHERTEXT);
      const client = new pg.Client({ connectionString: appUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [mine]);
        const seen = await client.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM tenant_smtp_configs",
        );
        await client.query("COMMIT");
        expect(seen.rows.map((r) => r.tenant_id)).toEqual([mine]);
      } finally {
        await client.end();
      }
    } finally {
      await removeTenant(mine);
      await removeTenant(other);
    }
  });
});
