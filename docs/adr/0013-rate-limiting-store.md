# ADR-0013: Rate-limiting store (Postgres by default, port for others)

- Status: proposed
- Date: 2026-11-01
- Deciders: user (GATE 2), solution-architect, security-engineer

## Context
Limits: search 5/min/IP, public booking 10/h/IP, 3 open bookings per phone per tenant, login, reset, test email, exports (NFR-SEC-05, FR-PUB-10, FR-AUTH-08). In-memory counters fail on serverless. No Redis lock-in, no new paid vendor, IP-derived data must expire within 24 h (NFR-GDPR-02).

## Options considered
1. Postgres table with atomic upsert on `(key, window_start)`.
2. Upstash Redis (free tier, EU region): extra US-HQ sub-processor.
3. Vercel Firewall rate limits: Vercel-specific.
4. In-process memory (only valid for a single-instance VPS).

## Decision
Option 1 behind `RateLimitStore`: `INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`; keys are HMAC(server key, IP or username); fixed windows (sliding approximated by two windows where needed); rows purged by the hourly job within 24 h. Client IP derived only from the trusted proxy header with explicit `TRUSTED_PROXY_COUNT`. Fail mode: login/reset closed, public search/booking reads open. Responses 429 with `Retry-After`.

## Consequences
- One extra small query per limited request; fine at 100 concurrent sessions.
- Redis/Upstash or Vercel Firewall can be added as another adapter or extra layer without changing callers.
- Distributed attackers remain a residual risk (RK-1), per REQ-7.
