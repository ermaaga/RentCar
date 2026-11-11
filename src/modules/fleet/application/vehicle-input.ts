import { z } from "zod";

import { singleLineText } from "../../../shared/text";

// FLT-01/02 input (docs/06-backend-api.md): bounded text without control characters; the daily price is
// entered in major units (e.g. 45.50) and stored in minor units; notes refuse anything that looks like a
// payment card number (SR-VAL-11, SEC-5: no card numbers stored anywhere).

export const VEHICLE_CATEGORIES = [
  "city",
  "compact",
  "sedan",
  "suv",
  "van",
  "convertible",
  "luxury",
  "other",
] as const;

export const FUEL_TYPES = [
  "petrol",
  "diesel",
  "hybrid",
  "plug_in_hybrid",
  "electric",
  "lpg_cng",
] as const;

const text = (min: number, max: number) => singleLineText(min, max);

/** 13 to 19 digits, possibly separated by spaces or dashes: treated as a card number. */
function looksLikeCardNumber(value: string): boolean {
  return /(?:\d[ -]?){13,19}/.test(value);
}

const MAX_PRICE_MINOR = 99_999_999;

/** "45", "45.5", "45,50" -> 4550; anything else -> NaN (refused). */
export function parsePriceToMinor(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalized)) {
    return Number.NaN;
  }
  return Math.round(Number(normalized) * 100);
}

export const vehicleInput = z.object({
  name: text(1, 80),
  plate: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[A-Za-z0-9 -]+$/),
  make: text(1, 80),
  model: text(1, 80),
  category: z.enum(VEHICLE_CATEGORIES),
  fuelType: z.enum(FUEL_TYPES),
  seats: z.coerce.number().int().min(1).max(20),
  dailyPriceMinor: z.number().int().min(0).max(MAX_PRICE_MINOR),
  notes: text(0, 1000)
    .refine((v) => !looksLikeCardNumber(v), "card numbers are not allowed")
    .optional(),
});

export type VehicleInput = z.infer<typeof vehicleInput>;
