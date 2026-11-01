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
- Every tenant table has `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_id = current_setting('app.tenant_id', true)::uuid`; default deny when the setting is missing.
- Each request/job step runs in an explicit transaction that starts with `SET LOCAL app.tenant_id`. Session-level `SET` is forbidden (lint + test) because it leaks across pooled connections.
- Runtime role is non-owner without BYPASSRLS; migration role differs.
- Tenant-less paths (system console, slug lookup, login lookup) use explicit system context (`app.scope = 'system'` policies on the few tables involved); jobs iterate tenants, each in its own scoped transaction.
- CI: generated cross-tenant matrix for every entity and route, and a DB-level test that the runtime role without the setting sees zero rows.
- Schema/database per tenant rejected: migration fan-out and cost for <50 small tenants.

## Consequences
- A forgotten filter yields empty results, not a leak.
- About one week extra initial effort (transaction wrapper, tests). Spike S1 validates it on Neon's pooler.
- Fallback if the chosen provider cannot support it: scoping-only plus tests, recorded as an accepted risk.
