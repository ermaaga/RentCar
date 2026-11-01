# Observability options per hosting setup (input to GATE 2)

2026-11-01 · Owner: observability-engineer · Status: proposal, analysis only · Phase 3

Inputs: `docs/01-discovery.md` (D14 not critical, G27 no alerts, G30 free tiers only behind an adapter, D13 < 50 tenants, C10 EU), `docs/02-requisiti.md` (FR-PLT-06, FR-PLT-08, FR-MAIL-04, FR-AUD-*, NFR-OBS-01/02, NFR-GDPR-06, NFR-SRV-01), `docs/spec/car-rental-spec.md` §2.

## 1. Summary and recommendation

- Baseline is **tool-independent and costs 0 EUR**: structured JSON logs to stdout, a health/readiness endpoint, a job-run log and an email-delivery log stored in the product database, and an error-tracking adapter that is a no-op by default.
- The vendor choice is a deployment-time env switch, never a code change (`OBS_ERROR_PROVIDER`, `OBS_LOG_SINK`, optional OTLP env vars).
- **Recommended per hosting**
  - Local Docker Compose: stdout logs (`docker compose logs`), no external tool. Optional: GlitchTip or Sentry DSN left empty.
  - Vercel + external EU Postgres: pino to stdout, **Sentry Developer (free)** for errors, **Grafana Cloud Free** (via log drain or OTLP) only if searchable logs beyond the Vercel retention are wanted. See the licence caveat on Vercel Hobby in section 4.
  - EU VPS with Docker: stdout logs with Docker log rotation, **GlitchTip self-hosted** (or Sentry free if the DSN is allowed to leave the VPS), Uptime Kuma optional. Zero licence cost, small RAM cost on the VPS.
  - EU managed container platform: platform log viewer plus Sentry free; Grafana Cloud Free if the platform can ship logs or OTLP.
- Estimated monthly cost for all recommended setups: **0 EUR** within free tiers at the declared scale (see section 5). OpenTelemetry traces are optional and off by default.

## 2. Minimal baseline (applies to every option)

| # | Item | Detail | Requirement |
|---|---|---|---|
| B1 | Structured JSON logs | One JSON object per line on stdout (pino). Fields: `timestamp` (ISO 8601 UTC), `level`, `message` (English), `event` (stable name, e.g. `booking.created`), `service`, `env`, `version`, `requestId` (correlation ID), `tenantId`, `userId` (internal id, only for authenticated staff), `durationMs`, `errorCode`. `debug` off in production. | FR-PLT-08, NFR-OBS-01 |
| B2 | Correlation ID | Middleware reads `x-request-id` or generates a UUID, stores it in AsyncLocalStorage, adds it to every log line, to the error-tracker scope and to the response header. If OpenTelemetry is enabled later, `traceId` is added with the same mechanism (W3C `traceparent`). | FR-PLT-08 |
| B3 | Health endpoint | `GET /api/healthz` (liveness, no dependencies) and `GET /api/readyz` (DB reachable with a 1 s timeout). Return only `{status}` and no versions or hostnames. Excluded from access logs. Used by the Compose `healthcheck` and by an external uptime pinger later. | FR-PLT-06, spec §2 |
| B4 | Error tracking adapter | `ErrorReporter` interface (`captureException`, `setContext`), providers `noop` (default), `sentry` (also used for GlitchTip, same SDK). Scrubbing hook (section 6) runs before send. Also logs every captured error as an `error` log line so nothing depends on the vendor. | NFR-OBS-01 |
| B5 | Job run log | Table `JobRun` (platform scope, rows may carry `tenantId`): `jobName`, `startedAt`, `finishedAt`, `status` (success, partial, failed), `processedCount`, `errorSummary` (no PII), `trigger` (cron, manual, lazy). One `info` log line per run plus one per failed tenant. Covers status transitions, year-end snapshots, snapshot corrections, expiry marking and reminders, yearly privacy reminder. Visible to the systemadmin in the console. | FR-PLT-05, NFR-OBS-01 |
| B6 | Email delivery log | Table or audit-style record per email: `emailType`, `tenantId`, `bookingId` or `userId` (ids only, no address), `status` (sent, failed, skipped_no_smtp), `errorSummary`, `attempt`, timestamps. Feeds the admin view and resend (FR-MAIL-04) and the email failure rate KPI. | FR-MAIL-04, NFR-OBS-02 |
| B7 | Business KPIs without tooling | SQL views or a systemadmin page: bookings per tenant per month, revenue per tenant, email failure rate, last job run per job. No metrics backend required. | KPI-7, NFR-OBS-02 |
| B8 | Audit log | Already specified (FR-AUD-*). It is a product feature, not a logging sink: it stays in the database with 24 months retention. | FR-AUD-03 |
| B9 | Logging policy | Log retention at most 30 days wherever the platform allows it (NFR-GDPR-06). Never log request/response bodies. | NFR-GDPR-06 |

Critical events to emit (NFR-OBS-01), all as `info` unless noted: `public.search`, `public.vehicle_selected`, `public.booking.submitted`, `booking.created`, `booking.conflict` (warn), `booking.failed` (error), `auth.login.succeeded`, `auth.login.failed` (warn), `auth.lockout` (warn), `booking.edited`, `email.sent`, `email.failed` (warn), `pdf.generated`, `pdf.failed` (error), `job.started`, `job.finished`, `job.failed` (error), `tenant.suspended`, `subscription.expired`.

## 3. Lightweight SLIs (measured, no alerting)

Criticality is low (D14), so these are **reporting indicators with indicative targets**, reviewed manually (monthly or after a release). No error-budget policy, no burn-rate alerts.

| SLI | Definition | Source | Indicative target |
|---|---|---|---|
| Public booking success rate | `booking.created` / (`booking.created` + `booking.failed`), excluding `booking.conflict` (valid business outcome) | logs or DB | >= 99% |
| Availability (synthetic, optional) | `readyz` 200 responses / probes from one external pinger | UptimeRobot-type free monitor, Better Stack free, or Uptime Kuma | >= 99% monthly (about 7 h of tolerated downtime) |
| Public search latency | p95 of `durationMs` for the search route | logs | < 1.5 s |
| Booking submit latency | p95 of `durationMs` for submit | logs | < 2 s |
| Server error rate | 5xx / all requests | logs | < 1% |
| Email delivery rate | `email.sent` / (`email.sent` + `email.failed`) | email delivery log | >= 95% (tenant SMTP outside our control) |
| Job freshness | age of last successful run per job | `JobRun` | daily jobs < 26 h, year-end snapshot present by 2 January |

On Vercel Hobby the log retention is too short to compute log-based SLIs (section 4), so SLIs that matter are derived from the database (`JobRun`, email log, bookings) and the optional external pinger.

## 4. Options per hosting setup

### 4.1 Tools, limits and cost (verified 2026-11-01)

| Tool | Free tier limits (as verified) | Fit | Source |
|---|---|---|---|
| Sentry Developer (SaaS) | 1 user, 5k errors, 5M spans, 5 GB logs, 50 replays, 30-day lookback, 1 uptime monitor, 1 cron monitor, unlimited projects | Error tracking with sourcemaps and release tracking; the cron monitor can watch the daily job | [sentry.io/pricing](https://sentry.io/pricing/) fetched 2026-11-01 |
| GlitchTip (self-hosted) | MIT licence, no event cap; about 512 MB RAM minimum, 2 GB recommended; 4 containers (web, worker, Postgres, Redis/Valkey optional in newer versions); Sentry-SDK compatible. Hosted GlitchTip free tier figures conflict between secondary sources (about 1,000 events/month): not relied upon | Error tracking fully inside the EU; costs VPS RAM and upgrade effort | Secondary sources only, e.g. [selfhosting.sh guide](https://selfhosting.sh/apps/glitchtip/); verify on glitchtip.com before adoption |
| Grafana Cloud Free | 10k active metric series, 50 GB logs, 50 GB traces, 50 GB profiles per month, 14-day retention, 3 users; over-limit data is discarded | Searchable logs (Loki) and OTLP traces if a drain or exporter is available; EU region selectable at stack creation | grafana.com pricing and free-tier pages via search results 2026-11-01 (page itself not fetched; secondary confirmation) |
| Better Stack Free | Telemetry: 3 GB logs retained 3 days, 30 GB metrics; 10 monitors and heartbeats, 1 status page, 100k exceptions/month; described as free "for personal projects" | Uptime pings and heartbeat for jobs; logs retention (3 days) is short | [betterstack.com/pricing](https://betterstack.com/pricing.md) fetched 2026-11-01 |
| Vercel Hobby runtime logs | 1 hour of runtime logs (about 4,000 rows per another Vercel page), 100k..1M free invocations, no log drains (Drains need Pro). **Hobby is restricted to non-commercial, personal use** (fair use guidelines) | Enough to debug a live issue only | [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby) updated 2026-09-14; [limits](https://vercel.com/docs/limits) |
| Vercel Pro | Runtime logs 1 day, Drains configurable, developer seat 20 USD/month | Needed if the SaaS is commercial (platform has paying tenants) | same Hobby page, 2026-11-01 |
| Uptime Kuma (self-hosted) | MIT, about 100-150 MB RAM, one container | Uptime checks and status page from the VPS itself (a pinger on the same host cannot see host outages) | not re-verified, well-known; no cost |
| OpenTelemetry SDK + collector | Open standard, no licence cost; cost is backend ingestion (Grafana free above) and added complexity (`@vercel/otel` or `@opentelemetry/sdk-node`) | Optional; useful to find slow queries and PDF generation time | spec-independent |

Important flag for GATE 2: **Vercel Hobby forbids commercial use**. If RentCar is sold to tenants (subscriptions), the Vercel option implies Pro (about 20 USD per developer seat per month) regardless of observability. This is a hosting cost for devops/architect to price; it is mentioned here because it also changes log retention (1 hour to 1 day) and enables log drains.

### 4.2 Option matrix

| Hosting | Option | Logs | Errors | Uptime | Monthly cost | Effort | Lock-in | Notes |
|---|---|---|---|---|---|---|---|---|
| Local Docker Compose | **L1 (recommended)**: baseline only | `docker compose logs`, json-file driver with rotation (`max-size: 10m`, `max-file: 3`) | `noop` or Sentry DSN if wanted | Compose healthcheck | 0 EUR | none | none | Matches acceptance criterion 1 |
| Local Docker Compose | L2: add GlitchTip container in a separate `compose.observability.yml` profile | same | GlitchTip | same | 0 EUR (about 1 GB RAM locally) | low | none | Only to rehearse the VPS setup |
| Vercel + external EU Postgres | **V1 (recommended)**: baseline + Sentry free | Vercel runtime logs (1 h Hobby / 1 day Pro) | Sentry Developer, EU data region at signup | optional Sentry uptime monitor or UptimeRobot/Better Stack free | 0 EUR (Hobby caveat above) | low | low (adapter) | Durable facts live in DB: `JobRun`, email log, audit log |
| Vercel + external EU Postgres | V2: V1 + Grafana Cloud Free | OTLP/HTTP log export from the app logger (no drain needed) or Vercel drain on Pro | Sentry | Grafana synthetic is not free; use V1 pinger | 0 EUR | medium | low (OTel) | Adds 14-day searchable logs. Log shipper must be non-blocking and short-timeout (serverless, NFR-SRV-01) |
| EU VPS with Docker | **S1 (recommended)**: baseline + GlitchTip self-hosted + Uptime Kuma (optional) | Docker json-file with rotation, `docker logs`, optional Loki later | GlitchTip (data stays on the VPS) | Uptime Kuma, or external free pinger | 0 EUR licences; needs about 1-2 GB extra RAM, which may push a 2 GB VPS up one size (devops to price, roughly a few EUR/month) | medium (updates, backups of GlitchTip DB) | none | No third-party processor for error data, simplest GDPR story |
| EU VPS with Docker | S2: baseline + Sentry free | as S1 | Sentry SaaS | external pinger | 0 EUR | low | low | Smaller VPS; error data leaves the box (scrubbed) |
| EU managed container platform | **M1 (recommended)**: baseline + Sentry free | Platform log viewer (retention varies, to verify per chosen platform) | Sentry | external pinger / platform health probe | 0 EUR | low | low | Platform health probe uses `readyz` |
| EU managed container platform | M2: M1 + Grafana Cloud Free | OTLP or syslog/HTTP shipper if supported | Sentry | external pinger | 0 EUR | medium | low | Only if the platform retention is under 7 days |

Rejected for now: Datadog, New Relic, Elastic Cloud, CloudWatch-style native stacks (no free tier fit or cost grows with volume); self-hosted Prometheus + Grafana + Loki + Tempo (too much operations effort for a one-person owner at this scale); Better Stack as primary log store (3-day free retention and "personal projects" wording).

### 4.3 Volume estimates (basis for the "free is enough" claim)

Assumptions: 50 tenants, each with about 300 public searches and 60 bookings per month, plus staff use, in the worst case at the 12-month horizon.

- Requests: about 50 x (300 x 3 + 60 x 10 + 2,000 admin) = about 175k requests/month.
- Logs: one access/event line (about 400 B) per request plus event lines: about 0.1-0.2 GB/month (limit 50 GB Grafana, 5 GB Sentry logs). Healthcheck lines excluded.
- Errors: expected below 500/month in a healthy system; Sentry free allows 5k. A crash loop could exhaust it in hours: use client-side sampling and `beforeSend` dedup (rate cap, e.g. 50 events/hour).
- Metrics: none required in baseline (KPIs from SQL). If OTel metrics are enabled, fewer than 500 series with `tenantId` as the only high-cardinality label (50 values): far below 10k.
- Traces: sampled at 10% (errors 100%) is below 20k spans/month; the Sentry 5M span allowance is not a constraint.

## 5. Cost summary

| Setup | Monthly cost (observability only) | Notes |
|---|---|---|
| L1 local | 0 EUR | |
| V1 Vercel + Sentry free | 0 EUR | Vercel plan cost not included (Hobby is non-commercial; Pro about 20 USD/seat/month per Vercel docs, 2026-11-01) |
| V2 Vercel + Sentry + Grafana free | 0 EUR | |
| S1 VPS + GlitchTip | 0 EUR licence; extra RAM possibly a few EUR/month (devops-engineer to confirm) | |
| S2 VPS + Sentry free | 0 EUR | |
| M1/M2 managed container | 0 EUR | Platform log retention to be verified once the platform is chosen |

Exceeding a free tier never auto-charges in these setups: Sentry Developer and Grafana Free drop excess data (Sentry log overage 0.50 USD/GB only applies if the account is upgraded or on-demand is enabled; keep it off). Free tiers can change; re-check at adoption.

## 6. PII redaction and GDPR rules

The platform is processor for tenants (discovery D15). Logs, traces and error reports must contain **no personal data and no secrets**.

1. **Allowlist logging**: log functions accept typed fields (ids, enums, numbers, durations). Free-form objects (`req.body`, `customer`, `user`) are never passed to the logger.
2. **Never logged or sent to the error tracker**: customer first/last name, phone, email, notes, driver data; passwords, temporary passwords, reset tokens, session ids/cookies, `Authorization` and `Cookie` headers, `SESSION_SECRET`, SMTP credentials (platform and tenant), S3 keys, `DATABASE_URL`; full request or response bodies; PDF content; SMTP server responses that echo addresses.
3. **Identifiers instead**: `tenantId`, `userId` (staff), `bookingCode` or `bookingId`, `customerId`. A booking code alone cannot identify a person outside the system. Anonymised customers (FR-CUS) therefore never appear in logs.
4. **IP addresses**: not logged by the application. Rate limiting stores hashed or truncated keys only. Platform access logs (Vercel, VPS reverse proxy) may contain IPs: retention at most 30 days (NFR-GDPR-06), configure on VPS, accept the platform default on Vercel.
5. **Pino `redact`** with explicit paths (`*.password`, `*.token`, `req.headers.authorization`, `req.headers.cookie`, `*.email`, `*.phone`, `*.firstName`, `*.lastName`, `*.smtpPassword`) as a second line of defence, plus a CI unit test that logs a fixture containing PII and asserts the output has none.
6. **Error tracker**: `sendDefaultPii: false`, no user object except `{id: userId}` and tag `tenantId`; `beforeSend` and `beforeBreadcrumb` strip request body, query string values for known sensitive keys, cookies and headers; no session replay and no request-body capture; breadcrumbs for console and fetch limited. Exception messages must not interpolate PII (lint rule or review item: use codes and ids).
7. **Error-tracker location**: pick the **EU region** for Sentry at signup; document Sentry (or Grafana) as a sub-processor in the privacy notice. GlitchTip on an EU VPS avoids a sub-processor.
8. **Retention**: application logs at most 30 days (Docker rotation, Grafana 14 days, Sentry 30 days all comply); audit log 24 months; `JobRun` and email log 12 months with a purge job (ids and status only).
9. **Frontend**: no browser error tracking, RUM or replay in the baseline; this avoids cookies and consent (discovery E21). If added later, load only after consent unless it is strictly technical and cookieless.
10. **Verification** (for the later verification phase): trigger a booking with a distinctive name/phone, a failed login and a forced exception on staging, then grep logs and error-tracker payloads for those strings.

## 7. What to add later when alerting becomes needed

Not in scope now (G27, D14); listed so that the baseline does not block it.

| Trigger to revisit | Addition | Cost note |
|---|---|---|
| First paying tenants depend on bookings, or any tenant asks for an SLA | External uptime check on `readyz` plus one synthetic journey (search returns results) from an EU region; alert by email to the owner | Better Stack free or UptimeRobot free: 0 EUR |
| Job failures go unnoticed | Heartbeat/cron monitor per daily job (Sentry cron monitor included in free tier, or Better Stack heartbeat); alert if no run in 26 h | 0 EUR |
| Error spikes | Sentry issue alert on new issue or on volume to owner email | 0 EUR |
| Need for SLOs | Promote section 3 SLIs to SLOs (99% booking success, 99% availability), add error budget and multi-window burn-rate alerts (Grafana alerting) | 0 EUR on Grafana free if series stay below 10k |
| Slow requests or DB load | Enable OpenTelemetry traces (HTTP, Prisma/Drizzle, outgoing SMTP/S3), 10% head sampling + 100% errors, export OTLP to Grafana | 0 EUR within free tier |
| More than one person on call | On-call schedule, severity P1/P2/P3, runbook per alert, status page, incident process and post-mortems (`docs/12-osservabilita.md` full version) | Status page free tiers exist; on-call tooling may cost |
| Logs needed beyond 1 hour/3 days | Loki via Grafana Cloud or a self-hosted Loki on the VPS | 0 EUR / low |

Design constraints to keep that door open now: stable `event` names, `requestId` everywhere, `JobRun` table, `readyz`, provider selection by env, no vendor SDK imports outside the adapter.

## 8. Proposed items for the requirements and architecture teams

- Add to FR-PLT-08: `JobRun` table and email delivery log as explicit deliverables (already implied by FR-MAIL-04); health route names `/api/healthz` and `/api/readyz` (FR-PLT-06 mentions one endpoint; two are proposed so that Compose liveness does not fail on a DB blip).
- ADR needed: `ErrorReporter` and `LogSink` adapters (env-driven providers) and the redaction policy.
- Devops: Docker log rotation in `compose.yml`, healthcheck on `readyz`, optional `observability` Compose profile, secrets for DSNs.
- Security: confirm the redaction list (section 6) and the sub-processor wording in the privacy notice.

## Esito
- **Stato**: completato
- **File prodotti/modificati**: `/Users/ermaaga/Work/RentCar/docs/03-inputs/observability-options.md`
- **Sintesi**:
  1. Baseline at 0 EUR and vendor-independent: JSON logs with `tenantId` and correlation ID, `/api/healthz` + `/api/readyz`, `ErrorReporter` adapter (noop by default), `JobRun` table, email delivery log, KPIs from SQL.
  2. Local Docker Compose: baseline only (L1), optional GlitchTip profile.
  3. Vercel + external Postgres: Sentry Developer free (EU region) for errors, Grafana Cloud Free optional for 14-day searchable logs; Vercel Hobby keeps only 1 hour of runtime logs, so durable facts live in the DB.
  4. EU VPS: GlitchTip self-hosted (+ Uptime Kuma optional), no third-party processor; EU managed container: platform logs + Sentry free.
  5. All recommended setups cost 0 EUR in licences within free tiers at < 50 tenants (volumes estimated in section 4.3); free-tier limits verified 2026-11-01 (Sentry and Better Stack official pages fetched; Grafana via search results of its own pages; GlitchTip from secondary sources only).
  6. Lightweight SLIs without alerting: booking success rate, availability (optional pinger), p95 latencies, 5xx rate, email delivery rate, job freshness.
  7. PII rules: allowlist logging, redact paths, no IP logging in the app, Sentry `sendDefaultPii: false` and scrubbing, no frontend RUM/replay, logs <= 30 days.
  8. Roadmap for when alerting is needed (uptime pinger, cron monitors, Sentry alerts, SLO burn-rate, OTel traces) is documented, all feasible on free tiers.
- **Assunzioni**:
  - ASSUNZIONE: two health routes (`/api/healthz`, `/api/readyz`) are acceptable instead of one.
  - ASSUNZIONE: EU region is selectable for Sentry and Grafana at signup; to be confirmed when accounts are created.
  - ASSUNZIONE: volume estimates (50 tenants, about 175k requests/month) are the worst case at 12 months.
  - ASSUNZIONE: Uptime Kuma figures and GlitchTip requirements come from general knowledge and secondary sources; verify before adoption.
  - ASSUNZIONE: platform log retention of the managed container provider is unknown until the provider is chosen.
- **Rischi**:
  - media: Vercel Hobby plan is non-commercial; a paid SaaS on Hobby breaches fair use and forces Pro (cost for devops/architect).
  - media: Vercel Hobby 1-hour runtime logs make post-incident diagnosis hard without a log export; mitigated by DB-backed job/email logs and Grafana option.
  - media: a PII leak via an exception message or logged object; mitigated by allowlist logger, redact paths and a CI test.
  - bassa: Sentry free quota exhausted by an error loop (events dropped); mitigated by rate cap in `beforeSend`.
  - bassa: free-tier terms may change; re-check at adoption (Better Stack free is worded "for personal projects").
- **Rilievi bloccanti** (solo review/test): n/a
- **Criteri non verificati**: nessuno (analysis only; no Must criterion verified here; the NFR-OBS-01 log review is planned for the verification phase).

## Domande per l'utente
| ID | Domanda | Opzioni (la prima è raccomandata) | Perché conta / impatto | Bloccante |
|---|---|---|---|---|
| OBS-1 | Per ora vuoi solo i log del programma (nessun servizio esterno), oppure attivare subito la segnalazione automatica degli errori? | A (raccomandata): solo log + tabelle interne in locale; Sentry gratuito (regione UE) quando andrete su Vercel / B: Sentry gratuito subito anche in locale / C: GlitchTip sul proprio server | Sentry gratuito e' il piu' semplice ma i dati degli errori (ripuliti da dati personali) passano da un fornitore da citare nell'informativa privacy; GlitchTip tiene tutto in casa ma richiede un po' di manutenzione | no |
| OBS-2 | Il servizio verra' venduto a pagamento ai noleggiatori? Se si', su Vercel serve il piano a pagamento (circa 20 USD/mese per utente), perche' il piano gratuito e' solo per uso personale non commerciale | A (raccomandata): considerare il costo Vercel Pro nella scelta dell'hosting (decide l'architetto/devops) / B: scegliere VPS o piattaforma container UE che non hanno questo vincolo | Cambia il costo mensile reale e la durata dei log (1 ora gratuito, 1 giorno a pagamento) | no (si per GATE 2 hosting) |
| OBS-3 | Vuoi un controllo esterno gratuito "il sito risponde?" con solo una email al titolare, pur senza reperibilita'? | A (raccomandata): no per ora, si aggiunge quando arriva il primo cliente pagante / B: si subito (UptimeRobot o Better Stack gratuito, 0 EUR) | Senza controllo esterno, un sito fermo si scopre solo quando qualcuno protesta; con la B hai almeno una email | no |
| OBS-4 | Quanto devono durare i log tecnici (senza dati personali)? | A (raccomandata): 14-30 giorni dove la piattaforma lo consente (giorni/ore su Vercel gratuito) / B: 7 giorni | Trade-off tra capacita' di indagare problemi vecchi e minimizzazione dei dati GDPR | no |
| OBS-5 | Ti basta vedere i KPI (prenotazioni e ricavi per noleggiatore, email non consegnate, ultimo avvio dei job) in una pagina del pannello systemadmin invece di un tool di dashboard? | A (raccomandata): si, pagina interna alimentata da query SQL / B: dashboard Grafana (richiede un account e configurazione) | Evita tool esterni e costi; la dashboard esterna ha senso solo con piu' tenant e piu' metriche | no |
