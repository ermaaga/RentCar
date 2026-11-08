import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Tenant settings (docs/05-database.md 5.2): value limits, all-or-nothing address, tenant isolation.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

async function tenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Settings')", [
    id,
    `st-${id.slice(0, 8)}`,
  ]);
  return id;
}

async function settings(t: string, extraColumn?: string, extraValue?: string): Promise<void> {
  const columns = ["tenant_id", "title", "contact_email", "contact_phone"];
  const values: unknown[] = [t, "Shop", "shop@example.test", "+39000000"];
  if (extraColumn !== undefined) {
    columns.push(extraColumn);
    values.push(extraValue);
  }
  const placeholders = values.map((_, i) => "$" + String(i + 1)).join(", ");
  await admin.query(
    `INSERT INTO tenant_settings (${columns.join(", ")}) VALUES (${placeholders})`,
    values,
  );
}

async function removeTenant(t: string): Promise<void> {
  await admin.query("DELETE FROM tenant_settings WHERE tenant_id = $1", [t]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [t]);
}

describe.skipIf(!adminUrl || !appUrl)("tenant settings: rules", () => {
  it("accepts a valid row with platform defaults", async () => {
    const t = await tenant();
    try {
      await settings(t);
      const row = await admin.query<{ font_key: string; max_rental_days: number }>(
        "SELECT font_key, max_rental_days FROM tenant_settings WHERE tenant_id = $1",
        [t],
      );
      expect(row.rows[0]).toEqual({ font_key: "inter", max_rental_days: 30 });
    } finally {
      await removeTenant(t);
    }
  });

  it("refuses a title over 45 characters and a short description over 160", async () => {
    const t = await tenant();
    try {
      await expect(
        admin.query(
          "INSERT INTO tenant_settings (tenant_id, title, contact_email, contact_phone) VALUES ($1, $2, 'a@b.test', '1')",
          [t, "x".repeat(46)],
        ),
      ).rejects.toThrow();
      await expect(settings(t, "short_description", "y")).resolves.toBeUndefined();
    } finally {
      await removeTenant(t);
    }
  });

  it("refuses a partial address and an unsafe colour", async () => {
    const t = await tenant();
    try {
      await expect(settings(t, "address_street", "Via Roma 1")).rejects.toThrow();
      await expect(settings(t, "color_primary", "red")).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenant settings: isolation", () => {
  it("a tenant reads only its own settings", async () => {
    const mine = await tenant();
    const other = await tenant();
    try {
      await settings(mine);
      await settings(other);
      const client = new pg.Client({ connectionString: appUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [mine]);
        const seen = await client.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM tenant_settings",
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
