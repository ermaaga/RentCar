// Authentication realms (docs/06-backend-api.md 4.1): tenant staff sign in under a tenant; the
// systemadmin signs in to the platform console. Pure.

export type Realm = { kind: "tenant"; tenantId: string } | { kind: "system" };

export function tenantRealm(tenantId: string): Realm {
  return { kind: "tenant", tenantId };
}

export const SYSTEM_REALM: Realm = { kind: "system" };

/** Tenant id stored on rows of this realm (NULL for the system realm). */
export function realmTenantId(realm: Realm): string | null {
  return realm.kind === "tenant" ? realm.tenantId : null;
}

/** Path of a set-password link, built from the configured base URL, never from request headers. */
export function credentialPath(
  realm: { kind: "tenant"; slug: string } | { kind: "system" },
  purpose: "activation" | "password_reset",
  token: string,
): string {
  const page = purpose === "activation" ? "activate" : "reset-password";
  const prefix = realm.kind === "tenant" ? `/${realm.slug}/admin` : "/system";
  return `${prefix}/${page}?token=${encodeURIComponent(token)}`;
}
