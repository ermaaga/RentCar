import { localDayNumber } from "./local-time";

// price() (docs/02-requisiti.md FR-PUB-12, REQ-1, A-11): billed days are the calendar days the rental
// touches in the tenant time zone; a return at exactly 00:00 does not touch the new day; a same-day
// rental is one day. Total = days x daily price (final price, VAT included, REQ-13). Pure.

export function billedDays(start: Date, end: Date, timeZone: string): number {
  const lastInstant = new Date(end.getTime() - 1);
  return localDayNumber(lastInstant, timeZone) - localDayNumber(start, timeZone) + 1;
}

export interface Price {
  billedDays: number;
  dailyPriceMinor: number;
  totalMinor: number;
}

export function price(
  period: { start: Date; end: Date },
  dailyPriceMinor: number,
  timeZone: string,
): Price {
  const days = billedDays(period.start, period.end, timeZone);
  return { billedDays: days, dailyPriceMinor, totalMinor: days * dailyPriceMinor };
}
