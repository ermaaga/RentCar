# ADR-0010: Production PostgreSQL provider and connection pooling

- Status: proposed (deferred to pre-GATE 4; code is provider-agnostic)
- Date: 2026-11-01
- Deciders: user (GATE 2, question ARC-6), solution-architect, devops-engineer

## Context
Production DB is not on Vercel, must be in the EU, serverless-compatible, low cost, with daily backups (NFR-BKP-01). RLS requires `SET LOCAL` inside transactions, hence transaction-mode pooling only. Deferred by the user ("poi vediamo", discovery C9).

## Options considered
1. **Neon** (AWS Frankfurt `aws-eu-central-1`): Free (1 GB per project, 100 CU-hours, suspend after 5 min, pooler up to 10,000 connections, 6 h restore window); Launch usage-based (USD 0.106/CU-hour, USD 0.35/GB-month, 7 days PITR). neon.com/pricing, 2026-11-01. Commercial-use wording on Free not stated on the page: verify.
2. **Supabase Pro** (EU region, USD 25/month, 8 GB, daily backups 7 days; Free pauses after 1 week of inactivity): fixed cost, no free production path.
3. Postgres on the VPS (option C): lowest cost, owner operates it.
4. EU-company managed Postgres (Scaleway, Aiven, Clever Cloud): not costed here (estimated EUR 10-20/month, unverified).

## Decision
Neon Frankfurt as the recommended provider for option A, **Launch plan in production** (Free plan only for development and preview branches); any provider works through `DATABASE_URL` (runtime, pooled) and `DIRECT_DATABASE_URL` (migrations/dumps). Rules: `pg` pool with small `max` (1 to 3 per function instance), short idle timeout, TLS `verify-full`, no session-level state, no session advisory locks (use transaction-level), no LISTEN/NOTIFY, no named prepared statements. The Free plan fails NFR-BKP-01 (6 h history) and, per devops-costs.md, free projects inactive for 90+ days are subject to deletion, so it is not used for production. In every provider case a nightly `age`-encrypted `pg_dump` (GitHub Actions) goes to a bucket at a different provider, key stored elsewhere, 30-day retention; restore tested once before go-live. Expected cost USD 5-15/month at launch and 10-25 at month 12 (devops estimate).

## GATE 2 note (2026-11-01)
Deferred to pre-GATE 4 by user decision: this ADR stays "proposed". The code is provider-agnostic: only `DATABASE_URL`, `DIRECT_DATABASE_URL` and documented env variables differ between hosting targets, and CI checks both a pooled and a direct connection path. The decision is recorded as accepted (or superseded) when the user chooses before GATE 4.

## Consequences
- Low, usage-bound DB cost; free branches for preview/staging.
- Cold start after 5 idle minutes (measure in spike S1); hourly job cadence avoids permanently awake compute.
- Neon is a US-HQ processor (Databricks) with EU data location: DPA/SCC to sign and list as sub-processor.
