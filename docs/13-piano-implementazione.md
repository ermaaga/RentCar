# Implementation plan: RentCar

Version 1.0 · 2026-11-03 · Owner: PM · Status: draft for GATE 3 (not approved)

Inputs: `02-requisiti.md` v1.4, `03-architettura.md`, `03b-struttura-codice.md`, `adr/0001..0015`, `04a-ux.md`, `04b-ui-design.md`, `design/`, `05-database.md` v1.1, `06-backend-api.md`, `openapi.yaml`, `07-frontend.md`, `08-security.md`, `09-seo.md`, `10-test-plan.md`, `11-devops-deploy.md`, `12-osservabilita.md`, `security/registro-rischi.md`, `security/sign-off.md`.

## 1. Approved solution
- **GATE 2 (2026-11-01)**: code bundle **Option A** — single Next.js App Router app (ADR-0015), TypeScript, PostgreSQL 16 via Drizzle, repository scoping + Postgres RLS from the first migration (ADR-0003), in-house DB-backed sessions with argon2id and one-time set-password links (ADR-0005), GiST exclusion constraint + per-vehicle advisory lock against double booking (ADR-0004), react-pdf (ADR-0006), cron endpoint + lazy jobs (ADR-0007), nodemailer + outbox with SMTP SSRF guard (ADR-0008), storage adapter local|s3 (ADR-0009), Postgres rate-limit table (ADR-0013), pino + noop/Sentry error reporter (ADR-0014).
- **UI**: shadcn/ui on Tailwind, Lucide, visual direction **Clear** + 3 borrowings, per-tenant tokens with `deriveTheme()` (`04b-ui-design.md`).
- **Security level**: OWASP ASVS 4.0.3 L2 (cybersecurity-manager).
- **Hosting**: **deferred** to before GATE 4 (user decision). Phase target is local `docker compose up`. Code stays portable between Vercel Pro + external EU Postgres and an EU VPS by configuration only (ADR-0010, ADR-0011 still "proposed").

## 2. Scope
- **In scope**: the whole spec (AC1–AC11) as refined by `02-requisiti.md` v1.4, including the extras chosen by the user (admin new-booking email, owner emails, CSV exports, audit log), admin booking edits (REQ-15), GDPR export/anonymisation, tenant termination with hard delete after 90 days, SEO baseline for `/{slug}`, CI on GitHub Actions running all tests and security controls.
- **Out of scope**: online payments, invoices/receipts, MFA (accepted risk until GATE 4), CAPTCHA, customer self-service cancellation, custom domains (only predisposed), more UI languages, alerting/on-call, charts (tables only), production deployment (needs the hosting decision and GATE 4).

## 3. Milestones
Order follows `02-requisiti.md` §3.2. Every milestone ends with the quality loop (code-reviewer + security-engineer + qa-engineer + observability-engineer, + ui-designer when UI is touched) and the cybersecurity-manager sign-off. Work is committed one task per commit (Conventional Commits) on a feature branch per milestone, merged to `main` via PR with green `ci-gate` and `security-gate`.

| ID | Objective | Activities (agent) | Depends on | Definition of Done (in addition to §4) | Abuse cases | Estimate (person-days) |
|---|---|---|---|---|---|---|
| **M0** | Foundations: repo, toolchain, Compose, CI with all mandatory security controls, DB roles + first migration, observability baseline, i18n + theming infrastructure | devops-engineer (10 commits, `11-devops-deploy.md` §12); database-architect (roles, extensions, migration runner, RLS template, seed); observability-engineer (logger, request ID, health/readiness, ErrorReporter noop, log canary); frontend-developer (Tailwind/shadcn setup, tokens build, theme CSS route skeleton, message catalog + hardcoded-string lint); spikes S1 (RLS + pooler, local), S-FE-1 (Next JS weight), S-FE-2 (503/410), S-FE-3 (CSP vs Radix `style=`) | GATE 3 | `docker compose up` starts DB + app with migrations (AC1 skeleton); `ci-gate` + `security-gate` green; every security control shown failing-then-passing; branch protection active; architecture rules enforced | ABU-M0-01..16 | 20–28 |
| **M1** | Platform, auth, systemadmin, tenants & subscriptions, jobs, SMTP guard | backend-developer (AUT, TEN, SUB, JOB, platform); frontend-developer (auth pages, `/system` console); database-architect (tables for these modules) | M0 | AC1 complete, AC2 (activation email via Mailpit); FR-ENF-01 policy; set-password link flow; login lockout | ABU-M1-01..34 | 30–38 |
| **M2** | Vehicles, public booking flow, availability, email + PDF, uploads | backend-developer (FLT, BKG public, NTF, PDF, uploads); frontend-developer (public `/{slug}` flow, vehicle admin); seo-specialist (metadata, status codes) | M1 | AC3, AC4 (public); NFR-PERF-01 Lighthouse on `/{slug}`; SEO checks; spike S2 (PDF), S5 (exclusion concurrency) | ABU-M2-01..22 | 32–40 |
| **M3** | Admin bookings (create/edit/cancel/pay), calendar (grid/month/week/day/agenda), customers, operators, audit log | backend-developer (BKG admin, CUS, operators, AUD); frontend-developer (calendar, bookings, customers, operators) | M2 | AC4 (edits), AC5, AC8; keyboard + screen-reader calendar; NFR-PERF-04 | ABU-M3-01..13 | 34–42 |
| **M4** | Expenses, revenue (per vehicle / global, month/year), yearly snapshots with corrections, CSV exports | backend-developer (FIN, snapshots, CSV streaming); frontend-developer (revenue, expenses, compare years) | M3 | AC6, AC7; reconciliation property test; spike S6 (CSV) | ABU-M4-01..07 | 20–26 |
| **M5** | Branding & settings, contrast rule, dark mode, responsive and visual hardening | frontend-developer (branding, theming end-to-end); backend-developer (BRD, OG image); ui-designer (visual verification) | M4 | AC9, AC11 at 375 px and 320 px reflow; full axe sweep with 3+ palettes + dark | ABU-M5-01..07 | 18–24 |
| **M6** | Pluggability proof (DB/storage by env), notifications, privacy reminder, tenant termination/purge, hardening, documentation | backend-developer, devops-engineer (local S3/MinIO + DB switch proof), observability-engineer, technical-writer | M5 | AC10; restore test locally; all suites green; README/runbook | ABU-M6-01..12 (host-dependent ones stay NOT VERIFIED until a host exists) | 18–24 |

**Total**: about **172–222 person-days** of agent work (backend 83–101, frontend 79–99, plus devops/database/QA harness). Since the agents do the work, this is an effort measure, not calendar time. Reviews and fixes are included in each milestone.

**After M6 (not part of this approval)**: hosting decision (ARC-2/5/6, OPS-1..8), staging, DAST, real-device tests, legal pack, GATE 4.

## 4. Definition of Done (every milestone)
- Code reviewed by code-reviewer with no blocking findings; English-only code, comments, logs; no UI text outside the message catalog.
- Structure from `03b-struttura-codice.md` respected, existing code reused, dependencies injected, dependency-cruiser/boundaries checks green.
- Automated tests written and green in CI (unit, integration on real Postgres, E2E incl. at least one mobile viewport per main flow); coverage gates (domain ≥ 90 %, application ≥ 80 %, global ≥ 75 %); milestone abuse cases green; cross-tenant matrix green.
- Security review by security-engineer closed; cybersecurity-manager sign-off APPROVED (or APPROVED WITH RISKS accepted by the user).
- SEO and accessibility requirements relevant to the milestone verified (axe, Lighthouse where applicable).
- New code observable (events in registry, no PII in logs).
- `docs/00-stato-progetto.md`, test report in `docs/test-reports/`, review in `docs/reviews/` updated; branch pushed on request.

## 5. Estimated costs
| Item | One-off | Monthly | Notes |
|---|---|---|---|
| Local development (Docker) | 0 | 0 | Everything in this plan runs locally |
| GitHub (private repo, Free plan) | 0 | 0 | ~2,000 Actions minutes/month [E]; Team (~4 USD/user) only if minutes run out (OPS-14) |
| Error tracking | 0 | 0 | noop by default; Sentry free EU optional (OBS-6) |
| Production hosting (deferred) | — | Option A ≈ 25–45 USD; Option C ≈ 11–20 EUR | Decided before GATE 4 |
| Domain, system email provider (deferred) | ~10–15 EUR/yr | 0 (free tier) | Before GATE 4 (OPS-5, OPS-6, BE-5) |
| Legal review of DPA / privacy templates (deferred) | to quote | — | Before GATE 4 (SEC-6) |
| External review of auth + isolation (deferred) | to quote | — | Recommended before GATE 4 (CSM-3) |

## 6. Risks (top; full lists in `pm/raid.md` and `security/registro-rischi.md`)
| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| RLS + connection pooling subtleties leak or break tenant scope | medium | high | NULLIF policies, `SET LOCAL` only, spike S1 in M0, permanent cross-tenant matrix in CI |
| Bespoke auth defects (ASVS L2) | medium | high | ABU-M1 suite (34 cases), security review per milestone, external review recommended before GATE 4 |
| Next.js cannot emit 503/410 from pages (SEO statuses) | high | medium | Spike S-FE-2 in M0; decision FE-1 before M2 |
| Strict CSP vs shadcn/Radix inline styles | medium | medium | Spike S-FE-3 in M0; documented exception only if unavoidable |
| JS budget 150 kB on `/{slug}` tight | medium | medium | Spike S-FE-1 in M0; budgets enforced in CI |
| Closed-year correction logic subtle (REQ-4 + REQ-15) | medium | high | Property tests, reconciliation job, snapshot versioning |
| Hosting-dependent checks (DAST, restore on provider, serverless PDF/SMTP) cannot run before a host exists | certain | medium | Marked NOT VERIFIED; block GATE 4, not milestones |
| Accepted residual risks: no MFA, no SMTP-change controls, no CAPTCHA switch | — | high/medium | Accepted by user until GATE 4; extension points kept |

## 7. What is needed from the user
- **Now (for implementation)**: answers to the GATE 3 questions (§8), approval of this plan. GitHub repository already exists (github.com/ermaaga/RentCar); MFA on the GitHub account; permission for the devops-engineer to configure branch protection/rulesets on `main`.
- **Before GATE 4 (not now)**: hosting choice and accounts (Vercel/Neon/Scaleway or VPS), domain, system email provider, backup key custody, legal review, real devices / screen-reader testers, staging environment.

## 8. Consolidated open questions
Already answered or decided are not repeated (see `00-stato-progetto.md`). "Pre-GATE 4" items are deferred by the user's earlier choice to build the software first.

### 8.1 Needed before or during implementation
| ID | Question | Recommendation | Blocking | Agent |
|---|---|---|---|---|
| FE-1 | Real 503/410 status for suspended/terminated tenant pages vs 200 + noindex | A: real status via an extra check on public requests (validated in spike S-FE-2) | before M2 | frontend/seo |
| SEC-15 / ARC-9 | Show the activation link on screen if email fails? | A: never shown; fix SMTP and re-issue | no (applied as default) | security/architect |
| SEC-12 | Tenant admin reset email via system SMTP | A: system SMTP for admins, tenant SMTP for operators | no | security |
| SEC-14 | Password pepper (ASVS 2.4.5) | A: yes, half a day | no | security |
| SEC-16 | Reject card-like numbers in notes | A: yes | no | security |
| SEC-17 | Privacy/terms text format | A: plain text or link | no | security |
| SEC-13 | Termination export delivery | A: emailed link, 7 days, 3 downloads | no | security |
| SEC-8 | HSTS preload | A: no preload | no | security |
| BE-1 | Anonymise customer and resend confirmation while read-only | A: allowed | no | backend |
| BE-2 | Change vehicle of an active rental | A: only if new vehicle free for whole period | no | backend |
| BE-3 | Late payments on closed year create snapshot version? | A: no | no | backend |
| BE-4 | Email customer on cancel/edit | A: no (as requirements) | no | backend |
| BE-6 | Daily price on date-only edits | A: price agreed at booking unless vehicle changes | no | backend |
| DB-2 | Clear booking notes on anonymisation | A: yes | no | database |
| DB-4 | Buffer used when editing an old booking | A: current tenant buffer | no | database |
| DB-5 | Monthly detail in yearly snapshots | A: no, yearly totals only | no | database |
| UX-1 | Admin primary device | A: phone first, desktop fully supported | no | ux |
| UX-2 | Prefilled search dates | A: prefilled with visible "N days billed" | no | ux |
| UX-3 | Vehicle gallery for customers | A: cover photo only in v1 | no | ux |
| UX-4 | Include current year "so far" in comparisons | A: yes, off by default | no | ux |
| UX-5 | Platform contact shown in expiry/suspension messages | A: dedicated support email | no (text before go-live) | ux |
| UX-6 | Systemadmin sees per-tenant booking count (no revenue) | A: count only | no | ux |
| UX-7 | Confirmation page reachable by booking code | A: always, without phone/email | no | ux/security |
| UX-8 / A-40 | Required tenant country (phone normalisation) | A: yes, default IT | no | ux/database |
| UX-9 / A-41 | "DPA signed" checkbox in onboarding | A: yes | no | ux/database |
| UX-10 / SEO-2 | English-only public page | A: yes | no | ux/seo |
| SEO-5 | Suspended tenant HTTP status | A: 503 | no | seo |
| SEO-6 | Accept ~1 s DB cold start on first visit | A: yes, measure in S1 | no | seo |
| UI-3 | Inter self-hosted, latin + latin-ext, 400–800 | A: confirm | no | ui |
| UI-4 | Placeholder platform logo | A: confirm, real logo later | no | ui |
| UI-5 | Tenant photos + upload guidance | A: confirm | no | ui |
| FE-2 | JS budgets 150/170/200/250 kB | A: yes | no | frontend |
| FE-3 | Tailwind v4 (drops iOS 16.0–16.3) | A: yes | no | frontend |
| FE-4 | Remember calendar view in localStorage | A: yes (preference only) | no | frontend |
| FE-5 | Browser-only error reporting | A: no in v1 | no | frontend |
| FE-6 | Photo variants 480/1280, empty alt in cards | A: yes | no | frontend |
| FE-7 | UI imports Zod schemas/DTO types; split catalog | A: yes | no | frontend/architect |
| FE-8 | Public booking draft not persisted | A: memory only | no | frontend |
| FE-9 | Log error digest shown to users | A: yes | no | frontend/observability |
| ARC-7 | Single Next.js app (no workspace) | A: confirm | no | architect |
| QA-1 | CI-only clock hook | A: yes, rejected outside `APP_ENV=ci` | no | qa |
| QA-2 | `data-calendar-grid` test attribute | A: yes | no | qa |
| QA-3 | Slow suites nightly/pre-release only | A: yes | no | qa |
| QA-4 | Chromium for Edge, nightly Firefox | A: yes | no | qa |
| QA-5 | Defect tracking | A: milestone reports in `docs/test-reports/` | no | qa |
| OPS-9 | Second approver on the repo | A: none; required checks, no bypass | no | devops |
| OPS-10 | Signed commits | A: no at start | no | devops |
| OPS-11 | Paid GitHub Advanced Security (CodeQL) | A: no, Semgrep blocking | no | devops |
| OPS-12 | Dependabot vs Renovate | A: Dependabot | no | devops |
| OPS-13 | License allowlist MIT/Apache-2.0/BSD/ISC/MPL-2.0, block GPL/AGPL | A: yes | no | devops |
| OPS-14 | Private repo, GitHub Free | A: yes | no | devops |
| OBS-6 | Sentry EU when enabled, listed as sub-processor | A: yes | no | observability |
| OBS-8 | Daily counters table if host logs are short | A: decide after hosting | no | observability |
| OBS-9 | Status page shows counts only | A: yes | no | observability |
| OBS-10 | Source maps upload | A: not at go-live | no | observability |

### 8.2 Deferred to before GATE 4 (not asked now)
ARC-2, ARC-5, ARC-6, ARC-8, OPS-1..8, OPS-15..18, SEC-6, SEC-9, CSM-1, CSM-2, CSM-3, OBS-3, OBS-4, OBS-7, BE-5, QA-6, QA-7, re-decision of accepted risks (MFA, SMTP-change controls, CAPTCHA).
