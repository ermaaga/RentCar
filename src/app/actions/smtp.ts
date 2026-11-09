"use server";

import { revalidatePath } from "next/cache";

import { requireTenantAdmin } from "@/app/_lib/session";
import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { getAccountContact, tenantRealm } from "@/modules/auth";
import {
  loadTenantSmtpTarget,
  recordSmtpTest,
  renderSmtpTestEmail,
  saveSmtpSettings,
  smtpSettingsInput,
} from "@/modules/notifications";
import type { SmtpActionState } from "@/modules/notifications/ui/form-state";
import { hitRateLimit, RATE_LIMITS } from "@/platform/rate-limit/postgres";

// NTF-01 and NTF-02 (docs/06-backend-api.md): tenant admin only. The SSRF guard runs on save (DNS
// outside the transaction) and again on every send.

const INPUT_FIELDS = [
  "host",
  "port",
  "security",
  "username",
  "password",
  "fromAddress",
  "fromName",
  "expectedUpdatedAt",
] as const;

function formToInput(form: FormData): Record<string, string> {
  const input: Record<string, string> = {};
  for (const name of INPUT_FIELDS) {
    const raw = form.get(name);
    input[name] = typeof raw === "string" ? raw.slice(0, 512) : "";
  }
  return input;
}

export async function saveSmtpSettingsAction(
  slug: string,
  _: SmtpActionState,
  form: FormData,
): Promise<SmtpActionState> {
  const { tenant, session } = await requireTenantAdmin(slug);
  const parsed = smtpSettingsInput.safeParse(formToInput(form));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    return { status: "error", messageKey: "smtpSettings.formInvalid", fields };
  }
  const c = getContainer();
  const guard = await c.mailer.checkTenantHost(parsed.data.host, parsed.data.port);
  if (!guard.ok) {
    return { status: "error", messageKey: "smtpSettings.hostRefused", fields: ["host"] };
  }
  const result = await saveSmtpSettings(c.pool, parsed.data, {
    tenantId: tenant.tenantId,
    actorUserId: session.userId,
    actorRole: session.role,
    key: c.smtpKey,
    now: c.clock.now(),
  });
  revalidatePath(`/${tenant.slug}/admin/settings/email`);
  if (!result.ok) {
    return result.code === "STALE"
      ? { status: "error", messageKey: "smtpSettings.stale" }
      : { status: "error", messageKey: "smtpSettings.passwordRequired", fields: ["password"] };
  }
  return { status: "done", messageKey: "smtpSettings.saved" };
}

export async function testSmtpAction(slug: string): Promise<SmtpActionState> {
  const { tenant, session } = await requireTenantAdmin(slug);
  const c = getContainer();
  const now = c.clock.now();
  const limit = await hitRateLimit(c.pool, {
    hmacKey: c.hmacKey,
    rule: RATE_LIMITS.smtpTest,
    identity: tenant.tenantId,
    now,
  });
  if (!limit.allowed) {
    return { status: "error", messageKey: "smtpSettings.testThrottled" };
  }
  const target = await loadTenantSmtpTarget(c.pool, tenant.tenantId, c.smtpKeys);
  const me = await getAccountContact(c.pool, {
    realm: tenantRealm(tenant.tenantId),
    userId: session.userId,
  });
  if (!target || !me) {
    return { status: "error", messageKey: "smtpSettings.notConfigured" };
  }
  const result = await c.mailer.sendTenant(target, renderSmtpTestEmail(me.email, getTranslator()));
  await recordSmtpTest(c.pool, { tenantId: tenant.tenantId, result, now });
  revalidatePath(`/${tenant.slug}/admin/settings/email`);
  return result.ok
    ? { status: "done", messageKey: "smtpSettings.testSent" }
    : { status: "error", messageKey: "smtpSettings.testFailed", category: result.category };
}
