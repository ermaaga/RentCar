import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";

// TEN-16 getPublicTenantProfile (docs/06-backend-api.md): what the public pages show about a tenant.
// Only public fields: contact, address, legal links and the booking rules the search form explains.

export interface PublicTenantSettings {
  title: string;
  shortDescription: string | null;
  contactEmail: string;
  contactPhone: string;
  address: { street: string; postalCode: string; city: string; countryCode: string } | null;
  timeZone: string;
  privacyUrl: string | null;
  termsUrl: string | null;
  rules: { minRentalDays: number; maxRentalDays: number; leadTimeMinutes: number };
}

interface Row {
  title: string;
  short_description: string | null;
  contact_email: string;
  contact_phone: string;
  address_street: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  address_country_code: string | null;
  time_zone: string;
  privacy_notice_url: string | null;
  rental_terms_url: string | null;
  min_rental_days: number;
  max_rental_days: number;
  lead_time_minutes: number;
}

function toSettings(r: Row): PublicTenantSettings {
  const { address_street: street, address_postal_code: postalCode } = r;
  const { address_city: city, address_country_code: countryCode } = r;
  return {
    title: r.title,
    shortDescription: r.short_description,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    address:
      street && postalCode && city && countryCode
        ? { street, postalCode, city, countryCode }
        : null,
    timeZone: r.time_zone,
    privacyUrl: r.privacy_notice_url,
    termsUrl: r.rental_terms_url,
    rules: {
      minRentalDays: r.min_rental_days,
      maxRentalDays: r.max_rental_days,
      leadTimeMinutes: r.lead_time_minutes,
    },
  };
}

export async function getPublicTenantSettings(
  pool: pg.Pool,
  tenantId: string,
): Promise<PublicTenantSettings | null> {
  return withTenantTx(pool, tenantId, async (c) => {
    const res = await c.query<Row>(
      `SELECT s.title, s.short_description, s.contact_email, s.contact_phone, s.address_street,
              s.address_postal_code, s.address_city, s.address_country_code, t.time_zone,
              s.privacy_notice_url, s.rental_terms_url, s.min_rental_days, s.max_rental_days,
              s.lead_time_minutes
         FROM tenants t JOIN tenant_settings s ON s.tenant_id = t.id WHERE t.id = $1`,
      [tenantId],
    );
    const row = res.rows[0];
    return row ? toSettings(row) : null;
  });
}
