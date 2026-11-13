import { randomUUID } from "node:crypto";

import { z } from "zod";

import { notesText } from "../../../shared/text";
import { customerFields } from "./booking-input";

// Form part of BKG-06 createAdminBooking (W-D5): strict. The period comes from the page (bound and
// checked again by the service); the phone is normalised later with the tenant country.

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const adminBookingInput = z
  .object({
    vehicleId: z.uuid(),
    ...customerFields,
    paid: z.enum(["", "card", "cash"]).transform((v) => (v === "" ? null : v)),
    notes: notesText(2000).transform((v) => (v === "" ? null : v)),
  })
  .strict();

/** The period and idempotency key bound by the page; anything else is refused. */
export const adminBookingPeriod = z
  .object({
    pickup: z.string().regex(LOCAL),
    return: z.string().regex(LOCAL),
    idempotencyKey: z.uuid(),
  })
  .strict();

/** A fresh key for one rendering of the form: a double submit replays instead of booking twice. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
