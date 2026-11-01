# DevOps input: environments, hosting cost and operational effort

2026-11-01 · Author: devops-engineer (estimate mode, Phase 3) · Input for GATE 2 and `docs/03-architettura.md`
Status: analysis only. No code, no infrastructure created.

Conventions: **[V]** = verified on an official page on 2026-11-01 (source in section 12). **[E]** = my estimate or recollection, not verified. Prices exclude VAT. USD amounts converted at an **assumed** 1 USD = 0.90 EUR [E]. A VAT-registered Italian business normally buys these services with reverse charge, so VAT is not a cost, but invoices come from non-Italian entities.

## 1. Summary for the architect

| Candidate | Launch (1-10 tenants) | 12 months (< 50 tenants) | Ops effort | Meets NFR-BKP-01 as-is | Commercial licence OK |
|---|---|---|---|---|---|
| A0. Vercel **Hobby** + Neon Free + R2 | $0 | $0 | ~1 h/month | no (Neon Free: 6 h history) | **NO (non-commercial only)** |
| **A1. Vercel Pro + Neon Free + R2** (pre-revenue / first tenant) | ~$20 (~EUR 18) | n/a (outgrown) | ~1-2 h | only with external dump | yes |
| **A2. Vercel Pro + Neon Launch + R2** | **$25-35 (~EUR 23-32)** | **$30-45 (~EUR 27-41)** | ~1-2 h | yes (7-day PITR) + external dump for 35-day retention | yes |
| A3. Vercel Pro + Supabase Pro + R2 | ~$45 (~EUR 41); +$100 with PITR | ~$45-70 | ~1-2 h | daily backup 7 days; RPO 24 h | yes |
| **B. Hetzner VPS (Docker Compose + Caddy + Postgres + R2/MinIO)** | **~EUR 11-13** | ~EUR 11-20 | **~3-5 h** | only with our own scripts | yes |
| C1. Render (Starter web + Basic Postgres, Frankfurt) | ~$13-15 (~EUR 12-14) | $26-44 (~EUR 23-40) | ~1-2 h | PITR 3 days (Hobby workspace) | confirm Render terms [E] |
| C2. Railway / Fly.io / Scaleway | $15-30 [E] / $17-46 [V+E] / EUR 15-30 [E] | higher | 2-4 h | partly self-managed | confirm |

Recommendation for the architect (not a decision): **A2** is the best fit for the user's stated intent (Vercel + external Postgres) and lowest ops effort; **B** is the cheapest and fully EU/no-US-vendor option but costs the most owner time and has an SMTP port issue (section 7). **A0 must not be used for a commercial product** (section 3).

## 2. Environments

| Environment | Purpose | Runtime | Data | Cost |
|---|---|---|---|---|
| Local | Development, acceptance criterion 1 | `docker compose up`: app + Postgres 16, healthcheck (`pg_isready`), named volume, migrations on start, seed. Optional profiles: `minio` (S3 adapter test), `mailpit` (SMTP sink) | Fake seed | EUR 0 |
| CI | Lint, types, tests with Postgres service container, build, security scans | GitHub Actions | Ephemeral | free tier [E] (see 9) |
| Preview (optional, per PR) | Review and E2E | A: Vercel preview deployment + Neon branch (Free: 10 branches [V]). B: not offered; use a second Compose project only on demand | Anonymised/fake | A: EUR 0 within plan |
| Staging (recommended minimal) | DAST (ZAP) and release rehearsal before production, `noindex`, access protected | A: Vercel preview alias (or a second Vercel project) + Neon branch of production schema with fake data. B: a second Compose project on the same VPS (isolated network/ports, `noindex`, basic auth) or a CX23 at EUR 5.99 [V] only when needed | Fake / anonymised | A: ~EUR 0; B: EUR 0-6 |
| Production | Real tenants | See candidates | Real, EU only | Section 3 onwards |

ASSUMPTION: no permanent staging at launch (low criticality, discovery D14); staging is a Vercel preview + DB branch (A) or a second Compose project (B). Production deploys only from the pipeline.

## 3. Vercel plan licensing for a commercial SaaS (critical)

- **[V]** Vercel Pricing page: "Our Hobby plan is for personal, non-commercial use." Fair Use Guidelines (last updated 2026-09-14): "**Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan.**"
- **[V]** Definition: commercial usage is any deployment "used for the purpose of financial gain of **anyone** involved in **any part of the production** of the project, including a paid employee or consultant writing the code". Examples include "receiving payment to create, update, or host the site" and "requesting or processing payment from visitors".
- Consequence for RentCar: a multi-tenant SaaS billed to rental businesses (subscriptions managed manually, spec section 5) is commercial. Hobby is acceptable only for a private prototype with no paying tenant and no one paid to build it. Using Hobby for production risks suspension of the deployment, and the user would be in breach of the Terms of Service. **Production requires Pro (or Enterprise).** The tenants' own bookings being "pay on site" does not change this: the platform fee is the commercial element.
- **[V]** Pro: $20/month, includes $20 usage credit; pay-as-you-go beyond it (functions $0.60 per 1M invocations, Active CPU from $0.128/h, memory from $0.0106 per GB-h, Fast Data Transfer 1 TB included). Hobby cannot buy extra usage; it is hard-capped. Whether the $20 is per seat is not stated on the pricing page; [E] historically per member. The owner is the only member, so 1 seat.
- Practical differences that matter here (all [V]):

| | Hobby | Pro |
|---|---|---|
| Commercial use | No | Yes |
| Cron jobs | max once per day, run any time in the hour (+/- 59 min) | once per minute, per-minute precision |
| Function max duration | 300 s | default 300 s, max 800 s |
| Function memory | 2 GB / 1 vCPU | up to 4 GB / 2 vCPU |
| Runtime log retention | 1 hour | 1 day |
| Regions | single region | multi-region possible |
| Overage | blocked | pay-as-you-go (set a spend limit [E]) |

- Region: functions default to a **single region `iad1` (US East)** [V]. It must be set explicitly to an EU region (`fra1` or `cdg1` [E: region codes]) and placed next to the database (Neon Frankfurt). Otherwise personal data is processed in the US and latency to the DB is high.
- GDPR note for the security-engineer: Vercel Inc. is a US company. Functions can be pinned to the EU, but the control plane, logs and the edge network are global. We need Vercel's DPA with SCCs/Data Privacy Framework [E], must not cache personal data at the CDN (booking pages with customer data: `Cache-Control: private/no-store`), and must avoid personal data in runtime logs.

## 4. Candidate A: Vercel + external Postgres + external object storage

### 4.1 Database options (EU)

| | Neon (AWS Frankfurt `aws-eu-central-1` or London [V]) | Supabase (EU region [E]) |
|---|---|---|
| Free | $0, 100 CU-h/project/month, 1 GB/project, scale to zero after 5 min (cannot be disabled), **history window 6 h**, 5 GB egress [V] | $0, 500 MB, **paused after 1 week of inactivity**, 2 active projects, **no automatic backups** [V] |
| Paid | Launch: pay-as-you-go, **$0.106 per CU-h**, $0.35/GB-month, history up to **7 days**, 500 GB egress, scale-to-zero optional. Example from Neon: ~140 CU-h + 1 GB ~ $15/month [V] | Pro from $25/month, 8 GB disk, then $0.125/GB, no pausing, **daily backups kept 7 days**, **PITR add-on $100/month per 7 days** [V] |
| Pooling | Built-in PgBouncer pooled endpoint, up to 10,000 pooled connections [V] | Supavisor pooler (transaction mode) [E] |
| Notes | Free projects inactive for 90+ days are subject to deletion (from 2026-10-05) [V]. Cold start after scale to zero adds latency [E]. Branching is useful for preview/staging | Bundles auth/storage we do not use; larger fixed fee for a plain Postgres |
| Estimate launch / 12 months | Free $0 (pre-revenue), Launch **$5-15** / **$10-25** [E] | $25 / $25-40 [E] |

Neon Free is not suitable for production: 6 h of history does not satisfy NFR-BKP-01 or the 35-day window of A-31, and the 90-day inactivity deletion rule is dangerous for an unattended project. Use it for development and preview branches only.

### 4.2 Object storage options (S3-compatible, adapter `STORAGE_PROVIDER=s3`)

| | Cloudflare R2 | Scaleway Object Storage (Paris/Amsterdam/Warsaw [E]) | Backblaze B2 |
|---|---|---|---|
| Storage | $0.015/GB-month, **10 GB free** [V] | ~EUR 0.0146/GB-month (Multi-AZ), 75 GB egress free then EUR 0.01/GB, requests/ingress included (official page via search summary) [V] | from $6.95/TB-month, first 10 GB free, egress free up to 3x stored, then $0.01/GB [V] |
| Operations | Class A $4.50/M, Class B $0.36/M, free 1M/10M per month [V] | included [V] | n/a on page |
| Egress | free [V] | 75 GB free [V] | see above |
| EU residency | EU jurisdiction bucket exists [E: not confirmed on the fetched page]; must be created with the EU jurisdiction at bucket creation | EU-native provider [E] | EU (Amsterdam) region [E: not confirmed on page] |
| Estimate | Launch and 12 months: **$0** (see sizing below) | ~EUR 0.1/month | ~$0 within free 10 GB |

Sizing [E]: 50 tenants x 30 vehicles x 5 photos x ~300 KB (resized to max 1280 px, NFR-PERF-01) ~ 2.3 GB; PDFs are generated on demand (FR-PDF-02) and not stored; DB dumps (compressed, ~tens of MB) x 30 days < 2 GB. Total well below R2's 10 GB free tier. Recommendation: **R2 with EU jurisdiction** (zero cost, free egress, S3 API) or **Scaleway** if a fully European provider is preferred.

### 4.3 Total cost (A)

| Item | Launch | 12 months |
|---|---|---|
| Vercel Pro | $20 | $20 (usage inside the $20 credit at this traffic [E]) |
| Neon Launch | $5-15 | $10-25 |
| R2 (or Scaleway) | $0 (EUR 0.1) | $0-0.5 |
| Domain (.com/.it) | ~EUR 1/month (EUR 10-15/year [E]) | same |
| System SMTP (transactional email, free tier) | $0 [E] | $0 [E] (verify per provider, see OPS-6) |
| GitHub (private repo, Actions) | $0 (free-plan minutes, see 9) | $0 |
| **Total** | **$25-35 (~EUR 23-32)** | **$30-45 (~EUR 27-41)** |

Hidden costs to watch: Vercel Image Optimization on Pro is usage-billed ($0.05 per 1K transformations, [V]) so serve tenant photos pre-resized from R2 where possible; Fast Origin Transfer ($0.06/GB [V]) from function to DB/storage; runtime logs are kept only 1 hour (Hobby) / 1 day (Pro) [V], so logs must be shipped to an external free tier (see observability input); no cost for Neon egress at this volume.

### 4.4 Serverless constraints (A)

| Topic | Fact | Implication |
|---|---|---|
| Function duration | 300 s default and max on Hobby; 300 s default, 800 s max on Pro [V] | NFR-SRV-01 assumes 10 s: still the design target. PDF with `@react-pdf/renderer` and email send fit comfortably |
| Memory / bundle | 2 GB (Pro up to 4 GB); 250 MB uncompressed bundle [V] | `@react-pdf/renderer` fits. Puppeteer/Chromium is a poor fit (size, cold start): keep the PDF adapter on react-pdf |
| **Request/response body** | **4.5 MB limit** on function payloads (413 beyond) [V] | Vehicle photos up to 5 MB (FR-VEH-05) **exceed it**. Use browser-side resize/compress below ~4 MB or, better, **presigned direct upload to the bucket** (needs bucket CORS and a storage-adapter method `createUploadUrl`). CSV export of 50,000 rows (NFR-PERF-06) may exceed 4.5 MB: stream the response or write to storage and return a signed URL. Flag for the architect |
| DB connections | Many short-lived instances; 1,024 file descriptors shared [V] | Use the pooled endpoint (Neon pooler / Supavisor), small per-instance pool (1-2). In transaction-pooling mode session-level features (session advisory locks, `SET`, prepared statements in some drivers) are unreliable: the atomic overlap check (FR-BKG-08) must rely on a transaction with an exclusion constraint or serializable isolation, not on session locks. Run migrations through the **direct** (non-pooled) connection. Flag for the database-architect |
| Outbound SMTP | Vercel blocks only port 25; 465 and 587 work [V]. Work after the response is sent may be frozen, so **await the send inside the request** with a timeout [V] | Per-tenant SMTP on 465/587 works. FR-MAIL-05 (bounded timeout, never fails the booking) is compatible; use a job/cron retry for failures |
| Cold starts | Fluid compute reduces them [E] | First request after idle may add ~1 s together with Neon wake-up [E]; acceptable for "not critical" |
| No local disk | Writable only `/tmp` | `STORAGE_PROVIDER=s3` is mandatory in production |
| Vercel-specific APIs | Cron, image optimization, ISR/edge middleware | Keep behind adapters as the spec demands; use plain `/api/cron/*` route handlers protected by a secret so any scheduler can call them |

### 4.5 Scheduled jobs (A)

Jobs required by the requirements: booking status transitions (FR-BKG-04, already lazy on read), subscription expiry marking and the 14-day reminder (FR-SYS-14), year-end snapshot (FR-REV-05, lazy-capable), yearly privacy reminder.

| Scheduler | Limits | Fit |
|---|---|---|
| Vercel Cron, Hobby | 100 jobs, **once per day**, +/- 59 min precision [V] | Enough for expiry/reminders/snapshots; not for 5-minute transitions (use lazy evaluation). Not licensable for production anyway |
| Vercel Cron, Pro | 100 jobs, **every minute**, per-minute precision [V]; each run is a normal function invocation (billed as such) | Fits all jobs, including a 5-minute transition job |
| GitHub Actions `schedule` | Free, minimum 5 min, may be delayed under load, disabled after 60 days of repository inactivity [E] | Portable fallback calling `POST /api/cron/<job>` with a bearer secret; keeps the jobs provider-neutral (good for the pluggability goal) |

Recommendation: idempotent job endpoints + Vercel Cron on Pro (daily for reminders/expiry, optional every 5 min for transitions), with GitHub Actions as the portable alternative.

### 4.6 Backups and restore (A)

| Layer | Mechanism | RPO / RTO | Test |
|---|---|---|---|
| Neon Launch | Built-in PITR history (up to 7 days [V]); restore creates a branch at a timestamp [E] | RPO minutes, RTO < 1 h | Branch restore, verify row counts, once before go-live (NFR-BKP-01) and quarterly |
| **Independent dump (required, any DB provider)** | GitHub Actions scheduled workflow: `pg_dump` (custom format) from the direct connection, encrypted with `age`, uploaded to a **different** bucket/provider (e.g. Scaleway or B2 if primary is R2), retention 30 days (A-31: <= 35 days) | RPO <= 24 h, RTO a few hours | Monthly restore into a throw-away Neon branch or local Compose |
| Supabase Pro | Daily backup, 7 days [V]; PITR +$100/month [V] | RPO 24 h (no PITR) | Dashboard restore |
| Object storage | Versioning off (cost); photos are re-uploadable; dumps are the safety net. Replicate bucket nightly with `rclone` to second provider if wanted [E] | RPO 24 h | Spot check |
| Encryption keys | The key encrypting tenant SMTP passwords must be stored outside the DB and the repo (password manager + Vercel env var); loss means every tenant must re-enter SMTP | n/a | Documented in runbook |

GDPR: erased/anonymised customers still exist inside backups for up to 7 days (Neon) and 30 days (dumps): consistent with NFR-GDPR-04 (<= 35 days). Dumps contain personal data: encrypted, private bucket, EU location.

## 5. Candidate B: single EU VPS (Hetzner) with Docker Compose

Stack: one VM (Falkenstein/Nuremberg/Helsinki [V]) running Caddy (automatic TLS), the Next.js container (`output: standalone`), Postgres 16 container with a named volume (or host volume), optional MinIO (or external R2/Scaleway), a cron container or host `crontab`.

### 5.1 Cost (B)

| Item | Price [V unless noted] | Launch | 12 months |
|---|---|---|---|
| Hetzner CX33 (4 vCPU, 8 GB, 80 GB, 20 TB traffic), incl. IPv4 | EUR 8.99 (CX23 2 vCPU/4 GB/40 GB is EUR 5.99 incl. IPv4: usable but the 40 GB disk is tight with Postgres + MinIO) | EUR 8.99 | EUR 8.99 (CPX22 EUR 19.99 if more CPU is needed) |
| Server backups (7 retained, 20% of price) | EUR 1.70 | EUR 1.70 | EUR 1.70 |
| Object storage | R2 free tier (preferred) or MinIO on the same disk | EUR 0 | EUR 0 |
| Off-site DB dump | R2/Scaleway | EUR 0 | EUR 0 |
| Domain | ~EUR 1/month | EUR 1 | EUR 1 |
| Staging (optional second Compose project on the same VM) | EUR 0 (extra RAM only) | EUR 0 | EUR 0 |
| **Total** | | **~EUR 11-13** | **~EUR 11-20** |

Source note: Hetzner raised prices on 2026-04-01 and 2026-06-15; figures above are from a price tracker updated 2026-10-20 and the official page's "from" prices (EUR 5.99 cost-optimised, EUR 6.49 regular) [V]. Re-check on the order page before purchase.

### 5.2 Constraints and risks (B)

- **Outbound SMTP: Hetzner blocks ports 25 and 465 by default on cloud servers; 587 is open** (third-party sources, official FAQ not retrieved) [E]. Many tenant mail providers use 465 (implicit TLS). Unblocking is by support request, case by case, and not guaranteed. This directly threatens per-tenant SMTP (FR-BRD-06). Mitigation: ask Hetzner support early, or document that tenants must use 587/STARTTLS. Vercel has no such problem (only port 25 blocked) [V].
- Single point of failure: one VM = no redundancy; Hetzner SLA 99.9% [V]. Acceptable under D14 ("not critical"), but downtime on the VM is downtime of the product.
- The owner is the sysadmin: OS patching (unattended-upgrades), Docker image updates, disk monitoring, fail2ban/firewall, SSH keys only, DB not exposed (bind to the internal Compose network), backups, restore drills.
- Uptime monitoring and log shipping must be set up by us (nothing included).
- Scheduled jobs: host cron or a tiny scheduler container calling `/api/cron/*`; no limits; no cold start.
- Serverless constraints disappear (no 4.5 MB body limit, long-running PDF/CSV fine, normal connection pool), but the build still must respect NFR-SRV-01 if the owner later moves to Vercel.
- Backups/restore: Hetzner snapshot-style backups are whole-disk (crash-consistent for Postgres, not guaranteed consistent) [E]; therefore add nightly `pg_dump` (+ optional WAL archiving with `wal-g`/`pgBackRest` to the bucket for PITR, ~2 h setup [E]) to an off-site bucket. RPO 24 h with dumps (minutes with WAL), RTO 1-3 h (new VM from Compose + restore). Restore test before go-live.
- Deploy: GitHub Actions builds the image, pushes to GHCR, SSH (or `docker compose pull && up -d`) to the VM with an environment-protected job; rollback = redeploy previous image tag. Migrations run as a one-shot container before the app starts (expand/contract).

## 6. Candidate C: managed container platforms in the EU

| Platform | App | Postgres | Storage | Estimate launch / 12 mo | Notes |
|---|---|---|---|---|---|
| **Render** (Frankfurt [E]) | Starter web service **$7/month**, 0.5 CPU/512 MB [V]; Standard-class for 12 months [E] | Basic-256mb **$6/month** (256 MB RAM, 100 connections, 1 GB included) or 1 GB RAM **$19/month**; extra storage ~$0.30/GB [V + search] | none (use R2) | **$13** / **$26-44** | Workspace Hobby $0, Pro $25 (+ compute) [V]. **PITR: 3 days on Hobby workspace, 7 days on Pro** [V]. Cron jobs billed per minute, e.g. $0.00016/min for the small size [V]. Bandwidth 5 GB (Hobby) / 25 GB (Pro) included, then $0.15/GB [V]. 256 MB Postgres is too small for comfort with an ORM; plan the $19 tier |
| **Railway** (Amsterdam [E]) | Usage-based: $10/GB RAM-month, $20/vCPU-month [V] | Postgres as a service on a volume ($0.15/GB-month [V]); backups not verified | Railway buckets $0.015/GB [V] | **$15-30** [E] / $25-40 [E] | Hobby plan $5 including $5 usage [V]; egress $0.05/GB [V]. Backups and PITR must be verified before choosing |
| **Fly.io** (Frankfurt) | shared-cpu-1x 1 GB in `fra` **$7.73/month** [V] | Managed Postgres from **$38/month** + $0.28/GB [V]; or self-managed Postgres machine on a volume (~$8 + $0.15/GB [V]), daily snapshots, 5-day retention, first 10 GB free [V] | none (R2) | **$17** (self-managed) to **$46+** (managed) | Egress $0.02/GB EU [V]. Self-managed DB brings VPS-like ops effort |
| **Scaleway** (Paris/Amsterdam) | Serverless Containers / small instance [E] | Managed Database for PostgreSQL entry plan [E] | Object Storage ~EUR 0.0146/GB, 75 GB egress free [V] | **EUR 15-30** [E, container and DB prices not verified in this pass] | EU-native provider; closest to a "sovereign EU" story |

Common to C: Docker image as the deploy unit (the same image as local Compose, so the build is portable), `render.yaml`/`fly.toml` as lightweight IaC, built-in rollback to a previous deploy, TLS and custom domains included (custom domains per tenant later: supported by Render/Fly [E]). Outbound SMTP: Render restricts outbound SMTP on some plans [E: verify]; Fly blocks port 25 [E: verify]. Cron: Render cron jobs, Railway cron, Fly scheduled machines, or GitHub Actions calling `/api/cron/*`.

## 7. Comparison of operational aspects

| Aspect | A2 (Vercel Pro + Neon + R2) | B (Hetzner VPS) | C1 (Render) |
|---|---|---|---|
| Ops effort / month | **~1-2 h**: Dependabot PRs, check dump job, spend, quarterly restore drill | **~3-5 h**: OS/Docker patching, disk, certs (Caddy auto), backups, SSH/firewall review, quarterly restore drill; incident exposure | ~1-2 h (similar to A) |
| Scale-out | Automatic | Resize VM (minutes of downtime) | Change plan |
| Zero-downtime deploy and instant rollback | Yes, atomic deploys, "promote previous" [E] | Compose rolling restart needs care; rollback by image tag (seconds to minutes) | Yes |
| SMTP ports for tenants | 465/587 OK, 25 blocked [V] | **25/465 blocked by default**, 587 OK [E] | verify [E] |
| Cron | Pro: per minute; Hobby: daily [V] | Unlimited | Native cron jobs |
| Long PDF / CSV / uploads | 4.5 MB body limit [V], 300-800 s duration [V] | No platform limits | No hard small limits [E] |
| Custom domains per tenant (future) | Supported (domain API, wildcard on Pro [E]) | Caddy on-demand TLS [E] | Supported [E] |
| Data residency | Functions pinned to EU region + EU DB/bucket; US vendor control plane | Fully EU, EU vendor | Frankfurt region [E]; US vendor |
| Lock-in | Low if adapters are respected: plain Postgres, S3 API, route-handler crons. Vercel-specific features to avoid: Cron config format, image optimization loader, edge middleware assumptions, ISR on-demand revalidation. Neon-specific: branching only (convenience) | None | Low (Docker image + Postgres) |
| Monitoring included | Basic logs 1 h/1 day only [V] | None | Basic logs |

## 8. Budget and cost control

- Vercel Pro: set the spend limit / budget alert [E: feature name "Spend Management"] so a traffic spike or a bot cannot create an uncapped bill; enable bot protection/rate limits (FR-PUB-10).
- Neon Launch: set a max compute size (autoscaling cap) and enable scale-to-zero; the unit price is $0.106/CU-h [V], so an always-on 1 CU costs ~$77/month [E: 730 h x $0.106].
- Monthly review of invoices during the first three months (cicd-deploy skill); tag resources by `project=rentcar`.
- Expected unit economics: ~$30-45/month for up to 50 tenants = under $1 per tenant per month.

## 9. CI/CD sketch (GitHub Actions) and secrets

GitHub Actions free plan: private repositories get a monthly minutes quota (2,000 min on Linux [E: verify]), more than enough: one pipeline run is ~5-8 min.

```
PR / push:      ci.yml
  install (pnpm cache) -> format check -> lint (complexity limits) -> type check
  -> architecture rules (dependency-cruiser) + duplication (jscpd)
  -> unit/integration tests (service container postgres:16) -> build
  -> security: gitleaks, pnpm audit / OSV-Scanner, Semgrep (SAST), Trivy (fs + image + IaC)
main (merge):   deploy-staging.yml
  -> migrate staging DB (direct connection, Neon branch) -> deploy preview/staging
  -> smoke test -> E2E (Playwright) -> DAST ZAP baseline on staging
tag vX.Y.Z:     release.yml  (GitHub Environment "production": required reviewer = owner)
  -> SBOM (Syft) archived -> migrate production DB (expand/contract) -> deploy
  -> post-deploy health check -> annotate deploy in observability tool
schedule:       backup.yml (nightly pg_dump + age + upload), cron-*.yml (portable job triggers),
                weekly dependency/Trivy scan; Dependabot or Renovate
```

- A: deploy with `vercel build` + `vercel deploy --prebuilt --prod` from the release job (token in the protected environment), with Git-based production auto-deploy disabled, so production changes only after approval. Previews can use Vercel's Git integration. Rollback: re-promote the previous deployment (instant); DB migrations must be backward compatible (expand/contract) so the previous version still works.
- B: build image, push to GHCR, SSH deploy with a key limited to a deploy user; `docker compose pull && up -d`; rollback by tag.
- C: platform deploy hook or `render.yaml` blueprint.
- Migrations run in the pipeline against the **direct** DB URL, never at request time in serverless. Locally and in Compose they run on container start (as required).
- Secrets: GitHub Environment secrets (staging/production) for CI; Vercel environment variables (encrypted, scoped per environment, mark secrets as sensitive [E]) for runtime; never in the repo or the image; `.env.example` with placeholders; pre-commit gitleaks; MFA on GitHub, Vercel, Neon, Cloudflare and the domain registrar; named accounts, least privilege (R2 token scoped to one bucket; separate DB roles for app and migrations); rotation procedure for `SESSION_SECRET`, DB password, S3 keys, system SMTP password documented in the runbook; the SMTP-password encryption key kept in a password manager as well. B: `.env` chmod 600, optionally `sops` + `age`.
- Environment variables from spec section 3 map 1:1; add `CRON_SECRET`, `ENCRYPTION_KEY` (SMTP secrets), `DIRECT_DATABASE_URL`.

## 10. Observability provisioning notes (pointer only)

No alerting or on-call now (D27). Free-tier tools only (D30). Because Vercel keeps runtime logs only 1 hour (Hobby) / 1 day (Pro) [V], production logs must go to an external sink with a free tier or errors to a free-tier error tracker (details in the observability-engineer input). On B, `docker logs` with rotation plus the same external sink. An external uptime check (free tier) is optional and is the only "alert" worth adding at the end of the first month if the owner agrees.

## 11. Decision guidance

- If the owner wants **lowest effort and the user-stated Vercel path**: A2. Start development on A1 (Pro $20 once the first paying tenant is in sight; until then the project is private code only on local Compose, so no Vercel account is needed at all).
- If the owner wants **lowest cost and EU-only vendors** and accepts ~4 h/month: B, after confirming SMTP 465 unblocking with Hetzner.
- If the owner wants **a single bill and Docker simplicity**: C1 (Render), provided Frankfurt, SMTP policy and commercial terms are confirmed.
- Whatever the choice, the spec's adapters (storage, job triggers, DB URL) keep a later migration between A, B and C to a matter of hours, because the app is a standard Next.js build plus Postgres plus S3.

## 12. Sources (accessed 2026-11-01)

- Vercel pricing: https://vercel.com/pricing
- Vercel Fair Use Guidelines (commercial usage; updated 2026-09-14): https://vercel.com/docs/limits/fair-use-guidelines
- Vercel Cron usage and pricing (updated 2026-07-15): https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel Functions limits (updated 2026-08-24): https://vercel.com/docs/functions/limitations
- Vercel SMTP guide: https://vercel.com/kb/guide/serverless-functions-and-smtp
- Neon pricing: https://neon.com/pricing · regions: https://neon.com/docs/introduction/regions
- Supabase pricing: https://supabase.com/pricing
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Scaleway storage pricing: https://www.scaleway.com/en/pricing/storage/ (via search summary; page not directly fetched)
- Backblaze B2 pricing: https://www.backblaze.com/cloud-storage/pricing
- Hetzner Cloud: https://www.hetzner.com/cloud/ · price tracker (updated 2026-10-20): https://costgoat.com/pricing/hetzner
- Hetzner SMTP port policy: third-party reports only (search 2026-11-01), official FAQ not retrieved
- Render pricing: https://render.com/pricing.md
- Fly.io pricing: https://docs.fly.io/about/pricing
- Railway pricing: https://railway.com/pricing
- Not verified: Render/Railway/Fly/Scaleway SMTP policies, Scaleway compute and DB prices, GitHub Actions free minutes, Supabase EU region list, R2/B2 EU region confirmation, Vercel Pro per-seat wording.

## Esito
- **Stato**: completato (prices partly estimated, see [E] marks)
- **File prodotti/modificati**: `/Users/ermaaga/Work/RentCar/docs/03-inputs/devops-costs.md`
- **Sintesi**:
  1. Vercel Hobby is non-commercial by Vercel's own Fair Use rules (even a paid developer counts): **production needs Pro, $20/month**. Hobby only for a private prototype.
  2. Candidate A2 (Vercel Pro + Neon Launch Frankfurt + R2 EU) costs about $25-35/month at launch and $30-45 at 12 months, ~1-2 h/month ops. Recommended for the user's Vercel intent.
  3. Candidate B (Hetzner CX33 + backups + R2) is cheapest, about EUR 11-13/month, but ~3-5 h/month ops and Hetzner blocks outbound ports 25/465 by default (587 open), which conflicts with per-tenant SMTP unless unblocked.
  4. Candidate C (Render, Frankfurt) about $13 at launch, $26-44 at 12 months; Fly managed Postgres starts at $38 so is poor value; Railway/Scaleway only partly verified.
  5. Neon Free (6 h history, 90-day inactivity deletion) and Supabase Free (no backups, pauses) fail NFR-BKP-01 for production; a nightly encrypted `pg_dump` from GitHub Actions to a second provider is required in every option (meets RPO/RTO 24 h and the 35-day cap).
  6. Serverless constraints for the architect and database-architect: 4.5 MB function body limit (5 MB photo uploads and 50k-row CSV need presigned upload/streaming), pooled connections with migrations on the direct URL, atomic booking check must not use session locks, set the Vercel function region to the EU (default is `iad1`), await SMTP sends inside the request.
  7. Cron: Hobby is daily only with +/-59 min precision; Pro is per-minute. All required jobs fit with idempotent `/api/cron/*` endpoints; GitHub Actions schedule is a portable fallback.
  8. Staging at launch = Vercel preview + Neon branch (A) or second Compose project (B); no permanent staging cost.
- **Assunzioni** (confirm with the user):
  - ASSUNZIONE: USD to EUR 0.90; prices are ex VAT; reverse charge applies.
  - ASSUNZIONE: no permanent staging, no paid monitoring, no on-call.
  - ASSUNZIONE: object storage is R2 with EU jurisdiction (free tier), photos pre-resized, total < 10 GB.
  - ASSUNZIONE: the system SMTP uses a free-tier transactional provider; tenant SMTP is supplied by tenants.
  - ASSUNZIONE: one Vercel seat (the owner).
- **Rischi**:
  - Using Vercel Hobby for production: account suspension and ToS breach (alta).
  - Hetzner port 465/25 block breaks tenant SMTP on option B (alta for B).
  - 4.5 MB payload limit breaks photo upload and large CSV unless designed around (media, A only).
  - US vendor control plane for Vercel; DPA/SCC and no personal data in logs/CDN cache needed (media).
  - Loss of the SMTP-encryption key or of the independent dump job unnoticed, since no alerting (media).
  - Price drift: Hetzner repriced twice in 2026; Neon/Vercel usage pricing may change (bassa).
  - Unverified items listed in section 12 (bassa/media).
- **Rilievi bloccanti**: nessuno
- **Criteri non verificati**: nessuno di tipo Must da verificare in questa fase (analysis only). Restore test (NFR-BKP-01) is to be executed after implementation; tools: `pg_dump`/`pg_restore` and Neon branch restore. Price items marked [E] were not verifiable on official pages with WebFetch/WebSearch (Hetzner SMTP policy, Scaleway compute/DB, Render/Fly SMTP, GitHub minutes).

## Domande per l'utente
| ID | Domanda | Opzioni (la prima è raccomandata) | Perché conta / impatto | Bloccante |
|---|---|---|---|---|
| OPS-1 | Accetti di pagare Vercel Pro (circa 20 dollari al mese) per la produzione? Il piano gratuito Hobby vieta l'uso commerciale, anche solo perché qualcuno è pagato per costruire il sito | A (raccomandata): sì, Pro dal primo tenant pagante / B: no, scelgo un VPS Hetzner (circa 11-13 euro al mese, più lavoro di manutenzione per te) / C: no, scelgo Render (circa 13 dollari al mese) | Decide l'ipotesi di hosting e il rispetto dei termini del fornitore; evita la sospensione del sito | sì |
| OPS-2 | Quanto tempo al mese puoi dedicare alla manutenzione dei server? | A (raccomandata): 1-2 ore, quindi servizi gestiti (Vercel + Neon o Render) / B: 3-5 ore, accetto un VPS da gestire io | Il VPS costa meno ma richiede aggiornamenti, controlli dei backup e gestione degli imprevisti | sì |
| OPS-3 | Budget mensile massimo accettabile per l'esercizio al lancio e a 12 mesi? | A (raccomandata): fino a circa 35-45 euro al mese / B: fino a circa 15 euro / C: nessun tetto, ottimizza la qualità | Fissa la scelta tra A2, B e C e il tetto di spesa (spend limit) da impostare | sì |
| OPS-4 | Per i dati (database e foto) preferisci fornitori solo europei, oppure va bene un fornitore con sede USA ma dati in regione UE (Neon su AWS Francoforte, Cloudflare R2 con giurisdizione UE)? | A (raccomandata): dati in UE, fornitori anche USA con contratto DPA / B: solo fornitori europei (Hetzner, Scaleway) | Impatta GDPR, costo e scelta di database e storage; i tenant sono clienti europei | no |
| OPS-5 | Chi possiede già account e dominio? Hai un dominio per la piattaforma (e quale) e account GitHub, Vercel, Neon, Cloudflare con MFA attivo? | A (raccomandata): dominio già mio, creo gli account con la mia email e MFA / B: serve acquistare il dominio (circa 10-15 euro l'anno) | Serve per DNS, TLS, URL `/{slug}` e futuri domini dei tenant | no |
| OPS-6 | Quale servizio usiamo per l'email di sistema (reset password del systemadmin, avvisi al proprietario)? | A (raccomandata): provider email transazionale con piano gratuito, da verificare / B: la casella SMTP del tuo dominio / C: SMTP del VPS (sconsigliato) | Senza SMTP di sistema non partono le email al proprietario; il piano gratuito va verificato (limiti giornalieri) | no |
| OPS-7 | Dove inviamo la copia di sicurezza (backup) cifrata del database, e chi la ripristina in caso di problema? | A (raccomandata): secondo fornitore diverso da quello principale (es. Scaleway o Backblaze), restore provato prima del go-live, ripristino fatto da te con una guida / B: solo backup del fornitore del database | Rispetta RPO/RTO di 24 ore e la conservazione massima di 35 giorni; senza copia esterna un errore del fornitore può far perdere i dati | no |
| OPS-8 | Se scegliamo il VPS (B): sei d'accordo a chiedere a Hetzner di sbloccare la porta 465 per l'SMTP, oppure i tenant useranno solo la porta 587? | A (raccomandata): non scegliere B, oppure chiedere lo sblocco prima dell'acquisto / B: i tenant usano solo la porta 587 | Molti provider email usano 465; se bloccata, le email dei tenant non partono | no |
