"use server";

import { after } from "next/server";

import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { credentialPath, issuePasswordResets, SYSTEM_REALM, tenantRealm } from "@/modules/auth";
import type { AuthFormState } from "@/modules/auth/ui/form-state";
import { renderCredentialEmail, sendTenantMail } from "@/modules/notifications";
import { resolveTenantBySlug } from "@/modules/tenancy";
import { hitRateLimit, RATE_LIMITS } from "@/platform/rate-limit/postgres";

import { consume, requestIp, securityEvent, tokenIssued } from "@/app/_lib/security";

// AUT-06/07 (docs/06-backend-api.md 4.2.3): the same answer whether or not an account matches. The
// lookup, the token and the email run after the response, so timing does not reveal accounts.

const DONE: AuthFormState = { status: "done", messageKey: "auth.forgot.done" };

type LinkRealm = { kind: "tenant"; slug: string; tenantId: string } | { kind: "system" };

/** RL-06: 3 reset requests per account per hour; past it nothing is sent (the answer is unchanged). */
async function accountAllowed(realm: LinkRealm, identifier: string, ip: string): Promise<boolean> {
  const c = getContainer();
  const account = await hitRateLimit(c.pool, {
    hmacKey: c.hmacKey,
    rule: RATE_LIMITS.resetAccount,
    identity: `${realm.kind === "tenant" ? realm.tenantId : "system"}:${identifier}`,
    now: c.clock.now(),
  });
  if (!account.allowed) {
    const reasonCode = RATE_LIMITS.resetAccount.scope;
    await securityEvent(
      { event: "ratelimit.exceeded", realm: realm.kind, outcome: "refused", reasonCode },
      ip,
    );
  }
  return account.allowed;
}

type Recipient = Awaited<ReturnType<typeof issuePasswordResets>>[number];

async function mailReset(realm: LinkRealm, r: Recipient, ip: string): Promise<void> {
  const c = getContainer();
  await tokenIssued({
    realm: realm.kind,
    reasonCode: "password_reset",
    subjectTenantId: realm.kind === "tenant" ? realm.tenantId : null,
    ip,
  });
  const path = credentialPath(
    realm.kind === "tenant" ? { kind: "tenant", slug: realm.slug } : { kind: "system" },
    "password_reset",
    r.token,
  );
  const mail = renderCredentialEmail(
    {
      purpose: "password_reset",
      to: r.email,
      displayName: r.displayName,
      username: r.username,
      link: `${c.baseUrl}${path}`,
    },
    getTranslator(),
  );
  // Admins and the systemadmin through the system SMTP; operators through the tenant SMTP (SEC-12).
  if (r.role === "operator" && realm.kind === "tenant") {
    await sendTenantMail(c, realm.tenantId, mail);
  } else {
    await c.mailer.sendSystem(mail);
  }
}

async function sendResets(realm: LinkRealm, identifier: string, ip: string): Promise<void> {
  if (!(await accountAllowed(realm, identifier, ip))) {
    return;
  }
  const c = getContainer();
  const authRealm = realm.kind === "tenant" ? tenantRealm(realm.tenantId) : SYSTEM_REALM;
  const recipients = await issuePasswordResets(c.pool, {
    realm: authRealm,
    identifier,
    now: c.clock.now(),
  });
  for (const r of recipients) {
    await mailReset(realm, r, ip);
  }
}

async function requestReset(realm: LinkRealm | null, form: FormData): Promise<AuthFormState> {
  const raw = form.get("identifier");
  const identifier = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 254) : "";
  const ip = await requestIp();
  if (!(await consume(RATE_LIMITS.resetIp, ip, realm?.kind ?? "tenant"))) {
    return { status: "error", messageKey: "auth.login.throttled" };
  }
  if (realm && identifier.length > 0) {
    after(() => sendResets(realm, identifier, ip));
  }
  return DONE;
}

export async function requestSystemResetAction(
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  return requestReset({ kind: "system" }, form);
}

export async function requestTenantResetAction(
  slug: string,
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const tenant = await resolveTenantBySlug(getContainer().pool, slug);
  const realm =
    tenant?.status === "active"
      ? { kind: "tenant" as const, slug: tenant.slug, tenantId: tenant.tenantId }
      : null;
  return requestReset(realm, form);
}
