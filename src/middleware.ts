import { NextResponse, type NextRequest } from "next/server";

import { getConfig } from "./platform/config/runtime";

// SR-05 / SR-06 (docs/09-seo.md): with PUBLIC_INDEXING_ENABLED off, every response is noindex; with it
// on, the platform, API and admin paths are noindex. Public pages set their own robots in metadata.
// Read per request from the validated config, so the switch needs no rebuild.
const NON_PUBLIC = /^\/(system|api)(\/|$)|^\/[^/]+\/admin(\/|$)/;

export function middleware(request: NextRequest) {
  const indexingEnabled = getConfig().PUBLIC_INDEXING_ENABLED;
  const response = NextResponse.next();
  if (!indexingEnabled || NON_PUBLIC.test(request.nextUrl.pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
