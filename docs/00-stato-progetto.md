# Project status: Car Rental System (RentCar)

APPROVAZIONE_IMPLEMENTAZIONE: APPROVATA
APPROVAZIONE_GO_LIVE: IN_ATTESA

> Security sign-off: see `docs/security/sign-off.md` (a BLOCKED sign-off prevents closing milestones and gates).
> The two lines above may change to `APPROVATA` **only** after explicit user approval. Until then the plugin hook blocks writes outside `docs/`.
> (The `APPROVAZIONE_*` keywords stay in Italian because the plugin hook reads them.)

## Summary
- **Traffic light**: 🟢 on track · reason: discovery in progress, full spec received
- **Original request**: multi-tenant car rental SaaS — full spec in `docs/spec/car-rental-spec.md`
- **Current phase**: 6 — Implementation (M0 closed; M1 in progress)
- **Next step**: GitHub CI green on PR #1, then owner decides merge and CSM-4 ruleset; CSM-5 spike S1 before M3. Former M0 list (done):  dependency-cruiser/jscpd/knip, Vitest, DB roles + migration runner (replaces migrate stub), ci.yml, security.yml, Playwright, governance, disabled deploy workflows; CSM-5 spike S1 decision needed before M3
- **Feature in progress**: M1 Platform, auth, tenants (one PR per slice, squash-merged, branch deleted on merge)
- **Activity in progress**: M1 — done since last update: password reset (PR #27), tenant detail with suspend/renew/admin access link (PR #28), change password and account page (PR #29), jobs endpoint with runner, retention and subscription-expiry jobs, Compose sidecar (PR #30); auth rate limits RL-05/08/09/16 and `security_event` on auth, token and job paths (PR #31); tenant SMTP settings with the full SSRF guard and test email (PR #32); operators and the transactional email outbox with account notices (PR #33); operator edit with a notice to the previous address (PR #35); subscription renewal reminders (PR #36); M1 light review with fixes: client IP from the trusted hop (`TRUSTED_PROXY_COUNT`), security tests now run, M1 abuse-case traceability, reports in `docs/test-reports/m1.md` and `docs/reviews/m1-review.md`, coverage gates per layer (PR #37); route registry and generated access matrix (PR #38); `tenantAction`/`systemAction` wrappers for every protected action (PR #39). M2 started: fleet, customer and booking tables with the exclusion constraint, spike S5 passed (`docs/spikes/m2-spikes.md`) (PR #40); vehicle admin FLT-01..06 (PR #41); booking domain (local times with DST, billed days per REQ-1, code, period rules) and availability search BKG-01 (PR #42); public site: tenant home with search form, results with client-side sort and filters, unavailable notice, RL-01 (PR #43); public booking BKG-02/03/04: booking page with price re-check and signed form token (honeypot, 3 s minimum fill time, idempotency key), submit in one tenant transaction (idempotent replay, vehicle lock, rules and price re-checked, 3 open bookings per phone, customer never overwritten, exclusion constraint, audit `booking.created`), confirmation page by code (first name only, RL-03 on misses), RL-02 (PR #44); booking emails: customer confirmation and admin new-booking notice enqueued in the booking transaction through the tenant SMTP, rendered at send time by a booking `EmailDataSource` registered in composition, RL-15 (3 confirmations a day per address), dispatched after the response (PR #45); confirmation PDF BKG-05 with react-pdf and vendored Noto Sans, download link on the confirmation page, spike S2 passed (0.3 s cold, ~40 ms warm, < 220 MiB; `docs/spikes/m2-spikes.md`) (this branch). Next: PDF attached to the confirmation email, vehicle photos (FLT-07..09), SEO checks; RL-14/18/20 when their entry points exist
- **Decisions expected from the user**: none until requirements questions
- **Open risks and issues**: see `docs/pm/raid.md`

## Phases
| # | Phase | Status | Documents |
|---|---|---|---|
| 0 | Kick-off | done | 00-stato-progetto.md, pm/raid.md, spec/ |
| 1 | Discovery | done | 01-discovery.md |
| 2 | Requirements — GATE 1 | done (approved) | 02-requisiti.md |
| 3 | Architecture — GATE 2 | done (Option A) | 03-architettura.md, 03b-struttura-codice.md, adr/ |
| 4 | Detailed design | done | 04…12 |
| 5 | Questions and approval — GATE 3 | done (approved by user 2026-11-08; security sign-off APPROVED WITH RISKS 2026-11-03) | 13-piano-implementazione.md |
| 6 | Implementation | in progress: M0 closed (PR #1); M1 data layer merged: tenants, users, sessions, password policy and hashing, login with lockout, subscriptions, credential tokens, outbox, job runs, audit log, tenant settings, SMTP config with encryption, SMTP host guard, platform archives, export tokens (PR #3–#19). M1 flows merged (PR #20–#25): effective access and read-only policy, set-password links (issue/peek/redeem), tenant provisioning in the system scope, system realm with bootstrap CLI, system mailer via Mailpit, sign-in/activation pages for both realms and the tenant console (owner creates a tenant, admin activates from the email: E2E green at 3 widths). Reset, change password, suspend/reactivate and renewal merged (PR #27–#29). Jobs: `/api/jobs/run` (Bearer `CRON_SECRET`, constant-time, RL-13 failure limit), idempotent runner (advisory lock + `job_runs` claim, failure code + retry, time budget), jobs `subscription_expiry_notice`, `retention_hourly`, `retention_daily`, Compose `jobs` sidecar; ABU-M1-26/27 covered by integration and unit tests. Jobs merged (PR #30). Auth limits and security events: RL-05 per-IP login failures (20/15 min, system 10), RL-08 set-password failures, RL-09 credential links per tenant, RL-16 link peeks; `security_event` rows (IP as /24 or /48 prefix + HMAC) for login success/failure/throttled with reason codes, logout, password change, token issued/redeemed/rejected, `ratelimit.exceeded`, `job.auth_failed`. Tenant SMTP (NTF-01/02): admin page `/{slug}/admin/settings/email`, password AES-256-GCM with tenant AAD, `guardedSmtpTarget` (hostname only, all A/AAAA resolved in 3 s, ipaddr.js classification incl. embedded IPv4, connect to the validated IP with TLS server name) on save, test and every send, test email to the acting admin only (RL-10), audit of field names only, read-only policy enforced. Operators (AUT-12/14/15/16): admin page `/{slug}/admin/operators` with plan usage, create under the `limit:operators` advisory lock (2 parallel at limit-1 give 1), activation link through the tenant SMTP (awaited, never retried, `email_log` credential row) and "Activation not delivered" derived from it, deactivate (sessions ended, links superseded, seat freed) and reactivate (seat check), re-send link (RL-09); operator password reset now goes through the tenant SMTP. Outbox and notices merged (PR #33). Operator edit (AUT-13): name and email, previous address notified through the outbox. Renewal reminders (US-017): job `subscription_renewal_reminder`, once per subscription end date from 14 days before the end to the end of grace, to the owner (system SMTP) and the tenant admin (tenant SMTP if configured, else system SMTP) through the outbox. Remaining M1: milestone quality loop (code, security, QA review) and M1 sign-off | reviews/, test-reports/ |
| 7 | Pre-release verification | to do | reviews/, test-reports/ |
| 8 | Documentation | to do | README, docs/manual/ |
| 9 | Go-live — GATE 4 | to do | 14-go-live.md |
| 10 | Closure | to do | 15-retrospettiva.md |

## Baseline decisions
- **Code language**: English (identifiers, comments, logs, tests, commits). Fixed.
- **Documentation language**: English for everything in `docs/` (analysis, ADRs, technical docs). User decision 2026-11-01.
- **Language for questions to the user**: Italian (user request).
- **UI languages**: English only at launch, simple single-locale i18n structure (spec §10, user 2026-11-01).
- **Criticality and SLOs**: low for now, no alerting/on-call; free-tier monitoring only
- **Chosen visual direction**: **Clear** + 3 borrowings (Field: large time numerals and 48 px targets on Today, 3 px focus ring; Warm: friendlier confirmation copy) — docs/design/clear/, user choice 2026-11-01

## Key decisions
| Date | Decision | Rationale | Reference |
|---|---|---|---|
| 2026-11-01 | Product is a SaaS for multiple independent rental businesses (tenants) | User answer | spec §1 |
| 2026-11-01 | Code, docs and UI in English only | User answer + spec §1 | — |
| 2026-11-01 | Stack constraints: Next.js App Router + TS, PostgreSQL via ORM, pluggable storage (local/S3), no Vercel lock-in, Docker Compose | Spec constraint | spec §2 |
| 2026-11-01 | Phase 1 target is local `docker compose`; later app on Vercel with external (non-Vercel) Postgres → serverless-compatible design | User answer | 01-discovery.md C9 |
| 2026-11-01 | Scale 1–10 tenants at launch, <50 in 12 months; Italy/EU; one currency + time zone per tenant | User answer | 01-discovery.md |
| 2026-11-01 | Path-based `/{slug}` now; single tenant-resolution point for future custom domains | User answer | 01-discovery.md C12 |
| 2026-11-01 | Full spec scope, no fixed deadline | User answer | 01-discovery.md B8 |
| 2026-11-01 | Git: user creates the repository; one commit per completed task (English messages) | User request | — |
| 2026-11-01 | CI: GitHub Actions running tests (lint, typecheck, unit, integration with Postgres, Playwright E2E incl. mobile viewports, security scans) on every push/PR — to be created in M0 by devops-engineer after GATE 3 | User request | 13-piano-implementazione.md (M0) |
| 2026-11-01 | No card numbers or identity documents stored anywhere (SEC-5) | User answer | 03-inputs/security-constraints.md |
| 2026-11-01 | Production hosting, monthly budget, ops time and legal review (OPS-2, OPS-3, SEC-6, ARC-2, ARC-5, ARC-6) DEFERRED: focus on building the software locally first; decide before go-live. GATE 2 decides the code-level bundle only | User answer | 03-architettura.md |
| 2026-11-01 | GATE 2: code bundle **Option A** — Drizzle, in-house DB-backed sessions (argon2id), repository scoping + Postgres RLS, react-pdf, cron endpoint + lazy jobs, nodemailer + outbox, Postgres rate-limit table. Production host (Vercel Pro vs EU VPS) deferred; code is host-portable | User choice (ARC-1) | 03-architettura.md, adr/ |
| 2026-11-01 | Postgres RLS from the first migration (ARC-3) | User choice | ADR-0003 |
| 2026-11-01 | Vehicle photo limit 4 MB with client-side downscale (ARC-4; changes requirement A-23) | User choice | ADR-0009 |
| 2026-11-01 | New users get a one-time set-password link valid 24 h instead of a temporary password (SEC-3; spec deviation §4) | User choice | ADR-0005 |
| 2026-11-01 | Security level OWASP ASVS 4.0.3 L2; password min length 12 | cybersecurity-manager | security/sign-off.md |
| 2026-11-01 | Tenant data after termination: export, hard delete after 90 days (SEC-7) | User choice | 02-requisiti.md |
| 2026-11-01 | No MFA, no SMTP-change controls, no CAPTCHA switch: residual risks ACCEPTED by user until GATE 4 | User acceptance | security/registro-rischi.md |
| 2026-11-01 | SEO: only /{slug} root indexable (SEO-1); optional tenant short description ≤160 chars (SEO-3) and optional address (SEO-4); title ≤45 chars | User choice | 09-seo.md |
| 2026-11-01 | Visual direction Clear + 3 borrowings (UI-1) | User choice | docs/design/index.html |
| 2026-11-01 | Tenant colors: automatic darker shade for links/text, block only pairs with no automatic fix (UI-2; rewords FR-BRD-04/A-29) | User choice | 04b-ui-design.md |
| 2026-11-03 | Suspended/terminated tenant public pages answer HTTP 200 + noindex (FE-1 = B; overrides SEO 503/410 proposal) | User choice | 07-frontend.md, 09-seo.md |
| 2026-11-03 | All remaining GATE 3 questions in 13-piano-implementazione.md §8.1 answered with the recommended option (incl. SEC-14 pepper = yes, BE-6 = price agreed at booking, SEC-15 = link never shown) | User answer | 13-piano-implementazione.md §8.1 |
| 2026-11-01 | UI: shadcn/ui on Tailwind, Lucide, per-tenant tokens | Spec constraint | spec §10.2 |

## Approval log
| Date | Gate | Outcome | Scope / notes |
|---|---|---|---|
| 2026-11-01 | GATE 1 — Requirements | APPROVED by user | docs/02-requisiti.md v1.1 incl. assumptions A-1..A-39 and decisions REQ-1..REQ-16 |
| 2026-11-03 | GATE 3 — Implementation plan | Security sign-off APPROVED WITH RISKS; user answers recorded | docs/13-piano-implementazione.md v1.0 |
| 2026-11-08 | Implementation approval | APPROVED by user | Plan M0–M6. Branch protection (CSM-4): user will enforce at end of development, not now. CSM-5 (spike S1 before M3): still open |
| 2026-11-01 | GATE 2 — Architecture | Option A chosen by user; security sign-off APPROVED WITH RISKS | Code bundle A; hosting deferred to before GATE 4 |

## Open questions
| ID | Question | Raised by | Blocking | Status |
|---|---|---|---|---|
| REQ-1 | Day-count rule | requirements-analyst | yes | answered 2026-11-01: calendar days touched (1/6 10:00 → 3/6 10:30 = 3 days) |
| REQ-2 | Status transitions | requirements-analyst | yes | answered: automatic at pickup/return time + manual admin override |
| REQ-3 | Revenue definition | requirements-analyst | yes | answered: only completed bookings, in the month of return |
| REQ-4 | Closed years | requirements-analyst | yes | answered: correctable, snapshot recomputed with "corrected on…" trace |
| REQ-5 | Expired/suspended tenant | requirements-analyst | yes | answered: 7-day grace with renewal banner, then public site "bookings unavailable" + staff read-only; existing bookings stay valid |
| REQ-6 | Customer self-service | requirements-analyst | no | answered: no, only the business cancels |
| REQ-7 | Anti-spam | requirements-analyst | no | answered: IP + phone limits + honeypot, no CAPTCHA |
| REQ-8 | Booking rules per tenant | requirements-analyst | no | answered: min/max duration, lead time, buffer (no opening hours) |
| REQ-9 | Maintenance | requirements-analyst | no | answered: simple "in maintenance now" toggle (as spec) |
| REQ-10 | Returning customer | requirements-analyst | no | answered: normalized phone match, no overwrite |
| REQ-11 | Operator visibility | requirements-analyst | no | answered: calendar, bookings with customer contacts, vehicles; no revenue/expenses/customer list/settings |
| REQ-12 | Privacy/terms | requirements-analyst | pre-go-live | answered: each tenant provides its own; owner provides template + DPA; retention until tenant anonymizes, yearly reminder |
| REQ-13 | VAT | requirements-analyst | no | answered: final prices VAT included, no invoices/receipts |
| REQ-14 | Extras | requirements-analyst | no | answered: ALL in scope — admin email per new booking, owner emails (tenant created, 14 days before expiry), CSV export, audit log |
| REQ-15 | Edit booking | requirements-analyst | no | answered: admin can ALWAYS edit dates and vehicle (re-check availability, recompute price) |
| REQ-16 | Admins per tenant | requirements-analyst | no | answered: ONE admin per tenant (as spec) |

## Implementation milestones
| Milestone | Traffic light | Status | Code review | Security review | Tests | Security sign-off | Notes |
|---|---|---|---|---|---|---|---|
