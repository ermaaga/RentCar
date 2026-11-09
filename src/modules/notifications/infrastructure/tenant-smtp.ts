import { randomUUID } from "node:crypto";
import type pg from "pg";

import { decryptField, encryptField } from "../../../platform/crypto/encryptor";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import type { SendResult, TenantSmtpTarget } from "../../../platform/mailer/port";
import type { SmtpSettingsInput } from "../application/smtp-settings-input";

// Tenant SMTP settings (docs/06-backend-api.md NTF-01..03). Tenant scope only. The password is stored
// as AES-256-GCM ciphertext bound to the tenant (AAD), decrypted only for one send, never returned.

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
  updatedAt: Date;
}

interface SmtpRow extends Omit<SmtpSummary, "passwordSet"> {
  passwordEnc: string;
}

const SELECT_ROW = `
  SELECT host, port, security, username, from_address AS "fromAddress", from_name AS "fromName",
         password_enc AS "passwordEnc", last_test_at AS "lastTestAt", last_test_ok AS "lastTestOk",
         last_test_error AS "lastTestError", updated_at AS "updatedAt"
    FROM tenant_smtp_configs WHERE tenant_id = $1`;

function aad(tenantId: string): string {
  return `rc:v1:smtp_password:${tenantId}`;
}

function toSummary(row: SmtpRow): SmtpSummary {
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    passwordSet: true,
    lastTestAt: row.lastTestAt,
    lastTestOk: row.lastTestOk,
    lastTestError: row.lastTestError,
    updatedAt: row.updatedAt,
  };
}

async function readRow(c: pg.ClientBase, tenantId: string): Promise<SmtpRow | undefined> {
  return (await c.query<SmtpRow>(SELECT_ROW, [tenantId])).rows[0];
}

export async function getSmtpSummary(pool: pg.Pool, tenantId: string): Promise<SmtpSummary | null> {
  const row = await withTenantTx(pool, tenantId, (c) => readRow(c, tenantId));
  return row ? toSummary(row) : null;
}

export interface SaveSmtpContext {
  tenantId: string;
  actorUserId: string;
  actorRole: string;
  key: Buffer;
  now: Date;
}

export type SaveSmtpResult = { ok: true } | { ok: false; code: "PASSWORD_REQUIRED" | "STALE" };

const FIELDS = ["host", "port", "security", "username", "fromAddress", "fromName"] as const;

function changedFields(before: SmtpRow | undefined, input: SmtpSettingsInput): string[] {
  const after = { ...input, fromName: input.fromName || null };
  const fields = FIELDS.filter((f) => before?.[f] !== after[f]).map(String);
  return input.password ? [...fields, "password"] : fields;
}

function isStale(before: SmtpRow | undefined, expected: string): boolean {
  if (!before) return expected !== "";
  return expected !== before.updatedAt.toISOString();
}

/** NTF-01: upsert with a stale check; the audit row lists field names only, never values. */
export async function saveSmtpSettings(
  pool: pg.Pool,
  input: SmtpSettingsInput,
  ctx: SaveSmtpContext,
): Promise<SaveSmtpResult> {
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const before = await readRow(c, ctx.tenantId);
    if (isStale(before, input.expectedUpdatedAt)) return { ok: false, code: "STALE" };
    if (!before && !input.password) return { ok: false, code: "PASSWORD_REQUIRED" };
    const passwordEnc = input.password
      ? encryptField(input.password, ctx.key, aad(ctx.tenantId))
      : (before?.passwordEnc ?? "");
    await upsert(c, input, passwordEnc, ctx);
    await auditSave(c, ctx, changedFields(before, input));
    return { ok: true };
  });
}

async function upsert(
  c: pg.ClientBase,
  input: SmtpSettingsInput,
  passwordEnc: string,
  ctx: SaveSmtpContext,
): Promise<void> {
  await c.query(
    `INSERT INTO tenant_smtp_configs (tenant_id, host, port, security, username, password_enc, from_address, from_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET host = $2, port = $3, security = $4, username = $5,
         password_enc = $6, from_address = $7, from_name = $8, updated_at = $9,
         last_test_at = NULL, last_test_ok = NULL, last_test_error = NULL`,
    [
      ctx.tenantId,
      input.host,
      input.port,
      input.security,
      input.username,
      passwordEnc,
      input.fromAddress,
      input.fromName || null,
      ctx.now,
    ],
  );
}

async function auditSave(c: pg.ClientBase, ctx: SaveSmtpContext, fields: string[]): Promise<void> {
  await c.query(
    `INSERT INTO audit_log (id, tenant_id, created_at, actor_type, actor_user_id, actor_role, action, entity_type, entity_id, changes)
       VALUES ($1, $2, $3, 'user', $4, $5, 'settings.smtp_updated', 'settings', $2, $6)`,
    [
      randomUUID(),
      ctx.tenantId,
      ctx.now,
      ctx.actorUserId,
      ctx.actorRole,
      JSON.stringify({ fields }),
    ],
  );
}

/** Decrypts the stored settings for one send. Null when the tenant has no SMTP. */
export async function loadTenantSmtpTarget(
  pool: pg.Pool,
  tenantId: string,
  keys: readonly Buffer[],
): Promise<TenantSmtpTarget | null> {
  const row = await withTenantTx(pool, tenantId, (c) => readRow(c, tenantId));
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    password: decryptField(row.passwordEnc, keys, aad(tenantId)),
    fromAddress: row.fromAddress,
    fromName: row.fromName,
  };
}

/** NTF-02: keeps the outcome category only (never provider text). */
export async function recordSmtpTest(
  pool: pg.Pool,
  input: { tenantId: string; result: SendResult; now: Date },
): Promise<void> {
  const error = input.result.ok ? null : input.result.category;
  await withTenantTx(pool, input.tenantId, (c) =>
    c.query(
      `UPDATE tenant_smtp_configs SET last_test_at = $2, last_test_ok = $3, last_test_error = $4
        WHERE tenant_id = $1`,
      [input.tenantId, input.now, input.result.ok, error],
    ),
  );
}
