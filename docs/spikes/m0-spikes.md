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

## S1: RLS with a transaction pooler on a real external Postgres (not done)

- Requires a free external Postgres in an EU region with synthetic data (CSM-5). The user has not decided. Local RLS template is verified (`tests/integration/rls.test.ts`), but pooler behaviour (ABU-M0-04, ABU-M0-05) is not.
- Blocking before M3 only (recommendation of the GATE 3 sign-off).
