import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashToken } from "../../src/platform/crypto/token";

// Credential tokens (docs/05-database.md 5.7): one live token per user and purpose, atomic consumption.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });

async function fixture(): Promise<{ tenant: string; user: string }> {
  const tenant = randomUUID();
  const user = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Creds')", [
    tenant,
    `cr-${tenant.slice(0, 8)}`,
  ]);
  await admin.query(
    "INSERT INTO users (id, tenant_id, role, username, display_name, email) VALUES ($1, $2, 'operator', 'operator1', 'O', 'o@example.test')",
    [user, tenant],
  );
  return { tenant, user };
}

async function issue(
  f: { tenant: string; user: string },
  purpose: string,
  token: string,
): Promise<void> {
  await admin.query(
    `UPDATE credential_tokens SET superseded_at = now()
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND superseded_at IS NULL`,
    [f.user, purpose],
  );
  await admin.query(
    `INSERT INTO credential_tokens (id, tenant_id, user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '24 hours')`,
    [randomUUID(), f.tenant, f.user, purpose, hashToken(token)],
  );
}

async function cleanup(f: { tenant: string }): Promise<void> {
  await admin.query("DELETE FROM credential_tokens WHERE tenant_id = $1", [f.tenant]);
  await admin.query("DELETE FROM users WHERE tenant_id = $1", [f.tenant]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [f.tenant]);
}

describe.skipIf(!adminUrl)("credential tokens", () => {
  it("re-issuing supersedes the previous live token, and only one stays live", async () => {
    const f = await fixture();
    try {
      await issue(f, "activation", "first-token-value-aaaaaaaaaaaaaaaaaaaaaaaaaa");
      await issue(f, "activation", "second-token-value-bbbbbbbbbbbbbbbbbbbbbbbbb");
      const live = await admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM credential_tokens WHERE user_id = $1 AND used_at IS NULL AND superseded_at IS NULL",
        [f.user],
      );
      expect(live.rows[0]?.n).toBe(1);
    } finally {
      await cleanup(f);
    }
  });

  it("consumes a token once, atomically, and refuses a second use", async () => {
    const f = await fixture();
    const token = "consume-once-token-cccccccccccccccccccccccccccc";
    try {
      await issue(f, "password_reset", token);
      const first = await admin.query(
        "UPDATE credential_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > now() RETURNING user_id",
        [hashToken(token)],
      );
      const second = await admin.query(
        "UPDATE credential_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > now() RETURNING user_id",
        [hashToken(token)],
      );
      expect(first.rows).toEqual([{ user_id: f.user }]);
      expect(second.rows).toEqual([]);
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl)("credential token expiry", () => {
  it("refuses an expired token", async () => {
    const f = await fixture();
    const token = "expired-token-value-dddddddddddddddddddddddddddddd";
    try {
      await admin.query(
        `INSERT INTO credential_tokens (id, tenant_id, user_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, $3, 'password_reset', $4, now() - interval '1 minute')`,
        [randomUUID(), f.tenant, f.user, hashToken(token)],
      );
      const used = await admin.query(
        "UPDATE credential_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND superseded_at IS NULL AND expires_at > now() RETURNING user_id",
        [hashToken(token)],
      );
      expect(used.rows).toEqual([]);
    } finally {
      await cleanup(f);
    }
  });
});
