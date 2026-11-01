# Security risk register: RentCar

Version 1.0 · 2026-11-01 · Owner: cybersecurity-manager · Status: opened at GATE 2 (design phase, no code yet)
Inputs: `docs/01-discovery.md`, `docs/02-requisiti.md` (v1.1), `docs/03-architettura.md`, `docs/adr/0001..0014`, `docs/03-inputs/security-constraints.md`, `docs/03-inputs/devops-costs.md`, `docs/03-inputs/observability-options.md`, `docs/pm/raid.md`.
Language: English. Questions to the user are in Italian in the sign-off Esito.

## 1. Risk classification

| Dimension | Assessment |
|---|---|
| Data processed | Ordinary personal data of end customers (first/last name, phone, optional email) across all tenants; staff account data (name, username, email, password hashes); per-tenant SMTP credentials (stored encrypted); business-confidential data (bookings, revenue, expenses). **No** special-category data, **no** card data (pay on site), **no** ID or licence numbers (premise: SEC-5 answer A). |
| Exposure | Internet-facing. Anonymous public write endpoint (booking, search) per tenant. Staff login per tenant and a privileged systemadmin login. A job endpoint reachable from the internet (secret-protected). |
| Crown jewels | (1) Tenant isolation, (2) systemadmin account, (3) encryption key (KEK) plus stored SMTP secrets, (4) tenant admin accounts, (5) database and its backups. |
| Impact of a breach | One flaw can expose every tenant's customers (multi-tenant blast radius). Compromised SMTP credentials allow mail sent as the tenant (phishing, reset-link interception). Individual records are of medium sensitivity; aggregate and trust impact on the owner (processor, contract signer) is high. |
| Regulatory | GDPR applies. Tenant = controller, owner = processor (Art. 28) for customer data; owner = controller for staff account and security data (NFR-GDPR-01). 72 h notification duty is the controller's; the processor must notify the controller "without undue delay". EU residency required (NFR-GDPR-05); US-HQ processors need DPA + SCC/DPF + transfer assessment. DPIA not required on the facts (screening note to be written; changes if SEC-5 is answered B). NIS2: not expected to apply (micro/small provider of a non-critical service; to be re-checked by the lawyer, SEC-6). PCI-DSS: out of scope while no card data is stored or processed. Healthcare/finance sector rules: none. EAA applies to the UI (accessibility, not a security matter). |
| Contractual | None stated (no ISO 27001/SOC 2 requirement). Tenants may ask for them later; not planned. |
| Availability | Not critical (discovery D14: RPO/RTO 24 h, no on-call). This lowers availability controls but does **not** lower confidentiality and integrity controls. |

### Required security level: OWASP ASVS 4.0.3 Level 2 for the whole application

Rationale:
- Multi-tenant SaaS, one flaw exposes every tenant (V4, V8), privileged systemadmin role (V2, V3), stored third-party credentials (V6), public unauthenticated write endpoint (V5, V11 business logic, anti-automation).
- The incremental cost of L2 over "L1 plus L2 on three chapters" is small (headers, logging, configuration are cheap).
- L3 not justified: no special-category data, no payments, no safety-critical function.
- This resolves SEC-4 (decision of the cybersecurity-manager; the user is informed, no user decision needed).
- Consequences that are **not** negotiable at L2 (they override weaker wording in `02-requisiti.md`):
  - Minimum password length is **12** (ASVS 4.0.3 V2.1.1 requires 12 even at L1). FR-AUTH-07 (min 10) must be changed; this also resolves SEC-2.
  - Passwords are checked against a breached/common list (FR-AUTH-07 already).
  - Verification of controls is by ASVS L2 checklist traced in `docs/08-security.md` (security-engineer), reviewed per milestone.
  - V2.8 (MFA/OTP): see risk R-AUTH-02 and the SEC-1 recommendation. For the privileged systemadmin role MFA is a mandatory control of this register before go-live.

### Minimum mandatory controls (baseline, see sign-off section 4 for the M0 list)
Secret scanning, SCA, SAST, container/IaC scan, abuse-case tests in CI, DAST on staging before each prod release, header/TLS checks, SBOM per release, branch protection, MFA and least privilege on all accounts (repo, hosting, DB, storage, DNS, email provider), encrypted backups on a separate provider with a tested restore, security logging with minimal email alerting (CSM-1).

## 2. Scale

Probability: L (low, needs unusual conditions) · M (plausible within 12 months) · H (expected or common).
Impact: L (limited, one user) · M (one tenant) · H (all tenants or legal exposure for the owner).
Level = P x I: High if at least one is H and the other is at least M; Medium if M/M or H/L; else Low.

## 3. Register

Status values: `open` (control planned, not implemented) · `mitigating` (control in progress) · `mitigated` (control implemented and verified) · `needs acceptance` (residual risk the user must accept, via the project manager) · `accepted` (recorded user decision) · `closed`.
Nothing is `mitigated` yet: no code exists. "Residual" is the expected level if the listed controls are implemented and verified.

### 3.1 Tenant isolation and access control

| ID | Risk | P | I | Level | Controls (requirement refs) | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-ISO-01 | Cross-tenant read/write (IDOR, missing tenant filter in a query, server action, CSV export, job, cache) | M | H | High | Scoped repositories + Postgres RLS (ADR-0003, ARC-3); generated cross-tenant matrix in CI for every entity and route; "runtime role without GUC returns zero rows" test; architecture rule forbidding ORM use outside repositories (NFR-ISO-01..03, US-063) | security-engineer / database-architect | Low | open |
| R-ISO-02 | RLS silently ineffective: runtime role owns tables or has BYPASSRLS (on Neon, roles created in the console are members of `neon_superuser`, which bypasses RLS: verify; on Supabase the default `postgres` role bypasses RLS), `FORCE RLS` missing, or session-level `SET` leaks across pooled connections (AR-2) | M | H | High | Runtime role created by SQL with `NOBYPASSRLS`, non-owner; separate migration role; only `SET LOCAL` in explicit transactions; lint rule + DB test that fails if the runtime role has BYPASSRLS or owns a table; spike S1 on the real pooler is a go/no-go for the RLS claim | database-architect | Low | open |
| R-ISO-03 | Tenant-less/system paths (slug lookup, login lookup, jobs, systemadmin console) become a bypass of scoping | M | H | High | Separate audited system context, explicit `app.scope = 'system'` policies on the few tables involved; jobs scope each tenant in its own transaction; review of every system-context call site | security-engineer | Low | open |
| R-ISO-04 | Operator (view-only) or deactivated/suspended user performs writes through a crafted server-action POST or an old session | M | M | Medium | `requireRole(scope, role)` in every action/handler/page (not only middleware); sessions revoked on deactivation, suspension and password change (FR-AUTH-10, FR-SYS-12); abuse-case tests per endpoint (401/403/404/400/mass assignment/429) | backend-developer / qa-engineer | Low | open |
| R-ISO-05 | Next.js framework-level auth bypass CVE (middleware/server-action class) | M | H | High | Authorisation never only in middleware; aggressive patching and advisory subscription; SCA gate; pinned versions with weekly update window | devops-engineer | Medium | open |
| R-ISO-06 | Audit log tampered with or leaking PII | L | M | Low | Append-only enforced at DB level (runtime role has INSERT/SELECT only on the audit table), identifiers only, test for PII (FR-AUD-03) | database-architect | Low | open |

### 3.2 Authentication and sessions

| ID | Risk | P | I | Level | Controls | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-AUTH-01 | Bespoke authentication code defects (options A and C; AR-3): session fixation, token handling, timing, lockout bypass | M | H | High | Small surface; primitives from `node:crypto`/`@node-rs/argon2`; ASVS L2 V2/V3 test cases; security-engineer review per milestone; independent review or pentest of auth and RLS before go-live (CSM-3) | security-engineer | Medium | needs acceptance (A, C) |
| R-AUTH-02 | Systemadmin credential theft (phishing, reuse, infostealer) gives control of all tenants. The spec excludes MFA | M | H | High | TOTP MFA for systemadmin before the first real tenant (recommendation SEC-1; spec change needed), recovery codes and a documented break-glass procedure, separate `__Host-rc_system` cookie, short absolute session, login alert email to owner, strict rate limit | security-engineer | Low with MFA; High without | needs acceptance if SEC-1 = C |
| R-AUTH-03 | Tenant admin account takeover (no MFA, phished password, mailbox compromise exposes a temporary password sent by email: FR-AUTH-03) | M | M | Medium | One-time set-password link instead of emailed password (SEC-3 A); 12-char minimum; breached-password check; throttling; MFA for tenant admins in a later phase through `SecondFactorVerifier` | security-engineer | Medium | needs acceptance (no tenant MFA at launch) |
| R-AUTH-04 | Account enumeration or brute force on login/reset | M | M | Medium | Constant-shape responses (FR-AUTH-06), per-account and per-IP throttling in a shared store (ADR-0013), fail closed on login/reset | backend-developer | Low | open |
| R-AUTH-05 | Reset link poisoning (Host header) or token reuse/race | L | H | Medium | Link built only from configured base URL, tokens CSPRNG >= 128 bits, hashed, single use, 60-minute life (NFR-SEC-07) | backend-developer | Low | open |
| R-AUTH-06 | Reset/set-password mail goes through a tenant SMTP that an attacker (compromised admin) controls, enabling takeover of operators | M | M | Medium | Re-authentication for SMTP changes, owner notification on SMTP change sent via the **system** SMTP (SEC-11), audit entry; reset for the tenant admin always via system SMTP | backend-developer | Low | open |

### 3.3 Secrets, SMTP and key management

| ID | Risk | P | I | Level | Controls | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-SEC-01 | Per-tenant SMTP credential leak (DB dump, logs, backups, env) enables mail abuse for all tenants (RAID R-4) | M | H | High | AES-256-GCM with AAD (tenant + field) and key id; secrets never returned or logged; log-scrub canary test; rotation procedure documented and rehearsed once; backups encrypted | security-engineer | Medium | open |
| R-SEC-02 | Single KEK (`APP_ENCRYPTION_KEY`, AS-4) readable by anyone with hosting project access (Vercel env) or the VPS root; lost KEK makes SMTP secrets unrecoverable | M | H | High | MFA and minimal members on the hosting account; KEK kept out of the DB provider and out of backups; offline custody copy by the owner (CSM-2); KMS/secret manager evaluated after launch; key-id design allows rotation | devops-engineer / owner | Medium | needs acceptance |
| R-SEC-03 | Secrets in the repo, CI logs, preview deployments or client bundle | M | H | High | gitleaks pre-commit + CI full-history scan, GitHub push protection, env scoped per environment, previews never get production secrets, `.env.example` only, Zod config fail-fast without printing values | devops-engineer | Low | open |
| R-SEC-04 | `CRON_SECRET` leak or weak compare lets anyone trigger jobs (DoS of DB, duplicate emails) | L | M | Low | Constant-time compare, distinct from other secrets, idempotent jobs with `JobRun` + advisory lock, 401 tests (US-123) | backend-developer | Low | open |
| R-SEC-05 | SSRF through tenant-configured SMTP host (cloud metadata, internal services) | M | H | High | Resolve-then-check allowlist rules, ports 25/465/587/2525 only, TLS verified, short timeouts, test cases in security-constraints section 13 (7) | backend-developer | Low | open |

### 3.4 Application-level and public surface

| ID | Risk | P | I | Level | Controls | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-APP-01 | Stored XSS or HTML injection through customer name, notes, tenant text, branding into calendar, emails, PDFs | M | M | Medium | Output encoding, no `dangerouslySetInnerHTML`, CSP with same-origin theme CSS, PDF text as data, tests with payloads | frontend-developer | Low | open |
| R-APP-02 | CSV formula injection in exports | M | M | Medium | Neutralise cells starting with `= + - @` (FR-CSV-02), test | backend-developer | Low | open |
| R-APP-03 | Malicious upload (polyglot, SVG, oversized) as logo or photo | M | M | Medium | Magic-byte allowlist, no SVG, `sharp` re-encode, random keys, tenant-prefixed keys, 4 MB cap (NFR-SEC-06, ADR-0009) | backend-developer | Low | open |
| R-APP-04 | Fake bookings by distributed bots block vehicles (RK-1); distributed attack bypasses IP limits (REQ-7 excludes CAPTCHA) | H | M | High | IP + phone limits, honeypot; limits keyed on the trusted client IP only; admin quick-cancel; per-tenant CAPTCHA switch off by default (SEC-10 A) | backend-developer | Medium | needs acceptance if SEC-10 = B |
| R-APP-05 | Booking-code guessing / unauthenticated lookup (40-bit minimum is borderline, NFR-SEC-07) | L | M | Low | Any public view by code requires code + second factor (phone/email) or an unguessable URL token, rate limited, >= 50 bits for display codes | requirements-analyst / backend-developer | Low | open |
| R-APP-06 | Missing/weak headers, CSP `unsafe-inline` via theming and Radix inline styles (AR-8), no HSTS on prod | M | M | Medium | Headers set centrally; header test in CI and on staging (ZAP/securityheaders); `style-src-attr` decision documented; HSTS without preload initially (SEC-8 A) | security-engineer | Low | open |
| R-APP-07 | PII in logs, error tracker or Vercel logs (names, phones, tokens) | M | M | Medium | Logging policy, canary test in CI, Sentry scrubbing and EU region if enabled, log retention <= 30 days (NFR-GDPR-06) | observability-engineer | Low | open |

### 3.5 Supply chain and CI

| ID | Risk | P | I | Level | Controls | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-SUP-01 | Vulnerable or malicious dependency (npm install scripts, typosquat, native modules such as sharp/argon2) | M | H | High | Lockfile + frozen installs, pinned versions, `ignore-scripts` with reviewed allowlist, `pnpm/npm audit` + OSV-Scanner (block high/critical with fix), Dependabot/Renovate, license check, SBOM, review of every new dependency | devops-engineer | Medium | open |
| R-SUP-02 | CI compromise (third-party GitHub Actions, `pull_request_target`, over-broad secrets) | L | H | Medium | Actions pinned by SHA, `contents: read` default, environment-scoped secrets with reviewers, OIDC where possible, branch protection | devops-engineer | Low | open |
| R-SUP-03 | Library churn / ownership risk in option B (Better Auth fast-moving, Prisma 7 young) | M | M | Medium | Pin versions, read release notes, auth tests independent of the library, upgrade window | backend-developer | Medium | open (B only) |

### 3.6 Hosting, data protection and privacy

| ID | Risk | P | I | Level | Controls | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-HOST-01 | Vercel Hobby (non-commercial) used for paying tenants: terms breach, account suspension (AR-1) | H | M | High | Production only on Vercel Pro or on option C; Hobby only for synthetic-data previews; decision ARC-2/OPS-1/SEC-9 | PM / owner | Low | open (blocking condition for A, B) |
| R-HOST-02 | US-HQ processors (Vercel, Neon/Databricks, Supabase, Sentry, GitHub; Brevo and Scaleway are EU companies) and edge transit of request data (AR-5): transfer mechanism, DPF status may change | M | M | Medium | EU regions pinned (fra1, eu-central-1), DPAs with SCC, DPF check at go-live, short transfer assessment, published sub-processor list, 30-day change notice; option C removes the question | cybersecurity-manager | Medium | needs acceptance (A, B) |
| R-HOST-03 | Backup via GitHub Actions: the dump transits a US-hosted runner and the workflow needs prod DB credentials in GitHub secrets | M | M | Medium | Dedicated read-only dump role, encrypt with `age` public key on the runner before upload (private key never in GitHub), GitHub listed as sub-processor, or run the dump from an EU-controlled host; short retention of artefacts (none) | devops-engineer | Low | open |
| R-HOST-04 | Preview/staging uses production data or keys; previews publicly reachable | M | H | High | Separate Neon branch / bucket / keys, synthetic data only, deployment protection enabled, env scopes verified at go-live | devops-engineer | Low | open |
| R-HOST-05 | Unencrypted or unrestorable backups; backup failure unnoticed (no alerting, D14) | M | H | High | `age`-encrypted dumps, different provider and key, restore tested before go-live and quarterly, backup success/failure email heartbeat (CSM-1) | devops-engineer | Medium | open |
| R-HOST-06 | Neon cold start/limits, single provider outage (AR-4, AR-6) | M | L | Low | Neon Launch, hourly cron, 24 h RTO accepted by discovery D14 | devops-engineer | Low | accepted (D14) |
| R-HOST-07 (option C) | Unpatched VPS, SSH exposure, Docker published ports bypassing the host firewall, DB and KEK on the same host, one machine = one compromise = all data, no alerting (owner has no ops staff, C11) | H | H | High | Key-only SSH from allowlist/VPN, Caddy only on 80/443, DB on private network with no published port, unattended-upgrades, monthly patch checklist owned by the owner, off-host encrypted backups, host-level heartbeat | owner / devops-engineer | Medium | needs acceptance (C) |
| R-HOST-08 (option C) | Outbound SMTP ports 25/465 blocked on the VPS provider: per-tenant SMTP fails, password reset for admins fails silently | H | M | High | Verify and request unblock before purchase, or restrict tenants to 587; test email in tenant settings | devops-engineer | Low | open (C only) |
| R-HOST-09 (option B) | Supabase exposes tables through its Data API (PostgREST) with the public anon key; default roles bypass RLS; region not confirmed | M | H | High | Disable Data API / revoke `anon` and `authenticated` grants, use only Postgres + S3 (as the architecture states), confirm EU region at project creation, MFA on Supabase org | database-architect | Medium | open (B only) |
| R-PRIV-01 | GDPR roles and documents missing at go-live: DPA, privacy-notice template, ROPA (processor), sub-processor list, breach procedure (RAID R-3, RK-5) | H | H | High | Deliverables are a go-live prerequisite (REQ-12); Italian lawyer review (SEC-6) | cybersecurity-manager / owner | Low | open (blocking for Gate 4) |
| R-PRIV-02 | Data-subject requests cannot be served (access/portability FR-CUS-07 is Should; anonymisation leaves PII in email logs, PDFs, caches, backups) | M | M | Medium | Raise FR-CUS-07 to Must in practice; anonymisation test covers `EmailLog`, stored PDFs, audit values; backups age out <= 35 days, stated in DPA | requirements-analyst / backend-developer | Low | open |
| R-PRIV-03 | Tenant data kept after termination without rule (SEC-7) | M | L | Low | Written rule in contract: export, deletion after 90 days, backups aging out | owner | Low | open (SEC-7) |
| R-PRIV-04 | Scope creep to sensitive data: card numbers or ID/licence data in notes or new fields (SEC-5) | M | H | High | Premise that data stays ordinary; note-field warnings; any new field of that class triggers a new classification, DPIA and probably ASVS L3 for those fields | cybersecurity-manager | Low | open (SEC-5) |

### 3.7 Detection and response

| ID | Risk | P | I | Level | Controls | Owner | Residual | Status |
|---|---|---|---|---|---|---|---|---|
| R-IR-01 | A breach goes undetected because no alerting exists (discovery D14/G27) and the owner is one person: controllers cannot meet their 72 h clock | M | H | High | Minimal email-only security alerts to the owner (login-failure bursts, new systemadmin login, SMTP change, job failure, backup failure) with no on-call; weekly review of the security-event view; `docs/security/incident-response.md` with a 24 h target to notify controllers | cybersecurity-manager / observability-engineer | Medium | needs acceptance (CSM-1) |
| R-IR-02 | Single-person dependency: owner unavailable, lost recovery codes, lost KEK or hosting account | M | M | Medium | Break-glass runbook, offline custody of KEK and recovery codes, a named deputy for hosting account recovery (CSM-2) | owner | Medium | needs acceptance |
| R-IR-03 | Design stays unverified until code exists: ASVS L2 compliance cannot be claimed | H | M | High | Per-milestone sign-off with evidence; DAST on staging before Gate 4; independent test (CSM-3) | cybersecurity-manager | Low | open |

## 4. Risks requiring explicit acceptance by the user (summary, via the project manager)

| Risk | When the acceptance is needed | Option affected |
|---|---|---|
| R-AUTH-01 bespoke auth residual risk (Medium) | Gate 2 choice of A or C | A, C |
| R-AUTH-02 systemadmin without MFA | Only if SEC-1 = C | all |
| R-AUTH-03 no MFA for tenant admins at launch | Gate 2 (SEC-1 A/B) | all |
| R-SEC-02 single KEK in hosting env / host | Gate 2 | all |
| R-HOST-02 US-HQ processors, edge transit, DPF volatility | Gate 2 choice of A or B (with SEC-6 lawyer input) | A, B |
| R-HOST-07 owner-operated server | Gate 2 choice of C (with OPS-2) | C |
| R-APP-04 distributed fake bookings without CAPTCHA | Gate 2 (SEC-10 B) | all |
| R-IR-01 detection without on-call (email-only alerts) | Before Gate 3 (CSM-1) | all |
| R-IR-02 single-person dependency | Before Gate 3 (CSM-2) | all |
| Any RLS fallback to scoping-only (if spike S1 fails) | During M1 | A, B, C |

Acceptance is not recorded yet. When the user accepts, the PM updates `Status` to `accepted` with date and wording of the decision.

## 5. Review

Next review: start of Gate 3 (plan), then at the end of every milestone and at Gate 4. New risks from the Phase 4 threat model (`docs/08-security.md`) are added here by the cybersecurity-manager.
