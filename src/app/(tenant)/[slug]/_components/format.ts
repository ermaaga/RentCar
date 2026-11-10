import { formatMessage, getTranslator } from "@/i18n";
import type { PeriodError } from "@/modules/booking";

// Display helpers for the public pages (docs/04a-ux.md 6.4): amounts in the tenant currency, local
// date-times shown as written (they already are tenant-local), durations in plain words.

/** "2026-06-03T10:00" -> "Wed 03 Jun 2026, 10:00" (the string is already in the tenant zone). */
export function localLabel(value: string): string {
  const [date = "", time = ""] = value.split("T");
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${day}, ${time}`;
}

export function leadLabel(minutes: number): string {
  const t = getTranslator();
  if (minutes >= 60 && minutes % 60 === 0) {
    return formatMessage(t("public.search.hours"), { n: minutes / 60 });
  }
  return formatMessage(t("public.search.minutes"), { n: minutes });
}

export type SearchErrorCode =
  | PeriodError
  | "INVALID_LOCAL_TIME"
  | "MISSING_PERIOD"
  | "INVALID_QUERY"
  | "RATE_LIMITED"
  | "FAILED";

const CODES: readonly SearchErrorCode[] = [
  "RETURN_BEFORE_PICKUP",
  "PICKUP_IN_PAST",
  "LEAD_TIME_NOT_MET",
  "PERIOD_TOO_FAR",
  "DURATION_TOO_SHORT",
  "DURATION_TOO_LONG",
  "INVALID_LOCAL_TIME",
  "MISSING_PERIOD",
  "INVALID_QUERY",
  "RATE_LIMITED",
  "FAILED",
];

export function asSearchError(value: unknown): SearchErrorCode | undefined {
  return CODES.find((c) => c === value);
}

export function searchErrorText(
  code: SearchErrorCode,
  rules: { minRentalDays: number; maxRentalDays: number; leadTimeMinutes: number },
): string {
  const t = getTranslator();
  return formatMessage(t(`public.searchError.${code}`), {
    lead: leadLabel(rules.leadTimeMinutes),
    min: rules.minRentalDays,
    max: rules.maxRentalDays,
  });
}

export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
}

export function daysText(n: number): string {
  const t = getTranslator();
  return n === 1 ? t("public.results.dayOne") : formatMessage(t("public.results.days"), { n });
}
