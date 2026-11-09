import { billedDays } from "./pricing";

// Search/booking period rules (docs/06-backend-api.md 5.2, REQ-8): checked in this order, the first
// failure is returned as a stable code. Pure: `now` and the tenant rules are passed in.

export interface PeriodRules {
  minRentalDays: number;
  maxRentalDays: number;
  leadTimeMinutes: number;
}

export type PeriodError =
  | "RETURN_BEFORE_PICKUP"
  | "PICKUP_IN_PAST"
  | "LEAD_TIME_NOT_MET"
  | "PERIOD_TOO_FAR"
  | "DURATION_TOO_SHORT"
  | "DURATION_TOO_LONG";

const MAX_AHEAD_MS = 2 * 366 * 86_400_000;

export function checkPeriod(
  period: { start: Date; end: Date },
  rules: PeriodRules,
  ctx: { now: Date; timeZone: string },
): { ok: true; billedDays: number } | { ok: false; code: PeriodError } {
  const { start, end } = period;
  const now = ctx.now.getTime();
  if (end.getTime() <= start.getTime()) return { ok: false, code: "RETURN_BEFORE_PICKUP" };
  if (start.getTime() < now) return { ok: false, code: "PICKUP_IN_PAST" };
  if (start.getTime() < now + rules.leadTimeMinutes * 60_000) {
    return { ok: false, code: "LEAD_TIME_NOT_MET" };
  }
  if (start.getTime() > now + MAX_AHEAD_MS) return { ok: false, code: "PERIOD_TOO_FAR" };
  const days = billedDays(start, end, ctx.timeZone);
  if (days < rules.minRentalDays) return { ok: false, code: "DURATION_TOO_SHORT" };
  if (days > rules.maxRentalDays) return { ok: false, code: "DURATION_TOO_LONG" };
  return { ok: true, billedDays: days };
}
