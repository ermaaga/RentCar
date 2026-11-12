import type { MetadataRoute } from "next";

import { robotsRules } from "@/app/_lib/seo";
import { getContainer } from "@/composition/container";

// SR-06/SR-07 (docs/09-seo.md): read at request time, so the switch takes effect without a rebuild.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return { rules: robotsRules(getContainer().publicIndexing) };
}
