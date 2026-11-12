import type { Metadata } from "next";

import { formatMessage, getTranslator } from "@/i18n";

// SEO rules of docs/09-seo.md as pure functions, so they are unit-tested without a database.
// Only the root `/{slug}` is indexable (SEO-1); every other public page is noindex (SR-05).

/** Canonical URL of a tenant: the origin comes from configuration, never from the Host header (SR-03). */
export function rootUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${slug}`;
}

export function rootTitle(name: string): string {
  return formatMessage(getTranslator()("public.seo.title"), { name });
}

/** The tenant's own short description (SEO-3) or the generated text; never truncated silently. */
export function rootDescription(tenant: {
  title: string;
  shortDescription: string | null;
}): string {
  if (tenant.shortDescription) return tenant.shortDescription;
  return formatMessage(getTranslator()("public.seo.description"), { name: tenant.title });
}

/** SR-05 for the root: indexed only when the switch is on, the tenant can take bookings and the URL has no query. */
export function rootRobots(state: {
  indexingEnabled: boolean;
  unavailable: boolean;
  hasQuery: boolean;
}): NonNullable<Metadata["robots"]> {
  if (!state.indexingEnabled || state.unavailable) return { index: false, follow: false };
  return state.hasQuery ? { index: false, follow: true } : { index: true, follow: true };
}

export interface JsonLdTenant {
  title: string;
  contactEmail: string;
  contactPhone: string;
  currency: string;
  address: { street: string; postalCode: string; city: string; countryCode: string } | null;
}

/** schema.org AutoRental (SR-13). Only stored fields are included; no placeholders. */
export function autoRentalJsonLd(tenant: JsonLdTenant, url: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    name: tenant.title,
    url,
    email: tenant.contactEmail,
    telephone: tenant.contactPhone,
    currenciesAccepted: tenant.currency,
    paymentAccepted: "Cash, Credit Card",
    ...(tenant.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: tenant.address.street,
            postalCode: tenant.address.postalCode,
            addressLocality: tenant.address.city,
            addressCountry: tenant.address.countryCode,
          },
        }
      : {}),
  };
}

/** Serialised for a script tag: `<` is escaped so tenant text cannot close the script element. */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** SR-06 / SR-07: robots.txt rules. No sitemap line (SR-08). */
export function robotsRules(indexingEnabled: boolean): {
  userAgent: string;
  allow?: string;
  disallow: string;
} {
  if (!indexingEnabled) return { userAgent: "*", disallow: "/" };
  return { userAgent: "*", allow: "/", disallow: "/api/" };
}
