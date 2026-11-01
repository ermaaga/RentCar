# Project status: Car Rental System (RentCar)

APPROVAZIONE_IMPLEMENTAZIONE: IN_ATTESA
APPROVAZIONE_GO_LIVE: IN_ATTESA

> Security sign-off: see `docs/security/sign-off.md` (a BLOCKED sign-off prevents closing milestones and gates).
> The two lines above may change to `APPROVATA` **only** after explicit user approval. Until then the plugin hook blocks writes outside `docs/`.
> (The `APPROVAZIONE_*` keywords stay in Italian because the plugin hook reads them.)

## Summary
- **Traffic light**: 🟢 on track · reason: discovery in progress, full spec received
- **Original request**: multi-tenant car rental SaaS — full spec in `docs/spec/car-rental-spec.md`
- **Current phase**: 3 → 4 — closing architecture (03b code structure, ADRs accepted), requirements delta; then detailed design
- **Next step**: Phase 4 wave A (UX, database, security threat model, SEO)
- **Feature in progress**: —
- **Activity in progress**: solution-architect → 03b-struttura-codice.md + ADR status; requirements-analyst → GATE 2 delta in 02-requisiti.md
- **Decisions expected from the user**: none until requirements questions
- **Open risks and issues**: see `docs/pm/raid.md`

## Phases
| # | Phase | Status | Documents |
|---|---|---|---|
| 0 | Kick-off | done | 00-stato-progetto.md, pm/raid.md, spec/ |
| 1 | Discovery | done | 01-discovery.md |
| 2 | Requirements — GATE 1 | done (approved) | 02-requisiti.md |
| 3 | Architecture — GATE 2 | done (Option A) | 03-architettura.md, 03b-struttura-codice.md, adr/ |
| 4 | Detailed design | to do | 04…12 |
| 5 | Questions and approval — GATE 3 | to do | 13-piano-implementazione.md |
| 6 | Implementation | to do | reviews/, test-reports/ |
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
| 2026-11-01 | UI: shadcn/ui on Tailwind, Lucide, per-tenant tokens | Spec constraint | spec §10.2 |

## Approval log
| Date | Gate | Outcome | Scope / notes |
|---|---|---|---|
| 2026-11-01 | GATE 1 — Requirements | APPROVED by user | docs/02-requisiti.md v1.1 incl. assumptions A-1..A-39 and decisions REQ-1..REQ-16 |
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
