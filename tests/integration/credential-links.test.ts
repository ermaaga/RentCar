import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  issueCredentialLink,
  peekCredentialLink,
  redeemCredentialLink,
  resolveSession,
} from "../../src/modules/auth";
import { withTenantTx } from "../../src/platform/db/tenant-tx";

// Set-password links end to end as the runtime role (docs/06-backend-api.md 4.2.2, ABU-M1-13).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const PEPPER = "p".repeat(40);
const NEW_PASSWORD = "a brand new passphrase";
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const now = new Date();

interface Fixture {
  tenantId: string;
  userId: string;
}

async function seed(): Promise<Fixture> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Links')", [
    tenantId,
    `cl-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, $2, 'admin', 'admin1', 'Admin', 'admin@example.test')`,
    [userId, tenantId],
  );
  return { tenantId, userId };
}

async function cleanup(f: Fixture): Promise<void> {
  await admin.query("DELETE FROM sessions WHERE tenant_id = $1", [f.tenantId]);
  await admin.query("DELETE FROM credential_tokens WHERE tenant_id = $1", [f.tenantId]);
  await admin.query("DELETE FROM users WHERE tenant_id = $1", [f.tenantId]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [f.tenantId]);
}

async function issue(f: Fixture, purpose: "activation" | "password_reset" = "activation") {
  return withTenantTx(app, f.tenantId, (client) =>
    issueCredentialLink(client, { tenantId: f.tenantId, userId: f.userId, purpose, now }),
  );
}

function redeem(f: Fixture, token: string, password = NEW_PASSWORD, at = now) {
  return redeemCredentialLink(app, {
    tenantId: f.tenantId,
    token,
    password,
    pepper: PEPPER,
    now: at,
  });
}

describe.skipIf(!adminUrl || !appUrl)("credential links: activation", () => {
  it("peeks without consuming, then activates the user and starts a session", async () => {
    const f = await seed();
    try {
      const token = await issue(f);
      const peek = await peekCredentialLink(app, { tenantId: f.tenantId, token, now });
      expect(peek).toEqual({ state: "valid", purpose: "activation", username: "admin1" });
      const result = await redeem(f, token);
      expect(result.status).toBe("ok");
      const sessionToken = result.status === "ok" ? (result.sessionToken ?? "") : "";
      expect(await resolveSession(app, { tenantId: f.tenantId, token: sessionToken, now })).toEqual(
        { userId: f.userId, role: "admin" },
      );
      expect(await peekCredentialLink(app, { tenantId: f.tenantId, token, now })).toEqual({
        state: "used",
      });
    } finally {
      await cleanup(f);
    }
  });

  it("a policy failure does not consume the link", async () => {
    const f = await seed();
    try {
      const token = await issue(f);
      expect(await redeem(f, token, "short")).toEqual({
        status: "policy_failed",
        problems: ["too_short"],
      });
      expect((await redeem(f, token)).status).toBe("ok");
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("credential links: refusals", () => {
  it("refuses an expired, a superseded and an unknown link", async () => {
    const f = await seed();
    try {
      const first = await issue(f);
      const second = await issue(f);
      expect((await redeem(f, first)).status).toBe("invalid");
      const tomorrow = new Date(now.getTime() + 25 * 3_600_000);
      expect((await redeem(f, second, NEW_PASSWORD, tomorrow)).status).toBe("invalid");
      expect((await redeem(f, "not-a-real-token")).status).toBe("invalid");
    } finally {
      await cleanup(f);
    }
  });

  it("refuses a link of a suspended tenant and leaves it unconsumed", async () => {
    const f = await seed();
    try {
      const token = await issue(f);
      await admin.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [f.tenantId]);
      expect((await redeem(f, token)).status).toBe("invalid");
      await admin.query("UPDATE tenants SET status = 'active' WHERE id = $1", [f.tenantId]);
      expect((await redeem(f, token)).status).toBe("ok");
    } finally {
      await cleanup(f);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("credential links: reset and races", () => {
  it("a reset sets the password without starting a session", async () => {
    const f = await seed();
    try {
      const token = await issue(f, "password_reset");
      expect(await redeem(f, token)).toEqual({ status: "ok", purpose: "password_reset" });
    } finally {
      await cleanup(f);
    }
  });

  it("of two concurrent redeems exactly one wins", async () => {
    const f = await seed();
    try {
      const token = await issue(f);
      const results = await Promise.all([redeem(f, token), redeem(f, token)]);
      expect(results.filter((r) => r.status === "ok")).toHaveLength(1);
      expect(results.filter((r) => r.status === "invalid")).toHaveLength(1);
    } finally {
      await cleanup(f);
    }
  });
});
