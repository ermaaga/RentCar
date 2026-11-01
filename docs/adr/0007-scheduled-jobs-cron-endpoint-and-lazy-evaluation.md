# ADR-0007: Scheduled jobs through an authenticated endpoint plus lazy evaluation

- Status: proposed
- Date: 2026-11-01
- Deciders: user (GATE 2), solution-architect

## Context
Needed: automatic booking status transitions, subscription expiry markers and reminders, year-end snapshots, email retries, yearly privacy reminder, rate-limit purge (FR-PLT-05). Must work in Docker and on Vercel, idempotent and safe concurrently; Vercel Hobby crons run once per day with +-59 min precision (checked 2026-11-01); Pro allows per-minute. No background threads on serverless.

## Options considered
1. Authenticated endpoint `/api/jobs/run` triggered by any scheduler, plus lazy evaluation on read.
2. In-process timers (`node-cron`) started in the app (breaks on serverless).
3. Managed queue/workflow product (Vercel Queues/Workflows, Inngest, Trigger.dev): extra vendor or Vercel-specific API.
4. Postgres-based job queue (pg-boss) with a long-running worker (needs a worker process, not serverless).

## Decision
Option 1.
- Port `JobScheduler` / use case `runDueJobs(now)`; each job is idempotent and keyed by `(job, tenant, period)` in `JobRun` with a unique constraint plus `pg_try_advisory_xact_lock`; concurrent calls do not duplicate effects (US-123).
- Endpoint accepts GET (Vercel Cron) and POST, requires `Authorization: Bearer ${CRON_SECRET}` (constant-time compare, separate from `SESSION_SECRET`), returns counts only.
- Triggers: Vercel Cron hourly (Pro), Compose sidecar loop locally, GitHub Actions cron as universal fallback or backup trigger.
- Lazy evaluation: effective booking status derived from time on read (manual overrides respected, A-25); subscription grace derived; year snapshot created on first access if missing (RK-8/RK-9); reminders are the only strictly job-driven effect.
- Cadence hourly (not 5 minutes) so a free Neon compute can suspend between runs.

## Consequences
- Missed or duplicated runs cannot corrupt data; worst case is a delayed reminder.
- A secret-protected endpoint must be in the security test plan; no state change on unauthenticated GET.
- Revisit with a queue only if volume or latency needs grow.
