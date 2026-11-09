import { z } from "zod";

import { FUEL_TYPES, VEHICLE_CATEGORIES } from "../../fleet";

import { addLocalDays, formatLocal, parseLocal } from "../domain/local-time";
import { offerQueryString } from "../domain/offers";
import type { PeriodRules } from "../domain/period-rules";

// Public search URL (docs/04a-ux.md 4.1, 06-backend-api BKG-01): human-readable, tenant-local times,
// bookmarkable. The plain search form submits date and time separately (it works without JavaScript);
// both shapes parse to the same query and the canonical URL uses `pickup`/`return` only.

export const SEARCH_CATEGORIES = VEHICLE_CATEGORIES;
export const SEARCH_FUELS = FUEL_TYPES;
export const SEAT_OPTIONS = [2, 4, 5, 7] as const;

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export interface SearchQuery {
  pickup: string;
  return: string;
  sort: "price-asc" | "price-desc";
  category: (typeof SEARCH_CATEGORIES)[number][];
  fuel?: (typeof SEARCH_FUELS)[number] | undefined;
  seats?: number | undefined;
}

type Params = Record<string, string | string[] | undefined>;

const single = z.string().max(32).optional();

const schema = z.object({
  pickup: single,
  return: single,
  pickupDate: single,
  pickupTime: single,
  returnDate: single,
  returnTime: single,
  sort: z.enum(["price-asc", "price-desc"]).optional(),
  category: z.array(z.string().max(80)).max(8).optional(),
  fuel: z.enum(SEARCH_FUELS).optional(),
  seats: z.coerce.number().int().min(1).max(20).optional(),
});

/** One local date-time from `name` or from `nameDate` + `nameTime`; undefined when absent or malformed. */
function localValue(p: z.infer<typeof schema>, name: "pickup" | "return"): string | undefined {
  const whole = p[name];
  if (whole !== undefined) {
    return LOCAL.test(whole) ? whole : undefined;
  }
  const date = p[`${name}Date`];
  const time = p[`${name}Time`];
  return date && time && DATE.test(date) && TIME.test(time) ? `${date}T${time}` : undefined;
}

function categories(values: readonly string[] | undefined): SearchQuery["category"] | undefined {
  const all = (values ?? []).flatMap((v) => v.split(",")).filter((v) => v !== "");
  const known = new Set<string>(SEARCH_CATEGORIES);
  if (!all.every((v) => known.has(v))) return undefined;
  return [...new Set(all)] as SearchQuery["category"];
}

/**
 * Strict parse: arrays only for `category`, unknown values refused. Unknown keys (e.g. campaign tags)
 * are ignored. Dates are only checked for shape here; the period rules run in the search itself.
 */
export function parseSearchQuery(
  params: Params,
): { ok: true; query: SearchQuery } | { ok: false; code: "MISSING_PERIOD" | "INVALID_QUERY" } {
  const { category, ...rest } = params;
  if (Object.values(rest).some(Array.isArray)) return { ok: false, code: "INVALID_QUERY" };
  const parsed = schema.safeParse({
    ...rest,
    category: category === undefined ? undefined : [category].flat(),
  });
  if (!parsed.success) return { ok: false, code: "INVALID_QUERY" };
  const pickup = localValue(parsed.data, "pickup");
  const ret = localValue(parsed.data, "return");
  if (!pickup || !ret) return { ok: false, code: "MISSING_PERIOD" };
  const cats = categories(parsed.data.category);
  if (!cats) return { ok: false, code: "INVALID_QUERY" };
  return {
    ok: true,
    query: {
      pickup,
      return: ret,
      sort: parsed.data.sort ?? "price-asc",
      category: cats,
      fuel: parsed.data.fuel,
      seats: parsed.data.seats,
    },
  };
}

/** Canonical query string: defaults left out, categories joined with commas. */
export function searchQueryString(q: SearchQuery): string {
  return offerQueryString(q, q);
}

/** Only the period, for links that keep the dates but drop the filters. */
export function periodQueryString(q: { pickup: string; return: string }): string {
  return new URLSearchParams({ pickup: q.pickup, return: q.return }).toString();
}

const QUARTER_MS = 15 * 60_000;

/**
 * Prefilled period (ASSUMPTION UX-2): pickup tomorrow 10:00, return two days later at the same time,
 * moved to the earliest allowed pickup (rounded up to 15 minutes) when the lead time needs it, and
 * stretched or shortened to stay within the rental-day limits.
 */
export function defaultPeriod(
  now: Date,
  timeZone: string,
  rules: PeriodRules,
): { pickup: string; return: string } {
  const tomorrow = `${addLocalDays(formatLocal(now, timeZone), 1).slice(0, 10)}T10:00`;
  const earliestMs = Math.ceil((now.getTime() + rules.leadTimeMinutes * 60_000) / QUARTER_MS);
  const earliest = formatLocal(new Date(earliestMs * QUARTER_MS), timeZone);
  const tomorrowAt = parseLocal(tomorrow, timeZone);
  const pickup =
    !tomorrowAt || tomorrowAt.getTime() < earliestMs * QUARTER_MS ? earliest : tomorrow;
  const extraDays = Math.min(Math.max(2, rules.minRentalDays - 1), rules.maxRentalDays - 1);
  return { pickup, return: addLocalDays(pickup, extraDays) };
}
