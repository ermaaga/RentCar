# ADR-0011: Production hosting target (Vercel Pro, EU VPS as same-code alternative)

- Status: proposed
- Date: 2026-11-01
- Deciders: user (GATE 2, questions ARC-1 and ARC-2)

## Context
Phase 1 is local Docker Compose. Stated intent for production: app on Vercel, DB elsewhere. Facts checked 2026-11-01 on vercel.com: Hobby is "personal, non-commercial use only", crons once per day with +-59 min precision; Pro is USD 20 per developer seat per month with USD 20 included usage credit; functions run in one region (default `iad1`, changeable), 2 GB memory, 300 s default duration, 4.5 MB body cap, 250 MB bundle. Security input flags US processor and plan-terms concerns.

## Options considered
1. Vercel Pro, function region `fra1`, no Vercel-specific services (no KV, Blob, Image Optimization, Analytics, Speed Insights).
2. Single EU VPS with Docker Compose and Caddy (Hetzner, Scaleway or OVH): about EUR 11-20/month (devops estimate), owner operates; outbound SMTP ports 25/465 reportedly blocked by default on Hetzner (unverified, third-party).
3. EU managed container platform (Scaleway Containers, Clever Cloud, ...): not costed.
4. Vercel Hobby: forbidden for a commercial SaaS; allowed only for a pilot without paying tenants.

## Decision
Design for the strictest target (serverless) so that 1 and 2 are interchangeable by deployment configuration: Next.js `output: 'standalone'` Docker image for VPS, Vercel build for serverless; the only Vercel-aware code lives in `platform/*` adapters (e.g. reading the client IP header, region pin in `vercel.json`). Recommended production: Vercel Pro `fra1` + ADR-0010 + ADR-0009. The final hosting choice is the user's (ARC-2) and is not needed before go-live; Phase 1 does not depend on it.

## Consequences
- Predictable monthly cost (Vercel Pro USD 20 + Neon Launch USD 5-15 at launch) instead of ToS risk.
- Switching to the VPS needs: Caddy/Compose production file, backup job, secrets handling, runbook (about 1 week).
- DPA, SCC and DPF checks for Vercel remain a go-live prerequisite (SEC-6).
- Serverless compatibility must keep being exercised (preview smoke test) even if the VPS is chosen.
