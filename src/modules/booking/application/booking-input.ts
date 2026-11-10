import { z } from "zod";

// Input of BKG-03 submitPublicBooking (docs/06-backend-api.md 6.x). Strict; the phone is normalised
// to E.164 later with the tenant country, the honeypot is checked before this schema.

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const publicBookingInput = z
  .object({
    formToken: z.string().min(1).max(512),
    vehicleId: z.uuid(),
    pickup: localDateTime,
    return: localDateTime,
    expectedTotalMinor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone: z.string().trim().min(6).max(32),
    email: z
      .union([z.literal(""), z.email().max(254)])
      .transform((v) => (v === "" ? undefined : v.toLowerCase())),
    acknowledge: z.literal(true),
  })
  .strict();

export type PublicBookingInput = z.infer<typeof publicBookingInput>;
