# DevOps and deploy: RentCar

Version 1.0 · 2026-11-01 · Owner: devops-engineer (analysis mode, Phase 4 wave B) · Status: design only, nothing created.
Inputs: `docs/03b-struttura-codice.md` (sections 2, 9, 10, 14), `docs/03-inputs/devops-costs.md`, ADR-0002/0007/0009/0010/0011/0015, `docs/05-database.md` (sections 8, 10, roles 4.1), `docs/08-security.md` (SR-CFG, SR-DB-09, H-1..H-14, DAST), `docs/security/sign-off.md` (section 4), `docs/02-requisiti.md` (FR-PLT-01..09, NFR-BKP-01, AC1, AC10).
Conventions: **[V]** verified from a project document; **[E]** estimate or to be verified at implementation; `ASSUMPTION` needs user confirmation. Tool and action versions are named here but exact versions and commit SHAs are pinned at implementation (M0), checked against the official release page that day.
Hosting is deferred (ADR-0010/0011): everything below works on Vercel Pro or an EU VPS by environment variables and one deployment file only. Phase 1 needs no cloud account except GitHub.

---

## 1. Environments

| Env | `APP_ENV` | Purpose | Where | Data | Access / protection |
|---|---|---|---|---|---|
| Local | `local` | Development, AC1 (`docker compose up`) | Developer machine, Compose | Synthetic seed (`demo-a`, `demo-b`, empty and terminated tenants, dev systemadmin) | Localhost only; DB published on `127.0.0.1` only |
| CI | `ci` | Tests on every push/PR: integration, security matrix, E2E, header test; also the ephemeral stack for the ZAP active scan | GitHub-hosted runner, Postgres service/Compose, destroyed after the job | Synthetic, built by fixtures | Relaxed rate limits only here (08-security 5.10); never reachable from outside |
| Preview (optional, Vercel only) | `staging` | Per-PR serverless proof (NFR-SRV-01, ABU-M6-10) | Vercel preview + Neon branch | Synthetic only | Vercel deployment protection on; own env scope, own DB branch, own bucket and keys; no production secret present (ABU-M6-07) |
| Staging | `staging` | Production-like rehearsal: migrations, E2E smoke, DAST baseline, header/TLS scan, restore drills | Same host kind as production (Vercel project or second Compose project/VPS) | Synthetic or anonymised, never production data | `noindex` (robots + `X-Robots-Tag`), access protected (Vercel protection or Caddy basic auth), separate DB, bucket, keys |
| Production | `production` | Real tenants | Chosen host | Real | Deploy only from the pipeline after approval; named accounts with MFA; no human `ssh`-deploys |

Rules (from sign-off section 3): real customer data enters a non-local environment only after Gate 4; staging and preview never hold production data or keys; every secret differs per environment (boot check: equal values for two different secrets are refused, SR-CFG-02).

Production-like = `staging | production` (03b section 9). All production guards (placeholder keys rejected, seed refused, `STORAGE_PROVIDER=local` refused with `HOST_KIND=serverless`, TLS `verify-full`) apply to staging as well.

## 2. Local environment (AC1, FR-PLT-01)

### 2.1 Compose design (`compose.yaml`)

One command: `docker compose up` (fresh clone: copy `.env.example` to `.env` first; see 2.4 for the zero-step variant).

| Service | Image / build | Role | Healthcheck | Dependencies | Ports |
|---|---|---|---|---|---|
| `postgres` | `postgres:16` pinned by digest (same major as Testcontainers) | Database. Bootstrap superuser `rentcar_admin` (NOT an application role, 05-database 4.1) | `pg_isready -U rentcar_admin -d rentcar` every 5 s, 10 retries, `start_period: 10s` | none | `127.0.0.1:5432:5432` only (control "DB port bound to 127.0.0.1") |
| `migrate` | same image as `app` (target `runner`, command `node scripts/migrate.js`) | One-shot: runs the reviewed SQL migrations and post-migration catalog checks as `rentcar_migrator` (then `SET ROLE rentcar_owner`) over `DIRECT_DATABASE_URL`; takes `pg_advisory_lock` (ADR-0002) | exits 0 | `postgres: service_healthy` | none; `restart: "no"` |
| `app` | build `Dockerfile` target `runner` | Next.js standalone server, runtime role `rentcar_app` over `DATABASE_URL` | `GET /api/healthz` via `node -e fetch(...)` (the runtime image has no curl), 10 s interval, `start_period: 20s` | `migrate: service_completed_successfully` | `3000:3000` (localhost-bound `127.0.0.1:3000` by default; override to expose on LAN) |
| `seed` (profile `seed`, default-on for local via `COMPOSE_PROFILES`) | same image, command `node scripts/seed.js` | Idempotent dev data and dev systemadmin; refuses `APP_ENV` other than `local\|ci` | exits 0 | `migrate` completed | none |
| `jobs` (profile `jobs`, on by default locally) | `curlimages/curl` pinned by digest or a 10-line Node loop in the app image | Calls `POST /api/jobs/run` hourly with `Bearer ${CRON_SECRET}` (ADR-0007); interval overridable (`JOBS_INTERVAL_SECONDS`, e.g. 60 for dev) | none | `app: service_healthy` | none |
| `minio` (profile `s3`) | `minio/minio` pinned | S3-compatible store to exercise the real `s3` adapter (`S3_FORCE_PATH_STYLE=true`) and AC10 | `mc ready local` or `/minio/health/live` | none | `127.0.0.1:9000`, console `127.0.0.1:9001` |
| `minio-init` (profile `s3`) | `minio/mc` pinned | Creates the bucket and a bucket-scoped access key | exits 0 | `minio` healthy | none |
| `mailpit` (profile `mail`) | `axllent/mailpit` pinned | Local SMTP sink + web UI to inspect system and tenant emails (credential links, PDFs) | HTTP `/livez` | none | SMTP `127.0.0.1:1025`, UI `127.0.0.1:8025` |

- **Named volume**: `pgdata` (Postgres), `minio-data` (profile `s3`), `uploads` (`STORAGE_PROVIDER=local` default locally, mounted at `STORAGE_LOCAL_PATH`). `docker compose down -v` is the documented reset.
- **Network**: one user-defined network; `postgres` is reachable by service name only; nothing but the listed `127.0.0.1` ports is published (SR-CFG-06).
- **DB role init** (SR-DB-01, H-1): `docker-entrypoint-initdb.d/10-roles.sh` (mounted read-only) runs the idempotent `scripts/db-bootstrap.sql` as `rentcar_admin` with role passwords taken from env: creates `rentcar_owner` (NOLOGIN), `rentcar_migrator` (LOGIN, member of owner), `rentcar_app`, `rentcar_backup`, the `rentcar` database owned by `rentcar_owner`, `btree_gist`, `REVOKE ... ON SCHEMA public FROM PUBLIC`, and the role-level timeouts (05-database 4.1). The same SQL file is run once, from the runbook, on managed production databases (section 9.2). The compose image does **not** use `POSTGRES_USER=rentcar_owner` (a superuser ignores RLS).
- **Migrations are automatic** (AC1): `app` waits for `migrate`. If `migrate` fails (including post-migration catalog checks) `app` never starts and `docker compose up` exits non-zero: fail closed.
- **Compose env interpolation**: `compose.yaml` contains placeholders only, all with the `INSECURE_DEV_` prefix, so the production guards reject them outside local/ci. Role passwords come from `.env`.
- **Profiles**: `docker compose --profile s3 --profile mail up`. `COMPOSE_PROFILES=seed,jobs` is preset in `.env.example`. Default `up` therefore starts postgres, migrate, seed, app, jobs. Plain-minimal start (`docker compose up app`) works too.
- **CI use**: the same `compose.yaml` plus `compose.ci.yaml` override (APP_ENV=ci, `RATE_LIMIT_STORE=postgres`, fixed secrets of CI, no published ports other than 3000 on the runner) is what Playwright runs against; the header test and the ZAP active scan target it too.
- **Hosting variant files** (not needed for Phase 1, designed now): `compose.prod.yaml` (VPS, section 8.2) adds Caddy, removes all published ports except 80/443, adds `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, memory limits, log rotation (`json-file`, `max-size 10m`, `max-file 5`, H-11).

### 2.2 Dockerfile (multi-stage, standalone, non-root)

`next.config` sets `output: 'standalone'` (ADR-0011). Stages:

1. `base`: `node:<LTS>-bookworm-slim` pinned by **digest** (Dependabot `docker` ecosystem keeps it current); `corepack enable`; pnpm version from `packageManager`.
2. `deps`: copies `package.json`, `pnpm-lock.yaml`, `.npmrc` (with `ignore-scripts=true`), runs `pnpm install --frozen-lockfile`, then rebuilds only the allow-listed native packages (`sharp`, `@node-rs/argon2`) by explicit command (SR-CFG-05). BuildKit cache mount for the pnpm store.
3. `builder`: copies sources, `pnpm build` (placeholder build-time env only: no secrets, no DB access at build; `NEXT_TELEMETRY_DISABLED=1`). Source maps are generated here and **not** copied to the runtime image (uploaded to the error tracker by CI, section 5.6).
4. `migrate-tools` (only inside the same image, no separate stage needed): `scripts/migrate.js`, `scripts/seed.js`, `scripts/create-systemadmin.js`, `drizzle/` and `drizzle/rollback` are bundled by esbuild into `dist-scripts/` and copied to the runner so one image does app, migration and seed (one artefact is promoted, never rebuilt).
5. `runner`: same slim base (distroless is rejected for now: the Node healthcheck and `sharp` native deps work on slim; revisit if Trivy shows avoidable CVEs), `USER node` (uid 1000), `WORKDIR /app`, copies `.next/standalone`, `.next/static`, `public`, `dist-scripts`, `drizzle`. `ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0`. `EXPOSE 3000`, `HEALTHCHECK` using Node. No package manager in the final layer where possible, no secrets in any layer (checked by Trivy secret scan and `docker history` review).
6. Image labels (OCI): source, revision (git SHA), created. Tag scheme: `ghcr.io/ermaaga/rentcar:sha-<gitsha>` for every main build, `:vX.Y.Z` on release; production references the **digest**.

`.dockerignore`: `.git`, `.env*` (except `.env.example`), `node_modules`, `.next`, `docs`, `tests`, `*.md` (except needed), coverage, playwright reports.

Read-only root FS: the runner needs a writable `/tmp` and `.next/cache` (tmpfs mounts in `compose.prod.yaml`); `STORAGE_PROVIDER=local` writes to the mounted volume only.

### 2.3 Developer tooling in M0 (implementation mode only)

Husky hooks: `pre-commit` (gitleaks protect staged, lint-staged: Prettier + ESLint on changed files), `commit-msg` (commitlint, Conventional Commits, English), `pre-push` (type check; optional). `.gitignore` covers `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.age` identity files, coverage, `.next`. `.nvmrc`/`engines` and `packageManager` pinned. `Makefile` or `package.json` scripts: `dev`, `up`, `down`, `reset`, `verify` (runs the same checks as CI locally), `db:migrate`, `db:rollback-test`.

### 2.4 `.env.example`

Generated and validated by a test: every key of the Zod schema appears in `.env.example` and vice versa (03b section 9). Grouped, each variable with a one-line comment, placeholder, and flags "required in production". Values for secrets use `INSECURE_DEV_...` so that they work locally and fail the production guard. Groups: runtime (`APP_ENV`, `HOST_KIND`, `APP_BASE_URL` (alias to be settled with backend: 03b uses `PUBLIC_BASE_URL`), `TRUSTED_PROXY_COUNT`), database (`DATABASE_URL`, `DIRECT_DATABASE_URL`, role passwords for compose bootstrap, `BACKUP_DATABASE_URL` documented as CI/backup-only), secrets (`SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, `RATE_LIMIT_HMAC_KEY`), storage (`STORAGE_PROVIDER`, `STORAGE_LOCAL_PATH`, `S3_*`, `UPLOAD_MAX_BYTES`), system email (`SYSTEM_ADMIN_EMAIL`, `SYSTEM_SMTP_*`), observability (`OBS_*`), seed (`SEED_SYSTEMADMIN_*`, local only). ASSUMPTION: the zero-step start for a new developer is `cp .env.example .env && docker compose up`; AC1 is satisfied by that (one extra copy command, documented in README). If the user insists on literally one command, `compose.yaml` can carry `env_file: required: false` plus inline `INSECURE_DEV_` defaults; this costs nothing, so the design includes it: `docker compose up` works with no `.env`, and `.env` only overrides.

## 3. Branching, commits and PR rules

- **Trunk-based**: `main` is always releasable. Short branches `feat/<epic>-<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` (current docs branch: `docs/analysis`), PR into `main`, squash merge, title = Conventional Commit (English). Branch life target < 3 days.
- **One commit per completed task** (user request): each task of `docs/13-piano-implementazione.md` ends as one commit on the branch (schema TS + migration + tests together, 05-database 8.1). commitlint checks every commit of the PR range; squash-merge keeps the PR title as the final message, so the PR contains the task commits and `main` gets one commit per PR. ASSUMPTION: one PR = one task or one tight group of tasks, so "one commit per task" holds on `main` too. If the user wants every task commit preserved on `main`, switch to rebase-merge (needs linear history rule; no other change).
- **Branch protection on `main`** (ruleset, verified by API output at M0 close): PR required; at least 1 approving review (ASSUMPTION: a solo owner cannot self-approve, so for a one-person team the rule is "PR required + all required checks green + CODEOWNERS review by the owner, admins not bypassing"; revisit when a second member joins, OPS-9); dismiss stale approvals on new pushes; conversation resolution required; required status checks (section 4.4) up to date with `main`; signed commits **not** required (optional, OPS-10); linear history; force push and deletion blocked; restrict who can push tags `v*` (release trigger); MFA enforced for all members; GitHub secret scanning + push protection on; Dependabot alerts and security updates on; private vulnerability reporting on.
- `CODEOWNERS`: `.github/`, `Dockerfile`, `compose*.yaml`, `drizzle/`, `src/platform/config/`, `src/platform/db/`, `src/platform/crypto/`, `tests/security/`, `docs/security/` require owner review (security-sensitive paths).
- PR template: description, task/requirement ids (`Refs: US-123, FR-BKG-08`), checklist (tests added, abuse cases for protected endpoints, migration reviewed: expand/contract and rollback file, no new dependency or justified, docs updated, screenshots at 360 px for UI).
- Releases: tag `vMAJOR.MINOR.PATCH` on `main` (SemVer; `0.x` until go-live), GitHub Release with generated notes and attached SBOM.

## 4. CI workflows

All workflows: `permissions: contents: read` at top level, elevated per job only where needed; third-party actions **pinned by full commit SHA** with the version in a comment (Dependabot `github-actions` ecosystem updates them); `concurrency` group per ref with `cancel-in-progress` for PR runs (never for release/backup); `timeout-minutes` on every job; no `pull_request_target` on untrusted code; secrets only from environments; `persist-credentials: false` on checkout unless a job pushes; `step-security/harden-runner` in audit mode first, then block egress where stable ([E], optional). Runner: `ubuntu-24.04` pinned (not `latest`). Node and pnpm from `.nvmrc` / `packageManager`.

### 4.1 Workflow list

| File | Triggers | Purpose |
|---|---|---|
| `ci.yml` | `push` (all branches), `pull_request` | Quality and tests (jobs below). Runs on every push and PR as the user requested |
| `security.yml` | `pull_request`, `push` to `main`, `schedule` weekly (Mon 04:00 UTC) | Mandatory M0 security controls |
| `codeql.yml` | same as security + weekly | CodeQL (GitHub-native SAST) alongside Semgrep. ASSUMPTION: private repo may need GitHub Advanced Security for code scanning upload (paid); if unavailable, Semgrep is the blocking SAST and CodeQL runs with results as an artefact only (OPS-11) |
| `deploy-staging.yml` | `push` to `main` after `ci.yml` and `security.yml` succeed (`workflow_run`, gated on the same SHA), `workflow_dispatch` | Build image, migrate staging, deploy, smoke, E2E subset, ZAP baseline |
| `release.yml` | tag `v*` pushed by an allowed actor | SBOM, image promotion, migrate production, deploy with approval, post-deploy checks, annotate. Refuses unless `APPROVAL_GO_LIVE` is recorded (section 7.1) |
| `jobs-cron.yml` | `schedule` hourly (fallback/backup trigger) + `workflow_dispatch` | Calls `/api/jobs/run` with `CRON_SECRET` (ADR-0007, H-9). Disabled if the host has its own scheduler; kept as second trigger |
| `nightly-backup.yml` | `schedule` daily 01:30 UTC + `workflow_dispatch` | Encrypted dump to the second provider. **Designed now, committed disabled (`if: vars.BACKUP_ENABLED == 'true'`), activated when production exists** (section 10) |
| `restore-test.yml` | `schedule` quarterly + `workflow_dispatch` | Restore drill with verification (section 10.4). Same activation rule |
| `nightly.yml` | `schedule` daily 03:00 UTC | Full test matrix incl. WebKit/Chromium all projects, mutation spot-check on `pricing`/`availability` (optional), DAST baseline on staging when it exists |
| `dependabot.yml` (config, not a workflow) | weekly | Ecosystems: `npm` (grouped minor/patch, security updates ungrouped and immediate), `github-actions`, `docker`, `docker-compose`. Renovate is the alternative (OPS-12) |

### 4.2 `ci.yml` jobs

Dependency graph follows 03b section 10 (`lint-types-arch` -> `unit` -> `integration` -> `security-matrix` -> `e2e` -> `scans`), with independent jobs parallelised to keep wall time near 8-12 min [E].

| Job | Needs | Steps | Blocks if |
|---|---|---|---|
| `setup` (composite action) | | checkout, pnpm/Node setup with `actions/setup-node` cache (`pnpm` store keyed on `pnpm-lock.yaml`), `pnpm install --frozen-lockfile` | lockfile out of date |
| `lint-types-arch` | | `prettier --check`; `eslint` (flat config; complexity <= 10, max-lines 300, max-lines-per-function 40, max-params 4, boundaries, no-cycle, `no-process-env`, jsx-no-literals, jsx-a11y); `tsc --noEmit`; `depcruise src tests --config .dependency-cruiser.cjs`; the unit test of the dependency-cruiser rules with fixture violations; `jscpd` (3% threshold over `src`); `knip`; token build diff check (`pnpm build:tokens && git diff --exit-code`); `.env.example` vs schema test; `drizzle-kit generate` produces no diff; commitlint on the PR commit range | any finding |
| `unit` | `setup` | `vitest run --project unit --coverage` (v8). Gates: `domain` >= 90% lines and branches, `application` >= 80%, global >= 75%, thresholds only ratchet up (a check compares to `coverage-thresholds.json` in the base branch). Coverage summary uploaded as artefact and posted as job summary | test fails or below gate |
| `integration` | `unit` | Service container `postgres:16` (digest-pinned), bootstrap with `scripts/db-bootstrap.sql` (the same file as Compose), `TEST_DATABASE_URL` + `TEST_DATABASE_ADMIN_URL`; template-database cloning per test file; migrations from zero with real roles; up/down/up for expansion migrations; catalog tests (RLS forced, grants == matrix, FK indexes, definer list); pooled + direct connection smoke (ADR-0010 "CI checks both paths": a second job variant fronts Postgres with `pgbouncer` in transaction mode, [E] image pinned, to exercise `SET LOCAL` and the "no session state" rules) | any failure |
| `security-matrix` | `integration` | `vitest run --project security`: cross-tenant matrix generator, registry test (every `tenant_id` table in the matrix), auth-negative helpers (401/403/404/400/mass assignment/429), "runtime role without GUC returns zero rows", 1,000-transaction GUC bleed test, log-scrub canary, abuse-case suites ABU-M*, production-guard boot tests (ABU-M0-09). Runs against the same Postgres service | any failure (blocking by definition) |
| `build` | `lint-types-arch` | `next build` with placeholder env; `docker build` (BuildKit, GHA cache `type=gha`), image not pushed on PR; client-bundle scan for env var names and secret patterns (SR-CFG-03); bundle-size budget report | build fails or bundle leak |
| `e2e` | `build` | Brings up the stack with `docker compose -f compose.yaml -f compose.ci.yaml up -d --wait` using the image just built (not a rebuild). Playwright, projects `desktop-chromium`, `mobile-iphone` (WebKit, iPhone 13), `mobile-android` (Pixel 7, Chromium), `small-360` (custom 360x640). Browsers installed with `npx playwright install --with-deps chromium webkit`, cached by Playwright version in `~/.cache/ms-playwright` (cache key = Playwright version; `install-deps` always runs). Matrix of 2 shards x projects on PRs: mobile projects run the public booking flow, admin calendar and vehicle form; desktop runs the full suite (03b section 14). `@axe-core/playwright` on key pages. The Postgres is the Compose one (so roles/RLS are real), not a CI service. Header/TLS test (`tests/security/headers.spec`: CSP, nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy; HSTS only when `APP_BASE_URL` is https, asserted in the staging smoke instead) runs here. Retries: 1 in CI, flake report; on failure upload trace, video, screenshots, Compose logs (scrubbed) as artefacts (7 days) | any failure; a test that passes only on retry is reported and counted (flake budget, QA owns) |
| `ci-gate` | all above | Single aggregating job `ci-gate` (`if: always()`, fails if any need failed or was skipped unexpectedly). **This is the only required check name for `ci.yml`**, so adding jobs never requires editing branch protection | |

Caching summary: pnpm store (setup-node), Docker layers (`type=gha`, `mode=max`), Playwright browsers (keyed on version), Next build cache (`.next/cache` keyed on lockfile + source hash), `.dependency-cruiser`/`eslint` caches (`--cache`). Cache is never trusted for correctness: lockfile is frozen and browsers are verified by `playwright install` itself.

### 4.3 `security.yml` jobs (all blocking, mapped to sign-off section 4)

| Control | Job and command | Threshold |
|---|---|---|
| Secret scanning (full history) | `gitleaks` action/CLI `detect --redact --log-opts=--all` on push/schedule, PR range on PR, with a committed `.gitleaks.toml` (allowlist only for `INSECURE_DEV_` placeholders, path-scoped, each entry commented) | any secret |
| SCA | `pnpm audit --audit-level=high --prod` plus full tree report; `osv-scanner scan --lockfile pnpm-lock.yaml` (and the Dockerfile base image); `license-checker`/`pnpm licenses` against the allowlist (OPS-13: owner approves the allowlist; default permissive: MIT, Apache-2.0, BSD, ISC, 0BSD, MPL-2.0 file-level) | high/critical with a fix available; exceptions in `.security/exceptions.yml` with expiry and reason |
| SAST | Semgrep (`p/owasp-top-ten`, `p/typescript`, `p/nextjs`, `p/security-audit`) + custom rules in `.semgrep/` (raw SQL not parameterised; repository call without `TenantTx`; route/action not built with `defineRoute`/`defineAction`; `dangerouslySetInnerHTML`; `fetch` of non-constant URL; `Math.random`; `NODE_TLS_REJECT_UNAUTHORIZED`; `style=` non-literal; `process.env` outside config). Each custom rule has a fixture test (`semgrep --test`) proving it fails on the bad sample and passes on the good one (failing-then-passing evidence). Semgrep CLI (OSS, no login) so no code leaves the runner | any unhandled high/error finding |
| Container + IaC | `trivy image` (the CI-built image: vuln + secret + misconfig, `--severity CRITICAL --exit-code 1 --ignore-unfixed`), `trivy fs` (lockfiles, secrets), `trivy config` on `Dockerfile`, `compose*.yaml`, `.github/workflows`, and any IaC | critical (high reported) |
| SBOM | `syft` or `cyclonedx-npm` CycloneDX JSON for the source tree on every main build (artefact); the image SBOM at release (section 7.1) | never blocks; archived |
| Workflow lint | `actionlint` + `zizmor` (GitHub Actions static security analysis) on `.github/workflows` | any error; checks SHA pinning, token permissions, template injection |
| Abuse-case harness | executed in `ci.yml` `security-matrix` (required) | see above |
| DAST | not per PR. `deploy-staging.yml` runs ZAP baseline against staging; Gate 4 runs the authenticated active scan against an ephemeral `APP_ENV=ci` stack (08-security 10.4) | no high findings |

`security.yml` jobs publish SARIF to the Security tab where the plan allows; results otherwise stay as artefacts. All scanner binaries/actions pinned by SHA/digest; scanner DBs are cached for 24 h.

### 4.4 Required status checks (branch protection)

`ci-gate` (from `ci.yml`), `security-gate` (aggregator of `security.yml`), `codeql` (if available, OPS-11), `commitlint` (PR title check, job inside `ci-gate`). Staging deploy and nightly are not required checks. The check names are created in the first M0 PR so protection can be turned on in that same milestone; protection is configured with `gh api` / a committed ruleset JSON (`.github/rulesets/main.json`) applied by the repo owner, and its output is the M0 evidence.

### 4.5 Cost and minutes

GitHub-hosted private-repo minutes: free plan quota [E: 2,000 Linux min/month, verify; the repository visibility is OPS-14]. One PR run is ~25-35 runner-minutes counting parallel jobs [E] (E2E dominates), so ~60-80 runs/month fit; more would need the Team plan (about USD 4 per user per month [E]) or a public repository (free). Mitigations: concurrency cancel, path filters for docs-only changes (`docs/**` runs only the docs lint and secret scan, **but still reports the required check names** via a path-aware first job so protection is satisfied), nightly full matrix instead of full matrix per PR.

## 5. Configuration, secrets and access

### 5.1 Principles

Secrets never in the repo, image, logs or client bundle (SR-CFG-03). Configuration is one Zod-validated object at startup (`instrumentation.ts`); failure prints variable names, never values. Per-environment values; no shared secrets between staging and production. Three stores only: (1) GitHub **Environments** (`staging`, `production`, `backup`) for CI/CD secrets, with required reviewers on `production` and `backup`-restore; (2) the **host's** secret store for runtime (Vercel environment variables marked sensitive; or `/etc/rentcar/*.env` root-only `0600` / Docker secrets on the VPS); (3) the owner's **password manager** for offline copies (KEK, age private key, recovery codes). Repository-level secrets are not used except none; PRs from forks never receive secrets.

### 5.2 Inventory

| Secret / config | Used by | Stored in | Env scope | Rotation | Notes |
|---|---|---|---|---|---|
| `DATABASE_URL` (role `rentcar_app`, pooled, `sslmode=verify-full`) | runtime | host secret store | per env | on compromise or staff change; DB password yearly | Never in CI except test DB |
| `DIRECT_DATABASE_URL` (role `rentcar_migrator`, direct) | migrate job | GitHub Environment secret (`staging`, `production`) | per env | yearly + on compromise | Not present in the runtime environment (H-13, SR-DB) |
| `rentcar_owner` credential | none (NOLOGIN) | does not exist as a login | | | A password for it must never be created (05-database risk list) |
| `BACKUP_DATABASE_URL` (role `rentcar_backup`, direct, read-only) | backup workflow | GitHub Environment `backup` | production only | yearly | Read-only role limits blast radius |
| `BACKUP_AGE_PUBLIC_KEY` | backup workflow | GitHub variable (public) | | on key rotation | Public by design |
| age **private** key | restore only | owner password manager + offline copy; **never in GitHub** | | on suspicion; re-encrypt policy in 10.5 | CSM-2 |
| `BACKUP_S3_*` (write-only to the dump bucket, second provider) | backup workflow | GitHub Environment `backup` | | yearly | Bucket key scoped to PutObject/List on one bucket; no delete (lifecycle does retention) |
| `RESTORE_S3_*` (read) | restore test | GitHub Environment `restore-test` (reviewer required) | | yearly | Separate from write key |
| `SESSION_SECRET`, `RATE_LIMIT_HMAC_KEY`, `CRON_SECRET` | runtime; `CRON_SECRET` also `jobs-cron.yml` | host store + GitHub Environment (for `CRON_SECRET`) | per env, all different | `SESSION_SECRET` rotation supports two active keys [ASSUMPTION: confirm with backend] ; `CRON_SECRET` on suspicion | >= 32 bytes entropy, generated by `openssl rand -base64 48` |
| `APP_ENCRYPTION_KEY` (KEK for SMTP passwords) | runtime | host store (Vercel sensitive / root-only file); offline copy in password manager | per env, different | rotation by key id (AES-GCM key ids, 03b crypto); re-wrap job | Not in the DB provider, not in backups, not in the same place as dumps (R-SEC-02, SR-CRY-09) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (+ `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`) | runtime | host store | per env, separate buckets | yearly | Token scoped to one bucket; staging bucket separate |
| `SYSTEM_SMTP_*`, `SYSTEM_ADMIN_EMAIL` | runtime (system emails) | host store | per env | on provider change | Port 465/587 only (H-8) |
| `OBS_*` (error-tracker DSN, release auth token, OTLP endpoint/headers) | runtime DSN; CI token for sourcemaps | DSN: host store; auth token: GitHub Environment | per env | yearly | DSN is not a secret in the strict sense but is treated as one |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | deploy jobs (Vercel option) | GitHub Environment (`staging`, `production`) | per env | 90 days (token with expiry) | Scoped token; production token only in the protected environment |
| SSH deploy key (VPS option) | deploy jobs | GitHub Environment | per env | yearly | Key restricted to a `deploy` user with a forced command (`authorized_keys` `command=`), no shell |
| `GHCR` pull token (VPS) | VPS pulls image | host root-only file | | 90 days | `read:packages` fine-grained; CI pushes with `GITHUB_TOKEN` (`packages: write` only in the build-release job) |
| `STAGING_BASIC_AUTH` / Vercel protection bypass | E2E/DAST against staging | GitHub Environment `staging` | staging | on staff change | |
| Seed credentials (`SEED_SYSTEMADMIN_*`) | local only | `.env` of the developer | local | n/a | Refused in staging/production by boot guard |

### 5.3 Handling rules

- Values enter GitHub only through `gh secret set --env <env>` or the UI by the owner; never through PRs. Agents and CI logs: `::add-mask::` for derived values, no `set -x` in steps handling secrets, no secrets in job summaries or artefacts. Gitleaks scans artefacts of failed E2E (trace files) before upload [E: scrubbing step].
- Production secrets are reachable only from jobs bound to the `production` environment (required reviewer, branch/tag restriction: only tags `v*`). `pull_request` workflows run with a read-only token and no environment secrets.
- Short-lived credentials preferred when the provider supports OIDC (Vercel/AWS/Scaleway token exchange) [E: most small providers do not; static scoped keys with expiry are the default; revisit].
- Accounts: MFA (TOTP or passkey) on GitHub, host, DB provider, storage providers, DNS registrar, email provider; named accounts; a break-glass recovery path documented in the password manager (OPS-15). Privilege minimum per section 8.4.
- Rotation procedures are runbook entries `docs/runbooks/rotate-<secret>.md` written in M0/M1 (technical-writer); a rotation calendar (yearly review in January) is a recurring issue template.
- Leak response: revoke, rotate, check logs, notify per `incident-response.md`; gitleaks hit in history means rotate first, then clean.

## 6. Hosting options and what differs (env only)

| Aspect | Option A-host: Vercel Pro `fra1` + Neon (Launch) + S3 provider | Option C-host: single EU VPS (Compose + Caddy + Postgres container) |
|---|---|---|
| Artefact | Vercel build from the same commit (`vercel build --prod`, prebuilt deploy) | The CI-built image `ghcr.io/ermaaga/rentcar@sha256:...` |
| `HOST_KIND` | `serverless` | `server` |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | Neon pooled / direct endpoint, `verify-full`, DB roles created by SQL once | `postgres` service on the private network; both URLs point to it (pooler not needed; `DATABASE_URL` still role `rentcar_app`) |
| Storage | `STORAGE_PROVIDER=s3` (Scaleway/R2) | `s3` (preferred) or `local` on a volume (allowed, `HOST_KIND=server`) |
| Scheduler | Vercel Cron hourly (`vercel.json`) + `jobs-cron.yml` fallback | `jobs` sidecar and/or `jobs-cron.yml` |
| Client IP | `TRUSTED_PROXY_COUNT` per Vercel header (VERIFY at build, H-3) | Caddy overwrites `X-Forwarded-For`; `TRUSTED_PROXY_COUNT=1` |
| TLS / CDN | Vercel-managed | Caddy automatic TLS; optional Cloudflare in front [E] |
| Migrations | CI job against Neon direct URL before promotion | CI job via SSH (`docker compose run --rm migrate`) before `up -d` of the new app |
| Backups | Neon PITR (7 days, Launch) + nightly dump | nightly dump (no PITR) + optional Hetzner snapshot |
| Hardening | Vercel project settings, env scopes, deployment protection | Section 8.2 |
| Cost at launch | about USD 25-35/month [devops-costs 1] | about EUR 11-13/month [devops-costs 1] + the owner's ops hours |

Switching hosts needs only: `vercel.json` or `compose.prod.yaml` + `Caddyfile`, environment values, and the runbook (about 1 week, ADR-0011). A preview deployment on Vercel is kept even when the VPS wins, as the serverless proof (NFR-SRV-01).

## 7. Release and deploy flow

### 7.1 Pipeline

```
PR / push  -> ci.yml + security.yml (required)  -> squash merge to main
main       -> deploy-staging.yml (automatic)
              build image once (tag sha-<gitsha>, push GHCR) -> Trivy image scan on the pushed digest
              -> migrate staging (direct URL, rentcar_migrator) -> deploy staging
              -> smoke: /api/healthz, /api/readyz, public search page, header test with HSTS, login page
              -> Playwright smoke subset (@smoke tag) against staging
              -> ZAP baseline (passive) -> report artefact
tag vX.Y.Z -> release.yml
              guard: refuse unless docs/00-stato-progetto.md on the tagged commit reports APPROVAZIONE_GO_LIVE: APPROVATA
                     (first production release only; later releases require the 'production' environment approval)
              -> verify the tag's commit has green ci-gate + security-gate and a green staging deploy of the same digest
              -> SBOM (syft, CycloneDX) of the image, attached to the GitHub Release and archived
              -> environment 'production' (required reviewer = owner, wait timer optional) 
              -> pre-migration safety point (7.3) -> migrate production (expand only) -> promote/deploy the SAME digest
              -> post-deploy: health/ready, synthetic journey, error-rate watch 15 min, annotate deploy in observability
              -> notify (email via system SMTP / GitHub notification)
```

The same artefact is promoted from staging to production (never rebuilt). On Vercel the staging and production builds are separate `vercel build` outputs of the same commit; the equivalence is asserted by comparing the git SHA exposed by `/api/healthz`-adjacent build metadata (not on the public endpoint: SR-CFG-07; it is checked via the deployment API instead). ASSUMPTION: Vercel Git-based auto-deploy for the production branch is disabled so production changes only through `release.yml` (devops-costs 9).

**Production is refused** by `release.yml` and by this role unless the state file reports `APPROVAZIONE_GO_LIVE: APPROVATA` (rule of the role; the workflow guard is a second line, not a substitute for the approval).

### 7.2 Deploy strategy

- **Vercel**: atomic immutable deployments; deploy with `vercel deploy --prebuilt --prod --skip-domain`, run the smoke tests against the deployment URL, then `vercel promote` (or alias). Rollback: `vercel rollback`/re-promote the previous deployment, seconds, no rebuild.
- **VPS**: rolling replacement of the single `app` container with `docker compose up -d --no-deps --wait app` after pulling the new digest; Caddy retries upstream for a short window, giving near-zero downtime (a few seconds, acceptable for the 1-10 tenant stage, [E]). Previous digest recorded in `/srv/rentcar/releases` (last 5). Blue/green with two app containers is a documented upgrade path, not built now (YAGNI).
- Previews: only Vercel (per-PR) and only with synthetic data.

### 7.3 Migrations in the release

- Run in CI against `DIRECT_DATABASE_URL` as `rentcar_migrator` **before** promotion, never at cold start (ADR-0002), with `lock_timeout=5s` and the advisory lock; post-migration catalog checks are part of `migrate` (05-database 8.1).
- **Expand/contract** is mandatory: the release that deploys code N may contain only additive migrations; destructive steps (marked `-- destructive`) ship one release later. A CI check rejects a PR that contains both a destructive migration and code changes referencing the old column (heuristic + reviewer checklist) [E].
- **Safety point before every migration with `-- destructive`**, and before the first production migration: Neon branch/restore point or `pg_dump` of the affected tables to the backup bucket (age-encrypted). For non-destructive releases the nightly dump and PITR are the safety net.
- Failed migration: the job fails, the old version keeps running (still compatible), nothing is promoted; fix forward with a new migration (never edit an applied one).

### 7.4 Rollback plan (objective criteria)

Automatic or manual rollback to the previous digest/deployment if, within 15 minutes after promotion, any of: readiness fails 3 consecutive probes; synthetic booking journey fails twice; 5xx rate > 2% over 5 min with at least 50 requests [E threshold, to confirm with observability]; a critical function is KO (login, public search, booking creation, admin calendar). Steps: (1) roll back the app (7.2, minutes); (2) leave expanded schema in place (compatible by construction); (3) if a contraction migration was released and is the cause: restore from the pre-migration safety point (the real rollback for contractions, ADR-0002) after PM authorisation; (4) post a note in the incident log, open an issue, add a regression test. No force push, no table drop, no data deletion without explicit PM-obtained authorisation.

### 7.5 Observability provisioning (docs/12-osservabilita.md, written by the observability-engineer in parallel)

DevOps provides, without deciding tooling: runtime variables `OBS_*` as secrets per environment; `OBS_ERROR_PROVIDER` / `OBS_LOG_SINK` switch (noop in local/CI); CI step uploads source maps to the error tracker with the release name = git SHA and `OBS_AUTH_TOKEN` from the environment, then deletes them from the build output; deploy annotation (release + deploy marker API call) as the last step of `release.yml`/`deploy-staging.yml`; dashboards and alerts versioned under `ops/observability/` and applied by a manual `workflow_dispatch` job if the chosen tool supports an API ([E], otherwise documented export); heartbeats: `jobs-cron.yml` and `nightly-backup.yml` ping a heartbeat URL (Sentry cron monitor / Better Stack) on success; absence of ping for 26 h emails the owner (CSM-1, devops-costs observability section). Alert recipients: OPS-16. Uptime check of `readyz` from outside once production exists.

## 8. Hardening

### 8.1 Common

TLS 1.2+ everywhere, HSTS from the application (no preload at start, SEC-8); DB `verify-full` in production-like; no database or admin port exposed; non-root containers; no `latest` tags; pinned digests; dependency installs with `ignore-scripts`; read-only token defaults in Actions; `X-Robots-Tag: noindex` and access protection on staging; `x-middleware-subrequest` stripped at the edge (H-12); request size limits (4 MB uploads, H-7).

### 8.2 VPS specifics (only if option C-host)

Key-only SSH on a non-default port with allowlist or VPN, `PermitRootLogin no`, `fail2ban`; UFW default-deny, only 22 (restricted), 80, 443 open, plus the Docker/UFW bypass fix (rules in `DOCKER-USER` or `ufw-docker`; verified from an external port scan, because Docker published ports bypass UFW by default); `unattended-upgrades` with reboot window; `chrony`; Caddy with HSTS, header set, request-size and timeout limits, `TRACE` blocked; Postgres only on the internal Docker network, data volume on an encrypted disk (LUKS or provider volume encryption, H-5: otherwise a recorded deviation); `app` and `postgres` non-root, `cap_drop ALL`, `no-new-privileges`; the KEK and DB passwords in root-only files **not** in the backed-up data set; outbound firewall to DB/S3/SMTP only where feasible; provider snapshot as a second safety layer; host heartbeat (cron `curl` to the heartbeat URL). Outbound SMTP 465/587 confirmed with the provider before purchase (OPS-8).

### 8.3 Vercel specifics (only if option A-host)

Function region pinned `fra1` in `vercel.json`; Pro plan; deployment protection on previews and staging; env scopes (Production / Preview / Development) populated separately, sensitive variables marked; Git production auto-deploy disabled; team with minimal members and MFA; log drain off by default; cron entries only calling `/api/jobs/run`.

### 8.4 Least privilege

GitHub: owner admin; CI token read-only by default; `production` environment reviewers = owner; no personal access tokens in workflows (fine-grained, expiring, if ever needed). DB: four roles as per 05-database 4.1; `rentcar_app` is the only credential on the runtime host; `rentcar_migrator` only in the protected CI environment; `rentcar_backup` only in the backup environment. Storage: one key per environment per bucket; backup bucket write-only key from CI, separate read key for restore. DNS registrar and host root accounts: MFA, not used day-to-day.

## 9. Costs and alerts

- Budget alerts: Vercel spend management (hard cap at the Pro included credit plus an agreed limit), Neon usage notification, bucket usage alerts at the provider, GitHub Actions minutes budget (set to USD 0 additional spend so overage stops instead of billing). Monthly review for the first three months. Target ceiling: OPS-3 (deferred by user). Estimates stay in `docs/03-inputs/devops-costs.md`; nothing is bought in Phase 1 (cost EUR 0 apart from GitHub).
- Hidden cost watch-list: Vercel function GB-hours and Fast Data Transfer, Neon compute (cold wake each hour is avoided by hourly cadence only if idle gaps > 5 min), egress from the backup bucket during drills, CI minutes (E2E on WebKit), error-tracker quota.

### 9.1 Environments table: tags and shutdown

Resources tagged `project=rentcar env=<env>` where the provider supports tags; the preview DB branches are deleted on PR close (workflow `preview-cleanup.yml`, destructive only on resources the workflow created, listed by name prefix `pr-<n>`; deletions of any other resource need PM authorisation).

### 9.2 Bootstrapping a managed production database (runbook outline)

1. Create project/DB in the EU region, enable PITR plan. 2. As the provider admin role run `scripts/db-bootstrap.sql` (roles with generated passwords stored directly in the secret stores, never printed). 3. Verify with the catalog query: `rentcar_app` is not superuser, not owner, `rolbypassrls=false`; `rentcar_backup` privileges; (S1/NV7 outcomes). 4. Run `migrate` from the `production` environment. 5. Create the production systemadmin with `create-systemadmin` (A-33, no password in env). 6. Store evidence in the go-live checklist.

## 10. Backup and disaster recovery (designed now, activated when production exists)

Consistent with 05-database section 10 and NFR-BKP-01: **RPO <= 24 h with dump only (minutes with Neon PITR), RTO <= 4 h target** (NFR-BKP-01 requires <= 24 h), retention 30 days, restore test before go-live and quarterly.

### 10.1 Nightly backup (`nightly-backup.yml`)

1. Trigger: `schedule` 01:30 UTC and manual; job in environment `backup`; `concurrency` without cancellation. Disabled by variable until production exists.
2. Install PostgreSQL 16 client (version matching the server major) and `age`; verify `age` binary checksum.
3. `pg_dump -Fc --enable-row-security --no-owner --exclude-table-data=sessions --exclude-table-data=credential_tokens --exclude-table-data=rate_limit_buckets "$BACKUP_DATABASE_URL"` with `sslmode=verify-full` over the **direct** connection and the read-only `rentcar_backup` role.
4. Export `deletion_ledger` rows of the last 35 days as CSV (`COPY ... TO STDOUT`), same encryption (05-database 5.22).
5. Generate a manifest `rentcar-<UTC>.manifest.json`: per-table row counts at dump time (taken inside the same snapshot using `pg_dump --snapshot` exported snapshot or a repeatable-read transaction [E: pick one at implementation so counts match the dump]), schema/migration count, dump size, git SHA of the app, dump tool version. Counts are the basis for the restore comparison because an RLS-filtered dump would show zeros.
6. Encrypt: `age -r "$BACKUP_AGE_PUBLIC_KEY"` (multiple recipients supported: owner key plus a second custodian key, OPS-17). Plain dump never touches disk persistently: pipe `pg_dump | age > file` in a tmpfs path; delete on exit.
7. Upload to the bucket of a **second provider** (different from the DB host and, if the app storage is at provider X, a bucket at Y; OPS-7) with `rentcar-<UTC>.dump.age`, `.manifest.json` (manifest is not secret but is also age-encrypted if it holds table names only? Row counts are not PII; stored plain, signed by checksum) and `.sha256`.
8. Sanity checks that fail the job: dump size within [50%, 300%] of the median of the last 7 [E], manifest non-empty, upload verified by `HEAD` and checksum, zero-row tables listed against an expected-non-empty list (`tenants`, `users` once tenants exist).
9. Heartbeat ping on success (monitor expects every 24 h +2 h); on failure GitHub emails the owner **and** the missing heartbeat alerts at 26 h (silent-failure mitigation, D14, CSM-1).
10. Retention: bucket lifecycle rule deletes objects after 30 days (the pipeline has no delete permission). Backups hold personal data of terminated tenants for up to 30-35 days: stated in the DPA (SEC-7).
11. Pre-migration dumps (7.3) use the same mechanism with prefix `premig-`.

GitHub is a processor for the backup run unless the dump runs from an EU host (sign-off section 3): listed as a sub-processor; the dump streams through the runner but is never stored there. Alternative (OPS-18): run the same script on the VPS with `systemd` timer (option C-host), removing GitHub from the data path.

### 10.2 Keys

age key pair generated offline by the owner (OPS-17); public key in GitHub variables; private key in the password manager plus a sealed offline copy; never on GitHub, runners, the VPS or next to `APP_ENCRYPTION_KEY`. Without both the dump and the KEK, encrypted SMTP credentials stay unreadable by design: restoring needs the KEK from its own custody (documented in the runbook). Annual key-custody check: decrypt a recent dump.

### 10.3 Restore runbook (outline for `docs/runbooks/restore.md`, English, technical-writer)

1. Declare incident; freeze writes if possible (maintenance mode via env flag, [ASSUMPTION: backend provides a read-only/maintenance switch] or stop the app).
2. Choose source: PITR restore to a new branch/instance (preferred, minutes) or the latest good dump. Record the target time.
3. Fetch `.dump.age`, `.manifest.json`, `.sha256` from the bucket; verify checksum; decrypt with the private key on a trusted machine.
4. Create a **new** empty database on the target instance with roles already present (`db-bootstrap.sql`); never restore over the live database.
5. `pg_restore --no-owner --role=rentcar_owner -d <db>` connected as `rentcar_migrator` (verified [V] in 05-database 10; if a provider refuses, retry with the provider's BYPASSRLS/superuser role).
6. Run `verify-restore` (script in `scripts/`): per-table row counts versus the manifest, FK validity, exclusion constraint present, RLS/grant/definer catalog suite (the CI catalog tests), a test login, `readyz`.
7. **Mandatory replay of the deletion ledger** (blocking step): apply `customer_anonymised` and `tenant_hard_deleted` entries from the exported ledger (35 days) and from any PITR-surviving ledger so erased subjects do not reappear; re-check by counts of the erased ids = 0. Log the operation in `platform_audit`.
8. Point `DATABASE_URL`/`DIRECT_DATABASE_URL` to the restored database (secret change, redeploy or restart), re-run `migrate` to apply any later migrations, run smoke tests, lift maintenance.
9. Postmortem and record RPO/RTO achieved; notify tenants if data loss > 0 and, if personal data is involved, assess the 72 h breach duty (incident-response.md).

### 10.4 Restore drill (`restore-test.yml`)

Quarterly and before go-live. Runs in a throwaway Postgres 16 service container in Actions (or a Neon branch), environment `restore-test` with reviewer approval and the read key; the private age key is **not** in GitHub, so the automated drill restores a **drill-specific** dump encrypted to a drill key kept in the environment (synthetic or staging data, never production) to exercise the mechanics, while the full production drill (decrypt with the real private key) is a manual, owner-attended run on a laptop or the VPS, with the result recorded in `docs/test-reports/restore-YYYY-MM-DD.md` (size, duration, counts match, ledger replay applied, RTO measured). Evidence of one production drill is a Gate 4 condition (NFR-BKP-01).

### 10.5 DR scenarios

| Scenario | Response | Target |
|---|---|---|
| Bad deploy | Rollback (7.4) | minutes |
| Bad migration (additive) | Roll back app; fix forward | minutes to hours |
| Bad contraction / data corruption | PITR to a new branch or restore pre-migration dump, ledger replay | RTO <= 4 h, RPO minutes (PITR) or <= 24 h |
| DB provider loss | Restore the latest dump from the second provider to another Postgres (Neon, Supabase, VPS) by changing `DATABASE_URL` (portability is the point of AC10) | RTO <= 4 h [E: needs the KEK and age key available] |
| Host/VPS loss | Re-provision from `compose.prod.yaml` + secrets from the password manager, restore dump | RTO <= 4 h, practised once |
| GitHub unavailable | Release and backup pause; backups can run from the VPS timer (OPS-18); manual deploy only with PM authorisation | accepted |
| Key loss (age private) | Backups unreadable: therefore two custodians (OPS-17) | prevention |

## 11. Infrastructure as code

Justified level: **no Terraform now** (a handful of managed resources, host not chosen). Declarative files in the repo are the IaC: `compose.yaml`, `compose.ci.yaml`, `compose.prod.yaml`, `Caddyfile`, `vercel.json`, `.github/workflows`, `.github/rulesets/main.json`, `scripts/db-bootstrap.sql`, `ops/observability/`. Revisit OpenTofu if the VPS option is chosen and more than ~5 cloud resources need reproducibility (state remote and protected, then). A README in `ops/` lists manually created resources and their settings (the "click-ops register") so nothing is invisible.

## 12. M0 delivery plan (for the PM, implementation mode, after approval)

Ordered small commits (one per task): (1) repo skeleton, `.gitignore`, `.editorconfig`, `.nvmrc`, pnpm/`engines`, README stub, `.env.example` + schema test; (2) formatter, ESLint flat config with complexity limits, strict tsconfig, Husky, lint-staged, commitlint; (3) dependency-cruiser rules + fixtures test, jscpd, knip; (4) Vitest with coverage gates + first unit test; (5) Dockerfile + `compose.yaml` (postgres, bootstrap, migrate stub, app, healthz) and AC1 proof; (6) `ci.yml` green with all jobs; (7) `security.yml` (gitleaks, audit, OSV, Semgrep + custom rules with fixtures, Trivy, zizmor, SBOM) with a failing-then-passing run per control stored in the PR; (8) Playwright projects + header test + abuse-case harness scaffold; (9) Dependabot config, CODEOWNERS, PR template, ruleset applied (API output as evidence); (10) deploy/backup/restore workflows committed disabled with dry-run mode. Evidence for the cybersecurity-manager: configuration files plus real run output/links for each control.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| DR-1 | Private-repo CI minutes or GitHub code scanning availability on the free plan | medium | Concurrency cancel, nightly matrix, Semgrep as blocking SAST; OPS-11, OPS-14 |
| DR-2 | Solo owner cannot satisfy "1 approving review" | medium | Ruleset with required checks + CODEOWNERS and no admin bypass; add a second reviewer later (OPS-9) |
| DR-3 | Backup silent failure (no on-call) | high | Heartbeat monitor at 26 h plus failure emails; first manual check weekly during month 1 |
| DR-4 | Age private key custody (loss = unreadable backups; leak = readable backups) | high | Two custodians, offline copy, annual decrypt test (OPS-17) |
| DR-5 | Dump routed through GitHub (extra sub-processor; credentials in Actions) | medium | Scoped write-only keys, `backup` environment, alternative VPS timer (OPS-18) |
| DR-6 | Docker published ports bypass UFW on the VPS | high (if C-host) | `DOCKER-USER` rules + external port scan as acceptance test |
| DR-7 | `rentcar_backup` BYPASSRLS or `SET ROLE` ownership behaves differently on the chosen provider | medium | Spike S1/NV7 in M1; `backup_read` policy fallback already verified |
| DR-8 | E2E on WebKit slow or flaky in CI | medium | Shard, cache browsers, retry 1, nightly full matrix; QA owns the flake budget |
| DR-9 | Neon scale-to-zero cold start affects staging smoke timing and hourly jobs | low | Generous smoke timeouts; measure in S1 |
| DR-10 | Vercel production auto-deploy left on by mistake | medium | Setting verified in the go-live checklist; release job is the only token holder for production |

---

## Esito

- **Stato**: completato
- **File prodotti/modificati**: `/Users/ermaaga/Work/RentCar/docs/11-devops-deploy.md`
- **Sintesi**:
  1. Five environments (local, CI, optional Vercel preview, staging, production) with `APP_ENV` classes, data and protection rules; real data only after Gate 4.
  2. Compose: `postgres` (16, digest-pinned, healthcheck, named volume, DB on 127.0.0.1) -> `migrate` (one-shot, `rentcar_migrator`, post-migration catalog checks) -> `app` (non-root, healthz); `seed` and `jobs` profiles on by default locally; `s3` (MinIO) and `mail` (Mailpit) optional profiles; DB roles created by `db-bootstrap.sql` in `initdb.d`; works with no `.env` thanks to `INSECURE_DEV_` defaults that production guards reject.
  3. Dockerfile: multi-stage standalone, digest-pinned slim base, `ignore-scripts` with allowlisted native rebuilds, `USER node`, scripts bundled so one image does app/migrate/seed; no sourcemaps or secrets in the runtime image.
  4. CI: `ci.yml` on every push/PR (lint/types/arch/duplication, unit with coverage gates, integration with Postgres 16 service incl. pgbouncer variant, security-matrix, build, Playwright Chromium + WebKit with 4 mobile/desktop projects against Compose), `security.yml` (gitleaks, audit + OSV + licences, Semgrep with fixture-tested custom rules, Trivy, SBOM, actionlint/zizmor), aggregator checks `ci-gate`/`security-gate` as the only required checks; staging auto-deploy, production on tag with protected environment.
  5. Release: same digest promoted staging to production; migrations before promotion, expand/contract, pre-migration safety point; objective rollback criteria; production refused unless `APPROVAZIONE_GO_LIVE: APPROVATA`; the Vercel and VPS paths differ by env and one deployment file only.
  6. Secrets inventory (per env, store, rotation) with GitHub Environments, host store and password manager; age private key and KEK never in GitHub or next to dumps.
  7. Nightly encrypted `pg_dump` -> second provider, 30 days, manifest with row counts, heartbeat; restore runbook with mandatory deletion-ledger replay; quarterly drill; all committed disabled until production exists.
  8. Branching: trunk-based, squash-merge PRs with Conventional Commits, one task per commit, ruleset and CODEOWNERS; M0 delivery order of 10 commits for the PM.
- **Assunzioni**:
  - `docker compose up` works without `.env` (inline `INSECURE_DEV_` defaults); `.env` only overrides.
  - One PR = one task (or a tight group), squash merge, so "one commit per task" holds on `main`; rebase-merge if every task commit must stay on `main`.
  - Solo owner: review rule is "required checks + CODEOWNERS, no admin bypass" until a second member exists.
  - Vercel Git production auto-deploy is disabled; `release.yml` is the only production path.
  - `SESSION_SECRET` supports two active keys during rotation (backend to confirm); a maintenance/read-only switch exists for restores (backend to confirm).
  - GitHub private-repo free minutes (about 2,000/month) and code-scanning availability not verified [E].
  - No IaC tool (Terraform/OpenTofu) until the host is chosen and the resource count justifies it.
  - Env name `APP_BASE_URL` (spec) vs `PUBLIC_BASE_URL` (03b) must be unified by backend; `.env.example` test will enforce one.
- **Rischi**:
  - Backup failure unnoticed without on-call (alta); mitigated by heartbeat + weekly manual check in month 1.
  - Age private key custody loss/leak (alta); two custodians, offline copy.
  - Docker bypassing UFW on VPS (alta, only option C-host).
  - Backup path through GitHub adds sub-processor and credentials in Actions (media).
  - GitHub free-tier minutes/code scanning limits (media); solo-owner review rule (media).
  - Provider-specific behaviour of `rentcar_backup` BYPASSRLS and `SET ROLE` ownership (media), resolved by spike S1/NV7.
  - WebKit E2E flake and duration (media).
- **Criteri non verificati**: nessuno in questa modalità (analysis only; nothing executed). Provider/GitHub prices and quotas marked [E] are to be verified at M0; tool and action versions/SHAs are pinned at implementation.

## Domande per l'utente

| ID | Domanda | Opzioni (la prima è raccomandata) | Perché conta / impatto | Bloccante |
|---|---|---|---|---|
| OPS-9 | Il repository avrà una seconda persona che può approvare le modifiche (revisore)? | A (raccomandata): no, per ora solo tu; le modifiche passano solo se tutti i controlli automatici sono verdi e nessuno può aggirare la regola / B: sì, un secondo account (anche un collaboratore) approva ogni modifica | Con una sola persona GitHub non permette di approvare le proprie modifiche: con A la protezione è comunque forte ma senza "secondo paio d'occhi" | no |
| OPS-10 | Vuoi che ogni commit sia firmato (firma digitale GitHub/GPG/SSH)? | A (raccomandata): no all'inizio / B: sì, obbligatorio | Dà prova di chi ha scritto il codice; richiede configurazione una tantum sui tuoi computer | no |
| OPS-11 | Il repository è privato e sei disposto a pagare GitHub Advanced Security (code scanning CodeQL) se serve? | A (raccomandata): no, uso Semgrep come controllo bloccante e CodeQL solo se gratuito / B: sì, pago per CodeQL | Impatta costo mensile e quale analizzatore blocca le modifiche | no |
| OPS-12 | Per gli aggiornamenti automatici delle librerie preferisci Dependabot o Renovate? | A (raccomandata): Dependabot (integrato in GitHub, zero installazioni) / B: Renovate (più configurabile, app da installare) | Cambia solo chi propone gli aggiornamenti; entrambi soddisfano il requisito di sicurezza | no |
| OPS-13 | Approvi la lista di licenze consentite per le librerie (MIT, Apache-2.0, BSD, ISC, MPL-2.0) e il blocco di tutte le altre (es. GPL/AGPL)? | A (raccomandata): sì / B: elenco più ristretto o più ampio, indicami quale | Una libreria con licenza non ammessa farebbe fallire la verifica; evita problemi legali per un prodotto commerciale | no |
| OPS-14 | Il repository GitHub sarà privato o pubblico, e con quale piano (Free o Team)? | A (raccomandata): privato, piano Free all'inizio, passaggio a Team (circa 4 dollari/utente/mese) solo se finiscono i minuti / B: pubblico (minuti gratuiti illimitati, ma il codice è visibile a tutti) | Determina quante esecuzioni dei test al mese sono gratuite e se il codice è riservato | no |
| OPS-15 | Chi custodisce il recupero degli account (codici di emergenza MFA, gestore di password) se non sei raggiungibile? | A (raccomandata): gestore di password con una persona di fiducia designata e codici stampati in luogo sicuro / B: solo tu | Se perdi l'accesso a GitHub o al fornitore del database, nessuno può rilasciare né ripristinare | no |
| OPS-16 | A quale indirizzo email e a chi arrivano gli avvisi automatici (backup mancato, sito non raggiungibile, errori)? | A (raccomandata): una casella dedicata (es. alerts@tuodominio) inoltrata a te / B: la tua email personale | Senza destinatario i guasti restano invisibili (non c'è reperibilità) | no |
| OPS-17 | Chi genera e custodisce la chiave di cifratura dei backup (chiave age) e chi è il secondo custode? | A (raccomandata): la generi tu offline, con una seconda copia sigillata affidata a una persona di fiducia / B: solo tu | Se la chiave si perde i backup sono illeggibili per sempre; se si diffonde, sono leggibili da chiunque | sì, prima del go-live (non per la Fase 1) |
| OPS-18 | Il backup notturno può passare dai server GitHub (più semplice, GitHub diventa un fornitore da elencare) oppure vuoi che parta da un server europeo tuo? | A (raccomandata): GitHub Actions, con chiavi limitate e senza salvare il dump sul runner / B: dal VPS europeo (nessun dato transita da GitHub, ma richiede il VPS) | Incide su privacy (elenco fornitori nel contratto) e semplicità | no (prima del go-live) |
