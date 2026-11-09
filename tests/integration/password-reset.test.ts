import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { issuePasswordResets, peekCredentialLink, tenantRealm } from "../../src/modules/auth";
import { hashPassword } from "../../src/platform/crypto/password";
import { hitRateLimit } from "../../src/platform/rate-limit/postgres";

// AUT-06 reset issuance and the generic fixed-window limiter (docs/06-backend-api.md 3.9, 4.2.3).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 2 });
const now = new Date();

async function seed(status = "active"): Promise<string> {
  const tenantId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Reset')", [
    tenantId,
    `rs-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email, password_hash, status)
     VALUES ($1, $2, 'admin', 'admin1', 'Admin', 'Admin@Example.test', $3, $4)`,
    [
      randomUUID(),
      tenantId,
      status === "active" ? await hashPassword("x".repeat(12), "p".repeat(40)) : null,
      status,
    ],
  );
  return tenantId;
}

async function cleanup(tenantId: string): Promise<void> {
  await admin.query("DELETE FROM credential_tokens WHERE tenant_id = $1", [tenantId]);
  await admin.query("DELETE FROM users WHERE tenant_id = $1", [tenantId]);
  await admin.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
}

describe.skipIf(!adminUrl || !appUrl)("password reset issuance", () => {
  it("matches by username or case-insensitive email and issues a live reset link", async () => {
    const t = await seed();
    try {
      for (const identifier of ["admin1", "ADMIN@example.TEST"]) {
        const [r] = await issuePasswordResets(app, { realm: tenantRealm(t), identifier, now });
        expect(r?.username).toBe("admin1");
        const peek = await peekCredentialLink(app, {
          realm: tenantRealm(t),
          token: r?.token ?? "",
          now,
        });
        expect(peek.purpose).toBe("password_reset");
      }
    } finally {
      await cleanup(t);
    }
  });

  it("issues nothing for an unknown identifier or a pending account", async () => {
    const t = await seed("pending");
    try {
      expect(
        await issuePasswordResets(app, { realm: tenantRealm(t), identifier: "nobody", now }),
      ).toEqual([]);
      expect(
        await issuePasswordResets(app, { realm: tenantRealm(t), identifier: "admin1", now }),
      ).toEqual([]);
    } finally {
      await cleanup(t);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("fixed-window rate limit", () => {
  it("allows up to the limit and refuses the next hit with a retry delay", async () => {
    const rule = { scope: `test.${randomUUID()}`, limit: 3, windowMs: 3_600_000 };
    const hmacKey = Buffer.alloc(32, 7);
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await hitRateLimit(app, { hmacKey, rule, identity: "ip-1", now }));
    }
    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    const last = results[3];
    expect(last?.allowed).toBe(false);
    expect(last && !last.allowed && last.retryAfterSeconds > 0).toBe(true);
    expect((await hitRateLimit(app, { hmacKey, rule, identity: "ip-2", now })).allowed).toBe(true);
  });
});
