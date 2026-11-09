"use server";

import { revalidatePath } from "next/cache";

import { requireSystemSession } from "@/app/_lib/session";
import { getContainer } from "@/composition/container";
import { getTranslator, type MessageKey } from "@/i18n";
import { credentialPath, issueAdminAccessLink } from "@/modules/auth";
import { renderCredentialEmail } from "@/modules/notifications";
import {
  changeSubscriptionEnd,
  createTenantInput,
  provisionTenant,
  setTenantStatus,
} from "@/modules/tenancy";
import type { ConsoleActionState } from "@/modules/tenancy/ui/console-action-form";
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

// Console commands on one tenant (TEN-05/06, SUB-02, AUT-17). Each re-checks the system session.

export async function setTenantStatusAction(
  slug: string,
  to: "suspended" | "active",
): Promise<ConsoleActionState> {
  const session = await requireSystemSession();
  const c = getContainer();
  const result = await setTenantStatus(
    c.pool,
    { slug, to },
    { actorUserId: session.userId, now: c.clock.now() },
  );
  revalidatePath(`/system/tenants/${slug}`);
  if (!result.ok) return { status: "error", messageKey: "tenantDetail.notFound" };
  return {
    status: "done",
    messageKey: result.changed ? "tenantDetail.statusChanged" : "tenantDetail.statusUnchanged",
  };
}

const RENEW_ERRORS: Record<string, MessageKey> = {
  NOT_FOUND: "tenantDetail.notFound",
  SUBSCRIPTION_INVALID_PERIOD: "tenantDetail.periodInvalid",
  SUBSCRIPTION_OVERLAP: "tenantDetail.overlap",
};

export async function renewSubscriptionAction(
  slug: string,
  subscriptionId: string,
  _: ConsoleActionState,
  form: FormData,
): Promise<ConsoleActionState> {
  const session = await requireSystemSession();
  const endDate = form.get("endDate");
  if (typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { status: "error", messageKey: "tenantDetail.periodInvalid" };
  }
  const c = getContainer();
  const result = await changeSubscriptionEnd(
    c.pool,
    { slug, subscriptionId, endDate },
    { actorUserId: session.userId, now: c.clock.now() },
  );
  revalidatePath(`/system/tenants/${slug}`);
  return result.ok
    ? { status: "done", messageKey: "tenantDetail.renewed" }
    : { status: "error", messageKey: RENEW_ERRORS[result.code] ?? "tenantDetail.notFound" };
}

export async function adminAccessLinkAction(slug: string): Promise<ConsoleActionState> {
  const session = await requireSystemSession();
  const c = getContainer();
  const link = await issueAdminAccessLink(c.pool, {
    slug,
    actorUserId: session.userId,
    now: c.clock.now(),
  });
  revalidatePath(`/system/tenants/${slug}`);
  if (!link) return { status: "error", messageKey: "tenantDetail.adminNone" };
  const mail = renderCredentialEmail(
    {
      purpose: "activation",
      to: link.email,
      displayName: link.displayName,
      username: link.username,
      link: `${c.baseUrl}${credentialPath({ kind: "tenant", slug }, "activation", link.token)}`,
    },
    getTranslator(),
  );
  const sent = await c.mailer.sendSystem(mail);
  return sent.ok
    ? { status: "done", messageKey: "tenantDetail.accessLinkSent" }
    : { status: "error", messageKey: "tenantDetail.accessLinkFailed" };
}
