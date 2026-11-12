import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getContainer } from "@/composition/container";
import { getTranslator, type MessageKey } from "@/i18n";
import { canTakeBookings, loadEffectiveAccess } from "@/modules/subscriptions";
import {
  getPublicTenantSettings,
  resolveTenantBySlug,
  type PublicTenantSettings,
} from "@/modules/tenancy";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

import { rootUrl } from "./seo";
import { consume, requestIp } from "./security";

// Public pages (docs/06-backend-api.md 4.4, FR-PUB-01, US-025): the tenant comes from the slug only;
// an unknown slug is the generic 404 and a tenant that cannot take bookings shows the unavailable page.

export interface PublicTenant extends PublicTenantSettings {
  tenantId: string;
  slug: string;
  currency: string;
  /** Why online booking is closed (W-P5 wording), or null when the booking path is open. */
  unavailable: "paused" | "closed" | null;
}

/** Once per request, shared by the page and its metadata. */
export const loadPublicTenant = cache(async (slug: string): Promise<PublicTenant> => {
  const c = getContainer();
  const tenant = await resolveTenantBySlug(c.pool, slug);
  const settings = tenant ? await getPublicTenantSettings(c.pool, tenant.tenantId) : null;
  if (!tenant || !settings) {
    notFound();
  }
  const access = await loadEffectiveAccess(c.pool, tenant, c.clock.now());
  const paused = access.state === "suspended" || access.state === "terminated";
  return {
    ...settings,
    tenantId: tenant.tenantId,
    slug: tenant.slug,
    currency: tenant.currency,
    unavailable: canTakeBookings(access) ? null : paused ? "paused" : "closed",
  };
});

/** RL-01 (5 searches per minute per tenant and IP). Fails open: a counter error never blocks a search. */
export async function searchAllowed(tenantId: string): Promise<boolean> {
  try {
    return await consume(RATE_LIMITS.publicSearch, `${tenantId}:${await requestIp()}`, "public");
  } catch {
    return true;
  }
}

/** "<page title> · <tenant title>", never indexed (FR-PUB-14 default). */
export async function publicPageMetadata(slug: string, title: MessageKey): Promise<Metadata> {
  const tenant = await loadPublicTenant(slug);
  return {
    title: `${getTranslator()(title)} · ${tenant.title}`,
    robots: { index: false, follow: false },
    alternates: { canonical: rootUrl(getContainer().baseUrl, tenant.slug) },
  };
}
