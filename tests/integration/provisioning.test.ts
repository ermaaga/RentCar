import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { peekCredentialLink, tenantRealm } from "../../src/modules/auth";
import { createTenantInput, provisionTenant } from "../../src/modules/tenancy";
import { validTenantInput } from "../support/tenant-input";

// TEN-03 as the runtime role in the system scope (docs/06-backend-api.md 6.1).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const now = new Date();

async function systemadmin(): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, NULL, 'systemadmin', $2, 'Owner', 'owner@example.test')`,
    [id, `sa-${id.slice(0, 8)}`],
  );
  return id;
}

function input(slug: string, overrides: Record<string, unknown> = {}) {
  return createTenantInput.parse({ ...validTenantInput, slug, ...overrides });
}

async function removeTenant(slug: string): Promise<void> {
  const t = await admin.query<{ id: string }>("SELECT id FROM tenants WHERE slug = $1", [slug]);
  const id = t.rows[0]?.id;
  if (!id) {
    return;
  }
  await admin.query("ALTER TABLE audit_log DISABLE TRIGGER USER");
  await admin.query("DELETE FROM audit_log WHERE tenant_id = $1", [id]);
  await admin.query("ALTER TABLE audit_log ENABLE TRIGGER USER");
  for (const table of ["credential_tokens", "users", "subscriptions", "tenant_settings"]) {
    await admin.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id]);
  }
  await admin.query("DELETE FROM tenants WHERE id = $1", [id]);
}

describe.skipIf(!adminUrl || !appUrl)("provisioning: create tenant", () => {
  it("creates tenant, settings, subscription, pending admin, a live activation link and audits", async () => {
    const actor = await systemadmin();
    const slug = `pv-${randomUUID().slice(0, 8)}`;
    try {
      const result = await provisionTenant(app, input(slug), { actorUserId: actor, now });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = await admin.query<{ status: string; n_settings: number; n_subs: number }>(
        `SELECT u.status,
                (SELECT count(*)::int FROM tenant_settings WHERE tenant_id = $1) AS n_settings,
                (SELECT count(*)::int FROM subscriptions WHERE tenant_id = $1) AS n_subs
           FROM users u WHERE u.id = $2`,
        [result.tenantId, result.adminUserId],
      );
      expect(rows.rows[0]).toEqual({ status: "pending", n_settings: 1, n_subs: 1 });
      const peek = await peekCredentialLink(app, {
        realm: tenantRealm(result.tenantId),
        token: result.activationToken,
        now,
      });
      expect(peek).toEqual({ state: "valid", purpose: "activation", username: "mario.rossi" });
    } finally {
      await removeTenant(slug);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("provisioning: audit", () => {
  it("writes the platform audit row", async () => {
    const actor = await systemadmin();
    const slug = `pv-${randomUUID().slice(0, 8)}`;
    try {
      const result = await provisionTenant(app, input(slug), { actorUserId: actor, now });
      if (!result.ok) throw new Error(result.code);
      const audit = await admin.query(
        "SELECT 1 FROM platform_audit WHERE subject_tenant_id = $1 AND action = 'tenant.created'",
        [result.tenantId],
      );
      expect(audit.rowCount).toBe(1);
    } finally {
      await removeTenant(slug);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("provisioning: refusals", () => {
  it("a taken slug creates nothing", async () => {
    const actor = await systemadmin();
    const slug = `pv-${randomUUID().slice(0, 8)}`;
    try {
      expect((await provisionTenant(app, input(slug), { actorUserId: actor, now })).ok).toBe(true);
      const second = await provisionTenant(app, input(slug, { name: "Other" }), {
        actorUserId: actor,
        now,
      });
      expect(second).toEqual({ ok: false, code: "SLUG_TAKEN" });
      const count = await admin.query("SELECT 1 FROM tenants WHERE name = 'Other'");
      expect(count.rowCount).toBe(0);
    } finally {
      await removeTenant(slug);
    }
  });
});

describe.skipIf(!adminUrl || !appUrl)("provisioning: slug and period refusals", () => {
  it("refuses reserved, tombstoned slugs and an inverted subscription period", async () => {
    const actor = await systemadmin();
    const tomb = `pv-${randomUUID().slice(0, 8)}`;
    await admin.query(
      "INSERT INTO slug_tombstone (slug, subject_tenant_id, reserved_until) VALUES ($1, $2, now() + interval '1 day')",
      [tomb, randomUUID()],
    );
    const ctx = { actorUserId: actor, now };
    expect(await provisionTenant(app, input("system"), ctx)).toEqual({
      ok: false,
      code: "SLUG_RESERVED",
    });
    expect(await provisionTenant(app, input(tomb), ctx)).toEqual({
      ok: false,
      code: "SLUG_RESERVED",
    });
    const inverted = input(`pv-${randomUUID().slice(0, 8)}`, {
      subscription: { ...validTenantInput.subscription, startDate: "2028-01-01" },
    });
    expect(await provisionTenant(app, inverted, ctx)).toEqual({
      ok: false,
      code: "SUBSCRIPTION_INVALID_PERIOD",
    });
    await admin.query("DELETE FROM slug_tombstone WHERE slug = $1", [tomb]);
  });
});
