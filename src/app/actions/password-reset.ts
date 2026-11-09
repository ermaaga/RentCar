"use server";

import { headers } from "next/headers";
import { after } from "next/server";

import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { credentialPath, issuePasswordResets, SYSTEM_REALM, tenantRealm } from "@/modules/auth";
import type { AuthFormState } from "@/modules/auth/ui/form-state";
import { renderCredentialEmail } from "@/modules/notifications";
import { resolveTenantBySlug } from "@/modules/tenancy";
import { clientIp } from "@/platform/host/client-ip";
import { hitRateLimit, RATE_LIMITS } from "@/platform/rate-limit/postgres";

// AUT-06/07 (docs/06-backend-api.md 4.2.3): the same answer whether or not an account matches. The
// lookup, the token and the email run after the response, so timing does not reveal accounts.

const DONE: AuthFormState = { status: "done", messageKey: "auth.forgot.done" };

type LinkRealm = { kind: "tenant"; slug: string; tenantId: string } | { kind: "system" };

async function sendResets(realm: LinkRealm, identifier: string): Promise<void> {
  const c = getContainer();
  const now = c.clock.now();
  const authRealm = realm.kind === "tenant" ? tenantRealm(realm.tenantId) : SYSTEM_REALM;
  const accountKey = `${realm.kind === "tenant" ? realm.tenantId : "system"}:${identifier}`;
  const account = await hitRateLimit(c.pool, {
    hmacKey: c.hmacKey,
    rule: RATE_LIMITS.resetAccount,
    identity: accountKey,
    now,
  });
  if (!account.allowed) {
    return;
  }
  const recipients = await issuePasswordResets(c.pool, { realm: authRealm, identifier, now });
  const t = getTranslator();
  for (const r of recipients) {
    // Operators reset through the tenant SMTP, which arrives with tenant mail settings (US-002).
    if (r.role === "operator") continue;
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
      t,
    );
    await c.mailer.sendSystem(mail);
  }
}

async function requestReset(realm: LinkRealm | null, form: FormData): Promise<AuthFormState> {
  const raw = form.get("identifier");
  const identifier = typeof raw === "string" ? raw.trim().toLowerCase().slice(0, 254) : "";
  const c = getContainer();
  const ip = await hitRateLimit(c.pool, {
    hmacKey: c.hmacKey,
    rule: RATE_LIMITS.resetIp,
    identity: clientIp(await headers()),
    now: c.clock.now(),
  });
  if (!ip.allowed) {
    return { status: "error", messageKey: "auth.login.throttled" };
  }
  if (realm && identifier.length > 0) {
    after(() => sendResets(realm, identifier));
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
