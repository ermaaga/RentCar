import type pg from "pg";

import { getEffectiveAccess, localDate } from "../../subscriptions";
import { dayKey, expiryKey, hourKey, type JobCounts, type JobName } from "../domain/catalogue";

// The job catalogue implemented so far (docs/06-backend-api.md 8.2). Each job lists its due periods
// and does the work for one period inside the transaction the runner opened for it.

export interface TenantTarget {
  id: string;
  slug: string;
  status: "active" | "suspended" | "terminated";
  timeZone: string;
}

/** Event emitted by a job; the runner forwards it to the logger (no PII, codes and ids only). */
export interface JobEvent {
  event: string;
  fields: Record<string, string | number>;
}

interface JobContext {
  now: Date;
  periodKey: string;
  emit(e: JobEvent): void;
}

interface PlatformJob {
  name: JobName;
  scope: "platform";
  periods(now: Date): string[];
  run(c: pg.PoolClient, ctx: JobContext): Promise<JobCounts>;
}

interface TenantJob {
  name: JobName;
  scope: "tenant";
  periods(c: pg.PoolClient, now: Date, tenant: TenantTarget): Promise<string[]>;
  run(c: pg.PoolClient, ctx: JobContext, tenant: TenantTarget): Promise<JobCounts>;
}

export type JobDefinition = PlatformJob | TenantJob;

const DAY_MS = 86_400_000;
const EXPIRED_KEEP_MS = 7 * DAY_MS;
const JOB_RUNS_KEEP_MS = 365 * DAY_MS;

interface SubscriptionRow {
  id: string;
  start_date: string;
  end_date: string;
  status: "active" | "cancelled";
}

/** The expired subscription (if the tenant is in grace or read-only expired), else none. */
async function expiredSubscription(
  c: pg.PoolClient,
  now: Date,
  tenant: TenantTarget,
): Promise<SubscriptionRow | undefined> {
  const res = await c.query<SubscriptionRow>(
    `SELECT id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
            status
       FROM subscriptions WHERE tenant_id = $1 AND status <> 'cancelled' ORDER BY end_date DESC`,
    [tenant.id],
  );
  const periods = res.rows.map((r) => ({
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
  }));
  const access = getEffectiveAccess(tenant, periods, now);
  if (access.state !== "grace" && access.state !== "read_only_expired") {
    return undefined;
  }
  const today = localDate(now, tenant.timeZone);
  return res.rows.find((r) => r.end_date < today);
}

const subscriptionExpiryNotice: TenantJob = {
  name: "subscription_expiry_notice",
  scope: "tenant",
  async periods(c, now, tenant) {
    const sub = await expiredSubscription(c, now, tenant);
    return sub ? [expiryKey(sub.id, sub.end_date)] : [];
  },
  run(_c, ctx, tenant) {
    // Expiry itself is derived (no state change, no mail): the job only records it once (8.2).
    const [, subscriptionId = "", endDate = ""] = ctx.periodKey.split(":");
    ctx.emit({
      event: "subscription.expired",
      fields: { tenantId: tenant.id, subscriptionId, endDate },
    });
    return Promise.resolve({ processed: 1, changed: 1 });
  },
};

const retentionHourly: PlatformJob = {
  name: "retention_hourly",
  scope: "platform",
  periods: (now) => [hourKey(now)],
  async run(c, ctx) {
    const res = await c.query("DELETE FROM rate_limit_buckets WHERE expires_at < $1", [ctx.now]);
    const deleted = res.rowCount ?? 0;
    return { processed: deleted, changed: deleted };
  },
};

const retentionDaily: PlatformJob = {
  name: "retention_daily",
  scope: "platform",
  periods: (now) => [dayKey(now)],
  async run(c, ctx) {
    const expiredBefore = new Date(ctx.now.getTime() - EXPIRED_KEEP_MS);
    const sessions = await c.query(
      "DELETE FROM sessions WHERE idle_expires_at < $1 OR absolute_expires_at < $1",
      [expiredBefore],
    );
    const tokens = await c.query("DELETE FROM credential_tokens WHERE expires_at < $1", [
      expiredBefore,
    ]);
    const runs = await c.query("DELETE FROM job_runs WHERE started_at < $1", [
      new Date(ctx.now.getTime() - JOB_RUNS_KEEP_MS),
    ]);
    const deleted = (sessions.rowCount ?? 0) + (tokens.rowCount ?? 0) + (runs.rowCount ?? 0);
    return { processed: deleted, changed: deleted };
  },
};

/** Registry order is execution order. */
export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  subscriptionExpiryNotice,
  retentionHourly,
  retentionDaily,
];
