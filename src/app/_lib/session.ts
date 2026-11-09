import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getContainer } from "@/composition/container";
import { peekCredentialLink, resolveSession, SYSTEM_REALM, tenantRealm } from "@/modules/auth";
import { resolveTenantBySlug, type ResolvedTenantRow } from "@/modules/tenancy";
import { sessionCookie } from "@/platform/http/session-cookie";

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

/** Read-only peek for the set-password pages (never consumes the link). */
export async function peekLink(
  realm: Parameters<typeof resolveSession>[1]["realm"],
  token: string,
) {
  const c = getContainer();
  return peekCredentialLink(c.pool, { realm, token, now: c.clock.now() });
}

/** Admin-only pages and actions (06-backend-api 5: operators have no settings access). */
export async function requireTenantAdmin(slug: string) {
  const ctx = await requireTenantSession(slug);
  if (ctx.session.role !== "admin") {
    redirect(`/${ctx.tenant.slug}/admin`);
  }
  return ctx;
}
