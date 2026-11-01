# Test plan: RentCar (multi-tenant car rental SaaS)

Version 1.0 · 2026-11-01 · Author: qa-engineer · Mode: analysis (no test written or executed yet)
Inputs read: `02-requisiti.md` v1.3, `03-architettura.md` (spikes S1-S6), `03b-struttura-codice.md` (§10, §14), `04a-ux.md` (§12), `05-database.md` (§8.2, §12), `08-security.md` (§4, §10), `09-seo.md` (§12, §15), spec §10-§11.
Language: English (decision 2026-11-01). Test names and descriptions in the code are English sentences.

Status vocabulary used in the traceability tables: `planned` (this document), later `pass` / `fail` / `NOT VERIFIED` (a Must criterion that is not verified counts as failed for exit).

---

## 0. Summary and dependencies

- Stack under test (Option A): Next.js App Router + TypeScript, PostgreSQL 16 with RLS and exclusion constraint, Drizzle, in-house sessions, react-pdf, nodemailer, cron endpoint. Test tooling is already fixed by 03b §14: Vitest, Testcontainers Postgres 16, Playwright, `@axe-core/playwright`, dependency-cruiser. This plan adds only: Lighthouse CI, k6 (load), OWASP ZAP and testssl.sh (as already proposed in `08-security.md` §10), Mailpit/`smtp-server` for mail, MinIO for S3 contract tests.
- 111 abuse cases (ABU-M0..M6) are all assigned to an automated suite and a milestone (§7). The 6 cases that are not fully automatable in CI (ABU-M0-05 at full volume, M2-17 on the real bucket, M6-05, M6-06, M6-07, M6-10) have a scripted pre-release procedure with stored evidence (§8.4).
- AC1-AC11 each have at least one automated end-to-end or integration test (NFR-TST-01). Section 3 is the traceability matrix.
- Spec AC2 says "temporary password"; the approved deviation (SEC-3) is an activation link. The test verifies the activation email and link, and verifies that **no password is ever generated, emailed or displayed**.

### 0.1 Dependencies on documents not yet written (to close before GATE 3)

| Dependency | Needed from | Impact on this plan |
|---|---|---|
| `07-frontend.md` (not written yet) | frontend-developer | Final route names, `data-testid` policy, component list, whether search is GET (SEO A-6), filter sheet and Agenda markup, JS budget confirmation (SR-14). Until then E2E specs are written against **roles and labels** from `04a-ux.md` wireframes; page objects are the single place to adapt. |
| `06-backend-api.md` | backend-developer | Route/action registry export format (SR-ACC-01) that drives generated tests; idempotency-key header name; version token field for FR-BKG-19; seed env var names. |
| `11-devops-deploy.md` | devops-engineer | Workflow files, runner OS, whether Docker-in-Docker is available (Testcontainers vs service container), staging URL, preview protection. |
| `12-osservabilita.md` | observability-engineer | Event names and error-tracking adapter, so the "provoked errors appear in logs and error tracking" tests (§9.4) assert real names. |
| `04b-ui-design.md` / tokens | ui-designer | Tenant palette used for contrast fixtures; dark-mode token set; focus ring colour rules. |
| Production host (ARC-2/OPS-2 deferred) | owner | Staging/DAST/serverless smoke (ABU-M6-10, S2-S4, S6) cannot be executed until a host is decided; they stay in "pre-release" and are flagged in the Esito. |

---

## 1. Strategy

### 1.1 Test pyramid (target proportions by count; Phase 1 estimates)

| Level | Tooling | Where | Share | Purpose | Time budget |
|---|---|---|---|---|---|
| Static / architecture | ESLint (complexity 10, max-lines), `tsc`, dependency-cruiser, jscpd, Semgrep, gitleaks, `check-messages.ts` (i18n keys), env-example check | CI `lint-types-arch` | gate | Enforce 03b §10 rules, no hard-coded UI text, no raw SQL outside data layer | < 3 min |
| Unit | Vitest, colocated `*.test.ts(x)`, `FakeClock`, builders | `src/**` | ~60% | Pricing (calendar days), availability and buffer rules, status derivation, edit rules, revenue attribution, snapshot versioning, grace/read-only policy, theme derivation and contrast, phone normalisation, Zod schemas, config guards, password policy, SSRF classifier, CSV safe text, code generator | < 60 s total, < 50 ms each |
| Integration | Vitest + Testcontainers Postgres 16 (runtime role `rentcar_app`, template DB clone per file) | `tests/integration/<module>` | ~20% | Repositories, RLS, exclusion constraint, services through the real guard, jobs idempotency, outbox, adapters contract tests (storage local/MinIO, rate-limit postgres/memory) | < 6 min |
| Security / cross-tenant | Vitest + real DB, generators from the route registry | `tests/security` | ~8% | Cross-tenant matrix, RLS matrix, auth-negative helpers, headers, log canary, 111 ABU cases | < 6 min |
| E2E | Playwright against `docker compose up` with seeded synthetic data | `tests/e2e` | ~10% | Critical flows, mobile viewports, axe, CSP violation listener, cookies, keyboard | PR subset < 10 min, full nightly |
| Non-functional | Lighthouse CI, k6, ZAP, testssl.sh | scripts + CI | gate by stage | Performance, load, DAST, TLS | nightly / pre-release |
| Manual | Checklists §13 | per milestone / pre-release | few | Screen reader, real-device Safari/Chrome mobile, UAT | milestone end |

Principle: every business rule is proven at the lowest level that can prove it; an E2E test exists only when the browser, the router, hydration or a multi-page flow matters (skill `testing-strategy`: client-side behaviour is verified in a real browser, never with `curl` or code reading).

### 1.2 Rules (apply to everything)

1. No test is skipped, disabled or loosened to get green. A flaky test is quarantined only with a tracked issue and a deadline (§11.3).
2. Deterministic: time through `FakeClock` (unit/integration) or Playwright `page.clock` plus server-side clock override (E2E, see §2.3); ids sequential; no random data without a seed printed on failure.
3. Isolated data: one database clone per test file; E2E data created through seeded builders per spec with unique slugs/usernames only when the test mutates shared tenants.
4. Every defect fix starts with a failing test that enters the regression suite (§12).
5. Test code follows the same layering rules as production code (dependency-cruiser runs on `tests`), reuses `tests/support/*` builders and fakes (no duplicate helpers; third duplicate gets extracted).
6. Evidence: actual command output stored in `docs/test-reports/<milestone>.md`; never presumed results.

### 1.3 Environments

| Environment | Content | Used for |
|---|---|---|
| Local developer | `docker compose up` (postgres, migrate, seed, app, jobs; profiles minio, mailpit) | AC1, exploratory, E2E debug |
| CI ephemeral (`APP_ENV=ci`) | Compose stack in the GitHub Actions job, seeded synthetic tenants, fake SMTP, MinIO, fake DNS resolver | All automated suites, ZAP authenticated active scan |
| Staging (when hosting is decided) | Separate DB branch, synthetic data, `APP_ENV=staging`, limits unchanged, `noindex` | Smoke, ZAP baseline, Lighthouse CI, TLS scan, observability checks, serverless smoke |
| Production | Real | Post-release smoke only (read-only, one synthetic tenant) per release-manager checklist |

---

## 2. Test data, fixtures, clock and time zones

### 2.1 Builders and seeds (`tests/support/builders`, `scripts/seed.ts`; per `05-database.md` §8.2 and §12)

Deterministic factory functions (no randomness, sequential ids, `FakeClock`). One entry point `buildWorld(world)` loads a named world into the template DB as `rentcar_owner`; tests run as `rentcar_app`.

| Fixture | Content | Used by |
|---|---|---|
| Tenant A `demo-a` and Tenant B `demo-b` (twins) | Same usernames (`admin`, `operator`), same plates, phones, customer names, dates, booking codes pattern; different ids. Each has: admin, active operator, deactivated operator, un-activated user; 6 vehicles (one in maintenance, one archived with history, one with 3 photos), customers (one with 3 bookings), bookings in every status, expenses in current and a closed year, a yearly snapshot v1 and v2, audit entries | Cross-tenant matrix, E2E |
| Tenant C | Empty (detects leaks into empty sets) | Matrix |
| Tenant D | Terminated (day 0, 30, 91 variants) | Purge, access-blocked tests |
| Tenant S (suspended), Tenant X (expired 3 days ago = grace), Tenant R (expired 8 days ago = read-only), Tenant K (cancelled subscription) | Subscription states | FR-SYS-12/13, FR-ENF-01 |
| Tenant T-DST | Time zone `Europe/Rome`, bookings across DST change; second tenant in `America/New_York` and a third in `Pacific/Auckland` (UTC+13 in DST) to catch browser/server time zone assumptions | Time tests |
| Tenant P (perf) | `seed:perf`: 50 tenants, 50 vehicles each, 10,000 bookings per tenant max, 5 years | NFR-PERF-02..06 (nightly) |
| Systemadmin | One, plus second for replacement tests | `/system` |
| Palette set | Valid palette; text #777777 on #FFFFFF (4.48:1 fails); primary with 3.9:1 (warn); pair below 3:1 (blocked); dark-mode palettes; extreme palettes (all white, all black, neon) | AC9, AC11, axe-with-tenant-palette |
| Payload corpora | XSS, SQL metacharacters, CSV formulas (`= + - @`, tab, CR), SSRF addresses (IPv4/IPv6/mapped/decimal/octal), upload files (SVG, polyglot JPEG+PHP, decompression bomb 30000x30000 PNG, truncated, animated, EXIF-GPS, 12 MB phone photo), Unicode (RTL override U+202E, NUL, emoji, homoglyph slugs), canary strings `CANARY_*` | ABU suites |
| Fakes | `FakeMailer`, fake SMTP server with controllable STARTTLS/cert/banner, fake DNS resolver (rebinding), `InMemoryStorage`, MinIO container, `FakeRateLimitStore`, `NoopErrorReporter` and a capturing reporter | Unit/integration/E2E |

Synthetic data only; no real personal data anywhere; Luhn-valid numbers used only as test strings.

### 2.2 Randomness and identity

Booking codes and tokens come from `IdGenerator`; tests inject `sequential` generators. The code-generator quality test (ABU-M2-13) uses a seeded sampler and asserts alphabet, length and 50-bit entropy by construction, not by statistics.

### 2.3 Clock control

| Layer | Mechanism |
|---|---|
| Unit | Domain functions take `now` as parameter; services receive `FakeClock` |
| Integration | `buildTestContainer({overrides:{clock}})`; DB-side `now()` is never used for business decisions (assert by grep test in the architecture suite) |
| E2E | App started with `TEST_CLOCK_ENDPOINT` enabled only when `APP_ENV=ci` (an architecture/config test proves it is rejected in staging/production): `POST /api/test/clock` sets the server clock; Playwright `page.clock.install({time})` sets the browser clock to the **same** instant. Tests for "today highlight", lead time, expiry, grace, year end and session expiry use both. **Dependency**: backend-developer must implement the CI-only clock hook (question QA-1). |
| Jobs | Jobs are invoked through the authenticated cron endpoint with the fake clock set |

### 2.4 Time zone and DST matrix (NFR-TZ-01, FR-BKG-13, US-056)

Mandatory cases for the pure pricing and day-count function and for revenue attribution, executed in **three runner time zones** (`TZ=UTC`, `TZ=Europe/Rome`, `TZ=America/Los_Angeles`) so a test that passes only in one zone fails in CI:

| Case | Expected |
|---|---|
| 1 Jun 10:00 to 3 Jun 10:30, 40.00/day | 3 days, 120.00 |
| 1 Jun 10:00 to 3 Jun 09:00 | 3 days |
| Same day 10:00-18:00 | 1 day |
| 1 Jun 10:00 to 2 Jun 00:00 exactly | 1 day (A-11) |
| Europe/Rome spring forward 29 Mar 2026 (23 h day) and fall back 25 Oct 2026 (25 h day), rental spanning each | Days counted on tenant calendar dates, unaffected |
| Rental starting 29 Mar 02:30 local (non-existent local time) and 25 Oct 02:30 (ambiguous) | Input rejected or resolved by the documented rule; never silently shifted a day |
| Booking ending 31 Dec 23:30 Europe/Rome (22:30 UTC) | December of that year |
| Booking ending 1 Jan 00:30 Europe/Rome (23:30 UTC 31 Dec) | January of the new year |
| "Today" at 00:30 tenant time while browser is in another zone (Rome tenant, browser `America/Los_Angeles`) | Tenant date highlighted (A-19) |
| Year-end snapshot at 31 Dec 23:59 vs 1 Jan 00:00 tenant time; leap day 29 Feb 2028 | Correct year, exactly one v1 |
| `America/New_York` and `Pacific/Auckland` tenants for all of the above | Same rules in tenant zone |
| Search lead time 3 h around DST transitions | Computed on instants |

---

## 3. Traceability

### 3.1 Spec acceptance criteria AC1-AC11 to tests (NFR-TST-01: at least one automated E2E/integration test each)

Test ids: `TC-<AREA>-<nn>`. Level: U unit, I integration, S security suite, E e2e, N non-functional, M manual. Milestone = milestone in which the test must be green (§5).

| AC | Statement | Test ids | Level | Spec file / location | Milestone |
|---|---|---|---|---|---|
| AC1 | `docker compose up` runs app + DB, auto migrations | TC-PLT-01 stack boots from clean clone with `.env.example`, `/api/readyz` 200, migrations applied, seeded systemadmin logs in at `/system`; TC-PLT-02 DB container restart keeps data (named volume); TC-PLT-03 `/api/healthz` liveness has no dependency check, `/api/readyz` returns non-2xx with DB down or migrations pending; TC-PLT-04 `.env.example` keys equal config schema keys (U); TC-PLT-05 seed refuses `APP_ENV=production` without flag | E (CI job `compose-smoke`) + U | `tests/e2e/platform/compose.spec.ts`, `src/platform/config/*.test.ts` | M0 (stack), M1 (login) |
| AC2 | Systemadmin creates tenant + subscription; admin receives activation email | TC-SYS-01 create tenant with subscription and first admin (E, Mailpit/fake SMTP): tenant reachable at `/{slug}`, activation email with 24 h link received via system SMTP, owner "tenant created" email; TC-SYS-02 slug in use/reserved/homoglyph rejected, nothing created (I); TC-SYS-03 email failure still creates tenant, message shown, re-issue works (I); TC-SYS-04 double submit creates one tenant (I); TC-SYS-05 email body contains no password, only link (I); TC-SYS-06 admin can log in only after setting a password (E); TC-SYS-07 KPI-1 timed run under 10 minutes (E, informational timer) | E, I | `tests/e2e/system/create-tenant.spec.ts`, `tests/integration/tenancy/*` | M1 |
| AC3 | Customer searches by dates, sees only available vehicles, books, gets code and PDF | TC-PUB-01 full flow search to confirmation with code and PDF download (E, desktop + mobile); TC-PUB-02 availability filter (overlap, buffer 0/60, maintenance, archived, cancelled-only) (U + I); TC-PUB-03 PDF content (text-searchable, code, vehicle, dates in tenant zone, 40.00 x 3 = 120.00, "not an invoice", no VAT) parsed with a PDF text extractor (I); TC-PUB-04 confirmation email with PDF attached (I with fake SMTP); TC-PUB-05 email failure keeps booking confirmed (I); TC-PUB-06 no-email path offers PDF download only (E) | E, I, U | `tests/e2e/public/booking.spec.ts` | M2 |
| AC4 | Overlapping bookings cannot both be confirmed | TC-BKG-01 20 concurrent requests, one vehicle, overlapping periods: exactly one success (I, US-055); TC-BKG-02 50 parallel conflicting inserts and 50 parallel edits: one winner, no deadlock, `40P01` counted (I, S5); TC-BKG-03 end == start with buffer 0 both accepted; buffer 60 rejects 59 min (U + I); TC-BKG-04 admin vs public simultaneously (I); TC-BKG-05 two admin edits moving different bookings onto same slot (I); TC-BKG-06 browser: two contexts book the same vehicle, loser sees "no longer available" and returns to results with form data kept (E, FR-PUB-08); TC-BKG-07 idempotency key replay creates one booking (I) | I, E | `tests/integration/booking/exclusion.test.ts`, `tests/e2e/public/conflict.spec.ts` | M2 (public), M3 (edits) |
| AC5 | Calendar sorted by name, month/week/day, highlights today | TC-CAL-01 order Audi A3, bmw X1, Fiat Panda (natural, case-insensitive) (U); TC-CAL-02 view switching grid/month/week/day/agenda keeps data consistent, period in URL (E); TC-CAL-03 today highlight in tenant zone with browser in another zone, at 00:30 tenant time, with non-colour indicator (E with clock); TC-CAL-04 booking across 3 days is continuous (E); TC-CAL-05 only visible range is loaded (network assertion) (E); TC-CAL-06 operator opens booking detail, no edit controls (E); TC-CAL-07 Agenda view grouped by day in tenant zone, keyboard and accessible names (E + axe); TC-CAL-08 loading, empty, error states (E, route interception) | U, E | `tests/e2e/admin/calendar.spec.ts` | M3 |
| AC6 | Expenses and bookings feed per-vehicle and global revenue by month and year | TC-REV-01 US-080 numbers exactly (250.00 / 60.00 / 190.00); TC-REV-02 cancelled and confirmed excluded; TC-REV-03 attribution by `endAt` month (28 Mar-3 Apr in April; 31 Dec 23:30 Rome in December); TC-REV-04 collected/outstanding/overpaid; TC-REV-05 per-vehicle sums equal global for every month and year (property-style test over generated data, FR-REV-10, KPI-4); TC-REV-06 archived vehicle figures in global; TC-REV-07 expense create/edit/delete updates views; TC-REV-08 current-year counters reset 1 Jan tenant zone; TC-REV-09 revenue views in the browser show the same numbers as the API (E) | U, I, E | `src/modules/revenue/**/*.test.ts`, `tests/integration/revenue`, `tests/e2e/admin/revenue.spec.ts` | M4 |
| AC7 | Yearly snapshot at year end, viewable for comparison | TC-SNP-01 job after 1 Jan creates exactly one v1 with totals equal to live; TC-SNP-02 job twice / re-run after failure / concurrent invocations: one v1; TC-SNP-03 lazy creation on first access; TC-SNP-04 snapshots created for read-only and suspended tenants; TC-SNP-05 closed-year correction creates v2, v3 on delete, v1 stays viewable, "corrected" badge, no new version when unaffected (US-085); TC-SNP-06 comparison uses latest versions, side-by-side, % difference; one-year empty state (E); TC-SNP-07 snapshot update/delete by runtime role fails (D, ABU-M4-06) | I, E | `tests/integration/revenue/snapshots.test.ts`, `tests/e2e/admin/compare-years.spec.ts` | M4 |
| AC8 | Operator can view but not modify bookings or vehicles | TC-OPR-01 operator session: no create/edit/cancel/payment/delete controls in calendar, bookings, vehicles; customer name, phone, email visible in detail (E); TC-OPR-02 every admin mutation from the action registry returns 403 and changes nothing (S, ABU-M3-02); TC-OPR-03 revenue, expenses, customers, operators, settings, audit URLs denied (E + S); TC-OPR-04 deactivated operator's open session fails on next request (I); TC-OPR-05 operator slot freed on deactivation (I) | E, S | `tests/e2e/admin/operator.spec.ts`, `tests/security/role-matrix.test.ts` | M3 |
| AC9 | Tenant branding (title, logo, colours) on public site and admin | TC-BRD-01 admin saves title/logo/primary: public header, admin header and `<title>` update (E); TC-BRD-02 two tenants side by side show their own branding, no bleed via cache (E + I); TC-BRD-03 logo > 1 MB or non-image rejected (I); TC-BRD-04 `theme.css` serves validated hex only and is tenant-scoped (I); TC-BRD-05 PDF and email use tenant title/logo/primary (I); TC-BRD-06 visual regression of 3 palettes on public results, admin Today and calendar (Playwright screenshots) | E, I | `tests/e2e/admin/branding.spec.ts` | M5 |
| AC10 | Changing `DATABASE_URL` or `STORAGE_PROVIDER` works without code change | TC-PLG-01 storage contract test runs identically on `local` and `s3` (MinIO) (I); TC-PLG-02 E2E with `STORAGE_PROVIDER=s3` + MinIO: upload vehicle photo, displayed publicly; switch to `local` with no code change (E, CI matrix job); TC-PLG-03 migrations and E2E smoke against a second PostgreSQL 16 instance via `DATABASE_URL` (CI matrix: compose Postgres and Testcontainers/service Postgres); TC-PLG-04 architecture test: no DB client or storage SDK import outside adapters (C, dependency-cruiser); TC-PLG-05 resolver swap test: a host-based `TenantResolver` fixture replaces slug resolver with no other module changed (U, US-122); TC-PLG-06 rate-limit store contract postgres/memory (I) | I, E, C | `tests/integration/platform/*.contract.test.ts`, `.github/workflows/ci.yml` matrix | M6 (full proof), M2 (contract) |
| AC11 | 375 px usable, no horizontal scroll outside calendar; tenant colours theme everything; contrast warnings | TC-RSP-01 for every key page at 320, 375, 768, 1024, 1280: `document.documentElement.scrollWidth <= clientWidth` (except calendar grid container) (E, all mobile projects); TC-RSP-02 touch targets >= 44x44 on touch viewports, >= 24x24 with spacing otherwise (E, bounding-box assertions for interactive elements); TC-RSP-03 mobile journeys J1 (public), admin login, calendar (day view default, sticky vehicle column, horizontal scroll inside grid only), bookings list as stacked cards, booking edit, branding (E, WebKit + Chromium, FR-UX-06); TC-RSP-04 tables become cards below `md`; TC-RSP-05 filter bottom sheet opens with 44x44 targets; TC-BRD-07 primary colour change themes buttons, links, focus rings across public and admin (computed-style assertion); TC-BRD-08 contrast warning for #777777 on #FFFFFF names pair, ratio, suggestion; 3.9:1 warns but saves; below 3:1 blocks save (U for the WCAG ratio function with reference vectors + E); TC-BRD-09 valid palette shows no warning; TC-BRD-10 dark mode follows device in auto, forced in light/dark; TC-RSP-06 400% zoom / 320 CSS px reflow; TC-RSP-07 long unbreakable text (email, plate, URL) wraps | E, U | `tests/e2e/responsive/*.spec.ts` | M5 (hardening), earlier milestones run their own pages |

### 3.2 User stories to test cases (all Must stories; coverage index)

Each story's Given/When/Then lines become one test each (test title = the criterion in English). The test-id prefix tells where it lives.

| Epic | Stories | Test ids / suites | Main level |
|---|---|---|---|
| EP-01 Auth | US-001 first login (valid, used, expired, short password keeps link usable, un-activated login fails), US-002 reset (existing, unknown identical response, expired/used, SMTP missing), US-003 throttling and deactivated, US-004 role and tenant enforcement | TC-AUT-01..18; abuse ABU-M1-01..18, 29, 32..34 | I + E |
| EP-02 Systemadmin | US-010 create tenant (AC2), US-011 suspend/reactivate, US-012 renew/overlap, US-013 limits incl. concurrent creation at limit-1, US-014 grace/read-only/cancelled, US-015 SMTP masked, US-016 admin recovery, US-017 owner notifications idempotent | TC-SYS-01..30; TC-ENF-01..12 (every mutation in read-only rejected, allowed list works) | I + E |
| EP-03 Public booking | US-020 search (all bullets), US-021 sort/filter/chips/bottom sheet, US-022 book, US-023 concurrent, US-024 abuse protection, US-025 unavailable pages, US-034 indexing control | TC-PUB-01..30; TC-SEO-01..10 | U + I + E |
| EP-04 Calendar | US-030, US-031, US-032, US-033 Agenda | TC-CAL-01..12 | U + E |
| EP-05 Vehicles | US-040 (duplicate plate per tenant, non-image/over 4 MB at server, 12 MB downscaled in browser, notes warning, limit), US-041 maintenance toggle and "rented" derived, US-042 archive, US-043 expenses | TC-VEH-01..20 | I + E |
| EP-06 Bookings | US-050 list/filter/URL persistence, US-051 manual (past booking completed), US-052 payment, US-053 cancel, US-054 lifecycle (job twice, manual early completion, manual active), US-055 concurrency, US-056 billed days, US-140/141/142/143 edit rules by state | TC-BKG-01..40; TC-PRC-01..15 (pricing/DST) | U + I + E |
| EP-07 Customers | US-060, US-061 de-dup (+39 333 123 4567 vs 3331234567), US-062 anonymise (searched in every table, PDF, CSV, logs), US-063 tenant isolation, US-064 yearly reminder once per year, US-065 export, US-066 terminate (day 0/90, export not delivered), US-067 warning on notes fields | TC-CUS-01..20 | I + E |
| EP-08 Operators | US-070 create/activate/re-issue/duplicate username/email failure, US-071, US-072 | TC-OPR-01..12 | I + E |
| EP-09 Revenue | US-080..086 | TC-REV, TC-SNP (see AC6/AC7) | U + I + E |
| EP-10 Branding/settings | US-090, 091, 092, 093 SMTP (encrypted, blank keeps), 094 booking rules, 095 privacy notice template fallback | TC-BRD-01..25 | U + I + E |
| EP-11 Email/PDF | US-100, 101, 102, 103 | TC-MAIL-01..12, TC-PDF-01..08 | I |
| EP-12 Responsive | US-110, 111, 112 | TC-RSP-01..10, TC-STA-01..06 (loading/empty/error states per list/calendar/form) | E |
| EP-13 Platform | US-120, 121, 122, 123 (job endpoint 401 without secret, counts with, concurrent invocations no duplicates) | TC-PLT, TC-PLG, TC-JOB-01..10 | I + E |
| EP-14 Audit/CSV | US-130, 131, 132 | TC-AUD-01..10, TC-CSV-01..10 | I |

Should/Could stories (FR-CUS-04/05, FR-BKG-15/19, FR-OPR-03, FR-CAL-06/09/10, FR-BRD-10, FR-MAIL-04, FR-REV-12/13) get tests when implemented; they are not exit criteria for their milestone unless promoted to Must. FR-BKG-19 (stale edit) is exercised by US-140 and ABU-M3-05, so it is tested in M3 regardless.

### 3.3 Non-functional requirements to tests

| NFR | Verification | Section |
|---|---|---|
| NFR-ISO-01..03 | Cross-tenant matrix, RLS matrix, tenant-prefixed storage keys, cache keyed by tenant (test: two tenants, same key name, different values) | §8.1 |
| NFR-SEC-01..09 | ABU suites, header test, upload tests, SSRF tests, scans | §7, §8 |
| NFR-GDPR-01..07 | Anonymisation search-every-table test, export, retention jobs with clock, no non-essential cookie/request test on public pages (network + cookie assertion), form links to privacy notice/terms, CI check that tenant DPA flag exists | §7, §9.5 |
| NFR-A11Y-01/02 | axe in Playwright + manual pass | §9 |
| NFR-PERF-01..06 | Lighthouse CI, k6, timing tests | §10 |
| NFR-TZ-01 | DST/year-boundary matrix, three runner zones | §2.4 |
| NFR-COMP-01 | Playwright Chromium, WebKit, Firefox projects + manual devices | §9.3, §13 |
| NFR-I18N-01 | `check-messages.ts` (unused/missing keys), ESLint rule against string literals in JSX, pseudo-localisation run (+40% text, accented characters) for layout overflow on 320/375 | §9.6 |
| NFR-OBS-01 | Provoked-error and event tests | §9.4 |
| NFR-PLG-01/02, NFR-SRV-01 | Architecture test, contract tests, serverless smoke (pre-release) | §3.1 AC10, §8.4 |
| NFR-BKP-01 | Restore test (ABU-M6-06) | §8.4 |
| NFR-TST-01 | This plan; coverage gates §11 | §11 |

---

## 4. Test cases for critical flows, edge, negative and permissions (selected; full lists are generated per story)

### 4.1 Critical flows (E2E, each has a mobile run)

| ID | Flow | Key checks |
|---|---|---|
| E-01 | J1 public booking: root -> search -> results -> form -> confirmation -> PDF | <= 4 screens, journey timer <= 2 min on 375 px (KPI-2), price shown equals confirmation, honeypot absent from a11y tree, links to privacy notice and terms visible before submit, form data kept on conflict, console without errors |
| E-02 | J8 activation and reset (admin, operator, systemadmin) | Used/expired/invalid link pages, policy checklist live, same response for unknown account |
| E-03 | Admin login/logout, session expiry (clock), deactivated user | Generic message; cookie flags |
| E-04 | J2 Today: pick-ups and returns, mark paid in <= 3 taps | Operator variant read-only |
| E-05 | J3 create manual booking, edit (confirmed, active extend/shorten, completed move month), mark paid, cancel | Old to new shown, balance, conflict message with booking code, stale edit message |
| E-06 | Calendar (grid, month, week, day, agenda) | AC5 |
| E-07 | J4 vehicle add with photos (12 MB downscale), maintenance toggle with warning list, archive, expenses | |
| E-08 | J5 revenue, closed-year correction, comparison | AC6/AC7 |
| E-09 | J6 branding with contrast warning, dark mode, preview | AC9/AC11 |
| E-10 | J7 systemadmin onboards tenant, KPI-1 timer | AC2 |
| E-11 | J9 tenant states: unknown slug 404, suspended, grace banner, after grace "bookings unavailable", read-only admin | |
| E-12 | J10 recover admin access | |
| E-13 | Customers: list, history, anonymise, export | |
| E-14 | CSV export (bookings with filters, formula cells neutralised) | Download assertion |
| E-15 | Read-only tenant: allowed (payment, status, export, password change) and blocked controls with reasons | |
| E-16 | Operators: create, re-issue link, deactivate | |
| E-17 | Settings: SMTP save (masked), test email, booking rules, privacy notice | |
| E-18 | Audit log view and filters | |

### 4.2 Roles and permission test (generated)

Matrix from `02-requisiti.md` §2: for each route/action in the route registry and each actor (anonymous, customer, operator, admin A, admin B, systemadmin, suspended-tenant admin, read-only-tenant admin, deactivated user) the generator asserts the expected status (200 / 401 / 403 / 404) and, for mutations, that the database is unchanged. The expectation table is data derived from the registry's declared guard; a route without a declaration fails the registry check (ABU-M0-13). The permission matrix of §2 of the requirements is also written as a literal table in `tests/security/permission-matrix.ts` and compared with the registry, so a mistaken declaration (not only a missing one) is caught.

### 4.3 Edge and negative themes (checklist applied to every form and action)

Empty, whitespace only, max length, max length + 1, Unicode/emoji/RTL, leading/trailing spaces, duplicate (plate, username, slug, phone), dates (past, today, lead time, min/max days, leap day, DST, year boundary, far future), amounts (0, negative, 3 decimals, huge, exponent, comma), double submit, back button after submit, expired session mid-form (input preserved), offline/network error with retry, 404 for foreign ids, stale version token, parallel tabs.

---

## 5. Scope per milestone

Milestones from `02-requisiti.md` §3.2 (M0 is the harness required by the security sign-off). "Cumulative" means all earlier suites must stay green: every milestone ends with the **full** suite (§12 regression).

| Milestone | Functional scope tested (new) | ABU cases (new, must be green at milestone end) | Non-functional | Spikes | E2E projects run on PR |
|---|---|---|---|---|---|
| M0 harness, CI, platform | Compose smoke (AC1 part), config guards, health endpoints, route-registry export, builders/fakes, template DB, matrix generators, header/log-canary helpers, tests of the rules themselves (dependency-cruiser fixtures failing-then-passing), CI workflows | ABU-M0-01..16 (16) | Lighthouse CI wired with a placeholder page; axe wired | S1 as permanent test (reduced volume) | desktop-chromium smoke |
| M1 auth, systemadmin, tenants, jobs, SMTP guard | AC1 complete, AC2; US-001..004, 010..017, 120, 123; FR-ENF-01 policy (unit); FR-SYS-12/13 | ABU-M1-01..34 (34) | axe on login, set-password, system pages; argon2 concurrency (ABU-M1-33, S3) | S3, S4 (if host chosen), S1 on real pooler | + mobile-iphone: login |
| M2 vehicles, public booking, email/PDF, availability | AC3, AC4 (public); US-020..025, 034, 040..043 (vehicle part), 056, 100..103, 061, 067; FR-PUB-*; PDF; uploads | ABU-M2-01..22 (22) | NFR-PERF-01 Lighthouse on `/{slug}` and booking steps; NFR-PERF-02/03 k6; axe on public pages; SEO checks (§10.3) | S2 (PDF), S5 | + all mobile projects: public booking |
| M3 admin bookings, calendar, customers, operators, audit | AC4 (edits), AC5, AC8; US-030..033, 050..055, 060, 062..066, 070..072, 130, 131, 140..143; FR-BKG-16..19 | ABU-M3-01..13 (13) | NFR-PERF-04 calendar month; axe on admin pages and Agenda; keyboard calendar | - | + calendar, vehicle form on mobile |
| M4 expenses, revenue, snapshots, CSV | AC6, AC7; US-080..086, 132; FR-CSV-*, FR-VEH-11, FR-REV-07 | ABU-M4-01..07 (7) | NFR-PERF-05/06; S6; reconciliation property test | S6 | + revenue on mobile |
| M5 branding, visual design, responsive hardening | AC9, AC11; US-090..095, 091, 092, 110..112 | ABU-M5-01..07 (7) | Full axe sweep with 3+ tenant palettes and dark mode; visual regression; reflow 320; pseudo-localisation | - | all projects, all viewports |
| M6 pluggability, notifications, hardening | AC10; US-064, 066, 121, 122; privacy reminder, tenant termination/purge; jobs; observability tests | ABU-M6-01..12 (12) | DAST (ZAP), TLS, restore test, serverless smoke, nightly load, full compatibility run (Firefox) | S2-S4, S6 repeated on target host | all |

Total ABU: 16 + 34 + 22 + 13 + 7 + 7 + 12 = **111**.

Entry criteria per milestone: build green, code review without blockers, test environment available. Exit: §14.

---

## 6. E2E flows and viewports

### 6.1 Playwright projects (from 03b §14, extended)

| Project | Engine / profile | Viewport | Runs |
|---|---|---|---|
| `desktop-chromium` | Chromium | 1280x800 | full suite on PR |
| `mobile-iphone` | WebKit, iPhone 13 profile (390x844, touch) | | public booking, admin login, calendar, bookings list+edit, vehicle form, branding on PR; full nightly |
| `mobile-android` | Chromium, Pixel 7 | 412x915 | same subset on PR |
| `small-360` | Chromium custom 360x640, touch | | public booking, admin bookings (stacked cards) on PR |
| `reflow-320` (**added**) | Chromium custom 320x568 | | AC11/UX §12-1: reflow and no horizontal scroll on every key page (page-load assertions only, no full flows); nightly |
| `tablet-768`, `desktop-1024` (**added**) | Chromium | 768x1024, 1024x768 | navigation changes at 1024 (UX §12), nightly layout assertions |
| `desktop-webkit`, `desktop-firefox` (**added**) | WebKit, Firefox desktop | 1280x800 | nightly: critical flows E-01, E-03, E-05, E-09 (NFR-COMP-01 requires Firefox and Safari) |

The spec requires "at least one Playwright mobile-viewport test per main flow" (§10.1, FR-UX-06): the table below is the binding mapping.

### 6.2 Main flow to mobile test mapping

| Main flow (FR-UX-06) | Spec | Mobile projects | Required assertions |
|---|---|---|---|
| Public booking | `public/booking.mobile.spec.ts` | iphone, android, small-360 | Every step: no horizontal page scroll, targets >= 44x44, filter bottom sheet, fixed bottom CTA not covering fields with the on-screen keyboard (visual viewport emulation), journey time/screens (KPI-2) |
| Admin login (and set-password) | `admin/login.mobile.spec.ts` | iphone, android, small-360 | Password manager friendly fields, `autocomplete` attributes, error message association |
| Calendar | `admin/calendar.mobile.spec.ts` | iphone, android | Day view default; grid scrolls horizontally **inside its container only**; sticky vehicle column stays visible; page scrollWidth == clientWidth |
| Booking management and edit | `admin/bookings.mobile.spec.ts` | iphone, android, small-360 | Stacked cards, collapsed navigation, edit form usable, conflict message visible, Mark paid within 3 taps |
| Branding | `admin/branding.mobile.spec.ts` | iphone, android | Contrast warning visible and not clipped, colour inputs usable, preview |
| Vehicle form (03b adds) | `admin/vehicle.mobile.spec.ts` | iphone, android | Photo input with camera/gallery, downscale of 12 MB image |
| Systemadmin onboarding (not a mobile main flow, desktop only, but reflow-320 smoke) | | reflow-320 | No horizontal scroll |

### 6.3 Shared helpers

`expectNoHorizontalPageScroll(page, {allow: '[data-calendar-grid]'})` (compares `scrollWidth` with `clientWidth` of `document.documentElement` and of `body`, and lists the widest offender on failure); `expectTouchTargets(page, {min: 44})`; `expectNoConsoleErrors`; `expectNoCspViolations` (listener on `securitypolicyviolation`, also feeding ABU-M5-05); `runAxe(page, {tags: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']})`; `withTenantPalette(page, palette)`. The `data-calendar-grid` hook (or equivalent) is a dependency for the frontend (QA-2).

---

## 7. Security tests and abuse-case automation (111 cases)

### 7.1 Principle

Every abuse case in `08-security.md` §4 becomes one automated test named `ABU-Mx-nn <attack> expects <result>` (the id is in the title, so `vitest -t ABU-M1` selects by milestone and the report counts them). A meta-test (`tests/security/abuse-coverage.test.ts`) parses `docs/08-security.md` §4, extracts all 111 ids and fails if any id has no test, or a test references an id that does not exist. Tests are generated from the **route registry** and **mutation registry** wherever the abuse case is "for every route/action".

### 7.2 Mapping ABU groups to suites

| Group | Ids | Level | Suite / file | Notes |
|---|---|---|---|---|
| DB role, RLS, grants, append-only | M0-01, 02, 03, 04, 07, 08; M1-28; M4-06 | D/I | `tests/security/db-catalog.test.ts`, `rls-matrix.test.ts` | Catalog queries against the template DB as `rentcar_app`; grants snapshot file committed; failing-then-passing run stored |
| GUC bleed / pooler | M0-05 | I/X | `tests/security/guc-bleed.test.ts` (CI volume), `scripts/qa/guc-bleed-full` (1,000 concurrent, nightly and pre-release against real pooler, spike S1) | |
| Static / CI checks | M0-06, 10, 13, 14, 16; M1-27 | C | Semgrep rules, dependency-cruiser, gitleaks job with throwaway branch fixture, registry check, "failing-then-passing" proof via a deliberately violating fixture run in the CI job `guards-selftest` | The self-test runs the tool against a violating fixture and asserts it fails |
| Config guards | M0-09; M1-23, 29 | U | `src/platform/config/*.test.ts` | Production guards: placeholder keys, short `CRON_SECRET`, `http://` base URL, Mailpit override in production |
| Headers, CSP, cookies | M0-11, 12; M1-08; M5-05; M6-09 | E/I | `tests/security/headers.test.ts` (data table from `08-security.md` §7.1 against the running compose app, all route classes and error pages), Playwright crawl with CSP listener | Next.js middleware bypass header (CVE class) in M0-12 |
| Log canary | M0-15; M3-09 (part); M6-08 | I | `tests/security/log-canary.test.ts` | Captures stdout, event table, error-reporter mock; asserts no `CANARY_*` |
| AuthN, sessions, throttling | M1-01..18, 29..34 | I/E | `tests/security/auth/*.test.ts`, `tests/e2e/security/session.spec.ts` | Clock fixture for lifetimes; two-origin browser test for CSRF |
| SSRF guard, SMTP, encryption | M1-19..25 | I/U | `tests/security/ssrf.test.ts` with fake DNS and fake SMTP | Rebinding test uses resolver that changes answer between save and send |
| Jobs | M1-26; M6-03, 12 | I | `tests/security/jobs.test.ts` | |
| Tenancy / IDOR | M2-18; M3-01, 13; M4-05; M5-07 | I | `tests/security/cross-tenant/*.test.ts` generated from `tenant-matrix.ts` | Read, list, update, delete, export for every entity; RSC/server-action payload variants |
| Role / mutation registry | M3-02, 03, 04, 08 | I | `tests/security/role-matrix.test.ts`, `read-only.test.ts` | Read-only allowed list tested positively too |
| Public booking abuse | M2-01..09, 19, 20, 21; M6-11 | I | `tests/security/public-booking.test.ts` | Rate-limit store failure variants |
| PDF | M2-11, 12, 13 | I/U | `tests/security/pdf.test.ts` | Tampered logo URL to metadata address must not be fetched (fake HTTP sink asserts zero requests) |
| Uploads, media | M2-14, 15, 16, 17; M5-04 | I/X | `tests/security/uploads.test.ts`; M2-17 against MinIO in CI (anonymous LIST/PUT/DELETE denied) and against the real bucket pre-release | |
| Email | M2-09, 10 | I | `tests/security/email.test.ts` | |
| CSV | M4-01..04 | I/U | `tests/security/csv.test.ts`; M4-04 (50,000 rows) also as nightly perf | |
| Audit / GDPR | M3-05..07, 09, 10; M6-01, 02, 03 | I | `tests/security/gdpr.test.ts`, `audit.test.ts`, `purge.test.ts` | "Search every table for ANON_*" helper |
| Theming / injection | M5-01, 02, 03 | U/I | `tests/security/theme-injection.test.ts` | |
| DAST and operations | M6-04..07, 10 | X | §8.4 | |
| Filter/sort injection, stale update | M3-05, 11, 12 | I/E | `tests/security/query-params.test.ts`, session list E2E | |

### 7.3 Per-function abuse checklist (secure-coding section 9) generated for each protected function

For each protected route/action the generator produces: unauthenticated -> 401 (or redirect for pages); wrong role -> 403; another tenant's id -> 404 with an identical body to a non-existent id; malformed/oversized input -> 400 with field errors and no stack trace; extra keys (mass assignment) -> ignored or 400 and database unchanged; rate limit where declared -> 429; CSRF origin check on mutations; and for state-changing routes an audit entry exists. A route registered without these generated cases fails the coverage meta-test.

### 7.4 Expected outputs

Tests assert on **both** the response and the database state (unchanged row counts and values), and on the absence of leakage in the response body (no tenant ids, stack traces, SQL text, SMTP banners, token values).

---

## 8. Cross-tenant, DAST and security gates

### 8.1 Cross-tenant matrix (KPI-5, NFR-ISO-01, blocking in CI)

Implements `03b` §7 and `05-database.md` §12: (a) catalog registry test fails if a table with `tenant_id` is not in the matrix; (b) for every entity and every repository/service/route path "tenant A actor, tenant B resource" returns 404/empty, never 200 with data, including audit log, CSV, snapshots, PDFs, media keys, theme, cache keys, job outputs; (c) FORCE RLS on all tenant tables; (d) runtime role with no GUC sees zero rows; (e) 1,000 interleaved transactions without bleed; (f) system scopes limited to the matrix in `05-database.md` §4.5 (undeclared scope gets 0 rows / `42501`); (g) composite FK prevents booking of A with vehicle of B (as owner, `23503`). Twin fixtures (same usernames, plates, phones) make "wrong tenant but same value" bugs visible. Tenant C (empty) detects accidental empty-set matching.

### 8.2 Security gates by stage (from `08-security.md` §10.3)

| Stage | Must pass |
|---|---|
| PR | Unit, integration, DB catalog, Semgrep, gitleaks, SCA, ABU cases for touched routes, header test |
| Milestone end | All ABU cases of the milestone and earlier; `docs/reviews/security-<milestone>.md` |
| Pre-release (GATE 4) | ABU-M6-04..07 and 10; no High/Critical open; TLS and header scan; restore test; preview isolation |

### 8.3 Supply chain

`pnpm audit` (fail on high/critical), OSV-Scanner, Trivy on the image (non-root, pinned digest), CycloneDX SBOM artifact, weekly schedule plus PR.

### 8.4 DAST plan (reference: `08-security.md` §10.4)

| Item | Plan |
|---|---|
| Passive baseline | OWASP ZAP baseline (docker `zaproxy/zap-stable`) against staging, nightly optional, mandatory pre-release |
| Authenticated active scan | Only on the ephemeral `APP_ENV=ci` stack in a dedicated workflow (`dast.yml`, manual trigger + pre-release), seeded users: tenant admin, operator, systemadmin by scripted form login; `__Host-` session detection; logout URL excluded; `/api/jobs/run` scanned separately (401 without secret) |
| Exclusions | Committed ZAP config with documented false positives only |
| Acceptance | No High; Mediums triaged with owner and date; report stored in `docs/test-reports/dast-<date>.md` |
| TLS / headers | testssl.sh (or SSL Labs) + securityheaders on staging and production |
| Pre-release scripted checks (not CI-automatable) | ABU-M0-05 full 1,000 concurrent against real pooler; ABU-M2-17 anonymous bucket operations on the real bucket; ABU-M6-06 restore into scratch DB and per-table counts; ABU-M6-07 preview environment variables carry no production secrets; ABU-M6-10 serverless smoke on preview with synthetic data (also S2, S3, S4, S6) |

All DAST/staging items are blocked until the hosting decision (ARC-2); they are listed as **NOT VERIFIED** until then in each milestone report and cannot be waived by QA.

---

## 9. Accessibility, compatibility, localisation, observability

### 9.1 Accessibility (WCAG 2.2 AA, EAA; NFR-A11Y-01/02)

Automated:
- `@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21aa, wcag22aa` (+ `best-practice` reported, not gating) on **every route class and every state** of the wireframes: login, set-password (valid/used/expired), reset, public root, results (with/without results), booking form (errors), confirmation, unavailable pages, 404, admin Today, calendar (grid and Agenda), bookings list/detail/edit, vehicles, vehicle form, expenses, customers, revenue, comparison, operators, settings, branding, audit log, `/system` pages. Zero violations of serious/critical severity gates the PR; any violation gates the milestone.
- Run each page in: light, dark, and with **three tenant palettes** (valid default, brand with ~4.6:1 pair, a warned 3.9:1 palette saved with warnings) because AA with any tenant palette is a requirement (FR-BRD-04). Note: axe cannot prove contrast of text on images or gradients; manual check for the PDF-free public hero (none planned per SEO SR-14).
- Playwright keyboard assertions: tab order, visible focus (2.4.7), focus not obscured by sticky header/bottom bar (2.4.11), dialogs trap and restore focus, Esc closes, bottom sheet focus, skip link, calendar grid arrow-key model, Agenda reachable from the view switcher.
- Target size 2.5.8: bounding-box check >= 24x24 (and >= 44x44 on touch).
- Reduced motion: `page.emulateMedia({reducedMotion:'reduce'})` asserts no running animations/transitions (`document.getAnimations()` empty) and no smooth scroll.
- 400% zoom / 320 CSS px reflow (1.4.10) and text spacing override (1.4.12) test: inject the WCAG text-spacing stylesheet and assert no clipped text/overlap on key pages.
- Forms: every input has an accessible name, errors programmatically associated (`aria-describedby`, `aria-invalid`), error summary receives focus, status messages announced (live regions) - assertion via accessibility tree snapshot (`page.accessibility`/`toMatchAriaSnapshot`).
- Contrast function: unit test of the WCAG relative-luminance ratio with published reference vectors, rounding rule (4.5 must not round up from 4.49).
- Lighthouse accessibility score >= 95 on public pages (supplementary only).

Manual (§13): screen-reader pass, keyboard-only walkthroughs J1, J3, calendar grid and Agenda, filters sheet, dialogs (UX §12-7).

### 9.2 Visual and layout regression

Playwright screenshot comparison (`toHaveScreenshot`) on 3 palettes x light/dark for public results, confirmation, admin Today, calendar day, booking edit; pinned Playwright browser versions and fonts (self-hosted) for stability; baselines updated only through a reviewed PR; masked dynamic regions.

### 9.3 Compatibility (NFR-COMP-01)

Automated: Chromium, WebKit, Firefox desktop projects (nightly critical flows), WebKit iPhone 13 and Chromium Pixel 7 profiles (PR). Manual: real iOS 16+ Safari and Android 10+ Chrome devices (§13). Edge and "last two versions": covered by Chromium (Edge is Chromium); no separate run, stated as an accepted equivalence (QA-4).

### 9.4 Observability tests (NFR-OBS-01, `testing-strategy`: provoked errors in logs and error tracking)

- Integration: provoke DB down, Zod failure, unhandled exception in action, route handler and RSC render, SMTP exception (ABU-M6-08): each yields one structured JSON log line with `requestId`, `tenantId`, `actorId`, `event`, one `ErrorReporter.capture` call, a generic user-facing error with the request id, and no PII/secret.
- Events: public booking (search, select, submit, success/failure/conflict), login, booking edit, email send, PDF generation, job runs emit named events (names from `12-osservabilita.md`, dependency).
- Staging (when it exists): provoke one error through a test-only route disabled in production; confirm it appears in the error-tracking tool and in logs with the trace id; confirm job-run log visible to the owner (NFR-OBS-03). Alerts: none are required now (NFR-OBS-03); the check is "no alert configured by mistake".
- Health: `/api/healthz` and `/api/readyz` behaviour (TC-PLT-03).

### 9.5 Privacy-related automated checks

Public pages issue no third-party request and set no cookie (Playwright network and cookie assertions, FR-PUB-13, NFR-GDPR-07); the only cookie after admin login is the session cookie; privacy notice/terms links visible before submit (NFR-GDPR-03); anonymisation search-every-table (ABU-M3-06); retention jobs with clock (ABU-M6-03).

### 9.6 Localisation (single locale `en`)

No multi-language E2E now. Tests: `check-messages.ts` (no key used but missing; no key unused), lint rule against literals in JSX, formats (`en` number/currency with tenant currency, dates in tenant zone), pseudo-localisation build (+40% length, accented) screenshot check at 320/375 for truncation/overflow, key structure ready for a second locale (type test that a stub `it.ts` with a missing key fails compilation). If a locale is added later this section is extended with two-language critical E2E.

---

## 10. Performance (NFR-PERF)

| Req | Test | Tool | Data | Threshold | Run |
|---|---|---|---|---|---|
| NFR-PERF-01 (+ SEO SR-14) | Lighthouse CI on `/{slug}`, results, booking form, confirmation; mobile 4G simulated, CPU 4x | Lighthouse CI (`@lhci/cli`), 5 runs median, p75 approximated from median of runs | 30 vehicles | LCP <= 2.5 s, CLS <= 0.1, INP <= 200 ms (via Playwright user-flow/TBT proxy in lab, INP measured with `web-vitals` in a scripted interaction), TTFB <= 800 ms, first-load JS root <= 150 kB gzip (bundle assertion from build output), images <= 1280 px / 480 px cards, lazy loading | PR (budget on build output), nightly (Lighthouse), staging pre-release |
| NFR-PERF-02 | Availability search load | k6, 20 VUs, 5 min | 50 vehicles, 5,000 bookings (tenant P) | p95 <= 500 ms server time | nightly + pre-release |
| NFR-PERF-03 | Booking create/edit | k6 | same | p95 <= 800 ms (excl. email/PDF); total with email attempt <= 3 s | nightly |
| NFR-PERF-04 | Calendar month 50x31 | Playwright timing + server timing header | tenant P | <= 1.5 s p95 server, <= 2 s client on throttled CPU (6x) approximating mid-range phone | nightly |
| NFR-PERF-05 | Revenue 5 years, 10,000 bookings; snapshot correction one year | Vitest timing on real DB + k6 | tenant P | p95 <= 1 s; correction <= 2 s; **and** query-plan assertion (`EXPLAIN` uses indexes, no N+1: query-count assertion per request) | nightly |
| NFR-PERF-06 | CSV 50,000 rows | integration + k6 | 50,000 rows | completes <= 10 s or streams without timeout; memory bounded | nightly (S6) |
| N+1 / query count | Query-count budget per page/action asserted in integration tests (e.g. calendar <= N queries independent of vehicle count) | Vitest with query logger | | no growth with row count | PR |
| Cold start | Measure first request after idle on real host (S1) | script | | report only, feeds SEO-5 | pre-release |

CI performance numbers on shared GitHub runners are noisy; therefore PR gates use **deterministic budgets** (bundle size, query counts, DOM size), while time-based thresholds run nightly on a fixed runner type with 3 retries of the measurement (not of the test) and a 10% tolerance band recorded in config. Calendar and revenue performance depend on `07-frontend.md` virtualisation decisions (dependency).

---

## 11. CI gates, flakiness policy, coverage

### 11.1 GitHub Actions (user request: run all tests; creation owned by devops-engineer in M0, definitions here)

| Job | Trigger | Content | Blocks merge |
|---|---|---|---|
| `lint-types-arch` | PR, push main | ESLint, `tsc --noEmit`, dependency-cruiser (+ rule self-test), jscpd (3%), message-catalog check, env-example check, Semgrep, gitleaks | yes |
| `unit` | PR, push | Vitest unit with coverage; matrix `TZ` = UTC, Europe/Rome, America/Los_Angeles for time-sensitive projects | yes |
| `integration` | after unit | Testcontainers Postgres 16 (or `postgres:16` service via `TEST_DATABASE_URL` if DinD unavailable), MinIO, fake SMTP; contract tests | yes |
| `security-matrix` | after integration | `tests/security` incl. all ABU of touched/previous milestones, abuse-coverage meta-test, headers vs compose app | yes |
| `e2e` | after security | `docker compose up` stack, Playwright projects (PR subset §6), axe, traces/videos on failure uploaded as artifacts, sharded by 4 | yes |
| `compose-smoke` | PR | AC1 clean-clone boot (`docker compose up --wait`, readyz) | yes |
| `plugability` | PR (path filter) + nightly | Matrix: `STORAGE_PROVIDER` local/s3 x database (compose Postgres / second Postgres) smoke | yes (nightly red opens issue, blocks release) |
| `scans` | PR + weekly | pnpm audit, OSV-Scanner, Trivy, SBOM | yes for high/critical |
| `nightly` | cron | Full matrix: all Playwright projects incl. Firefox/WebKit desktop, reflow-320, tablet; visual regression; Lighthouse CI; k6 load; S1 full volume; mutation spot-check on `pricing` and `availability` (optional); jobs idempotency stress | no (opens tracked issue; red nightly blocks milestone close) |
| `dast` | manual / pre-release | ZAP authenticated active scan on ephemeral stack; testssl on staging | blocks GATE 4 |

Pipeline order follows 03b §10: `lint-types-arch -> unit -> integration -> security-matrix -> e2e -> scans`. Actions pinned by SHA; `permissions: contents: read`; frozen lockfile; no secrets in PR workflows from forks; test artifacts (junit, coverage, traces, screenshots, Lighthouse and ZAP reports) retained 14 days. Every merge to the main branch runs the full PR set plus the regression suite (§12).

### 11.2 Coverage gates (03b §10, enforced by Vitest v8, only raisable)

| Scope | Gate |
|---|---|
| `modules/*/domain` | >= 90% lines and branches |
| `modules/*/application` | >= 80% |
| `infrastructure` | no numeric gate; covered by integration tests (each repository method has at least one integration test; reported) |
| Global | >= 75% |
| Quality add-ons | Every Zod schema and config guard has a test (checked by a script listing schemas without a test); mutation spot-check on pricing/availability nightly (survivors reported, target >= 80% killed, informational in Phase 1); coverage is indicative, the meaningful measure is traceability: every FR marked M maps to a test id (script compares requirement ids in test titles/tags with `02-requisiti.md`) |

### 11.3 Flakiness policy

1. Retries: Playwright `retries: 1` in CI to capture trace on first failure; **a test that passes only on retry is recorded as flaky** (reporter output) and counted. Unit/integration have zero retries.
2. A flaky test is fixed, not excluded. If it blocks the team it may be quarantined (`test.fixme` is **not** allowed; a tagged `@quarantine` project that still runs and reports) only with a tracked issue, an owner and a deadline of 5 working days; quarantine of a regression-suite or ABU test is not allowed (it must be fixed same day).
3. Causes to remove first: real time (use clocks), fixed sleeps (use web-first assertions and `expect.poll`), shared data (isolate), port clashes, animation (disable via reduced motion in test config), ordering between tests (random order flag `--sequence.shuffle` runs nightly for unit/integration to find coupling).
4. Metric: flaky rate = flaky tests / total E2E per week, target 0; any flaky ABU or regression test is a blocking defect.
5. Playwright config: `fullyParallel`, workers fixed, `trace: 'retain-on-failure'`, `video: 'retain-on-failure'`, fixed `locale: 'en-GB'`, `timezoneId` set explicitly per project (and tests that need another zone override it).

### 11.4 Defect management

`BUG-nnn | Severity | Environment | Steps | Expected | Actual | Evidence | Requirement`. Severity: **Blocker** (acceptance criterion unmet, cross-tenant leak, regression of regression-suite flow, security High/Critical, data loss) · **High** · **Medium** · **Low**. Blockers and regressions stop the milestone. Every fix commit contains the failing-first test and references the id (`Refs: BUG-nnn`). Defects logged in the milestone report, not in a separate tool, unless the user asks for GitHub Issues (QA-5).

---

## 12. Regression suite and impact analysis

### 12.1 Regression suite (versioned here; created at first test cycle, updated every feature)

Greenfield: nothing is in production, so the first release baseline is the set below. A flow is "regression" once its milestone is closed; from then on every milestone and every merge to main runs all of it (`@regression` tag, so `playwright test --grep @regression` and `vitest --project regression` select it). Client-side flows run in a real browser (Chromium + WebKit mobile).

| ID | Flow | Covering test | Introduced |
|---|---|---|---|
| RG-01 | Clean-clone boot, readyz, migrations | TC-PLT-01 | M0 |
| RG-02 | Cross-tenant matrix, RLS, GUC bleed | `tests/security/cross-tenant`, `rls-matrix` | M0 |
| RG-03 | Admin/operator/systemadmin login, logout, session expiry, throttling | E-03, ABU-M1 | M1 |
| RG-04 | Activation and reset links | E-02 | M1 |
| RG-05 | Tenant create + activation email | TC-SYS-01 | M1 |
| RG-06 | Suspended / grace / read-only behaviour | E-11, E-15 | M1 |
| RG-07 | Public search + booking + confirmation + PDF (desktop + mobile) | E-01 | M2 |
| RG-08 | Overlap prevention (concurrency, edits) | TC-BKG-01..06 | M2 |
| RG-09 | Pricing / DST matrix | TC-PRC (3 time zones) | M2 |
| RG-10 | Navigation between pages: client-side routing, back/forward, deep links with filters in URL, no console errors | `navigation.spec.ts` | M2 |
| RG-11 | Admin booking create/edit/cancel/pay | E-05 | M3 |
| RG-12 | Calendar views and today highlight | E-06 | M3 |
| RG-13 | Operator read-only | E-04 variant, role matrix | M3 |
| RG-14 | Customers: de-dup, anonymise, export | E-13 | M3 |
| RG-15 | Audit entries for audited actions | TC-AUD | M3 |
| RG-16 | Revenue figures and reconciliation | TC-REV-05 | M4 |
| RG-17 | Snapshots and corrections | TC-SNP | M4 |
| RG-18 | CSV exports | E-14, ABU-M4 | M4 |
| RG-19 | Branding on public + admin, contrast rules | E-09 | M5 |
| RG-20 | Responsive no-horizontal-scroll sweep | TC-RSP-01 | M5 |
| RG-21 | axe sweep of all route classes | A11y suite | M2 onward, extended each milestone |
| RG-22 | Security headers and CSP on all route classes | headers test | M0 |
| RG-23 | Log canary | log-canary test | M0 |
| RG-24 | Storage/DB pluggability smoke | TC-PLG-02/03 | M6 |

Rule: a regression-suite test that is not executed counts as NOT VERIFIED and blocks (skill rule). Every bug found adds a test with tag `@regression`.

### 12.2 Impact analysis template (per feature; first populated at the first change request)

The report of each milestone lists, for the changed areas, the existing flows that may be affected, including indirectly. Standing coupling map for this architecture (used to decide inclusions; when in doubt the flow is included):

| Change touches | Existing flows to re-run (at minimum) |
|---|---|
| Pricing / time helpers (`shared/time`, date library) | RG-07, RG-09, RG-11, RG-16, RG-17, RG-12 (today highlight), RG-18 |
| Availability / booking repository / exclusion constraint | RG-07, RG-08, RG-11, RG-12, RG-16 |
| Tenant context / `withTenant` / RLS / pooling | RG-02 and every flow |
| Auth/session/guard | RG-03..06, RG-13, ABU-M1 |
| Theme tokens / `theme.css` / Tailwind preset / shared UI components | RG-19, RG-20, RG-21, visual regression, all E2E |
| Layout / navigation / router / middleware | RG-10, RG-20, RG-22, all E2E |
| Message catalog / i18n | `check-messages`, pseudo-localisation, all E2E |
| Email / PDF | RG-05, RG-07, RG-11 (resend), TC-MAIL |
| Jobs | status lifecycle, snapshots, reminders (all TC-JOB) |
| Storage adapter | uploads, media, PDF with logo, RG-24 |
| Config / env | RG-01, config guard tests |

---

## 13. Manual test protocol

Run at the end of M3, M5 and before GATE 4 (full), with a short pass at other milestone ends for changed screens. Results recorded in the milestone report with date, tester, device/OS/browser versions and screenshots. Manual findings are logged as BUG ids with the same severities.

### 13.1 Screen reader pass (NFR-A11Y-01/02)

| Platform | Combination | Flows |
|---|---|---|
| macOS | VoiceOver + Safari | J1 public booking, J3 admin booking edit, calendar Agenda, branding form with contrast warning, dialogs, filter sheet |
| Windows | NVDA + Firefox (and Chrome) | Same flows; NVDA availability: not owned by the team (QA-6: tester access) |
| iOS | VoiceOver + Safari (real device) | J1, admin Today, calendar day view |
| Android | TalkBack + Chrome (real device) | J1, admin bookings cards |

Checks: landmarks and headings order, form labels/errors announced, status messages (booking conflict, saved, validation summary) announced once, calendar grid navigable and Agenda equivalent complete, dialogs announce title and return focus, no focus loss on route change (focus moves to main heading), link purposes, tables have headers, icons have names or are hidden, tenant logo alt text, "today" and status not conveyed by colour only.

### 13.2 Browser and device protocol

- **Emulators** (during development): Chrome DevTools device mode (iPhone SE 375, iPhone 14 Pro, Pixel 7, Galaxy S20 360), Safari Responsive Design Mode, Xcode iOS Simulator (Safari, iOS 16 and latest), Android Studio emulator (Chrome, Android 10 and latest). Checks: virtual keyboard overlap with sticky bottom bar, safe-area insets, `100vh` issues (use `dvh`), date/time pickers (native), 300 ms tap delay, pinch zoom not disabled (WCAG 1.4.4), input zoom on focus in iOS (font-size >= 16px), file input camera/gallery, autofill for phone/name, orientation change, text size increase.
- **Real devices** (release candidate): at least one iPhone with Safari (iOS 16+), one Android phone with Chrome (Android 10+). If none available, the corresponding criteria stay NOT VERIFIED for NFR-COMP-01 (QA-6).
- **Desktop**: latest 2 versions of Chrome, Safari, Firefox, Edge for J1, J3, calendar, branding.
- Keyboard-only walkthrough (UX §12-7), 200% and 400% zoom, forced-colors (Windows high contrast) and dark mode, reduced motion.
- Print/PDF: open the booking PDF in Preview, Acrobat and a phone viewer: fonts, logo, no overflow, text searchable.
- Email rendering: confirmation and activation mails in Gmail web, Apple Mail, Outlook web (Mailpit for structure; real inboxes for the final pass); links work, plain-text part present, no tracking pixels.

### 13.3 Exploratory sessions

Time-boxed (45 min) charters per milestone: "break the booking flow", "tenant switching confusion", "mess with time (clock, zone, DST)", "permissions by URL guessing", "interrupt and resume (offline, back button)". Findings become automated tests when reproducible.

---

## 14. Definition of done for testing

A milestone's testing is done only if all hold:

1. All Must criteria of the milestone (user stories and AC portions) verified with real, stored output; none NOT VERIFIED.
2. Full suite green in CI at the release commit: lint/arch, unit, integration, security matrix, E2E (all PR projects), scans; nightly of the last 3 days green (or red items explained and fixed).
3. All ABU cases of the milestone **and earlier ones** pass; abuse-coverage meta-test green (111 at M6).
4. Whole regression suite (§12) executed, including client-side flows in the real browser; zero regressions.
5. No open Blocker or High defect; Medium/Low listed with owner.
6. Coverage gates met (domain >= 90, application >= 80, global >= 75) and traceability script shows every M requirement of the milestone mapped to a test.
7. axe: zero violations on the pages of the milestone for all tested palettes; manual keyboard pass done for new interaction patterns.
8. No horizontal page scroll at 320/375/768/1024/1280 for the milestone's pages (except calendar grid); at least one mobile-viewport test per main flow introduced.
9. Performance budgets met (PR deterministic budgets; nightly numbers within threshold).
10. Every bug fixed in the milestone has its reproducing test.
11. Security review report for the milestone present and without Critical/High (security-engineer; QA checks the ABU evidence).
12. Report written in `docs/test-reports/<milestone>.md` with: scope, environment and version, summary (run/passed/failed), per-criterion outcome, defects, regression (impacted flows, suite run, outcome per flow), non-functional results, NOT VERIFIED list with tool and command attempted, recommendation (passes / does not pass; always "does not pass" with a Must NOT VERIFIED).
13. Test code reviewed (English, no skipped tests, no `test.skip/fixme/only`, enforced by ESLint rule `no-only-tests` and a grep gate).

If a tool is missing, QA first tries to obtain it (`npx playwright install --with-deps chromium webkit firefox`, `npx -y @lhci/cli`, `docker run grafana/k6`, `docker run zaproxy/zap-stable`) and records the command and error before declaring a criterion unverifiable.

---

## 15. UAT checklist (owner / tenant representative, in staging with synthetic then demo data)

To be run by a non-developer, on a phone and a desktop. Accept = tick with date and name.

**Platform owner (systemadmin)**
- [ ] Create a tenant with subscription and first admin in <= 10 minutes without help (KPI-1); the admin receives the activation email.
- [ ] Suspend and reactivate a tenant; the public page changes immediately.
- [ ] Renew an expired subscription; the tenant leaves read-only.
- [ ] Replace a tenant admin who lost access.
- [ ] I receive the "tenant created" and "subscription ends in 14 days" emails.
- [ ] Terminate a tenant: I get the export; deletion date shown.

**Rental business (admin) on desktop and phone**
- [ ] Set a password from the activation link; the rules are understandable.
- [ ] Set title, logo, colours; I see the contrast warning for a bad colour; public site and admin change colour.
- [ ] Add 3 vehicles with phone photos; put one in maintenance; it disappears from the public site.
- [ ] Enter booking rules (min/max days, buffer) and privacy notice/terms; the public form reflects them.
- [ ] Today's pick-ups and returns are clear; I can mark a booking paid in 3 taps.
- [ ] Create a booking for a walk-in customer; try to double-book and get a clear refusal.
- [ ] Edit a booking (dates, vehicle) and see old/new values and the balance; extend an active rental.
- [ ] Calendar: sorted by name, today highlighted, week/month/day; on phone it is usable.
- [ ] Add expenses; revenue per vehicle and global match my own calculation for a sample month.
- [ ] Compare two years; I understand the "corrected" badge.
- [ ] Anonymise a customer and export a customer's data.
- [ ] Export bookings CSV and open it in Excel/Sheets: no strange cells, characters correct.
- [ ] Create an operator; the operator can view but cannot change.
- [ ] Audit log shows my changes.

**Customer (a real person unfamiliar with the product, on their own phone)**
- [ ] Find the rental page, search dates, choose a car, book in under 2 minutes in at most 4 screens.
- [ ] Understand price, days and "pay on site"; receive the code and PDF.
- [ ] If the car was taken meanwhile, the message is clear and my data is kept.

**Cross-cutting**
- [ ] Text is readable, buttons are easy to tap; nothing needs sideways scrolling (except calendar grid).
- [ ] Error messages are understandable (no codes); wording consistent.
- [ ] Emails look right in my mail app.

UAT defects follow §11.4; sign-off by the owner is the user's decision, not QA's.

---

## 16. Risks to the test effort

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| QR-1 | Hosting undecided: staging, DAST baseline, serverless smoke, S2-S4/S6 on real host, Lighthouse on real network cannot run | High (blocks GATE 4 evidence) | Run everything possible in CI stack; decide host before M6; keep items flagged NOT VERIFIED |
| QR-2 | Frontend design (07) not yet written: selectors, routes, calendar markup may change | Medium | Role/label selectors, page objects, `data-calendar-grid` hook |
| QR-3 | CI minutes and duration (E2E on compose, 8 projects, k6, ZAP) | Medium | PR subset vs nightly split, sharding, path filters |
| QR-4 | Docker-in-Docker unavailable on a chosen runner | Low | `postgres:16` service container fallback already specified in 03b |
| QR-5 | Clock control in E2E requires a CI-only hook in the app | Medium | Specified in §2.3; guarded by config test |
| QR-6 | Real-device and screen-reader access (NVDA, iOS, Android) may be missing | Medium | Ask owner for devices or a tester; otherwise NFR-COMP-01/A11Y items stay NOT VERIFIED |
| QR-7 | 111 abuse cases plus meta-test is a large M0-M1 effort | Medium | Registry-driven generators; build harness in M0 as mandated |
| QR-8 | WebKit-in-Linux differs from real Safari | Medium | Treat as emulation; manual real-device pass before GATE 4 |
| QR-9 | Performance numbers on shared runners are noisy | Low | Deterministic PR budgets; nightly with tolerance band |

---

## 17. Assumptions

| ID | Assumption (needs confirmation) |
|---|---|
| QA-A1 | Playwright E2E runs against the compose stack, with a CI-only server clock hook, fake SMTP and MinIO; the app exposes no test hooks outside `APP_ENV=ci`. |
| QA-A2 | Search is a GET with query parameters and filters persist in the URL (SEO A-6, US-050); confirmed by `07-frontend.md`. |
| QA-A3 | Edge is covered by Chromium (same engine); Safari by WebKit emulation plus real-device manual pass. |
| QA-A4 | Defects are tracked in the milestone test reports; no external tracker unless requested. |
| QA-A5 | Mutation testing and visual regression are in scope as nightly/optional quality add-ons, not gates in Phase 1. |
| QA-A6 | Route registry and mutation registry are exported as JSON by the backend in M0 (security sign-off control), format agreed with backend-developer. |
| QA-A7 | The DAST and host-dependent pre-release checks are accepted as evidence at GATE 4, not at milestone ends. |
