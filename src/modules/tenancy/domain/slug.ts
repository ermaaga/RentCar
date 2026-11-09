// Tenant slug rules (docs/06-backend-api.md 3.4, SR-ACC-07). Pure.

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Path segments the app owns; a tenant can never take them. */
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "system",
  "api",
  "media",
  "exports",
  "_next",
  "static",
  "assets",
  "admin",
  "login",
  "logout",
  "robots.txt",
  "favicon.ico",
  "sitemap.xml",
  "healthz",
  "readyz",
  "theme",
  "www",
  "app",
  "help",
  "support",
  "status",
  "docs",
]);

export type SlugCheck = { ok: true } | { ok: false; reason: "invalid" | "reserved" };

export function checkSlug(slug: string): SlugCheck {
  if (!SLUG.test(slug) || slug.includes("--")) {
    return { ok: false, reason: "invalid" };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true };
}
