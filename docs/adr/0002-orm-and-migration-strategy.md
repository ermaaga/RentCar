# ADR-0002: ORM and migration strategy (Drizzle, migrate outside cold start)

- Status: proposed
- Date: 2026-11-01
- Deciders: user (GATE 2), solution-architect

## Context
Spec allows Prisma or Drizzle. Needs: PostgreSQL features not covered by most ORMs (exclusion constraint, `tstzrange`, `btree_gist`, RLS, triggers), serverless-friendly footprint, `DATABASE_URL` swap (AC10), automatic migrations in `docker compose up` (AC1), safe behaviour with transaction-mode poolers.

## Options considered
1. **Drizzle ORM + `pg` + drizzle-kit** (SQL-first migrations, custom SQL files, `tstzrange` via custom type, `sql` template for `set_config`).
2. **Prisma 7** (Rust-free client, `prisma-client` generator, `@prisma/adapter-pg`): mature DX and tooling; cannot model exclusion constraints or `tstzrange` (needs `Unsupported` + raw SQL), RLS requires a client extension per operation; generated client adds bundle weight and drift warnings.
3. Query builder only (Kysely) with hand-written migrations.

## Decision
Option 1 (Drizzle + node-postgres). Migration files are reviewed SQL committed to the repo; non-modelled objects are hand-written SQL migrations. Migration runner is a small script using Drizzle's migrator under `pg_advisory_lock`.
- Local/Compose: one-shot `migrate` service runs before `app` (`service_completed_successfully`); seed is a separate dev-profile service that refuses production mode without a flag.
- Production (serverless): migrations run in CI against `DIRECT_DATABASE_URL` (non-pooled) *before* the new deployment is promoted; never on function cold start. Expand/contract discipline because old and new versions overlap.
- Runtime role differs from the migration role (no DDL, not owner) for RLS.

## Consequences
- SQL-close code is easy to review for tenant scoping and the exclusion constraint.
- Smaller serverless bundle than Prisma; permissive licence (Apache-2.0).
- Less tooling polish than Prisma Studio/Migrate; accepted.
- Option B (Prisma 7) remains viable but costs friction on RLS and constraints.
- Swapping ORM later is contained to repository implementations (ADR-0001).
