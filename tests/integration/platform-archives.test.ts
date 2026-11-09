import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// Platform archives (docs/05-database.md 5.19-5.22): append-only guards, codes-only columns, system-only reads.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

describe.skipIf(!adminUrl)("platform archives: append-only", () => {
  it("security events cannot be updated or deleted, even by the owner", async () => {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO security_event (id, event, realm, outcome, reason_code) VALUES ($1, 'auth.login.failure', 'tenant', 'denied', 'bad_credentials')",
      [id],
    );
    try {
      await expect(
        admin.query("UPDATE security_event SET outcome = 'x' WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/);
      await expect(admin.query("DELETE FROM security_event WHERE id = $1", [id])).rejects.toThrow(
        /append-only/,
      );
    } finally {
      // Removed by the test only, through a session that disables the trigger for this table.
      await admin.query("ALTER TABLE security_event DISABLE TRIGGER security_event_no_delete");
      await admin.query("DELETE FROM security_event WHERE id = $1", [id]);
      await admin.query("ALTER TABLE security_event ENABLE TRIGGER security_event_no_delete");
    }
  });
});

describe.skipIf(!adminUrl)("platform archives: constraints", () => {
  it("platform audit refuses an action outside the taxonomy", async () => {
    await expect(
      admin.query("INSERT INTO platform_audit (id, action) VALUES ($1, 'tenant.exploded')", [
        randomUUID(),
      ]),
    ).rejects.toThrow();
  });

  it("slug tombstones refuse a malformed slug", async () => {
    await expect(
      admin.query(
        "INSERT INTO slug_tombstone (slug, subject_tenant_id, reserved_until) VALUES ('Bad_Slug', $1, now())",
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it("deletion ledger requires a customer id for an anonymisation entry", async () => {
    await expect(
      admin.query(
        "INSERT INTO deletion_ledger (id, kind, subject_tenant_id, occurred_at) VALUES ($1, 'customer_anonymised', $2, now())",
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow();
  });
});

describe.skipIf(!appUrl)("platform archives: reads by scope", () => {
  it("a tenant scope cannot read security events", async () => {
    const client = new pg.Client({ connectionString: appUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.scope', 'tenant', true)");
      const rows = await client.query("SELECT id FROM security_event");
      await client.query("COMMIT");
      expect(rows.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
