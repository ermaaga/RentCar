import pg from "pg";
import { describe, expect, it } from "vitest";

import { createSystemadmin, readBootstrapInput } from "../../scripts/create-systemadmin";
import {
  login,
  peekCredentialLink,
  redeemCredentialLink,
  resolveSession,
  SYSTEM_REALM,
  tenantRealm,
} from "../../src/modules/auth";
import { deriveKey } from "../../src/platform/crypto/keys";

// System realm: bootstrap CLI, activation, login and sessions (docs/06-backend-api.md 4.1, 4.2.6).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const PEPPER = "p".repeat(40);
const PASSWORD = "the owner passphrase";
const HMAC_KEY = deriveKey("m".repeat(40), "ratelimit");
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const now = new Date();
const MIN = 60_000;

async function bootstrap(): Promise<{ username: string; token: string }> {
  const username = `owner-${String(Date.now()).slice(-8)}${String(Math.random()).slice(2, 6)}`;
  const input = readBootstrapInput({
    SYSTEMADMIN_USERNAME: username,
    SYSTEMADMIN_EMAIL: "owner@example.test",
  });
  return { username, token: await createSystemadmin(app, input, now) };
}

async function cleanup(username: string): Promise<void> {
  const u = await admin.query<{ id: string }>(
    "SELECT id FROM users WHERE tenant_id IS NULL AND username = $1",
    [username],
  );
  const id = u.rows[0]?.id;
  await admin.query("DELETE FROM sessions WHERE user_id = $1", [id]);
  await admin.query("DELETE FROM credential_tokens WHERE user_id = $1", [id]);
  await admin.query("DELETE FROM users WHERE id = $1", [id]);
}

function systemLogin(username: string, password: string, at = now) {
  return login(app, {
    realm: SYSTEM_REALM,
    username,
    password,
    peppers: [PEPPER],
    hmacKey: HMAC_KEY,
    now: at,
  });
}

describe.skipIf(!adminUrl || !appUrl)("system realm: bootstrap and activation", () => {
  it("creates a pending owner whose link activates it and starts a system session", async () => {
    const { username, token } = await bootstrap();
    try {
      expect(await peekCredentialLink(app, { realm: SYSTEM_REALM, token, now })).toEqual({
        state: "valid",
        purpose: "activation",
        username,
      });
      const redeemed = await redeemCredentialLink(app, {
        realm: SYSTEM_REALM,
        token,
        password: PASSWORD,
        pepper: PEPPER,
        now,
      });
      const session = redeemed.status === "ok" ? (redeemed.sessionToken ?? "") : "";
      const resolved = await resolveSession(app, { realm: SYSTEM_REALM, token: session, now });
      expect(resolved?.role).toBe("systemadmin");
    } finally {
      await cleanup(username);
    }
  });

  it("refuses a bad bootstrap input", () => {
    expect(() =>
      readBootstrapInput({ SYSTEMADMIN_USERNAME: "x", SYSTEMADMIN_EMAIL: "a@b.c" }),
    ).toThrow();
    expect(() =>
      readBootstrapInput({ SYSTEMADMIN_USERNAME: "owner", SYSTEMADMIN_EMAIL: "no" }),
    ).toThrow();
  });
});

describe.skipIf(!adminUrl || !appUrl)("system realm: login and sessions", () => {
  it("logs in, idles out after 15 minutes, and is not valid in a tenant realm", async () => {
    const { username, token } = await bootstrap();
    try {
      await redeemCredentialLink(app, {
        realm: SYSTEM_REALM,
        token,
        password: PASSWORD,
        pepper: PEPPER,
        now,
      });
      const result = await systemLogin(username, PASSWORD);
      if (result.status !== "ok") throw new Error(result.status);
      expect(result.absoluteExpiresAt.getTime() - now.getTime()).toBe(8 * 60 * MIN);
      const at20 = new Date(now.getTime() + 20 * MIN);
      expect(
        await resolveSession(app, { realm: SYSTEM_REALM, token: result.token, now: at20 }),
      ).toBeNull();
      const foreign = tenantRealm("00000000-0000-4000-8000-000000000000");
      expect(await resolveSession(app, { realm: foreign, token: result.token, now })).toBeNull();
    } finally {
      await cleanup(username);
    }
  });

  it("a system link cannot be redeemed as a tenant link and a wrong password is refused", async () => {
    const { username, token } = await bootstrap();
    try {
      const foreign = tenantRealm("00000000-0000-4000-8000-000000000000");
      expect((await peekCredentialLink(app, { realm: foreign, token, now })).state).toBe("invalid");
      expect(await systemLogin(username, "not the password at all")).toEqual({
        status: "invalid",
        reason: "not_active",
      });
    } finally {
      await cleanup(username);
    }
  });
});
