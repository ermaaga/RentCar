import type { MetadataRoute } from "next";

import { getConfig } from "@/platform/config";

// robots.txt (docs/09-seo.md SR-06/SR-07). No Disallow for /system or admin paths (it would advertise
// them; the X-Robots-Tag header does that job) and no Sitemap line (SR-08). Read at request time so
// one build serves every environment.

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!getConfig().PUBLIC_INDEXING_ENABLED) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" } };
}
