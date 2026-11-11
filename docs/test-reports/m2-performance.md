# M2 performance: public pages (NFR-PERF-01)

Version 1.0 · 2026-11-11 · Measured by: PM (Claude) · Fixture: `perf-rent`, 30 vehicles each with a cover photo (`scripts/seed-perf.ts`)

## 1. Method

- **JS budget (PR gate)**: `tests/e2e/perf/js-budget.spec.ts`. Each page loads in a fresh browser context (cold cache) and the encoded (gzip) body sizes of every script are summed. Budgets from `docs/07-frontend.md` 13.1. The spec also fails on any request to another origin (FR-PUB-13). It runs in the CI E2E job, which now starts Compose with the `perf` profile and waits for the fixture.
- **Timings (nightly)**: Lighthouse CI 0.16.0 (`tests/perf/lighthouserc.cjs`, workflow `nightly-perf.yml`): Lighthouse's default mobile profile (simulated slow 4G, 4x CPU), 5 runs per URL, assertions on the median. TBT stands in for INP in the lab. Reports stay on disk and become a workflow artifact; nothing goes to a third-party server.
- Local run: production build (`next build` + `next start`), Postgres 16, same machine as the browser. TTFB therefore excludes real network and the database cold start (SEO-6); it must be measured again on staging.

## 2. Results (2026-11-11, local)

| Page | Script (gzip, cold) | Budget | LCP (median) | CLS | TBT | TTFB | Lighthouse perf / a11y / best practices |
|---|---|---|---|---|---|---|---|
| `/{slug}` | 136.1 kB | 150 kB (target 125) | 0.80 s | 0 | 115 ms | 17 ms | 0.99 / 1.00 / 1.00 |
| `/{slug}/vehicles` (30 cars) | 144.7 kB | 170 kB | 0.78 s | 0 | 57 ms | 29 ms | 1.00 / 1.00 / 1.00 |
| `/{slug}/book` | 143.8 kB | 200 kB | not run | | | | |

Budgets in NFR-PERF-01: LCP <= 2.5 s, CLS <= 0.1, INP <= 200 ms (TBT <= 200 ms as the lab proxy), TTFB <= 800 ms. All met. The SEO score is 0.66 only because `PUBLIC_INDEXING_ENABLED` is off (noindex), which is expected outside production.

The gate was checked failing-then-passing: with the root budget lowered to 100 kB the spec failed with 139,383 bytes received.

## 3. Fixed during the measurement

| # | Finding | Fix |
|---|---|---|
| P1 | `/favicon.ico` answered 404 on every page (console error, best practices 0.96) | Platform favicon `src/app/icon.svg` (09-seo section 9: the platform favicon is enough) |
| P2 | Results page skipped from H1 to the H3 card names (Lighthouse `heading-order`, a11y 0.98) | The live vehicle count is now the H2 above the cards (`role="status"` kept inside) |

## 4. Open

| # | Item | Status |
|---|---|---|
| O1 | Root JS is 136 kB against the 125 kB target (the 150 kB budget is met); most of it is the Next.js/React runtime | Watch; revisit in M6 performance polish |
| O2 | Lighthouse on the booking form and the confirmation page (need a vehicle id and a booking created per run) | Open: add a Lighthouse user flow when a booking fixture exists |
| O3 | TTFB and LCP over a real network and a pooled, possibly cold, database | Open until staging (QR-1, SEO-6) |
| O4 | INP measured with `web-vitals` in a scripted interaction (10-test-plan section 10) | Open; TBT is the lab proxy for now |
