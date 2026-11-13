# M0 spikes: results

Version 1.0 · 2026-11-08 · Owner: frontend-developer and database-architect (M0 work) · Status: M0 outcome

## S-FE-1: Next.js JavaScript weight (done)

- Method: `pnpm build`, then gzip size of the JavaScript files listed in `.next/build-manifest.json` for the home route.
- Result, M0 scaffold (one page, no feature code): 4 files, 434 kB raw, **129 kB gzip** (framework included).
- Reading: this is the floor. It leaves room for the booking flow budget (NFR-PERF-01) to be checked in M2 when real pages exist. No action now.

## S-FE-3: CSP versus Radix inline `style=` (open, decided by M5)

- Current policy (`next.config.ts`): `script-src 'self' 'unsafe-inline'` and `style-src 'self' 'unsafe-inline'`, no remote origins. Accepted for M0 as a temporary gap.
- Question: can the policy drop `'unsafe-inline'` for styles while Radix/shadcn sets `style=` attributes?
- Not measured yet: Radix is not installed in M0. The spike runs in M1 when the first Radix component lands, with a nonce or hash strategy. Until then the gap stays in the register.

## S1: RLS with a transaction pooler (local part done 2026-11-13; provider part open, CSM-5)

- **Local part (done)**: `tests/security/guc-bleed.test.ts` runs the runtime role through PgBouncer 1.22 in transaction mode with **two** server connections (`tests/security/pgbouncer/start.sh`), so transactions of different tenants share server connections. It checks that 40 transactions run on at most 2 backends (multiplexing really happens); that after a commit, a rollback and an SQL error the next statement on the same pooler sees no `app.tenant_id` and no vehicle rows (ABU-M0-04); and that 1,000 concurrent transactions alternating tenants A and B return zero foreign rows (ABU-M0-05). Runs in the CI integration job (`GUC_BLEED_VOLUME=1000`, about 3 s).
- **The test catches the fault it targets**: with `set_config('app.tenant_id', $1, false)` (session level) the ABU-M0-04 case fails. The same mutant also left a real tenant id on a pooled server connection after the run, which the next client inherited until PgBouncer was restarted: the exact bleed the transaction-local rule prevents.
- **Provider part (open)**: the same test against the chosen provider's pooler and roles (Neon or Supabase, EU region, synthetic data), plus S3/S4, still needs the user's decision CSM-5. Until then R-PLAN-02 stays open with this local evidence as mitigation.
