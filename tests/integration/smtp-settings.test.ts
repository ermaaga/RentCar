import pg from "pg";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  getSmtpSummary,
  loadTenantSmtpTarget,
  recordSmtpTest,
  renderSmtpTestEmail,
  saveSmtpSettings,
} from "../../src/modules/notifications";
import { deriveKey } from "../../src/platform/crypto/keys";
import { createSmtpMailer } from "../../src/platform/mailer/smtp-mailer";

// NTF-01..03 (docs/06-backend-api.md): encrypted password bound to the tenant, stale check, audit with
// field names only, tenant isolation, and a real send through Mailpit on port 2525.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const smtpHost = process.env.TEST_SMTP_HOST;
const mailpitApi = process.env.TEST_MAILPIT_API;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const KEY = deriveKey("k".repeat(40), "smtp");
const SECRET = "smtp-secret-canary-4711";

const input = {
  host: "smtp.example.com",
  port: 587,
  security: "starttls" as const,
  username: "mailer",
  password: SECRET,
  fromAddress: "noreply@example.com",
  fromName: "Rent Roma",
  expectedUpdatedAt: "",
};

async function tenant(): Promise<string> {
  const id = randomUUID();
  await admin.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, 'Smtp')", [
    id,
    `ss-${id.slice(0, 8)}`,
  ]);
  return id;
}

function ctx(tenantId: string, now = new Date()) {
  return { tenantId, actorUserId: randomUUID(), actorRole: "admin", key: KEY, now };
}

describe.skipIf(!adminUrl || !appUrl)("tenant SMTP settings", () => {
  it("stores the password encrypted, summarises without it and decrypts for a send", async () => {
    const t = await tenant();
    expect(await saveSmtpSettings(app, { ...input, password: "" }, ctx(t))).toEqual({
      ok: false,
      code: "PASSWORD_REQUIRED",
    });
    expect(await saveSmtpSettings(app, input, ctx(t))).toEqual({ ok: true });
    const stored = await admin.query<{ password_enc: string }>(
      "SELECT password_enc FROM tenant_smtp_configs WHERE tenant_id = $1",
      [t],
    );
    expect(stored.rows[0]?.password_enc).not.toContain(SECRET);
    const summary = await getSmtpSummary(app, t);
    expect(summary).toMatchObject({ host: "smtp.example.com", passwordSet: true });
    expect(JSON.stringify(summary)).not.toContain("v1.");
    expect((await loadTenantSmtpTarget(app, t, [KEY]))?.password).toBe(SECRET);
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenant SMTP settings: updates", () => {
  it("keeps the password when blank, refuses stale writes and audits field names only", async () => {
    const t = await tenant();
    await saveSmtpSettings(app, input, ctx(t, new Date("2026-11-01T10:00:00Z")));
    const first = await getSmtpSummary(app, t);
    const stale = await saveSmtpSettings(app, { ...input, host: "other.example.com" }, ctx(t));
    expect(stale).toEqual({ ok: false, code: "STALE" });
    const update = {
      ...input,
      host: "smtp2.example.com",
      password: "",
      expectedUpdatedAt: first?.updatedAt.toISOString() ?? "",
    };
    expect(await saveSmtpSettings(app, update, ctx(t))).toEqual({ ok: true });
    expect((await loadTenantSmtpTarget(app, t, [KEY]))?.password).toBe(SECRET);
    const audit = await admin.query<{ changes: { fields: string[] } }>(
      "SELECT changes FROM audit_log WHERE tenant_id = $1 AND action = 'settings.smtp_updated' ORDER BY created_at",
      [t],
    );
    expect(audit.rows.map((r) => r.changes.fields)).toEqual([
      ["host", "port", "security", "username", "fromAddress", "fromName", "password"],
      ["host"],
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET);
  });
});

describe.skipIf(!adminUrl || !appUrl)("tenant SMTP settings: isolation and tests", () => {
  it("binds the ciphertext to its tenant and isolates tenants", async () => {
    const a = await tenant();
    const b = await tenant();
    await saveSmtpSettings(app, input, ctx(a));
    expect(await getSmtpSummary(app, b)).toBeNull();
    await admin.query(
      `INSERT INTO tenant_smtp_configs (tenant_id, host, port, security, username, password_enc, from_address)
       SELECT $2, host, port, security, username, password_enc, from_address FROM tenant_smtp_configs WHERE tenant_id = $1`,
      [a, b],
    );
    await expect(loadTenantSmtpTarget(app, b, [KEY])).rejects.toThrow();
  });

  it("records the last test outcome as a category", async () => {
    const t = await tenant();
    await saveSmtpSettings(app, input, ctx(t));
    await recordSmtpTest(app, {
      tenantId: t,
      result: { ok: false, category: "auth_failed" },
      now: new Date(),
    });
    expect(await getSmtpSummary(app, t)).toMatchObject({
      lastTestOk: false,
      lastTestError: "auth_failed",
    });
  });
});

describe.skipIf(!adminUrl || !appUrl || !smtpHost || !mailpitApi)("tenant mail via Mailpit", () => {
  it("delivers the test email through the tenant settings", async () => {
    const t = await tenant();
    await saveSmtpSettings(app, { ...input, host: smtpHost ?? "", port: 2525 }, ctx(t));
    const target = await loadTenantSmtpTarget(app, t, [KEY]);
    const to = `smtp-${t.slice(0, 8)}@rentcar.localhost`;
    const mailer = createSmtpMailer({
      port: 2525,
      security: "none",
      fromName: "",
      allowPrivate: true,
    });
    const sent = await mailer.sendTenant(
      target ?? input,
      renderSmtpTestEmail(to, getTranslator("en")),
    );
    expect(sent).toEqual({ ok: true });
    const res = await fetch(
      `${mailpitApi ?? ""}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    const { messages } = (await res.json()) as {
      messages: { Subject: string; From: { Address: string } }[];
    };
    expect(messages.map((m) => [m.Subject, m.From.Address])).toEqual([
      ["RentCar test email", "noreply@example.com"],
    ]);
  });
});
