import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  issueAdminAccessLink,
  peekCredentialLink,
  redeemCredentialLink,
  resolveSession,
  tenantRealm,
} from "../../src/modules/auth";
import {
  changeSubscriptionEnd,
  createTenantInput,
  getTenantDetail,
  provisionTenant,
  setTenantStatus,
} from "../../src/modules/tenancy";
import { validTenantInput } from "../support/tenant-input";

// Console lifecycle as the runtime role (docs/06-backend-api.md TEN-05/06/10, SUB-02, AUT-17).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const now = new Date();
const PEPPER = "p".repeat(40);

async function actor(): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, NULL, 'systemadmin', $2, 'Owner', 'owner@example.test')`,
    [id, `lc-${id.slice(0, 8)}`],
  );
  return id;
}

/** A provisioned tenant whose admin is active with a live session. */
async function activeTenant(actorUserId: string) {
  const slug = `lc-${randomUUID().slice(0, 8)}`;
  const created = await provisionTenant(
    app,
    createTenantInput.parse({ ...validTenantInput, slug }),
    {
      actorUserId,
      now,
    },
  );
  if (!created.ok) throw new Error(created.code);
  const realm = tenantRealm(created.tenantId);
  const redeemed = await redeemCredentialLink(app, {
    realm,
    token: created.activationToken,
    password: "admin passphrase 1",
    pepper: PEPPER,
    now,
  });
  const session = redeemed.status === "ok" ? (redeemed.sessionToken ?? "") : "";
  return { slug, realm, session, tenantId: created.tenantId };
}

describe.skipIf(!adminUrl || !appUrl)("tenant lifecycle: suspend and reactivate", () => {
  it("suspension ends tenant sessions at once; repeating is a no-op; reactivation restores", async () => {
    const ctx = { actorUserId: await actor(), now };
    const t = await activeTenant(ctx.actorUserId);
    expect(await resolveSession(app, { realm: t.realm, token: t.session, now })).not.toBeNull();
    expect(await setTenantStatus(app, { slug: t.slug, to: "suspended" }, ctx)).toEqual({
      ok: true,
      changed: true,
    });
    expect(await resolveSession(app, { realm: t.realm, token: t.session, now })).toBeNull();
    expect(await setTenantStatus(app, { slug: t.slug, to: "suspended" }, ctx)).toEqual({
      ok: true,
      changed: false,
    });
    expect(await setTenantStatus(app, { slug: t.slug, to: "active" }, ctx)).toEqual({
      ok: true,
      changed: true,
    });
    expect((await getTenantDetail(app, t.slug))?.status).toBe("active");
    expect(await setTenantStatus(app, { slug: "no-such-tenant", to: "active" }, ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenant lifecycle: subscription and admin access", () => {
  it("renews the end date and refuses an end before the start", async () => {
    const ctx = { actorUserId: await actor(), now };
    const t = await activeTenant(ctx.actorUserId);
    const sub = (await getTenantDetail(app, t.slug))?.subscriptions[0];
    const id = sub?.id ?? "";
    expect(
      await changeSubscriptionEnd(
        app,
        { slug: t.slug, subscriptionId: id, endDate: "2028-10-31" },
        ctx,
      ),
    ).toEqual({ ok: true });
    expect((await getTenantDetail(app, t.slug))?.subscriptions[0]?.endDate).toBe("2028-10-31");
    expect(
      await changeSubscriptionEnd(
        app,
        { slug: t.slug, subscriptionId: id, endDate: "2020-01-01" },
        ctx,
      ),
    ).toEqual({ ok: false, code: "SUBSCRIPTION_INVALID_PERIOD" });
  });
});

describe.skipIf(!adminUrl || !appUrl)("admin access link", () => {
  it("a new access link clears the password, ends sessions and is a live activation link", async () => {
    const ctx = { actorUserId: await actor(), now };
    const t = await activeTenant(ctx.actorUserId);
    const link = await issueAdminAccessLink(app, {
      slug: t.slug,
      actorUserId: ctx.actorUserId,
      now,
    });
    expect(link?.username).toBe("mario.rossi");
    expect(await resolveSession(app, { realm: t.realm, token: t.session, now })).toBeNull();
    expect((await getTenantDetail(app, t.slug))?.admin?.status).toBe("pending");
    const peek = await peekCredentialLink(app, { realm: t.realm, token: link?.token ?? "", now });
    expect(peek.state).toBe("valid");
    const notice = await admin.query<{ template: string; recipient: string }>(
      "SELECT template, recipient FROM email_log WHERE tenant_id = $1 AND category = 'transactional'",
      [t.tenantId],
    );
    expect(notice.rows).toEqual([
      { template: "notice.admin_access_changed", recipient: "mario@rent.test" },
    ]);
  });
});
