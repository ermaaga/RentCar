import pg from "pg";
import { describe, expect, it } from "vitest";

// ABU-M0-03: row-level security template. Without a tenant in the session, the runtime role sees
// and changes no tenant rows. Uses a probe table created and dropped by the test itself.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;

async function scalar(url: string, sql: string): Promise<number> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<{ n: number }>(sql);
    return res.rows[0]?.n ?? -1;
  } finally {
    await client.end();
  }
}

describe.skipIf(!adminUrl || !appUrl)("row-level security template", () => {
  it("without a tenant set, the runtime role sees and changes no tenant rows", async () => {
    const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    try {
      await admin.query("DROP TABLE IF EXISTS rls_probe");
      await admin.query("CREATE TABLE rls_probe (tenant_id uuid NOT NULL, note text NOT NULL)");
      await admin.query("ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY");
      await admin.query("ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY");
      await admin.query(
        "CREATE POLICY rls_probe_tenant ON rls_probe USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())",
      );
      await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON rls_probe TO rentcar_app");
      await admin.query("INSERT INTO rls_probe VALUES (gen_random_uuid(), 'seed row')");

      const visible = await scalar(appUrl ?? "", "SELECT count(*)::int AS n FROM rls_probe");
      expect(visible).toBe(0);
      const deleted = await scalar(
        appUrl ?? "",
        "WITH d AS (DELETE FROM rls_probe RETURNING 1) SELECT count(*)::int AS n FROM d",
      );
      expect(deleted).toBe(0);
    } finally {
      await admin.query("DROP TABLE IF EXISTS rls_probe");
      await admin.end();
    }
  });
});
