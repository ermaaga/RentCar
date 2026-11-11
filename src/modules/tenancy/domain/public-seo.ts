// Public SEO rules of docs/09-seo.md (SR-03, SR-11, SR-13). Pure: the origin always comes from
// configuration (APP_BASE_URL), never from the request Host header.

/** SR-03: `{origin}/{slug}`, no trailing slash, no query string. */
export function canonicalUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/${slug}`;
}

/** Hard cap of the meta description (09-seo section 7). */
export const DESCRIPTION_MAX = 160;

/** SR-11: the tenant's own short description, else the fallback text; never over 160 characters. */
export function rootDescription(shortDescription: string | null, fallback: string): string {
  const own = shortDescription?.trim();
  const text = own && own.length > 0 ? own : fallback;
  return text.length <= DESCRIPTION_MAX ? text : `${text.slice(0, DESCRIPTION_MAX - 1)}…`;
}

export interface AutoRentalInput {
  title: string;
  canonical: string;
  currency: string;
  contactPhone: string;
  contactEmail: string;
  address: { street: string; postalCode: string; city: string; countryCode: string } | null;
}

/** Phone as E.164 when the stored value can be read as one, else null (the field is then left out). */
export function e164(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  const normalised = digits.startsWith("00") ? `+${digits.slice(2)}` : digits;
  return /^\+[1-9]\d{6,14}$/.test(normalised) ? normalised : null;
}

/** SR-13: schema.org AutoRental for the root page, with only the fields that exist. */
export function autoRentalJsonLd(input: AutoRentalInput): Record<string, unknown> {
  const telephone = e164(input.contactPhone);
  const a = input.address;
  return {
    "@context": "https://schema.org",
    "@type": "AutoRental",
    name: input.title,
    url: input.canonical,
    ...(telephone ? { telephone } : {}),
    email: input.contactEmail,
    currenciesAccepted: input.currency,
    paymentAccepted: "Cash, Credit Card",
    ...(a
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: a.street,
            postalCode: a.postalCode,
            addressLocality: a.city,
            addressCountry: a.countryCode,
          },
        }
      : {}),
  };
}

/**
 * JSON for a `<script type="application/ld+json">` body: `<` is written as its Unicode escape so
 * tenant text can never close the script element (09-seo section 8). Also escapes U+2028/U+2029.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
