# ADR-0003: Tenant isolation by scoped repositories plus PostgreSQL RLS

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01)
- Deciders: user (GATE 2, question ARC-3), solution-architect, security-engineer

## Context
Cross-tenant leakage is the main product risk (KPI-5, NFR-ISO-01). Spec requires every query scoped by `tenantId` and cross-tenant tests. Security input recommends RLS as defence in depth. Production uses a pooled connection (transaction mode).

## Options considered
1. Application-level scoping only (repository layer).
2. RLS only.
3. Both: scoped repositories (primary, mandatory) and RLS (backstop).
4. Schema-per-tenant or database-per-tenant.

## Decision
Option 3. 
- Repositories are created only from a `TenantScope` (tenant id from session or resolved tenant, never from input); no repository method accepts a raw tenant id from callers.
- Every tenant table has `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`; default deny when the setting is missing. The `NULLIF` is mandatory: after a transaction ends, a reused pooled connection keeps the GUC as an empty string (not unset), and a bare `''::uuid` cast raises an error instead of returning zero rows (verified by the database-architect, `docs/05-database.md`). A test covers the empty-GUC case on a reused connection.
- Each request/job step runs in an explicit transaction that starts with `SET LOCAL app.tenant_id`. Session-level `SET` is forbidden (lint + test) because it leaks across pooled connections.
- Runtime role is non-owner without BYPASSRLS; migration role differs.
- Tenant-less paths use the transaction-local GUC `app.scope`, with exactly five non-tenant values: `resolve` (slug lookup), `system_auth` (systemadmin login, not yet authenticated), `system` (authenticated systemadmin console), `job` and `bootstrap` (CLI creating the first systemadmin). `withTenant` sets `app.tenant_id` (scope `tenant`); `withSystemTx(scope)` sets `app.scope` (and `app.actor_id`) and never `app.tenant_id`; the two are mutually exclusive. Which scope may touch which table and command is the table x command matrix in `docs/05-database.md` section 4.5 (the single source of truth, mirrored in `tests/security/rls-matrix.ts` and compared with `pg_policies` in CI). No non-tenant scope has any policy on customers, bookings, vehicles, expenses or snapshots. This replaces the earlier wording `app.scope = 'system'` / `app.system_actor`. Jobs list tenants under scope `job`, then process each tenant in its own `withTenant` transaction.
- Database roles: `rentcar_owner` (NOLOGIN, owns objects), `rentcar_migrator` (LOGIN, member of owner, runs migrations on the direct connection), `rentcar_app` (runtime, non-owner, no BYPASSRLS), `rentcar_backup` (read-only dump role).
- CI: generated cross-tenant matrix for every entity and route, and a DB-level test that the runtime role without the setting sees zero rows.
- Schema/database per tenant rejected: migration fan-out and cost for <50 small tenants.

## Consequences
- A forgotten filter yields empty results, not a leak.
- About one week extra initial effort (transaction wrapper, tests). Spike S1 validates it on Neon's pooler.
- Fallback if the chosen provider cannot support it: scoping-only plus tests, recorded as an accepted risk.
