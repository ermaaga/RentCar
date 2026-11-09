import { randomUUID } from "node:crypto";
import type pg from "pg";

import { decryptField, encryptField } from "../../../platform/crypto/encryptor";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import type { TenantSmtpSettings } from "../../../platform/mailer/port";
import type { SmtpSettingsInput } from "../application/smtp-input";

// Tenant SMTP settings (docs/06-backend-api.md NTF-01/02, 05-database 5.3). The password is stored only
// as AES-256-GCM ciphertext bound to the tenant (AAD), decrypted only to send, never returned.

const aad = (tenantId: string) => `rc:v1:smtp_password:${tenantId}`;

export interface SmtpSummary {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  fromAddress: string;
  fromName: string | null;
  passwordSet: true;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

interface SmtpRow {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  password_enc: string;
  from_address: string;
  from_name: string | null;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
}

async function readRow(c: pg.ClientBase, tenantId: string): Promise<SmtpRow | undefined> {
  const res = await c.query<SmtpRow>(
    `SELECT host, port, security, username, password_enc, from_address, from_name,
            last_test_at, last_test_ok, last_test_error
       FROM tenant_smtp_configs WHERE tenant_id = $1`,
    [tenantId],
  );
  return res.rows[0];
}

function summary(row: SmtpRow): SmtpSummary {
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    fromAddress: row.from_address,
    fromName: row.from_name,
    passwordSet: true,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok,
    lastTestError: row.last_test_error,
  };
}

export async function getSmtpSummary(pool: pg.Pool, tenantId: string): Promise<SmtpSummary | null> {
  const row = await withTenantTx(pool, tenantId, (c) => readRow(c, tenantId));
  return row ? summary(row) : null;
}

/** Decrypted settings for a send, or null when the tenant has none. A bad ciphertext throws. */
export async function loadTenantSmtp(
  pool: pg.Pool,
  tenantId: string,
  keys: readonly Buffer[],
): Promise<TenantSmtpSettings | null> {
  const row = await withTenantTx(pool, tenantId, (c) => readRow(c, tenantId));
  if (!row) {
    return null;
  }
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    password: decryptField(row.password_enc, keys, aad(tenantId)),
    fromAddress: row.from_address,
    fromName: row.from_name,
  };
}

const AUDITED: readonly (keyof SmtpSettingsInput)[] = [
  "host",
  "port",
  "security",
  "username",
  "password",
  "fromAddress",
  "fromName",
];

function changedFields(before: SmtpRow | undefined, input: SmtpSettingsInput): string[] {
  if (!before) {
    return [...AUDITED];
  }
  const previous: Record<string, unknown> = {
    host: before.host,
    port: before.port,
    security: before.security,
    username: before.username,
    fromAddress: before.from_address,
    fromName: before.from_name ?? undefined,
  };
  return AUDITED.filter((field) =>
    field === "password" ? Boolean(input.password) : previous[field] !== input[field],
  );
}

export interface SaveContext {
  tenantId: string;
  actorUserId: string;
  key: Buffer;
  now: Date;
}

async function upsert(
  c: pg.ClientBase,
  input: SmtpSettingsInput,
  passwordEnc: string,
  ctx: SaveContext,
): Promise<void> {
  await c.query(
    `INSERT INTO tenant_smtp_configs
       (tenant_id, host, port, security, username, password_enc, from_address, from_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id) DO UPDATE SET
       host = EXCLUDED.host, port = EXCLUDED.port, security = EXCLUDED.security,
       username = EXCLUDED.username, password_enc = EXCLUDED.password_enc,
       from_address = EXCLUDED.from_address, from_name = EXCLUDED.from_name,
       updated_at = EXCLUDED.updated_at,
       last_test_at = NULL, last_test_ok = NULL, last_test_error = NULL`,
    [
      ctx.tenantId,
      input.host,
      input.port,
      input.security,
      input.username,
      passwordEnc,
      input.fromAddress,
      input.fromName ?? null,
      ctx.now,
    ],
  );
}

/** `settings.smtp_updated` with field names only, never values (06-backend-api 11.1). */
async function auditUpdate(c: pg.ClientBase, fields: string[], ctx: SaveContext): Promise<void> {
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, actor_user_id, actor_role, action,
                            entity_type, entity_id, changes)
     VALUES ($1, $2, $3, 'user', $4, 'admin', 'settings.smtp_updated', 'tenant', $2, $5)`,
    [randomUUID(), ctx.tenantId, ctx.now, ctx.actorUserId, JSON.stringify({ fields })],
  );
}

/** NTF-01 upsert (the caller has already run the SSRF guard outside this transaction). */
export async function saveSmtpSettings(
  pool: pg.Pool,
  input: SmtpSettingsInput,
  ctx: SaveContext,
): Promise<{ ok: true; summary: SmtpSummary } | { ok: false; code: "PASSWORD_REQUIRED" }> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const before = await readRow(c, ctx.tenantId);
    const password = input.password ?? "";
    const passwordEnc =
      password.length > 0
        ? encryptField(password, ctx.key, aad(ctx.tenantId))
        : before?.password_enc;
    if (!passwordEnc) {
      return { ok: false, code: "PASSWORD_REQUIRED" };
    }
    await upsert(c, input, passwordEnc, ctx);
    await auditUpdate(c, changedFields(before, input), ctx);
    const saved = await readRow(c, ctx.tenantId);
    if (!saved) {
      throw new Error("smtp settings vanished after upsert");
    }
    return { ok: true, summary: summary(saved) };
  });
}

/** Stores the outcome of a test send (category only, SR-SSRF-05). */
export async function recordSmtpTest(
  pool: pg.Pool,
  input: { tenantId: string; ok: boolean; category?: string; now: Date },
): Promise<void> {
  await withTenantTx(pool, input.tenantId, (c) =>
    c.query(
      `UPDATE tenant_smtp_configs SET last_test_at = $2, last_test_ok = $3, last_test_error = $4
        WHERE tenant_id = $1`,
      [input.tenantId, input.now, input.ok, input.ok ? null : (input.category ?? "unknown")],
    ),
  );
}

/** The acting user's own address: the only allowed recipient of a test email (SR-SSRF-06). */
export async function actingUserEmail(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const res = await withTenantTx(pool, tenantId, (c) =>
    c.query<{ email: string }>("SELECT email FROM users WHERE tenant_id = $1 AND id = $2", [
      tenantId,
      userId,
    ]),
  );
  return res.rows[0]?.email ?? null;
}
