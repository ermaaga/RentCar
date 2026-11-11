import { checkSlug } from "@/modules/tenancy/domain/slug";

// Central X-Robots-Tag policy (docs/09-seo.md section 5, SR-05/SR-06; docs/08-security.md SR-HDR-04).
// Pure, so the proxy stays a thin adapter. The meta robots tags on each page are belt and braces;
// tenant state (suspended, closed) is only known to the page, which sets its own noindex meta.

export const NOINDEX = "noindex, nofollow";
export const NOINDEX_FOLLOW = "noindex, follow";

/** Public sub-paths whose links are worth following (search results list the tenant's cars). */
const FOLLOW_SUBPATHS: ReadonlySet<string> = new Set(["vehicles"]);

/**
 * The X-Robots-Tag value for a request, or null when the page decides alone (the tenant root without
 * a query string, which is indexable only while the tenant takes bookings).
 */
export function robotsHeader(
  pathname: string,
  hasQuery: boolean,
  indexing: boolean,
): string | null {
  if (!indexing) return NOINDEX;
  const [first = "", second, ...rest] = pathname.split("/").filter((s) => s.length > 0);
  if (!checkSlug(first).ok) return NOINDEX; // platform root, /system, /api, unknown paths
  if (second === undefined) return hasQuery ? NOINDEX_FOLLOW : null;
  if (rest.length === 0 && FOLLOW_SUBPATHS.has(second)) return NOINDEX_FOLLOW;
  return NOINDEX; // admin, booking form, confirmation, any other sub-path
}

/**
 * SR-04: the lowercase path when the first segment is an uppercase variant of a well-formed slug,
 * else null. The slug's existence is checked by the page after the redirect (unknown slug is a 404).
 */
export function lowercaseSlugPath(pathname: string): string | null {
  const match = /^\/([^/]+)(.*)$/.exec(pathname);
  if (!match) return null;
  const [, segment = "", tail = ""] = match;
  const lower = segment.toLowerCase();
  if (lower === segment || !checkSlug(lower).ok) return null;
  return `/${lower}${tail}`;
}

/** Pages that carry a booking code in the URL: no referrer leaves them (SR-16, 09-seo section 11). */
export function isBookingCodePath(pathname: string): boolean {
  return /^\/[^/]+\/booking\/[^/]+/.test(pathname);
}
