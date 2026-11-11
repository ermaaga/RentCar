# M2 review: code, security, QA and observability (light review)

Version 1.0 · 2026-11-11 · Reviewer: PM (Claude), light review as for M1 (`m1-review.md`) instead of the four review agents · Scope: M2 code, PR #40 to #48 and the branch `claude/funny-planck-05ile7` (SEO baseline, FLT-08, performance gates)

This is **not** the formal quality loop of `13-piano-implementazione.md` §4. It records what was checked, what was fixed and what stays open, so the formal review and the cybersecurity-manager sign-off can start from it.

## 1. Method

- Re-read of the M2 entry points (public search, booking page and submit, confirmation and PDF, vehicle admin, photo upload, cover, reorder, delete, `/media`) against `06-backend-api.md` (FLT, BKG, NTF) and `08-security.md` (SR-VAL, SR-RL, SR-UPL, SR-PDF, ABU-M2-*).
- Traceability of the 22 M2 abuse cases to tests: `tests/security/abuse-cases-m2.test.ts` (13 automated, 8 partial with the gap stated, 1 pending).
- Observability against the event registry of `12-osservabilita.md`.
- All automated checks green: format, lint, typecheck, dependency-cruiser, jscpd, knip; 470 Vitest tests (unit, integration on Postgres 16, security); 44 Playwright tests at desktop, 375 and 320 px with axe; JS budget and Lighthouse (`docs/test-reports/m2-performance.md`); SEO checks (`m2-seo-check.md`).

## 2. Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| R1 | Medium | Public booking names and phone were only trimmed: no NFC, and control characters, NUL, CR/LF and bidi overrides (U+202E) were accepted (SR-VAL-04, ABU-M2-05) | **Fixed**: `src/shared/text.ts` (`singleLineText`, `hasControl`, now also C1 controls and U+2028/2029) used by the booking and vehicle inputs; unit tests |
| R2 | Medium | No booking events in the logs: `public.booking.submitted`, `booking.created`, `booking.conflict`, `booking.failed`, `pdf.failed` were missing, and an unexpected submit error became "try again" with no trace at all (the booking SLI could not be computed) | **Fixed**: the events are logged with ids and codes only; `booking.failed` carries the SQLSTATE or error name, never the message (Postgres details can hold customer data). Checked on a local E2E run: no phone or email in the log |
| R3 | Low | Booking submit threw (HTTP 500) when the rate-limit store was down, instead of failing closed with a friendly message (SR-RL-04, ABU-M2-02) | **Fixed**: the action answers "try again" and books nothing |
| R4 | Low | The confirmation page and the PDF route counted RL-03 misses under different keys (tenant id vs slug), doubling the misses an attacker gets | **Fixed**: both use slug + IP |
| R5 | Low | Several abuse cases are only partly automated (route-level PDF 404/429 headers, encoded traversal on `/media`, parallel idempotent replays, store-down paths, stale form on a suspended tenant) | Open: gaps listed in the traceability test |
| R6 | Info | SR-VAL-11 asks for Luhn-valid 15-19 digit sequences; the vehicle notes rule refuses any 13-19 digit sequence (stricter, short numbers still accepted) | Accepted (safer; revisit if users complain) |
| R7 | Info | Tenant logo (PDF, Open Graph, ABU-M2-12/14 logo parts) and expenses (ABU-M2-18 part) belong to M5 and M4 | Scope |
| R8 | Info | ABU-M2-17 (bucket ACLs) needs the s3 adapter and a host | Pending (pre-GATE 4) |

## 3. What looks right

- Tenant isolation: every query is tenant-scoped and runs in `withTenantTx`; the exclusion constraint and ascending locks hold under 50 parallel bookings (spike S5); availability never shows another tenant's or archived vehicles.
- Public booking: signed form token with minimum fill time and honeypot (silent decoy), strict schema, price and rules recomputed server-side, idempotent replay, customer never overwritten, at most 3 open bookings per phone.
- Uploads: magic-byte detection, pixel and frame limits, re-encoding to WebP without metadata, size cap before and while reading, server-built keys, per-vehicle and per-tenant limits, objects cleaned up on failure and delete; `/media` rebuilds the key from captured groups and serves with `nosniff` and a sandbox CSP.
- PDF: tenant + code lookup, identical 404s, RL-03, `private, no-store`, no network during rendering.
- Email: HTML escaped, no customer data in subjects, 3 confirmations a day per address.
- Public pages: no third-party requests, JS within budget, Lighthouse timings well within NFR-PERF-01.

## 4. Recommendation

M2 can be considered **functionally complete**. R1 to R4 are fixed in this branch. Before closing it formally: the cybersecurity-manager sign-off (with R5 to R8 recorded as accepted gaps or scheduled work), and the user's decision on whether the formal four-agent quality loop is required or this light review is enough, as for M1.
