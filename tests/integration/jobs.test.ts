import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { runDueJobs, type RunOptions } from "../../src/modules/jobs";
import type { JobDefinition, JobEvent } from "../../src/modules/jobs/infrastructure/definitions";
import { withTenantTx } from "../../src/platform/db/tenant-tx";

// JobRunner as the runtime role (docs/06-backend-api.md 8.1, 05-database 5.16, ABU-M1-26). `now` is in
// 2001 so the platform retention jobs only ever touch rows these tests created with older expiries.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 8 });

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

/** A distinct instant per test, so platform period keys never collide between tests or reruns. */
function past(): Date {
  const hours = Math.floor(Math.random() * 365 * 24);
  return new Date(Date.UTC(2001, 0, 15) + hours * 3_600_000);
}

function options(now: Date, extra: Partial<RunOptions> = {}): RunOptions & { events: JobEvent[] } {
  const events: JobEvent[] = [];
  return {
    now,
    budgetMs: 60_000,
    elapsedMs: () => 0,
    onEvent: (e) => events.push(e),
    events,
    ...extra,
  };
}

async function tenantWithSubscription(endDate: string): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `jb-${id.slice(0, 8)}`;
  await admin.query(
    "INSERT INTO tenants (id, slug, name, time_zone) VALUES ($1, $2, 'Jobs', 'Europe/Rome')",
    [id, slug],
  );
  await admin.query(
    `INSERT INTO subscriptions (id, tenant_id, max_vehicles, max_operators, start_date, end_date,
                                price_minor, price_currency)
     VALUES ($1, $2, 5, 1, '2000-01-01', $3, 1000, 'EUR')`,
    [randomUUID(), id, endDate],
  );
  return { id, slug };
}

async function runsFor(tenantId: string) {
  const res = await admin.query<{
    job: string;
    status: string;
    attempt: number;
    error: string | null;
  }>("SELECT job, status, attempt, error FROM job_runs WHERE tenant_id = $1 ORDER BY started_at", [
    tenantId,
  ]);
  return res.rows;
}

const RETENTION = ["retention_hourly", "retention_daily"] as const;

/** A tenant job that fails with division by zero for one tenant while `state.broken` is set. */
function flakyJob(failingId: string, healthyId: string, state: { broken: boolean }): JobDefinition {
  const key = `test:${randomUUID()}`;
  return {
    name: "subscription_expiry_notice",
    scope: "tenant",
    periods: (_c, _now, tenant) =>
      Promise.resolve(tenant.id === failingId || tenant.id === healthyId ? [key] : []),
    async run(c, _ctx, tenant) {
      if (state.broken && tenant.id === failingId) {
        await c.query("SELECT 1 / 0");
      }
      return { processed: 1, changed: 1 };
    },
  };
}

/** Rows that retention must delete: all expired or started long before `past()`. */
async function seedExpiredRows(tenantId: string) {
  const userId = randomUUID();
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, display_name, email)
     VALUES ($1, $2, 'admin', $3, 'Retained', 'r@example.test')`,
    [userId, tenantId, `ret-${userId.slice(0, 8)}`],
  );
  const bucket = randomBytes(32).toString("hex");
  await admin.query(
    `INSERT INTO rate_limit_buckets (key, window_start, count, expires_at)
     VALUES ($1, '2000-01-01', 1, '2000-01-01T01:00Z')`,
    [bucket],
  );
  await admin.query(
    `INSERT INTO sessions (id, tenant_id, realm, user_id, token_hash, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, 'tenant', $3, $4, '2000-12-01', '2000-12-01')`,
    [randomUUID(), tenantId, userId, randomBytes(32)],
  );
  await admin.query(
    `INSERT INTO credential_tokens (id, tenant_id, user_id, purpose, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, 'activation', $4, '2000-12-01', '2000-11-30')`,
    [randomUUID(), tenantId, userId, randomBytes(32)],
  );
  const oldRun = `old:${randomUUID()}`;
  await admin.query(
    `INSERT INTO job_runs (id, job, tenant_id, period_key, status, started_at, finished_at)
     VALUES ($1, 'retention_daily', $2, $3, 'succeeded', '1999-01-01', '1999-01-01')`,
    [randomUUID(), tenantId, oldRun],
  );
  return { userId, bucket, oldRun };
}

async function remaining(seeded: Awaited<ReturnType<typeof seedExpiredRows>>): Promise<number> {
  const res = await admin.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM rate_limit_buckets WHERE key = $1)
          + (SELECT count(*) FROM sessions WHERE user_id = $2)
          + (SELECT count(*) FROM credential_tokens WHERE user_id = $2)
          + (SELECT count(*) FROM job_runs WHERE period_key = $3) AS n`,
    [seeded.bucket, seeded.userId, seeded.oldRun],
  );
  return Number(res.rows[0]?.n);
}

describe.skipIf(!adminUrl || !appUrl)("subscription_expiry_notice", () => {
  it("notices an expired subscription once, even with five parallel calls", async () => {
    const t = await tenantWithSubscription("2000-12-31");
    const now = new Date("2001-03-01T10:00:00Z");
    const calls = Array.from({ length: 5 }, () =>
      options(now, { jobs: ["subscription_expiry_notice"], tenantSlug: t.slug }),
    );
    const results = await Promise.all(calls.map((o) => runDueJobs(app, o)));

    expect(results.reduce((n, r) => n + r.counts.succeeded, 0)).toBe(1);
    expect(results.every((r) => r.counts.failed === 0)).toBe(true);
    const notices = calls
      .flatMap((o) => o.events)
      .filter((e) => e.event === "subscription.expired");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.fields).toMatchObject({ tenantId: t.id, endDate: "2000-12-31" });
    expect(await runsFor(t.id)).toEqual([
      { job: "subscription_expiry_notice", status: "succeeded", attempt: 1, error: null },
    ]);
    const again = await runDueJobs(
      app,
      options(now, { jobs: ["subscription_expiry_notice"], tenantSlug: t.slug }),
    );
    expect(again.counts).toMatchObject({ succeeded: 0, alreadyDone: 1 });
  });

  it("does nothing for a subscription that is still running", async () => {
    const t = await tenantWithSubscription("2001-12-31");
    const now = new Date("2001-03-01T10:00:00Z");
    const only = { jobs: ["subscription_expiry_notice"] as const, tenantSlug: t.slug };
    const result = await runDueJobs(app, options(now, only));
    expect(result.counts.succeeded).toBe(0);
    expect(await runsFor(t.id)).toEqual([]);
  });
});

describe.skipIf(!adminUrl || !appUrl)("job runner failures and budget", () => {
  it("records a failure code, keeps other tenants going and retries next time", async () => {
    const failing = await tenantWithSubscription("2001-12-31");
    const healthy = await tenantWithSubscription("2001-12-31");
    const state = { broken: true };
    const job = flakyJob(failing.id, healthy.id, state);
    const now = past();

    const first = await runDueJobs(app, options(now, { definitions: [job] }));
    expect(first.counts).toMatchObject({ succeeded: 1, failed: 1 });
    expect(await runsFor(failing.id)).toEqual([
      { job: job.name, status: "failed", attempt: 1, error: "pg_22012" },
    ]);
    expect((await runsFor(healthy.id))[0]?.status).toBe("succeeded");

    state.broken = false;
    const second = await runDueJobs(app, options(now, { definitions: [job] }));
    expect(second.counts).toMatchObject({ succeeded: 1, alreadyDone: 1, failed: 0 });
    expect(await runsFor(failing.id)).toEqual([
      { job: job.name, status: "succeeded", attempt: 2, error: null },
    ]);
  });

  it("defers every step once the time budget is spent", async () => {
    const spent = { jobs: RETENTION, elapsedMs: () => 10_000, budgetMs: 8_000 };
    const result = await runDueJobs(app, options(past(), spent));
    expect(result.counts).toMatchObject({ succeeded: 0, deferred: 2 });
  });
});

describe.skipIf(!adminUrl || !appUrl)("retention jobs", () => {
  it("purges expired rate-limit buckets, sessions, credential tokens and old job runs", async () => {
    const t = await tenantWithSubscription("2001-12-31");
    const seeded = await seedExpiredRows(t.id);
    const result = await runDueJobs(app, options(past(), { jobs: RETENTION }));
    expect(result.counts).toMatchObject({ succeeded: 2, failed: 0 });
    expect(await remaining(seeded)).toBe(0);
  });

  it("never lets the tenant scope delete credential tokens or job runs", async () => {
    const t = await tenantWithSubscription("2001-12-31");
    await admin.query(
      `INSERT INTO job_runs (id, job, tenant_id, period_key, status, started_at, finished_at)
       VALUES ($1, 'retention_daily', $2, $3, 'succeeded', now(), now())`,
      [randomUUID(), t.id, `keep:${randomUUID()}`],
    );
    const deleted = await withTenantTx(app, t.id, async (c) => {
      const runs = await c.query("DELETE FROM job_runs WHERE tenant_id = $1", [t.id]);
      const tokens = await c.query("DELETE FROM credential_tokens WHERE tenant_id = $1", [t.id]);
      return (runs.rowCount ?? 0) + (tokens.rowCount ?? 0);
    });
    expect(deleted).toBe(0);
    expect((await runsFor(t.id)).length).toBe(1);
  });
});
