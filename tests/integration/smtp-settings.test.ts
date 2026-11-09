import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  getSmtpSummary,
  testSmtpSettings,
  updateSmtpSettings,
} from "../../src/modules/notifications";
import type { SmtpDeps } from "../../src/modules/notifications/infrastructure/smtp-settings-service";
import type { Mailer, MailMessage, TenantSmtpSettings } from "../../src/platform/mailer/port";
import { createSmtpMailer } from "../../src/platform/mailer/smtp-mailer";

// NTF-01/02 as the runtime role (docs/06-backend-api.md, SR-SSRF-01..06, SR-CRY-01).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const KEY = Buffer.alloc(32, 9);
const SECRET = "CANARY_SMTP_PASSWORD_7c1";

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function tenantWithAdmin(): Promise<{ tenantId: string; userId: string; email: string }> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const email = `admin-${userId.slice(0, 8)}@rentcar.localhost`;
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Smtp')", [
    tenantId,
    `st-${tenantId.slice(0, 8)}`,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, $2, 'admin', $3, 'Admin', $4)`,
    [userId, tenantId, `st-${userId.slice(0, 8)}`, email],
  );
  return { tenantId, userId, email };
}

function recordingMailer(): Mailer & {
  sent: { settings: TenantSmtpSettings; message: MailMessage }[];
} {
  const sent: { settings: TenantSmtpSettings; message: MailMessage }[] = [];
  return {
    sent,
    sendSystem: () => Promise.resolve({ ok: true }),
    sendTenant: (settings, message) => {
      sent.push({ settings, message });
      return Promise.resolve({ ok: false, category: "auth_failed" });
    },
  };
}

function deps(mailer: Mailer, addresses: string[] = ["8.8.8.8"]): SmtpDeps {
  return {
    pool: app,
    mailer,
    fieldKeys: [KEY],
    allowPrivate: false,
    resolve: () => Promise.resolve(addresses),
  };
}

const input = {
  host: "smtp.example.com",
  port: 587 as const,
  security: "starttls" as const,
  username: "mailer@example.com",
  password: SECRET,
  fromAddress: "noreply@example.com",
};

describe.skipIf(!adminUrl || !appUrl)("saveSmtpSettings (NTF-01)", () => {
  it("stores only ciphertext and audits field names, never values", async () => {
    const t = await tenantWithAdmin();
    const actor = { tenantId: t.tenantId, userId: t.userId, now: new Date() };
    const saved = await updateSmtpSettings(deps(recordingMailer()), input, actor);
    expect(saved.ok).toBe(true);
    const row = await admin.query<{ password_enc: string }>(
      "SELECT password_enc FROM tenant_smtp_configs WHERE tenant_id = $1",
      [t.tenantId],
    );
    expect(row.rows[0]?.password_enc).toMatch(/^v1\./);
    const audit = await admin.query<{ changes: unknown }>(
      "SELECT changes FROM audit_log WHERE tenant_id = $1 AND action = 'settings.smtp_updated'",
      [t.tenantId],
    );
    const text = JSON.stringify(audit.rows);
    expect(text).toContain("password");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("mailer@example.com");
    const summary = await getSmtpSummary(app, t.tenantId);
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });

  it("refuses a host that resolves to a private address and stores nothing", async () => {
    const t = await tenantWithAdmin();
    const actor = { tenantId: t.tenantId, userId: t.userId, now: new Date() };
    const result = await updateSmtpSettings(deps(recordingMailer(), ["10.0.0.5"]), input, actor);
    expect(result).toEqual({ ok: false, code: "SMTP_HOST_REFUSED", category: "blocked_address" });
    expect(await getSmtpSummary(app, t.tenantId)).toBeNull();
  });
});

describe.skipIf(!adminUrl || !appUrl)("saveSmtpSettings password and isolation", () => {
  it("requires a password the first time and keeps it when left blank later", async () => {
    const t = await tenantWithAdmin();
    const actor = { tenantId: t.tenantId, userId: t.userId, now: new Date() };
    const blank = { ...input, password: undefined };
    expect(await updateSmtpSettings(deps(recordingMailer()), blank, actor)).toEqual({
      ok: false,
      code: "PASSWORD_REQUIRED",
    });
    await updateSmtpSettings(deps(recordingMailer()), input, actor);
    await updateSmtpSettings(
      deps(recordingMailer()),
      { ...blank, host: "mail.example.com" },
      actor,
    );
    const mailer = recordingMailer();
    await testSmtpSettings(deps(mailer), actor, getTranslator());
    expect(mailer.sent[0]?.settings).toMatchObject({ host: "mail.example.com", password: SECRET });
  });

  it("keeps one tenant's settings invisible to another", async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    await updateSmtpSettings(deps(recordingMailer()), input, {
      tenantId: a.tenantId,
      userId: a.userId,
      now: new Date(),
    });
    expect(await getSmtpSummary(app, b.tenantId)).toBeNull();
  });
});

describe.skipIf(!adminUrl || !appUrl)("testSmtpSettings (NTF-02)", () => {
  it("answers not configured before any save", async () => {
    const t = await tenantWithAdmin();
    const result = await testSmtpSettings(
      deps(recordingMailer()),
      { tenantId: t.tenantId, userId: t.userId, now: new Date() },
      getTranslator(),
    );
    expect(result).toEqual({ ok: false, code: "SMTP_NOT_CONFIGURED" });
  });

  it("sends only to the acting user and records the failure category", async () => {
    const t = await tenantWithAdmin();
    const actor = { tenantId: t.tenantId, userId: t.userId, now: new Date() };
    await updateSmtpSettings(deps(recordingMailer()), input, actor);
    const mailer = recordingMailer();
    const result = await testSmtpSettings(deps(mailer), actor, getTranslator());
    expect(result).toEqual({ ok: false, code: "SMTP_TEST_FAILED", category: "auth_failed" });
    expect(mailer.sent.map((s) => s.message.to)).toEqual([t.email]);
    const summary = await getSmtpSummary(app, t.tenantId);
    expect(summary).toMatchObject({ lastTestOk: false, lastTestError: "auth_failed" });
  });
});

const smtpHost = process.env.TEST_SMTP_HOST;
const mailpitApi = process.env.TEST_MAILPIT_API;

describe.skipIf(!smtpHost || !mailpitApi)("tenant mailer via Mailpit (local override)", () => {
  it("delivers through the tenant settings", async () => {
    const to = `tenant-${randomUUID().slice(0, 8)}@rentcar.localhost`;
    const mailer = createSmtpMailer({
      port: 1025,
      security: "none",
      fromName: "RentCar",
      allowPrivate: true,
    });
    const result = await mailer.sendTenant(
      { ...input, host: smtpHost ?? "", port: 1025, fromName: "Rent Roma" },
      { to, subject: "Tenant hello", text: "hello", html: "<p>hello</p>" },
    );
    expect(result).toEqual({ ok: true });
    const res = await fetch(
      `${mailpitApi ?? ""}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    const body = (await res.json()) as { messages: { Subject: string }[] };
    expect(body.messages.map((m) => m.Subject)).toEqual(["Tenant hello"]);
  });
});
