"use server";

import { revalidatePath } from "next/cache";

import { tenantAction } from "@/app/_lib/define-action";
import { consume } from "@/app/_lib/security";
import { getContainer } from "@/composition/container";
import { getTranslator, type MessageKey } from "@/i18n";
import { smtpSettingsInput, testSmtpSettings, updateSmtpSettings } from "@/modules/notifications";
import type { SmtpFormState } from "@/modules/notifications/ui/form-state";
import type { SendFailure } from "@/platform/mailer/port";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

// NTF-01/02 entry points: admin of the tenant only, blocked while the tenant is read-only. Outcomes
// are message keys; SMTP failures are shown as categories only (SR-SSRF-05).

function failureKey(category: SendFailure): MessageKey {
  return `settings.email.failure.${category}`;
}

function deps() {
  const c = getContainer();
  return {
    pool: c.pool,
    mailer: c.mailer,
    fieldKeys: c.fieldKeys,
    allowPrivate: c.smtpAllowPrivate,
  };
}

function readForm(form: FormData): Record<string, unknown> {
  const value = (key: string) => {
    const raw = form.get(key);
    return typeof raw === "string" ? raw.slice(0, 1024) : "";
  };
  const fromName = value("fromName").trim();
  return {
    host: value("host"),
    port: value("port"),
    security: value("security"),
    username: value("username"),
    password: value("password") || undefined,
    fromAddress: value("fromAddress").trim(),
    ...(fromName ? { fromName } : {}),
  };
}

const ADMIN_WRITE = {
  minRole: "admin",
  writeClass: "write",
  onRefused: (messageKey: MessageKey): SmtpFormState => ({ status: "error", messageKey }),
} as const;

export const saveSmtpAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant, session }, _: SmtpFormState, form: FormData): Promise<SmtpFormState> => {
    const parsed = smtpSettingsInput.safeParse(readForm(form));
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join("."));
      return { status: "error", messageKey: "settings.email.invalid", fields };
    }
    const c = getContainer();
    const result = await updateSmtpSettings(deps(), parsed.data, {
      tenantId: tenant.tenantId,
      userId: session.userId,
      now: c.clock.now(),
    });
    revalidatePath(`/${tenant.slug}/admin/settings/email`);
    if (result.ok) {
      return { status: "done", messageKey: "settings.email.saved" };
    }
    if (result.code === "PASSWORD_REQUIRED") {
      return {
        status: "error",
        messageKey: "settings.email.passwordRequired",
        fields: ["password"],
      };
    }
    return { status: "error", messageKey: failureKey(result.category), fields: ["host"] };
  },
);

export const testSmtpAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant, session }): Promise<SmtpFormState> => {
    // RL-10: 5 test emails per tenant per hour.
    if (!(await consume(RATE_LIMITS.smtpTest, tenant.tenantId, "tenant"))) {
      return { status: "error", messageKey: "settings.email.testThrottled" };
    }
    const c = getContainer();
    const result = await testSmtpSettings(
      deps(),
      { tenantId: tenant.tenantId, userId: session.userId, now: c.clock.now() },
      getTranslator(),
    );
    revalidatePath(`/${tenant.slug}/admin/settings/email`);
    if (result.ok) {
      return { status: "done", messageKey: "settings.email.testSent" };
    }
    return {
      status: "error",
      messageKey:
        result.code === "SMTP_NOT_CONFIGURED"
          ? "settings.email.notConfigured"
          : failureKey(result.category),
    };
  },
);
