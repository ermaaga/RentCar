import { z } from "zod";

// Input of TEN-03 createTenant (docs/06-backend-api.md 6.1). Strict: unknown keys are refused.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeZones = new Set(Intl.supportedValuesOf("timeZone").concat("UTC"));
const email = z.email().max(254);
const username = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._-]{3,40}$/));

const address = z
  .object({
    street: z.string().trim().min(1).max(120),
    postalCode: z.string().trim().min(1).max(16),
    city: z.string().trim().min(1).max(80),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict();

const subscription = z
  .object({
    maxVehicles: z.number().int().min(0).max(10_000),
    maxOperators: z.number().int().min(0).max(1_000),
    startDate: isoDate,
    endDate: isoDate,
    priceMinor: z.number().int().min(0).max(99_999_999),
    priceCurrency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

export const createTenantInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z.string(),
    contact: z.object({ email, phone: z.string().trim().min(1).max(32) }).strict(),
    title: z.string().trim().min(1).max(45),
    shortDescription: z.string().trim().max(160).optional(),
    address: address.optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    timeZone: z.string().refine((tz) => timeZones.has(tz)),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dpaSigned: z.literal(true),
    subscription,
    admin: z.object({ displayName: z.string().trim().min(1).max(120), username, email }).strict(),
  })
  .strict();

export type CreateTenantInput = z.infer<typeof createTenantInput>;
