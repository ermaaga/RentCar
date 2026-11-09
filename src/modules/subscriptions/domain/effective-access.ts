// Effective access of a tenant (docs/06-backend-api.md 4.4, FR-ENF-01, REQ-5). Pure: no I/O, `now`
// passed in. Dates are local calendar dates (YYYY-MM-DD) in the tenant time zone; `endDate` is inclusive.

const RENEWAL_NOTICE_DAYS = 14;
const GRACE_DAYS = 7;

export interface SubscriptionPeriod {
  startDate: string;
  endDate: string;
  status: "active" | "cancelled";
}

export interface TenantAccessInput {
  status: "active" | "suspended" | "terminated";
  timeZone: string;
}

export type EffectiveAccess =
  | { state: "active" }
  | { state: "renewal_due"; daysLeft: number }
  | { state: "grace"; graceEndsOn: string }
  | { state: "read_only_expired" | "read_only_cancelled" | "read_only_no_subscription" }
  | { state: "suspended" | "terminated" };

const DAY_MS = 86_400_000;

/** Local calendar date of `now` in `timeZone`, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dayNumber(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The subscription that decides access: the one containing today, else the latest by end date. */
function currentSubscription(
  subscriptions: readonly SubscriptionPeriod[],
  today: string,
): SubscriptionPeriod | undefined {
  const live = subscriptions.filter((s) => s.status !== "cancelled");
  const containing = live.find((s) => s.startDate <= today && today <= s.endDate);
  if (containing) {
    return containing;
  }
  const latest = [...live].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  return latest ?? subscriptions[0];
}

function accessFor(subscription: SubscriptionPeriod, today: string): EffectiveAccess {
  if (subscription.status === "cancelled") {
    return { state: "read_only_cancelled" };
  }
  const daysLeft = dayNumber(subscription.endDate) + 1 - dayNumber(today);
  if (daysLeft > RENEWAL_NOTICE_DAYS) {
    return { state: "active" };
  }
  if (daysLeft > 0) {
    return { state: "renewal_due", daysLeft };
  }
  const graceEnd = dayNumber(subscription.endDate) + 1 + GRACE_DAYS;
  if (dayNumber(today) < graceEnd) {
    return { state: "grace", graceEndsOn: fromDayNumber(graceEnd) };
  }
  return { state: "read_only_expired" };
}

export function getEffectiveAccess(
  tenant: TenantAccessInput,
  subscriptions: readonly SubscriptionPeriod[],
  now: Date,
): EffectiveAccess {
  if (tenant.status !== "active") {
    return { state: tenant.status };
  }
  const today = localDate(now, tenant.timeZone);
  const subscription = currentSubscription(subscriptions, today);
  if (!subscription) {
    return { state: "read_only_no_subscription" };
  }
  return accessFor(subscription, today);
}

/** Whether the public booking path is open (FR-ENF-01). */
export function canTakeBookings(access: EffectiveAccess): boolean {
  return access.state === "active" || access.state === "renewal_due" || access.state === "grace";
}

export type WriteClass = "read" | "write" | "ro_allowed";

export type WriteDecision =
  { ok: true } | { ok: false; code: "TENANT_UNAVAILABLE" | "TENANT_READ_ONLY" };

/** The single read-only policy (docs/06-backend-api.md 4.4), called by every entry point. */
export function assertWritable(access: EffectiveAccess, writeClass: WriteClass): WriteDecision {
  if (access.state === "suspended" || access.state === "terminated") {
    return { ok: false, code: "TENANT_UNAVAILABLE" };
  }
  if (writeClass === "write" && access.state.startsWith("read_only_")) {
    return { ok: false, code: "TENANT_READ_ONLY" };
  }
  return { ok: true };
}
