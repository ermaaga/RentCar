import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { login, resolveSession, revokeSession } from "../../src/modules/auth";
import { hashPassword } from "../../src/platform/crypto/password";
import { hashToken } from "../../src/platform/crypto/token";

// Login and sessions against a real Postgres as the runtime role (docs/05-database.md 5.5, 5.6).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const PEPPER = "p".repeat(40);
const PASSWORD = "correct horse battery";
const MIN = 60_000;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 2 });
const now = new Date();

interface Fixture {
  tenantId: string;
  userId: string;
}

async function seed(): Promise<Fixture> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Sessions')", [
    tenantId,
    `ss-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, password_hash, status)
     VALUES ($1, $2, 'operator', 'operator1', 'Op', 'op@example.test', $3, 'active')`,
    [userId, tenantId, await hashPassword(PASSWORD, PEPPER)],
  );
  return { tenantId, userId };
}

async function cleanup(f: Fixture): Promise<void> {
  await admin.query("DELETE FROM sessions WHERE tenant_id = $1", [f.tenantId]);
  await admin.query("DELETE FROM users WHERE tenant_id = $1", [f.tenantId]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [f.tenantId]);
}

async function tryLogin(f: Fixture, username: string, password: string) {
  return login(app, { tenantId: f.tenantId, username, password, peppers: [PEPPER], now });
}

async function openSession(f: Fixture): Promise<string> {
  const ok = await login(app, {
    tenantId: f.tenantId,
    username: "operator1",
    password: PASSWORD,
    peppers: [PEPPER],
    now,
  });
  return ok?.token ?? "";
}

describe.skipIf(!adminUrl || !appUrl)("login", () => {
  it("logs in with the right password and resolves the token", async () => {
    const f = await seed();
    try {
      const token = await openSession(f);
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(await resolveSession(app, { tenantId: f.tenantId, token, now })).toEqual({
        userId: f.userId,
        role: "operator",
      });
    } finally {
      await cleanup(f);
    }
  });

  it("refuses a wrong password", async () => {
    const f = await seed();
    try {
      expect(await tryLogin(f, "operator1", "wrong password here")).toBeNull();
    } finally {
      await cleanup(f);
    }
  });

  it("refuses an unknown user with the same answer", async () => {
    const f = await seed();
    try {
      expect(await tryLogin(f, "nobody1", PASSWORD)).toBeNull();
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("logout", () => {
  it("revokes a session so the token no longer resolves", async () => {
    const f = await seed();
    try {
      const token = await openSession(f);
      expect(await revokeSession(app, { tenantId: f.tenantId, token })).toBe(true);
      expect(await resolveSession(app, { tenantId: f.tenantId, token, now })).toBeNull();
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("session expiry", () => {
  it("expires a session after 30 idle minutes", async () => {
    const f = await seed();
    try {
      const token = await openSession(f);
      const at25 = new Date(now.getTime() + 25 * MIN);
      expect(await resolveSession(app, { tenantId: f.tenantId, token, now: at25 })).not.toBeNull();
      const at60 = new Date(now.getTime() + 60 * MIN);
      expect(await resolveSession(app, { tenantId: f.tenantId, token, now: at60 })).toBeNull();
    } finally {
      await cleanup(f);
    }
  });

  it("expires a session at 12 hours even while it stays active", async () => {
    const f = await seed();
    try {
      const token = await openSession(f);
      for (let minutes = 20; minutes <= 11 * 60; minutes += 20) {
        const at = new Date(now.getTime() + minutes * MIN);
        expect(await resolveSession(app, { tenantId: f.tenantId, token, now: at })).not.toBeNull();
      }
      const after = new Date(now.getTime() + 13 * 60 * MIN);
      expect(await resolveSession(app, { tenantId: f.tenantId, token, now: after })).toBeNull();
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("session storage", () => {
  it("stores only the SHA-256 of the token, never the token", async () => {
    const f = await seed();
    try {
      const token = await openSession(f);
      const rows = await admin.query<{ token_hash: Buffer }>(
        "SELECT token_hash FROM sessions WHERE tenant_id = $1",
        [f.tenantId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.token_hash.equals(hashToken(token))).toBe(true);
      expect(rows.rows[0]?.token_hash.toString("utf8")).not.toContain(token);
    } finally {
      await cleanup(f);
    }
  });
});
