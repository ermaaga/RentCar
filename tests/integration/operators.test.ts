import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import {
  createOperator,
  listOperators,
  operatorUsage,
  recordCredentialDelivery,
  reissueOperatorLink,
  setOperatorActive,
  updateOperator,
} from "../../src/modules/auth";

// Operators as the runtime role (docs/06-backend-api.md 4.2.5, AUT-12/14/15/16, US-013, US-072).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 8 });
const now = new Date();

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function tenant(maxOperators: number) {
  const tenantId = randomUUID();
  const adminId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Ops')", [
    tenantId,
    `op-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO subscriptions (id, tenant_id, max_vehicles, max_operators, start_date, end_date,
                                price_minor, price_currency)
     VALUES ($1, $2, 5, $3, current_date - 10, current_date + 300, 1000, 'EUR')`,
    [randomUUID(), tenantId, maxOperators],
  );
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, $2, 'admin', 'boss', 'Boss', 'boss@example.test')`,
    [adminId, tenantId],
  );
  return { tenantId, adminId, ctx: { tenantId, actorUserId: adminId, now } };
}

const sara = (n = "") => ({
  displayName: `Sara ${n}`,
  username: `sara${n}`,
  email: `sara${n}@example.test`,
});

describe.skipIf(!adminUrl || !appUrl)("createOperator (AUT-12, US-013)", () => {
  it("creates a pending operator with an activation link and a credential email row", async () => {
    const t = await tenant(2);
    const created = await createOperator(app, sara(), t.ctx);
    if (!created.ok) throw new Error(created.code);
    expect(created.link.token.length).toBeGreaterThan(20);
    const mail = await admin.query<{ category: string; max_attempts: number; recipient: null }>(
      "SELECT category, max_attempts, recipient FROM email_log WHERE id = $1",
      [created.link.emailLogId],
    );
    expect(mail.rows[0]).toEqual({ category: "credential", max_attempts: 1, recipient: null });
    expect((await listOperators(app, t.tenantId, now))[0]?.status).toBe("pending");
  });

  it("refuses a taken username", async () => {
    const t = await tenant(3);
    await createOperator(app, sara(), t.ctx);
    expect(await createOperator(app, { ...sara(), email: "x@example.test" }, t.ctx)).toEqual({
      ok: false,
      code: "USERNAME_TAKEN",
    });
  });

  it("gives exactly one success to two parallel creates at limit - 1", async () => {
    const t = await tenant(1);
    const results = await Promise.all([
      createOperator(app, sara("1"), t.ctx),
      createOperator(app, sara("2"), t.ctx),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "PLAN_LIMIT_REACHED" }]);
    expect(await operatorUsage(app, t.tenantId, now)).toEqual({ used: 1, max: 1 });
  });
});

describe.skipIf(!adminUrl || !appUrl)("setOperatorActive (AUT-14, US-072)", () => {
  it("deactivation ends sessions and frees the seat; reactivation needs a seat", async () => {
    const t = await tenant(1);
    const first = await createOperator(app, sara("1"), t.ctx);
    if (!first.ok) throw new Error(first.code);
    const id = first.link.operatorId;
    await admin.query(
      `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, 'tenant', $3, $4, now() + interval '1 hour', now() + interval '1 hour')`,
      [randomUUID(), t.tenantId, id, Buffer.alloc(32, randomUUID().charCodeAt(0))],
    );
    const off = await setOperatorActive(app, { id, active: false }, t.ctx);
    expect(off).toEqual({ ok: true, changed: true, sessionsRevoked: 1 });
    expect((await createOperator(app, sara("2"), t.ctx)).ok).toBe(true);
    expect(await setOperatorActive(app, { id, active: true }, t.ctx)).toEqual({
      ok: false,
      code: "PLAN_LIMIT_REACHED",
    });
    expect(await setOperatorActive(app, { id: t.adminId, active: false }, t.ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});

describe.skipIf(!adminUrl || !appUrl)("operator links and isolation (AUT-15/16)", () => {
  it("re-issues a link only while pending and shows a failed email as not delivered", async () => {
    const t = await tenant(2);
    const created = await createOperator(app, sara(), t.ctx);
    if (!created.ok) throw new Error(created.code);
    await recordCredentialDelivery(app, {
      tenantId: t.tenantId,
      emailLogId: created.link.emailLogId,
      ok: false,
      category: "no_smtp",
      now,
    });
    expect((await listOperators(app, t.tenantId, now))[0]?.status).toBe("activation_not_delivered");
    const later = new Date(now.getTime() + 1000);
    const again = await reissueOperatorLink(
      app,
      { id: created.link.operatorId },
      { ...t.ctx, now: later },
    );
    expect(again.ok && again.link.token !== created.link.token).toBe(true);
    expect((await listOperators(app, t.tenantId, later))[0]?.status).toBe("pending");
    await admin.query("UPDATE users SET status = 'active', password_hash = 'x' WHERE id = $1", [
      created.link.operatorId,
    ]);
    expect(await reissueOperatorLink(app, { id: created.link.operatorId }, t.ctx)).toEqual({
      ok: false,
      code: "NOT_PENDING",
    });
  });
});

describe.skipIf(!adminUrl || !appUrl)("operator isolation", () => {
  it("never lists or changes another tenant's operators", async () => {
    const a = await tenant(2);
    const b = await tenant(2);
    const created = await createOperator(app, sara(), a.ctx);
    if (!created.ok) throw new Error(created.code);
    expect(await listOperators(app, b.tenantId, now)).toEqual([]);
    const id = created.link.operatorId;
    expect(await setOperatorActive(app, { id, active: false }, b.ctx)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await reissueOperatorLink(app, { id }, b.ctx)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe.skipIf(!adminUrl || !appUrl)("updateOperator (AUT-13, SR-AUT-10)", () => {
  it("tells the previous address about an email change, through the tenant channel", async () => {
    const t = await tenant(2);
    const created = await createOperator(app, sara(), t.ctx);
    if (!created.ok) throw new Error(created.code);
    const id = created.link.operatorId;
    const edit = { id, displayName: "Sara B.", email: "sara.new@example.test" };
    expect(await updateOperator(app, edit, t.ctx)).toEqual({ ok: true, emailChanged: true });
    expect(await updateOperator(app, { ...edit, displayName: "Sara" }, t.ctx)).toEqual({
      ok: true,
      emailChanged: false,
    });
    const notices = await admin.query<{ template: string; channel: string; recipient: string }>(
      `SELECT template, channel, recipient FROM email_log
        WHERE tenant_id = $1 AND category = 'transactional'`,
      [t.tenantId],
    );
    expect(notices.rows).toEqual([
      { template: "notice.email_changed", channel: "tenant_smtp", recipient: "sara@example.test" },
    ]);
    expect((await listOperators(app, t.tenantId, now))[0]).toMatchObject({
      displayName: "Sara",
      email: "sara.new@example.test",
    });
  });

  it("never edits an admin or another tenant's operator", async () => {
    const a = await tenant(2);
    const b = await tenant(2);
    const created = await createOperator(app, sara(), a.ctx);
    if (!created.ok) throw new Error(created.code);
    const edit = { displayName: "X", email: "x@example.test" };
    const notFound = { ok: false, code: "NOT_FOUND" };
    expect(await updateOperator(app, { id: a.adminId, ...edit }, a.ctx)).toEqual(notFound);
    expect(await updateOperator(app, { id: created.link.operatorId, ...edit }, b.ctx)).toEqual(
      notFound,
    );
  });
});
