import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { login, resolveSession, revokeSession, tenantRealm } from "../../src/modules/auth";
import { hashPassword } from "../../src/platform/crypto/password";
import { hashToken } from "../../src/platform/crypto/token";
import { deriveKey } from "../../src/platform/crypto/keys";
import { purgeExpired } from "../../src/modules/auth/infrastructure/throttle";

// Login and sessions against a real Postgres as the runtime role (docs/05-database.md 5.5, 5.6).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const PEPPER = "p".repeat(40);
const PASSWORD = "correct horse battery";
const MIN = 60_000;
const HMAC_KEY = deriveKey("m".repeat(40), "ratelimit");
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

async function tryLogin(f: Fixture, username: string, password: string, at: Date = now) {
  return login(app, {
    realm: tenantRealm(f.tenantId),
    username,
    password,
    peppers: [PEPPER],
    hmacKey: HMAC_KEY,
    now: at,
  });
}

async function openSession(f: Fixture): Promise<string> {
  const result = await tryLogin(f, "operator1", PASSWORD);
  if (result.status !== "ok") {
    throw new Error(`login failed: ${result.status}`);
  }
  return result.token;
}

describe.skipIf(!adminUrl || !appUrl)("login", () => {
  it("logs in with the right password and resolves the token", async () => {
    const f = await seed();
    try {
      const token = await openSession(f);
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(await resolveSession(app, { realm: tenantRealm(f.tenantId), token, now })).toEqual({
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
      expect(await tryLogin(f, "operator1", "wrong password here")).toEqual({
        status: "invalid",
        reason: "bad_password",
      });
    } finally {
      await cleanup(f);
    }
  });

  it("refuses an unknown user with the same answer", async () => {
    const f = await seed();
    try {
      expect(await tryLogin(f, "nobody1", PASSWORD)).toEqual({
        status: "invalid",
        reason: "unknown_user",
      });
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
      expect(await revokeSession(app, { realm: tenantRealm(f.tenantId), token })).toBe(true);
      expect(await resolveSession(app, { realm: tenantRealm(f.tenantId), token, now })).toBeNull();
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
      expect(
        await resolveSession(app, { realm: tenantRealm(f.tenantId), token, now: at25 }),
      ).not.toBeNull();
      const at60 = new Date(now.getTime() + 60 * MIN);
      expect(
        await resolveSession(app, { realm: tenantRealm(f.tenantId), token, now: at60 }),
      ).toBeNull();
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
        expect(
          await resolveSession(app, { realm: tenantRealm(f.tenantId), token, now: at }),
        ).not.toBeNull();
      }
      const after = new Date(now.getTime() + 13 * 60 * MIN);
      expect(
        await resolveSession(app, { realm: tenantRealm(f.tenantId), token, now: after }),
      ).toBeNull();
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

describe.skipIf(!adminUrl || !appUrl)("login lockout", () => {
  it("refuses every attempt after 5 failures in a window, even with the right password", async () => {
    const f = await seed();
    try {
      for (let i = 0; i < 5; i += 1) {
        expect(await tryLogin(f, "operator1", "wrong password here")).toEqual({
          status: "invalid",
          reason: "bad_password",
        });
      }
      const blocked = await tryLogin(f, "operator1", PASSWORD);
      expect(blocked.status).toBe("throttled");
      expect(blocked.status === "throttled" && blocked.retryAfterSeconds >= 1).toBe(true);
    } finally {
      await cleanup(f);
    }
  });

  it("does not throttle a different username of the same tenant", async () => {
    const f = await seed();
    try {
      for (let i = 0; i < 5; i += 1) {
        await tryLogin(f, "operator1", "wrong password here");
      }
      const other = await tryLogin(f, "nobody1", PASSWORD);
      expect(other).toEqual({ status: "invalid", reason: "unknown_user" });
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("login lockout window", () => {
  it("reopens the window after 15 minutes", async () => {
    const f = await seed();
    try {
      for (let i = 0; i < 5; i += 1) {
        await tryLogin(f, "operator1", "wrong password here");
      }
      const later = new Date(now.getTime() + 16 * MIN);
      expect((await tryLogin(f, "operator1", PASSWORD, later)).status).toBe("ok");
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("rate-limit purge", () => {
  it("removes counters past their expiry and keeps live ones", async () => {
    const past = new Date(now.getTime() - 3 * 3_600_000);
    const expiredKey = "e".repeat(64);
    const liveKey = "f".repeat(64);
    await admin.query(
      `INSERT INTO rate_limit_buckets (key, window_start, count, expires_at) VALUES
         ($1, $2, 3, $3), ($4, now(), 1, now() + interval '1 hour')`,
      [expiredKey, past, new Date(past.getTime() + 60 * MIN), liveKey],
    );
    const removed = await purgeExpired(admin, now);
    const left = await admin.query<{ key: string }>(
      "SELECT key FROM rate_limit_buckets WHERE key IN ($1, $2)",
      [expiredKey, liveKey],
    );
    await admin.query("DELETE FROM rate_limit_buckets WHERE key IN ($1, $2)", [
      expiredKey,
      liveKey,
    ]);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(left.rows.map((r) => r.key)).toEqual([liveKey]);
  });
});
