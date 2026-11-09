"use server";

import { requireSystemSession } from "@/app/_lib/session";
import { getContainer } from "@/composition/container";
import { getTranslator, type MessageKey } from "@/i18n";
import { credentialPath } from "@/modules/auth";
import { renderCredentialEmail } from "@/modules/notifications";
import { createTenantInput, provisionTenant } from "@/modules/tenancy";
import type { CreateTenantState } from "@/modules/tenancy/ui/form-state";

// TEN-03 entry point: parse the console form, provision in one system transaction, then await the
// activation email through the system SMTP (BE-D6). The token exists only in memory here.

const NUMBER_FIELDS = new Set([
  "subscription.maxVehicles",
  "subscription.maxOperators",
  "subscription.priceMinor",
]);

const PROVISION_ERRORS: Record<string, { key: MessageKey; field: string }> = {
  SLUG_TAKEN: { key: "system.newTenant.slugTaken", field: "slug" },
  SLUG_RESERVED: { key: "system.newTenant.slugReserved", field: "slug" },
  SLUG_INVALID: { key: "system.newTenant.slugInvalid", field: "slug" },
  SUBSCRIPTION_INVALID_PERIOD: { key: "system.newTenant.period", field: "subscription.endDate" },
};

/** Builds the nested input from dotted form names (`admin.email` -> { admin: { email } }). */
function formToInput(form: FormData): Record<string, unknown> {
  const input: Record<string, unknown> = { dpaSigned: form.get("dpaSigned") === "on" };
  for (const [name, raw] of form.entries()) {
    if (typeof raw !== "string" || name === "dpaSigned" || name.startsWith("$")) continue;
    const value = NUMBER_FIELDS.has(name) ? Number(raw) : raw.slice(0, 512);
    const [head = "", tail] = name.split(".");
    if (tail === undefined) {
      input[head] = value;
    } else {
      const group = (input[head] ?? {}) as Record<string, unknown>;
      group[tail] = value;
      input[head] = group;
    }
  }
  if (input.shortDescription === "") delete input.shortDescription;
  return input;
}

export async function createTenantAction(
  _: CreateTenantState,
  form: FormData,
): Promise<CreateTenantState> {
  const session = await requireSystemSession();
  const parsed = createTenantInput.safeParse(formToInput(form));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    return { status: "error", messageKey: "system.newTenant.formInvalid", fields };
  }
  const c = getContainer();
  const result = await provisionTenant(c.pool, parsed.data, {
    actorUserId: session.userId,
    now: c.clock.now(),
  });
  if (!result.ok) {
    const e = PROVISION_ERRORS[result.code] ?? PROVISION_ERRORS.SLUG_INVALID;
    return {
      status: "error",
      messageKey: e?.key ?? "system.newTenant.formInvalid",
      fields: [e?.field ?? ""],
    };
  }
  const mail = renderCredentialEmail(
    {
      purpose: "activation",
      to: parsed.data.admin.email,
      displayName: parsed.data.admin.displayName,
      username: parsed.data.admin.username,
      link: `${c.baseUrl}${credentialPath({ kind: "tenant", slug: result.slug }, "activation", result.activationToken)}`,
    },
    getTranslator(),
  );
  const sent = await c.mailer.sendSystem(mail);
  return { status: "created", slug: result.slug, emailSent: sent.ok };
}
