# Discovery

2026-11-01 · Owner: PM · Source: user answers (Italian) + `docs/spec/car-rental-spec.md`

## Project summary
RentCar is a multi-tenant SaaS for car rental businesses. The software owner (systemadmin) onboards rental businesses (tenants) with manually managed subscriptions. Each tenant gets a branded public booking site at `/{slug}` (search → available vehicles → booking with pay-on-site) and an admin area for fleet, bookings, calendar, customers, expenses and revenue, plus view-only operators. First target: run fully in local Docker Compose; later the app is meant to be deployed on Vercel, with the database hosted elsewhere. Small scale (1–10 tenants at launch, < 50 in 12 months), Italy/EU market, English-only UI.

## Answers
| # | Topic | Answer | Source |
|---|---|---|---|
| A1 | Problem / users | Booking + fleet management for small and medium rental businesses; roles systemadmin, admin, operator, anonymous customer | spec §1, §4 |
| A2 | Product type | Multi-tenant SaaS for many independent rental businesses | user |
| A4 | MVP scope | Whole spec (acceptance criteria 1–11), delivered in milestones | user |
| A5 | Existing systems | None; greenfield, empty repository | dedotto |
| B6 | Development budget | Not stated; development is done by the agent team. Paid third-party services should be avoided | user (implicit) |
| B7 | Monthly running budget | Not stated; prefer free tiers (monitoring explicitly free tiers only) | user |
| B8 | Deadline | No fixed deadline; full scope with quality | user |
| C9 | Hosting | **Phase 1: local only with `docker compose`.** Production hosting decided later; intent: **app on Vercel, DB not on Vercel** (external Postgres) | user |
| C10 | Data residency | EU (Italy/EU tenants, GDPR) | dedotto from market answer |
| C11 | Who runs infra | The owner (user); no dedicated ops staff | dedotto |
| C12 | Domains | Path-based `/{slug}` now; **design tenant resolution in one place so custom domains per tenant can be added later** | user |
| D13 | Scale | 1–10 tenants at launch, < 50 in 12 months; fleets of a few dozen vehicles each | user |
| D14 | Criticality | **Not critical for now**: no alerting/on-call required in this phase | user |
| D15 | Personal / payment data | Customer personal data (name, phone, optional email); no online payments (pay on site, card or cash recorded manually). GDPR applies; platform acts as processor for tenants (controllers) | spec §6 + dedotto |
| D15b | Security standards | None stated; OWASP ASVS level to be set by cybersecurity-manager | DELEGATO AL TEAM |
| D16 | Accessibility | WCAG AA contrast is required by spec; full WCAG 2.2 AA recommended (EAA applies to B2C e-commerce-like services in the EU) | spec §10.2 + dedotto |
| D17 | Devices | Mobile-first web for both customer flow and admin (320px+), tablet, desktop; no native app, no offline | spec §10.1 |
| E18 | Stack | **Fixed by spec**: Next.js App Router + TypeScript, PostgreSQL via Prisma or Drizzle, Zod, shadcn/ui + Tailwind, Lucide, server-side PDF, Docker Compose, pluggable DB/storage, no Vercel-specific APIs unless behind an adapter | spec §2, §10 |
| E19 | Integrations | Per-tenant SMTP; system SMTP; S3-compatible storage. No payments, no SSO, no e-invoicing | spec |
| E20 | SEO | Public booking pages per tenant exist; SEO not stated as a goal → seo-specialist to define a minimal baseline | DELEGATO AL TEAM |
| E21 | Analytics / cookies | Not requested; avoid non-essential cookies (no cookie banner needed if only session cookies) | DELEGATO AL TEAM |
| E22 | Content / brand | Each tenant supplies its own logo, colors, font choice; platform default theme defined by ui-designer | spec §10.2 |
| F23 | UI languages | **English only**, simple single-locale i18n structure (texts in a message catalog) | user + spec §10 |
| F25 | Markets | Italy/EU; **one currency per tenant** (EUR default); per-tenant time zone (Europe/Rome default) | user |
| F26 | Docs language | **English for all docs** (analysis, ADRs, technical docs). Questions to the user in Italian | user |
| G27 | Alerts | None for now | user |
| G30 | Monitoring tools | Free tiers only, behind an adapter (e.g. structured logs + optional Sentry free) | user |
| G31 | Status page | Not needed | dedotto |
| H32–35 | Usage context / style | Customers: on smartphones, often in a hurry (travellers). Admin/operators: at the counter or on the move, frequent daily use, phone and desktop. Style fixed by spec: modern, professional, rounded, soft shadows | spec §10 + dedotto |

## Baseline decisions
- Code language: **English** (fixed)
- UI language: English only at launch; default `en`; no fallback needed; texts in a message catalog
- Documentation language: English (technical and analysis); user manuals in English
- Service criticality: low for now; no alert recipients, no on-call; free-tier error tracking optional; business KPIs: bookings per tenant, revenue (already in the product)
- Usage context: mobile-first for customers and staff; feeling "modern and professional"; brand per tenant

## Key discriminants for technical choices (by weight)
1. **Stack is fixed by the spec** (Next.js, PostgreSQL, ORM, shadcn/ui) — architecture options concern ORM, auth library, PDF engine, storage/email/jobs adapters, hosting of the DB, not the framework.
2. **Must run end-to-end with `docker compose up`** locally (acceptance criterion 1) — first deliverable target.
3. **Must also be deployable on Vercel (app only) with an external Postgres** later → serverless-compatible design: no reliance on local filesystem in production (S3 storage), DB connection pooling, PDF engine that works in serverless (favours `@react-pdf/renderer` over Puppeteer), scheduled jobs (year-end snapshot) behind an adapter (e.g. Vercel Cron / container cron / lazy creation), no long-running processes.
4. **Low running cost**: free tiers preferred; small scale (< 50 tenants).
5. **EU data residency and GDPR** (customer personal data, per-tenant SMTP credentials).
6. **Strict tenant isolation** with cross-tenant tests (spec §10).
7. **Pluggability**: DB and storage swappable via env only (acceptance criterion 10).
8. **Future custom domains per tenant**: single tenant-resolution point.

## Hard constraints (non-negotiable)
- Spec §2 stack and §10 non-functional requirements; acceptance criteria 1–11.
- English-only code, docs and UI.
- No Vercel-specific API outside an adapter.
- Fonts self-hosted (no third-party CDN).

## Still open
- Production DB provider and storage provider (deferred by user: "poi vediamo") → architect proposes EU options compatible with Vercel.
- Functional gaps in the spec (day-count rule for partial days, booking status transitions, year-end snapshot trigger, customer de-duplication, subscription expiry behaviour on public site, cancellation rules, privacy notice ownership) → requirements analysis.
