import { NextResponse, type NextRequest } from "next/server";

import { isBookingCodePath, lowercaseSlugPath, robotsHeader } from "@/app/_lib/robots-policy";
import { getConfig } from "@/platform/config";

// Request proxy (Next.js 16 file convention). Response headers only: the X-Robots-Tag class policy
// (docs/09-seo.md SR-05/SR-06, read from configuration at runtime so one image serves every
// environment), the uppercase slug redirect (SR-04) and no-referrer on booking-code pages (SR-16).
// Never authorisation: every page and action checks access itself (SR-ACC-04).

export function proxy(request: NextRequest): NextResponse {
  const cfg = getConfig();
  const { pathname, search } = request.nextUrl;
  const lower = lowercaseSlugPath(pathname);
  if (lower !== null) {
    // Location from APP_BASE_URL, never from the Host header (09-seo SR-03).
    return NextResponse.redirect(new URL(`${lower}${search}`, cfg.APP_BASE_URL), 301);
  }
  const response = NextResponse.next();
  const robots = robotsHeader(pathname, search.length > 1, cfg.PUBLIC_INDEXING_ENABLED);
  if (robots !== null) response.headers.set("X-Robots-Tag", robots);
  if (isBookingCodePath(pathname)) response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  // Not for build assets, robots.txt and /media (class M headers of its own; 09-seo section 5).
  matcher: ["/((?!_next/|media/|favicon\\.ico$|robots\\.txt$).*)"],
};
