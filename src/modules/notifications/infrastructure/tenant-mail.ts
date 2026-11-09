import type pg from "pg";

import type { Mailer, MailMessage, SendResult } from "../../../platform/mailer/port";
import { loadTenantSmtp } from "./tenant-smtp";

// Sends one message through the tenant's own SMTP (docs/06-backend-api.md 9.1). No settings gives
// `no_smtp`; a stored password that cannot be decrypted gives `unknown` (never the error text).
export async function sendTenantMail(
  deps: { pool: pg.Pool; mailer: Mailer; fieldKeys: readonly Buffer[] },
  tenantId: string,
  message: MailMessage,
): Promise<SendResult> {
  let settings;
  try {
    settings = await loadTenantSmtp(deps.pool, tenantId, deps.fieldKeys);
  } catch {
    return { ok: false, category: "unknown" };
  }
  if (!settings) {
    return { ok: false, category: "no_smtp" };
  }
  return deps.mailer.sendTenant(settings, message);
}
