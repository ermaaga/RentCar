import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getContainer } from "@/composition/container";
import { peekCredentialLink, resolveSession, SYSTEM_REALM, tenantRealm } from "@/modules/auth";
import type { MessageKey } from "@/i18n";
import { assertWritable, loadEffectiveAccess } from "@/modules/subscriptions";
import { resolveTenantBySlug, type ResolvedTenantRow } from "@/modules/tenancy";
import { sessionCookie } from "@/platform/http/session-cookie";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

import { consume, requestIp } from "./security";

// Page guards (docs/06-backend-api.md AUT-21): resolve the realm cookie to a session or redirect to
// the realm's sign-in page. Any failure denies.

async function tokenFor(realm: "tenant" | "system"): Promise<string | undefined> {
  const spec = sessionCookie(realm, getContainer().secureCookies);
  return (await cookies()).get(spec.name)?.value;
}

export async function requireSystemSession() {
  const token = await tokenFor("system");
  const c = getContainer();
  const session = token
    ? await resolveSession(c.pool, { realm: SYSTEM_REALM, token, now: c.clock.now() })
    : null;
  if (session?.role !== "systemadmin") {
    redirect("/system/login");
  }
  return session;
}

/** Unknown, reserved and deleted slugs give the generic 404 (SR-ACC-07). */
export async function requireTenant(slug: string): Promise<ResolvedTenantRow> {
  const tenant = await resolveTenantBySlug(getContainer().pool, slug);
  if (!tenant) {
    notFound();
  }
  return tenant;
}

export async function requireTenantSession(slug: string) {
  const tenant = await requireTenant(slug);
  const token = await tokenFor("tenant");
  const c = getContainer();
  const session = token
    ? await resolveSession(c.pool, {
        realm: tenantRealm(tenant.tenantId),
        token,
        now: c.clock.now(),
      })
    : null;
  if (!session) {
    redirect(`/${tenant.slug}/admin/login`);
  }
  return { tenant, session };
}

/** Admin-only tenant pages and actions: an operator is sent back to the admin home. */
export async function requireTenantAdmin(slug: string) {
  const found = await requireTenantSession(slug);
  if (found.session.role !== "admin") {
    redirect(`/${found.tenant.slug}/admin`);
  }
  return found;
}

/**
 * The single read-only policy for tenant writes (docs/06-backend-api.md 4.4, FR-ENF-01): the message to
 * show when the tenant may not write now, or null when it may.
 */
export async function tenantWriteRefusal(tenant: ResolvedTenantRow): Promise<MessageKey | null> {
  const c = getContainer();
  const access = await loadEffectiveAccess(c.pool, tenant, c.clock.now());
  const decision = assertWritable(access, "write");
  if (decision.ok) {
    return null;
  }
  return decision.code === "TENANT_READ_ONLY" ? "admin.readOnly" : "auth.login.unavailable";
}

/**
 * Read-only peek for the set-password pages (never consumes the link). RL-16: 60 peeks per IP per
 * hour; past it every link reads as invalid, so the page cannot be used to probe tokens.
 */
export async function peekLink(
  realm: Parameters<typeof resolveSession>[1]["realm"],
  token: string,
): Promise<Awaited<ReturnType<typeof peekCredentialLink>>> {
  if (!(await consume(RATE_LIMITS.credentialPeekIp, await requestIp(), realm.kind))) {
    return { state: "invalid" };
  }
  const c = getContainer();
  return peekCredentialLink(c.pool, { realm, token, now: c.clock.now() });
}
