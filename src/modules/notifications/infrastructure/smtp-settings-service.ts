import type pg from "pg";

import type { MessageKey } from "../../../i18n";
import type { Mailer, SendFailure } from "../../../platform/mailer/port";
import { guardedSmtpTarget, type HostResolver } from "../../../platform/mailer/smtp-target";
import { renderSmtpTestEmail } from "../application/credential-email";
import type { SmtpSettingsInput } from "../application/smtp-input";
import {
  actingUserEmail,
  loadTenantSmtp,
  recordSmtpTest,
  saveSmtpSettings,
  type SmtpSummary,
} from "./tenant-smtp";

// NTF-01/02 use cases: SSRF guard on save (DNS outside the transaction) and on the test send, the test
// recipient fixed to the acting user, outcomes as categories only (SR-SSRF-01..06).

export interface SmtpDeps {
  pool: pg.Pool;
  mailer: Mailer;
  fieldKeys: readonly Buffer[];
  /** Local Mailpit override (APP_ENV=local only): skips the DNS guard. */
  allowPrivate: boolean;
  resolve?: HostResolver;
}

export interface SmtpActor {
  tenantId: string;
  userId: string;
  now: Date;
}

export type SaveSmtpResult =
  | { ok: true; summary: SmtpSummary }
  | { ok: false; code: "SMTP_HOST_REFUSED"; category: SendFailure }
  | { ok: false; code: "PASSWORD_REQUIRED" };

export async function updateSmtpSettings(
  deps: SmtpDeps,
  input: SmtpSettingsInput,
  actor: SmtpActor,
): Promise<SaveSmtpResult> {
  if (!deps.allowPrivate) {
    const target = await guardedSmtpTarget(input.host, input.port, deps.resolve);
    if (!target.ok) {
      return { ok: false, code: "SMTP_HOST_REFUSED", category: target.category };
    }
  }
  const key = deps.fieldKeys[0];
  if (!key) {
    throw new Error("no field encryption key configured");
  }
  return saveSmtpSettings(deps.pool, input, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    key,
    now: actor.now,
  });
}

export type TestSmtpResult =
  | { ok: true }
  | { ok: false; code: "SMTP_NOT_CONFIGURED" }
  | { ok: false; code: "SMTP_TEST_FAILED"; category: SendFailure };

export async function testSmtpSettings(
  deps: SmtpDeps,
  actor: SmtpActor,
  t: (key: MessageKey) => string,
): Promise<TestSmtpResult> {
  const settings = await loadTenantSmtp(deps.pool, actor.tenantId, deps.fieldKeys);
  const to = await actingUserEmail(deps.pool, actor.tenantId, actor.userId);
  if (!settings || !to) {
    return { ok: false, code: "SMTP_NOT_CONFIGURED" };
  }
  const sent = await deps.mailer.sendTenant(settings, renderSmtpTestEmail(to, t));
  await recordSmtpTest(deps.pool, {
    tenantId: actor.tenantId,
    ok: sent.ok,
    ...(sent.ok ? {} : { category: sent.category }),
    now: actor.now,
  });
  return sent.ok ? { ok: true } : { ok: false, code: "SMTP_TEST_FAILED", category: sent.category };
}
