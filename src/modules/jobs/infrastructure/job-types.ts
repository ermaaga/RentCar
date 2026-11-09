import type pg from "pg";

import type { OutboxDeps } from "../../notifications";
import type { JobCounts, JobName } from "../domain/catalogue";

// Shapes shared by the runner and the job implementations (docs/06-backend-api.md 8.1).

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

/** Sending dependencies for mail jobs; absent in runs that must not send (then mail jobs only tidy). */
export type JobMail = Omit<OutboxDeps, "pool"> & {
  /** SYSTEM_ADMIN_EMAIL: the owner's address for platform reminders; absent means none is sent. */
  ownerEmail?: string | undefined;
};

export interface JobContext {
  /** For jobs that open their own short transactions (the outbox sends with no transaction open). */
  pool: pg.Pool;
  now: Date;
  periodKey: string;
  emit(e: JobEvent): void;
  mail?: JobMail | undefined;
}

export interface PlatformJob {
  name: JobName;
  scope: "platform";
  periods(now: Date): string[];
  run(c: pg.PoolClient, ctx: JobContext): Promise<JobCounts>;
}

export interface TenantJob {
  name: JobName;
  scope: "tenant";
  periods(c: pg.PoolClient, now: Date, tenant: TenantTarget): Promise<string[]>;
  run(c: pg.PoolClient, ctx: JobContext, tenant: TenantTarget): Promise<JobCounts>;
}

export type JobDefinition = PlatformJob | TenantJob;
