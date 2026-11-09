import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  dispatchDue,
  enqueueNotice,
  failStaleCredentialRows,
} from "../../src/modules/notifications";
import type { Mailer, MailMessage, SendResult } from "../../src/platform/mailer/port";
import { withTenantTx } from "../../src/platform/db/tenant-tx";

// Outbox as the runtime role (docs/06-backend-api.md 9.3, 05-database 5.15).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const MIN = 60_000;

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

function mailer(result: SendResult) {
  const sent: MailMessage[] = [];
  const m: Mailer = {
    sendSystem: (message) => {
      sent.push(message);
      return Promise.resolve(result);
    },
    sendTenant: (_s, message) => {
      sent.push(message);
      return Promise.resolve(result);
    },
  };
  return {
    sent,
    deps: { pool: app, mailer: m, fieldKeys: [Buffer.alloc(32, 1)], t: getTranslator() },
  };
}

async function tenantUser(role: "admin" | "operator" = "admin") {
  const tenantId = randomUUID();
  const userId = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Out')", [
    tenantId,
    `ox-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, $2, $3, 'person', 'Anna <b>', 'anna@example.test')`,
    [userId, tenantId, role],
  );
  return { tenantId, userId, scope: { kind: "tenant" as const, tenantId } };
}

async function enqueue(t: Awaited<ReturnType<typeof tenantUser>>, now: Date): Promise<string> {
  return withTenantTx(app, t.tenantId, (c) =>
    enqueueNotice(c, {
      tenantId: t.tenantId,
      channel: "system_smtp",
      template: "notice.password_changed",
      userId: t.userId,
      recipient: "anna@example.test",
      now,
    }),
  );
}

async function row(id: string) {
  const res = await admin.query<{ status: string; attempts: number; last_error: string | null }>(
    "SELECT status, attempts, last_error FROM email_log WHERE id = $1",
    [id],
  );
  return res.rows[0];
}

describe.skipIf(!adminUrl || !appUrl)("outbox dispatch", () => {
  it("renders from the account at send time, escapes the name and marks the row sent", async () => {
    const t = await tenantUser();
    const now = new Date();
    const id = await enqueue(t, now);
    const m = mailer({ ok: true });
    expect(await dispatchDue(m.deps, t.scope, now)).toEqual({ sent: 1, failed: 0, abandoned: 0 });
    expect(m.sent[0]?.to).toBe("anna@example.test");
    expect(m.sent[0]?.html).toContain("Anna &lt;b&gt;");
    expect(m.sent[0]?.text).not.toContain("http");
    expect(await row(id)).toMatchObject({ status: "sent", attempts: 1, last_error: null });
    expect(await dispatchDue(m.deps, t.scope, now)).toEqual({ sent: 0, failed: 0, abandoned: 0 });
  });

  it("backs off after a failure and abandons after the fifth attempt", async () => {
    const t = await tenantUser();
    let now = new Date();
    const id = await enqueue(t, now);
    const m = mailer({ ok: false, category: "connect_timeout" });
    await dispatchDue(m.deps, t.scope, now);
    expect(await row(id)).toMatchObject({
      status: "failed",
      attempts: 1,
      last_error: "connect_timeout",
    });
    expect((await dispatchDue(m.deps, t.scope, new Date(now.getTime() + 4 * MIN))).failed).toBe(0);
    for (const wait of [5, 30, 120, 360]) {
      now = new Date(now.getTime() + wait * MIN + 1000);
      await dispatchDue(m.deps, t.scope, now);
    }
    expect(await row(id)).toMatchObject({ status: "abandoned", attempts: 5 });
    expect(m.sent).toHaveLength(5);
  });
});

describe.skipIf(!adminUrl || !appUrl)("outbox scope and credential rows", () => {
  it("never dispatches another tenant's rows", async () => {
    const a = await tenantUser();
    const b = await tenantUser();
    const id = await enqueue(a, new Date());
    const m = mailer({ ok: true });
    await dispatchDue(m.deps, b.scope, new Date());
    expect(m.sent).toHaveLength(0);
    expect((await row(id))?.status).toBe("pending");
  });

  it("fails credential rows still pending after 15 minutes, without retry", async () => {
    const t = await tenantUser("operator");
    const id = randomUUID();
    await admin.query(
      `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id,
                              max_attempts, created_at)
       VALUES ($1, $2, 'tenant_smtp', 'credential', 'credential.activation', 'user', $3, 1,
               now() - interval '20 minutes')`,
      [id, t.tenantId, t.userId],
    );
    expect(await failStaleCredentialRows(app, t.scope, new Date())).toBe(1);
    expect(await row(id)).toMatchObject({ status: "failed", last_error: "not_delivered" });
    const m = mailer({ ok: true });
    await dispatchDue(m.deps, t.scope, new Date(Date.now() + 48 * 60 * MIN));
    expect(m.sent).toHaveLength(0);
  });
});
