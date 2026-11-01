# ADR-0014: Observability baseline and caching policy

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01)
- Deciders: user (GATE 2), solution-architect, observability-engineer

## Context
Not critical, no alerting, free tiers only behind an adapter (discovery D14, G27, G30). Observability input (`docs/03-inputs/observability-options.md`) proposes a tool-independent baseline. Caching must not break immediate effects (tenant suspension, availability) and must avoid paid Redis.

## Options considered
Observability: (1) baseline + optional Sentry free; (2) + Grafana Cloud Free via OTLP; (3) self-hosted GlitchTip/Uptime Kuma (VPS only); (4) paid APM (rejected).
Caching: (a) none beyond HTTP; (b) Next data cache/ISR for tenant pages; (c) Redis.

## Decision
- Observability: pino JSON logs to stdout with request id (AsyncLocalStorage), tenant id, user id, no PII; `/api/healthz` (liveness) and `/api/readyz` (DB, 1 s timeout); `ErrorReporter` port (`noop` default, `sentry` via env, also GlitchTip); `JobRun`, `EmailLog` and audit tables as durable evidence; business KPIs by SQL/system page; log retention <= 30 days; OpenTelemetry optional and off. Env switches `OBS_ERROR_PROVIDER`, `OBS_LOG_SINK`.
- Caching: `React.cache` per request for tenant, session and config; HTTP caching only for `/media/*` (immutable) and `theme.css` (versioned); no Next data cache or ISR for tenant state; availability, calendar and revenue computed live; no Redis. Revisit with measurements (Lighthouse CI, NFR-PERF).

## Consequences
- Cost 0; no vendor needed to operate; Sentry optional.
- Slightly more DB reads per request (accepted at this scale).
- With no alerting, failures are discovered by looking at the job-run, email and error views (accepted risk RK-10).
