import { z } from "zod";

import { singleLineText } from "../../../shared/text";

// Input of BKG-03 submitPublicBooking (docs/06-backend-api.md 6.x). Strict; the phone is normalised
// to E.164 later with the tenant country, the honeypot is checked before this schema.

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/** Customer fields shared by the public form and the staff form (SR-VAL-04, ABU-M2-05). */
export const customerFields = {
  firstName: singleLineText(1, 80),
  lastName: singleLineText(1, 80),
  phone: singleLineText(6, 32),
  email: z
    .union([z.literal(""), z.email().max(254)])
    .transform((v) => (v === "" ? undefined : v.toLowerCase())),
};

export const publicBookingInput = z
  .object({
    formToken: z.string().min(1).max(512),
    vehicleId: z.uuid(),
    pickup: localDateTime,
    return: localDateTime,
    expectedTotalMinor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    ...customerFields,
    acknowledge: z.literal(true),
  })
  .strict();

export type PublicBookingInput = z.infer<typeof publicBookingInput>;
