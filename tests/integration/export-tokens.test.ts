import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashToken } from "../../src/platform/crypto/token";

// Export download tokens (docs/05-database.md 5.23): one live link per tenant, bounded atomic counter,
// tenant isolation.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

const CONSUME = `UPDATE export_download_tokens SET download_count = download_count + 1
  WHERE token_hash = $1 AND superseded_at IS NULL AND expires_at > now()
    AND download_count < max_downloads
  RETURNING storage_key`;

async function tenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Export')", [
    id,
    `ex-${id.slice(0, 8)}`,
  ]);
  return id;
}

function keyFor(t: string): string {
  return `private/${t}/exports/${randomUUID()}.zip`;
}

async function issue(t: string, token: string, key: string = keyFor(t)): Promise<void> {
  await admin.query(
    "UPDATE export_download_tokens SET superseded_at = now() WHERE tenant_id = $1 AND superseded_at IS NULL",
    [t],
  );
  await admin.query(
    `INSERT INTO export_download_tokens (id, tenant_id, token_hash, storage_key, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
    [randomUUID(), t, hashToken(token), key],
  );
}

async function asTenant<T>(t: string, run: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: appUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [t]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } finally {
    await client.end();
  }
}

async function consume(t: string, token: string): Promise<number> {
  return asTenant(t, async (c) => (await c.query(CONSUME, [hashToken(token)])).rowCount ?? 0);
}

async function removeTenant(t: string): Promise<void> {
  await admin.query("DELETE FROM export_download_tokens WHERE tenant_id = $1", [t]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [t]);
}

describe.skipIf(!adminUrl || !appUrl)("export tokens: consumption", () => {
  it("allows three downloads and refuses the fourth", async () => {
    const t = await tenant();
    try {
      await issue(t, "export-token-a");
      const results = [];
      for (let i = 0; i < 4; i += 1) {
        results.push(await consume(t, "export-token-a"));
      }
      expect(results).toEqual([1, 1, 1, 0]);
    } finally {
      await removeTenant(t);
    }
  });

  it("re-issuing supersedes the previous link, which stops working", async () => {
    const t = await tenant();
    try {
      await issue(t, "export-token-old");
      await issue(t, "export-token-new");
      expect(await consume(t, "export-token-old")).toBe(0);
      expect(await consume(t, "export-token-new")).toBe(1);
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("export tokens: constraints", () => {
  it("refuses a second live link, a storage key outside the tenant and a bad counter", async () => {
    const t = await tenant();
    try {
      await issue(t, "export-token-b");
      await expect(
        admin.query(
          `INSERT INTO export_download_tokens (id, tenant_id, token_hash, storage_key, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
          [randomUUID(), t, hashToken("export-token-c"), keyFor(t)],
        ),
      ).rejects.toThrow();
      await expect(issue(t, "export-token-d", keyFor(randomUUID()))).rejects.toThrow();
      await expect(
        admin.query("UPDATE export_download_tokens SET max_downloads = 4 WHERE tenant_id = $1", [
          t,
        ]),
      ).rejects.toThrow();
    } finally {
      await removeTenant(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("export tokens: isolation", () => {
  it("another tenant can neither see nor consume the link", async () => {
    const mine = await tenant();
    const other = await tenant();
    try {
      await issue(mine, "export-token-e");
      const seen = await asTenant(
        other,
        async (c) => (await c.query("SELECT id FROM export_download_tokens")).rowCount,
      );
      expect(seen).toBe(0);
      expect(await consume(other, "export-token-e")).toBe(0);
      expect(await consume(mine, "export-token-e")).toBe(1);
    } finally {
      await removeTenant(mine);
      await removeTenant(other);
    }
  });
});
