import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { changePassword, login, resolveSession, tenantRealm } from "../../src/modules/auth";
import { deriveKey } from "../../src/platform/crypto/keys";
import { hashPassword } from "../../src/platform/crypto/password";

// AUT-08 (docs/06-backend-api.md 4.2.4): current password required, other sessions end, token rotates.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const PEPPER = "p".repeat(40);
const OLD = "the old passphrase";
const NEW = "the new passphrase";
const HMAC_KEY = deriveKey("m".repeat(40), "ratelimit");
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const now = new Date();

async function seed(): Promise<string> {
  const tenantId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Change')", [
    tenantId,
    `cp-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, password_hash, status)
     VALUES ($1, $2, 'admin', 'admin1', 'A', 'a@example.test', $3, 'active')`,
    [randomUUID(), tenantId, await hashPassword(OLD, PEPPER)],
  );
  return tenantId;
}

async function signIn(tenantId: string, password: string) {
  return login(app, {
    realm: tenantRealm(tenantId),
    username: "admin1",
    password,
    peppers: [PEPPER],
    hmacKey: HMAC_KEY,
    now,
  });
}

function change(
  tenantId: string,
  sessionToken: string,
  currentPassword: string,
  newPassword = NEW,
) {
  return changePassword(app, {
    realm: tenantRealm(tenantId),
    sessionToken,
    currentPassword,
    newPassword,
    peppers: [PEPPER],
    hmacKey: HMAC_KEY,
    now,
  });
}

async function token(tenantId: string, password = OLD): Promise<string> {
  const r = await signIn(tenantId, password);
  if (r.status !== "ok") throw new Error(r.status);
  return r.token;
}

describe.skipIf(!adminUrl || !appUrl)("change password", () => {
  it("rotates the caller's session, ends the others and accepts only the new password", async () => {
    const t = await seed();
    const mine = await token(t);
    const other = await token(t);
    const result = await change(t, mine, OLD);
    expect(result.status).toBe("ok");
    const rotated = result.status === "ok" ? result.sessionToken : "";
    const realm = tenantRealm(t);
    expect(await resolveSession(app, { realm, token: mine, now })).toBeNull();
    expect(await resolveSession(app, { realm, token: other, now })).toBeNull();
    expect(await resolveSession(app, { realm, token: rotated, now })).not.toBeNull();
    expect((await signIn(t, OLD)).status).toBe("invalid");
    expect((await signIn(t, NEW)).status).toBe("ok");
    // SR-AUT-10: a notice is enqueued in the same transaction, to the account's own address.
    const notices = await admin.query<{ template: string; channel: string }>(
      "SELECT template, channel FROM email_log WHERE tenant_id = $1 AND category = 'transactional'",
      [t],
    );
    expect(notices.rows).toEqual([{ template: "notice.password_changed", channel: "system_smtp" }]);
  });

  it("refuses a wrong current password, a short new one and a missing session", async () => {
    const t = await seed();
    const mine = await token(t);
    expect(await change(t, mine, "not the current one")).toEqual({ status: "current_invalid" });
    expect((await change(t, mine, OLD, "short")).status).toBe("policy_failed");
    expect(await change(t, "no-session", OLD)).toEqual({ status: "unauthenticated" });
  });
});
