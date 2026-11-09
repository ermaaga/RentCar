import type pg from "pg";

import { dispatchDue, failStaleCredentialRows, type OutboxScope } from "../../notifications";
import { dayKey, expiryKey, hourKey, type JobCounts } from "../domain/catalogue";
import type { JobContext, JobDefinition, PlatformJob, TenantJob, TenantTarget } from "./job-types";
import { renewalReminder } from "./renewal-reminder";
import { subscriptionState, type SubscriptionRow } from "./tenant-subscriptions";

export type { JobDefinition, JobEvent, JobMail, TenantTarget } from "./job-types";

// The job catalogue implemented so far (docs/06-backend-api.md 8.2). Each job lists its due periods
// and does the work for one period inside the transaction the runner opened for it.

const DAY_MS = 86_400_000;
const EXPIRED_KEEP_MS = 7 * DAY_MS;
const JOB_RUNS_KEEP_MS = 365 * DAY_MS;

/** The expired subscription (if the tenant is in grace or read-only expired), else none. */
async function expiredSubscription(
  c: pg.PoolClient,
  now: Date,
  tenant: TenantTarget,
): Promise<SubscriptionRow | undefined> {
  const { rows, access, today } = await subscriptionState(c, now, tenant);
  if (access.state !== "grace" && access.state !== "read_only_expired") {
    return undefined;
  }
  return rows.find((r) => r.end_date < today);
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

/** Dispatches due outbox rows of one scope and fails stale credential rows (8.2). */
async function outboxStep(ctx: JobContext, scope: OutboxScope): Promise<JobCounts> {
  const stale = await failStaleCredentialRows(ctx.pool, scope, ctx.now);
  if (!ctx.mail) {
    return { processed: stale, changed: stale };
  }
  const sent = await dispatchDue({ pool: ctx.pool, ...ctx.mail }, scope, ctx.now, 50);
  const processed = stale + sent.sent + sent.failed + sent.abandoned;
  return { processed, changed: stale + sent.sent + sent.abandoned };
}

const outboxTenant: TenantJob = {
  name: "email_outbox_dispatch",
  scope: "tenant",
  periods: (_c, now) => Promise.resolve([hourKey(now)]),
  run: (_c, ctx, tenant) => outboxStep(ctx, { kind: "tenant", tenantId: tenant.id }),
};

const outboxPlatform: PlatformJob = {
  name: "email_outbox_dispatch",
  scope: "platform",
  periods: (now) => [hourKey(now)],
  run: (_c, ctx) => outboxStep(ctx, { kind: "platform" }),
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
  renewalReminder,
  outboxTenant,
  outboxPlatform,
  retentionHourly,
  retentionDaily,
];
