import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withSystemTx } from "../../../platform/db/system-tx";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import { lockKey, type JobCounts, type JobName, type RunTotals } from "../domain/catalogue";
import {
  JOB_DEFINITIONS,
  type JobDefinition,
  type JobEvent,
  type TenantTarget,
} from "./definitions";

// JobRunner.runDueJobs (docs/06-backend-api.md 8.1, 05-database 5.16). Every (job, tenant, period) step
// runs in its own transaction: advisory try-lock, then the job_runs row claimed with an upsert that
// only succeeds when no succeeded row exists, then the work. A failure rolls back and a second short
// transaction records `failed` with an error code, so the next invocation retries it.

export interface RunOptions {
  now: Date;
  jobs?: readonly JobName[] | undefined;
  tenantSlug?: string | undefined;
  budgetMs: number;
  /** Milliseconds since the invocation started (monotonic), for the time budget. */
  elapsedMs: () => number;
  onEvent?: (e: JobEvent) => void;
  /** Catalogue override for tests; production always uses JOB_DEFINITIONS. */
  definitions?: readonly JobDefinition[];
}

export interface RunResult {
  runId: string;
  counts: RunTotals;
}

type Scope = { kind: "platform" } | { kind: "tenant"; tenant: TenantTarget };

interface Step {
  job: JobDefinition;
  scope: Scope;
  periodKey: string;
}

type StepOutcome = "succeeded" | "failed" | "skipped" | "alreadyDone";

function withScope<T>(
  pool: pg.Pool,
  scope: Scope,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return scope.kind === "tenant" ? withTenantTx(pool, scope.tenant.id, fn) : withSystemTx(pool, fn);
}

function tenantIdOf(scope: Scope): string | null {
  return scope.kind === "tenant" ? scope.tenant.id : null;
}

/** Error code stored in job_runs: SQLSTATE for database errors, never a message (may hold data). */
function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? `pg_${code}` : "job_error";
}

async function listTenants(pool: pg.Pool, slug: string | undefined): Promise<TenantTarget[]> {
  return withSystemTx(pool, async (c) => {
    const res = await c.query<{
      id: string;
      slug: string;
      status: TenantTarget["status"];
      time_zone: string;
    }>(
      `SELECT id, slug, status, time_zone FROM tenants
        WHERE status IN ('active', 'suspended', 'terminated') AND ($1::text IS NULL OR slug = $1)
        ORDER BY created_at, id`,
      [slug ?? null],
    );
    return res.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      status: r.status,
      timeZone: r.time_zone,
    }));
  });
}

async function planJob(
  pool: pg.Pool,
  job: JobDefinition,
  tenants: readonly TenantTarget[],
  options: RunOptions,
): Promise<Step[]> {
  if (job.scope === "platform") {
    if (options.tenantSlug) {
      return [];
    }
    return job
      .periods(options.now)
      .map((periodKey) => ({ job, scope: { kind: "platform" }, periodKey }));
  }
  const steps: Step[] = [];
  for (const tenant of tenants) {
    try {
      const keys = await withTenantTx(pool, tenant.id, (c) => job.periods(c, options.now, tenant));
      for (const periodKey of keys) {
        steps.push({ job, scope: { kind: "tenant", tenant }, periodKey });
      }
    } catch (err) {
      // A tenant whose planning fails is retried by the next invocation; the others go on.
      options.onEvent?.({
        event: "job.failed",
        fields: { job: job.name, tenantId: tenant.id, error: errorCode(err) },
      });
    }
  }
  return steps;
}

async function work(c: pg.PoolClient, step: Step, options: RunOptions): Promise<JobCounts> {
  const ctx = {
    now: options.now,
    periodKey: step.periodKey,
    emit: (e: JobEvent) => options.onEvent?.(e),
  };
  if (step.job.scope === "platform") {
    return step.job.run(c, ctx);
  }
  if (step.scope.kind !== "tenant") {
    throw new Error("tenant job planned without a tenant");
  }
  return step.job.run(c, ctx, step.scope.tenant);
}

async function claimAndRun(pool: pg.Pool, step: Step, options: RunOptions): Promise<StepOutcome> {
  const tenantId = tenantIdOf(step.scope);
  return withScope(pool, step.scope, async (c) => {
    const lock = await c.query<{ got: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS got",
      [lockKey(step.job.name, tenantId, step.periodKey)],
    );
    if (!lock.rows[0]?.got) {
      return "skipped";
    }
    const claimed = await c.query<{ id: string }>(
      `INSERT INTO job_runs (id, job, tenant_id, period_key, status, attempt, started_at, finished_at)
       VALUES ($1, $2, $3, $4, 'succeeded', 1, $5, $5)
       ON CONFLICT (job, tenant_id, period_key) DO UPDATE
         SET status = 'succeeded', attempt = job_runs.attempt + 1, started_at = EXCLUDED.started_at,
             finished_at = EXCLUDED.finished_at, error = NULL
       WHERE job_runs.status <> 'succeeded'
       RETURNING id`,
      [randomUUID(), step.job.name, tenantId, step.periodKey, options.now],
    );
    const runRow = claimed.rows[0];
    if (!runRow) {
      return "alreadyDone";
    }
    const counts = await work(c, step, options);
    await c.query("UPDATE job_runs SET counts = $2 WHERE id = $1", [
      runRow.id,
      JSON.stringify(counts),
    ]);
    return "succeeded";
  });
}

async function recordFailure(pool: pg.Pool, step: Step, now: Date, code: string): Promise<void> {
  await withScope(pool, step.scope, (c) =>
    c.query(
      `INSERT INTO job_runs (id, job, tenant_id, period_key, status, attempt, started_at, finished_at, error)
       VALUES ($1, $2, $3, $4, 'failed', 1, $5, $5, $6)
       ON CONFLICT (job, tenant_id, period_key) DO UPDATE
         SET status = 'failed', attempt = job_runs.attempt + 1, started_at = EXCLUDED.started_at,
             finished_at = EXCLUDED.finished_at, error = EXCLUDED.error
       WHERE job_runs.status <> 'succeeded'`,
      [randomUUID(), step.job.name, tenantIdOf(step.scope), step.periodKey, now, code],
    ),
  );
}

function stepFields(step: Step): Record<string, string> {
  const tenantId = tenantIdOf(step.scope);
  return {
    job: step.job.name,
    periodKey: step.periodKey,
    ...(tenantId ? { tenantId } : {}),
  };
}

async function runStep(pool: pg.Pool, step: Step, options: RunOptions): Promise<StepOutcome> {
  const emit = (event: string, extra: Record<string, string> = {}) =>
    options.onEvent?.({ event, fields: { ...stepFields(step), ...extra } });
  try {
    const outcome = await claimAndRun(pool, step, options);
    if (outcome === "succeeded") {
      emit("job.finished");
    }
    return outcome;
  } catch (err) {
    // One tenant's failure never stops the others (SR-JOB-04).
    const code = errorCode(err);
    await recordFailure(pool, step, options.now, code).catch(() => undefined);
    emit("job.failed", { error: code });
    return "failed";
  }
}

/** Runs every due step in registry order until the time budget is spent. Counts only, no data. */
export async function runDueJobs(pool: pg.Pool, options: RunOptions): Promise<RunResult> {
  const runId = randomUUID();
  const counts: RunTotals = { succeeded: 0, failed: 0, skipped: 0, alreadyDone: 0, deferred: 0 };
  const selected = (options.definitions ?? JOB_DEFINITIONS).filter(
    (j) => !options.jobs || options.jobs.includes(j.name),
  );
  options.onEvent?.({ event: "job.started", fields: { runId } });
  const tenants = selected.some((j) => j.scope === "tenant")
    ? await listTenants(pool, options.tenantSlug)
    : [];
  for (const job of selected) {
    if (options.elapsedMs() >= options.budgetMs) {
      counts.deferred += 1;
      continue;
    }
    const steps = await planJob(pool, job, tenants, options);
    for (const step of steps) {
      if (options.elapsedMs() >= options.budgetMs) {
        counts.deferred += 1;
        continue;
      }
      counts[await runStep(pool, step, options)] += 1;
    }
  }
  options.onEvent?.({ event: "job.run", fields: { runId, ...counts } });
  return { runId, counts };
}
