// Job names and period keys (docs/06-backend-api.md 8.2). Pure: `now` is passed in. Keys are UTC so
// every invocation in the same hour or day agrees on the period, whatever host runs it.

export const JOB_NAMES = [
  "email_outbox_dispatch",
  "subscription_expiry_notice",
  "retention_hourly",
  "retention_daily",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Hourly period key, e.g. 2026-11-09T14. */
export function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** Daily period key, e.g. 2026-11-09. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Expiry key: a new end date (renewal) yields a new key, so a later expiry is noticed again. */
export function expiryKey(subscriptionId: string, endDate: string): string {
  return `subexp:${subscriptionId}:${endDate}`;
}

/** Lock key for pg_try_advisory_xact_lock: one holder per (job, tenant, period). */
export function lockKey(job: JobName, tenantId: string | null, periodKey: string): string {
  return `job:${job}:${tenantId ?? "platform"}:${periodKey}`;
}

export interface JobCounts {
  processed: number;
  changed: number;
}

/** Totals returned by one invocation: counts only, never data (JOB-01). */
export interface RunTotals {
  succeeded: number;
  failed: number;
  skipped: number;
  alreadyDone: number;
  deferred: number;
}
