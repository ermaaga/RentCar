# Security sign-off log: RentCar

Owner: cybersecurity-manager. Each entry records date, scope, evidence examined and outcome (APPROVED · APPROVED WITH RISKS · BLOCKED). Only the user can accept residual risk; acceptances are recorded in `docs/security/registro-rischi.md` by the PM.

---

## GATE 2 (architecture) · 2026-11-01

**Scope**: the three options in `docs/03-architettura.md` v1.0 (A portable core on serverless, B managed-platform bundle, C container-first EU VPS) and ADR-0001..0014 (status proposed).
**Evidence examined** (documents only; no code or running system exists): `docs/03-architettura.md`, `docs/adr/0001..0014`, `docs/03-inputs/security-constraints.md`, `docs/03-inputs/devops-costs.md`, `docs/03-inputs/observability-options.md`, `docs/02-requisiti.md` (NFR-SEC, NFR-GDPR, NFR-ISO, FR-AUTH, FR-SYS, FR-CUS), `docs/01-discovery.md`, `docs/pm/raid.md`.
**Not verified** (does not block Gate 2): provider terms, DPA/DPF status, Neon and Supabase role behaviour with RLS, regions. These are design-phase claims taken from the architecture and security inputs; each becomes a verification condition below, checked at M1 (spike S1) or Gate 4. I did not re-fetch provider pages in this phase.

### 1. Classification and level (decision of the cybersecurity-manager)
- Ordinary personal data, multi-tenant, anonymous public write, stored SMTP credentials, privileged systemadmin. Detail in `registro-rischi.md` section 1.
- **Required level: OWASP ASVS 4.0.3 Level 2 for the whole application.** L3 not justified. Closes SEC-4.
- Consequences for the requirements (change requests for the PM/requirements-analyst; they do not depend on the option chosen):
  1. Password minimum length 12, not 10 (ASVS V2.1.1). Closes SEC-2. FR-AUTH-07 to be amended.
  2. FR-CUS-07 (customer data export) effectively Must for the processor role.
  3. Any public lookup by booking code needs a second factor or an unguessable token (NFR-SEC-07 is borderline).
- Premise: no card data, no ID/licence data (SEC-5 answer A). If SEC-5 = B this sign-off is void and the classification is redone (DPIA, field encryption, possibly L3 for those fields).

### 2. Outcome per option

| Option | Outcome | Summary |
|---|---|---|
| A: Drizzle, in-house sessions, scoping + RLS, Vercel Pro + Neon + Scaleway | **APPROVED WITH RISKS** | Meets the ASVS L2 design. Residual: bespoke auth, US-HQ processors, KEK in hosting env. |
| B: Prisma + Better Auth + Supabase on Vercel Pro | **APPROVED WITH RISKS** | Meets the L2 design; best MFA path; but Supabase exposure model, username-scoping workaround and library churn add risks. Least attractive on security grounds. |
| C: same code as A on one EU VPS | **APPROVED WITH RISKS**, conditional on the owner's written commitment to operate it | Best residency story; weakest operational security for a non-ops owner. Becomes **BLOCKED** if the owner does not commit to the duties in section 3 (C only). |

No option is blocked at design level. A and C are acceptable; A is easier for a non-ops owner, C is simpler for GDPR. B is acceptable but the least attractive (same US-HQ app host as A, extra vendor, more moving parts in the data layer). The security view agrees with the architect's recommendation of A provided the conditions hold, and with C if the owner wants no US-HQ processor and accepts the operational duties.

**Production on Vercel Hobby is BLOCKED** for all options (terms prohibit commercial use; suspension risk; daily-only cron). Related questions: ARC-2, OPS-1, SEC-9.

### 3. Conditions per option

**Common to all options** (verified at the stated point):
1. Phase 1 (local Docker) uses synthetic data only; real customer data enters a non-local environment only after Gate 4 sign-off. Previews and staging never hold production data or keys. (M0, Gate 4)
2. RLS validated by spike S1 on the real pooler and DB role before M2 closes: runtime role non-owner and without BYPASSRLS, `FORCE RLS`, `SET LOCAL` only. If S1 fails, the fallback (scoping only) is a risk the user must accept (ARC-3). (M1/M2)
3. MFA, named accounts and least privilege on GitHub, hosting, DB, storage, DNS and email providers. (M0, Gate 4)
4. DPA, privacy-notice template, ROPA entry, sub-processor list and breach procedure exist before the first real tenant; Italian legal review (SEC-6). (Gate 4)
5. KEK handling per R-SEC-02: not in the DB provider, not in backups, offline custody copy (CSM-2). (M1)
6. Security-event view and minimal email alerts (CSM-1). (before Gate 4)
7. ASVS L2 checklist traced in `docs/08-security.md`; per-milestone security review; critical and high findings closed and re-tested.

**A and B (Vercel)**:
- Vercel Pro or higher, function region pinned to `fra1`, deployment protection on previews, env scopes per environment. DPA with SCC signed, DPF status checked at go-live, short transfer assessment. (Gate 4)
- Neon (A): production on Launch plan with at least 7 days of history; runtime role created by SQL, not the console default role (verify BYPASSRLS behaviour in S1).
- Backups per R-HOST-03: read-only dump role, `age` public-key encryption on the runner, private key outside GitHub, separate provider, restore tested before go-live. GitHub is listed as sub-processor unless the dump runs from an EU host.
- A only: independent review of auth and RLS before go-live (CSM-3) because the auth is bespoke.

**B only**:
- Disable the Supabase Data API or revoke `anon` and `authenticated` grants; use only Postgres and S3, as the architecture states; confirm the EU region and sign the DPA at project creation; MFA on the Supabase organisation.
- Better Auth: per-tenant username mapping without weakening uniqueness; the library tables (`user/session/account/verification`) under RLS or an equivalent control and covered by the cross-tenant matrix; versions pinned; lockout, forced-change and session-revocation hooks covered by abuse-case tests.

**C only**:
- Written commitment by the owner (monthly patch routine, backup check, incident duties; see OPS-2). Without it: BLOCKED.
- Hardening verified before go-live: key-only SSH (allowlist or VPN); firewall that Docker cannot bypass (no published ports except Caddy 80/443; DB on a private network); unattended-upgrades; Caddy HSTS and headers; non-root containers; DB and KEK not in the same backup set; off-host encrypted backups with a tested restore; backup and host heartbeat email (R-HOST-05, R-HOST-07).
- Outbound SMTP ports confirmed with the provider before purchase (R-HOST-08, OPS-8).
- Serverless proof (NFR-SRV-01) by periodic Vercel preview with synthetic data only.

### 4. Mandatory controls to be active before M0 closes
At M0 close I will ask for the configuration file and a failing-then-passing CI run (or the tool output) for each row.

| Control | Minimum for M0 | Blocks the pipeline if |
|---|---|---|
| Repository and branch protection | Git repository with a remote (the working directory is not a git repository today); PR required, review, CI green, no force push; MFA for all members | setting verified by API output or screenshot |
| Secret scanning | gitleaks pre-commit + CI full-history scan; GitHub push protection | any secret found |
| SCA | `pnpm/npm audit --audit-level=high` + OSV-Scanner on every PR and weekly; Dependabot/Renovate grouped updates; frozen-lockfile installs; license check | high or critical with fix available |
| SAST | Semgrep (OWASP, TypeScript, Next.js rules) or CodeQL on every PR, plus custom rules: raw SQL without parameters, repository access without `TenantScope`, route handler without the guard wrapper, `dangerouslySetInnerHTML`, `fetch` of user URLs | unhandled high findings |
| Container and IaC | Trivy on image, filesystem and compose/IaC config; minimal base image pinned by digest, non-root, no secrets in layers | critical |
| Abuse-case harness | Cross-tenant matrix generator, auth-negative helpers (401/403/404/400/mass assignment/429), "runtime role without GUC returns zero rows" test; may have few entities in M0 but runs in CI | any failure |
| Header/TLS test | Automated header test (CSP, HSTS when not local, nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy) against the compose app | missing mandatory header |
| SBOM | CycloneDX or Syft for the release build, archived | n/a |
| CI hardening | Actions pinned by SHA, `contents: read` default, no `pull_request_target` on untrusted code, environment-scoped secrets | n/a |
| Config and secrets | Zod-validated config, `.env.example` only, dev placeholder keys rejected in production mode, seed password refused in production | startup fails |
| DB roles | Separate migration and runtime roles from the first migration; DB port bound to 127.0.0.1 in compose | n/a |
| Log hygiene | Log-scrub canary test scaffold | canary leaks |

Active before Gate 4 (not M0): DAST (ZAP baseline/API scan) on staging with no high findings; TLS and header scan on staging and production; backup restore test; `incident-response.md` and contacts; DPA package; accepted residual risks.

### 5. Security-relevant open questions and recommendations

| Question | Security recommendation | Notes |
|---|---|---|
| SEC-1 MFA | **Systemadmin MFA (TOTP) before the first real tenant, not "after launch".** Tenant-admin MFA in a later phase (accept R-AUTH-03). Option C of SEC-1 (none) is not acceptable to me without explicit user acceptance. | Spec excludes OTP: scope change (TOTP + recovery codes, a few days). Under B it is nearly free. |
| SEC-2 password length | Decided: 12 (ASVS L2). | No user decision needed. |
| SEC-3 set-password link | **A: one-time link, 24 h, token hashed, no password by email.** | Deviates from FR-AUTH-03/11 and the spec text; `CredentialIssuer` already allows it. |
| SEC-4 ASVS level | Decided: L2 for the whole app. | Informational. |
| SEC-5 exclusion of card/ID data | **A: exclude definitively**; note fields carry a warning. | Blocking for the classification: B voids this sign-off. |
| SEC-6 legal review | **A: Italian lawyer reviews DPA, notice and transfers once before the first real tenant.** | Blocking for Gate 4, not Gate 2. |
| SEC-7 tenant data after termination | **A: export, then hard delete after 90 days; backups age out within 35 days; stated in the DPA.** | Must be in the contract text. |
| SEC-8 HSTS preload | A: no preload at start. | Low impact. |
| SEC-9 / ARC-2 / OPS-1 Vercel plan | If Vercel: a paid plan is a condition; Hobby is blocked for production. Security does not force C. | Compliance simplicity favours C. |
| SEC-10 CAPTCHA switch | A: per-tenant switch, off by default. | Otherwise R-APP-04 needs acceptance. |
| SEC-11 SMTP change controls | **A: re-enter password and notify owner and tenant admin through the system SMTP.** Treated as a required control. | Declining requires acceptance of the R-AUTH-06 / R-SEC-01 residuals. |
| ARC-3 RLS | **A: yes, from the first migration.** Required for ASVS L2 defence in depth. | Fallback only with acceptance. |
| ARC-4 4 MB uploads | No security objection. | |
| ARC-5 / ARC-6 / OPS-4 storage, DB provider | Prefer EU-headquartered providers where cost is similar (Scaleway); US-HQ with EU region acceptable with DPA and SCC. | Residual R-HOST-02. |

### 6. Findings to forward (no code yet, so not blocking Gate 2)
1. FR-AUTH-07 (10 characters) conflicts with the required level: change to 12.
2. FR-CUS-07 export should be Must.
3. Backup workflow through GitHub Actions: sub-processor and credential-scope implication (R-HOST-03).
4. Backup, job and host failures are silent under D14: minimal email heartbeat needed (CSM-1).
5. Neon and Supabase default roles can bypass RLS (verify in S1; R-ISO-02).
6. Audit table must be append-only at database grant level, not by convention.
7. Public booking-code lookup, if any, needs a second factor or token (R-APP-05).
8. The working directory is not a git repository; branch protection and secret scanning in M0 need one.

### 7. Risks that need explicit user acceptance
Full list in `registro-rischi.md` section 4. By chosen option: A: R-AUTH-01, R-HOST-02, R-SEC-02; B: R-HOST-02, R-SEC-02, R-SUP-03; C: R-AUTH-01, R-HOST-07, R-SEC-02. For all: R-AUTH-03, R-IR-01, R-IR-02 and, depending on the answers, R-AUTH-02 (SEC-1) and R-APP-04 (SEC-10).

### 8. Outcome
**GATE 2: APPROVED WITH RISKS** for options A, B and C as described above. The user can choose any of them; the PM presents the acceptance list in section 7 together with the choice. Production on Vercel Hobby, and any real customer data before Gate 4, remain BLOCKED.

---

## GATE 3 (implementation plan) · 2026-11-03

**Scope**: `docs/13-piano-implementazione.md` v1.0 (milestones M0 to M6, user answers of 2026-11-03: all recommended options, FE-1 = 200 + noindex), against `docs/08-security.md` v1.1, `docs/06-backend-api.md`, `docs/05-database.md`, `docs/11-devops-deploy.md`, `docs/10-test-plan.md`, `docs/03b-struttura-codice.md`, `docs/02-requisiti.md` v1.4 and `docs/security/registro-rischi.md`.
**Evidence examined**: the documents above (design and plan only; still no code and no running pipeline). The control mapping below is therefore "planned and traceable", not "active". Activation is verified at M0 close with real run output.
**Web check done**: GitHub branch protection and rulesets on private repositories (finding 1 below). Source: GitHub documentation on rulesets and community threads (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/converting-branch-protections-to-rulesets, https://github.com/orgs/community/discussions/209198). I did not test it on the user's repository.

### 1. Findings that need a decision or a task

| # | Finding | Severity | Handling |
|---|---|---|---|
| F1 | **Branch protection cannot be enforced on a private repository on GitHub Free** (OPS-14 was answered "private repo, GitHub Free"; rulesets and `main.json` would be created but not enforced). The mandatory control "branch protection" and the CI gates (`ci-gate`, `security-gate`) would then be advisory: any direct push to `main` skips them. Push protection and code scanning for private repositories are also paid features (the plan already covers CodeQL; gitleaks in CI replaces push protection). | High for M0 close | **Condition of M0 close**; user decision CSM-4 |
| F2 | Abuse-case count: `08-security.md` has **35** M1 cases (ABU-M1-35 pepper added) and 112 in total; plan and test plan say 34 and 111. The meta-test `abuse-coverage` is specified for 111 ids and would fail or hide a case. | Medium | M0 task T3 |
| F3 | `PASSWORD_PEPPER` (+ `_PREVIOUS`) is missing from the `03b` config list and from the `11-devops` secrets inventory (SR-AUT-15, 06-backend §4.2.7 define it). A secret missing from the inventory is missed by rotation, custody (CSM-2), boot guard, `.env.example` and gitleaks allowlist. | Medium | M0 task T1 |
| F4 | `02-requisiti.md` v1.4 does not yet contain several change requests of `08-security.md` §11.1: CR-1 (CSV trigger set `= + - @ TAB CR`), CR-2 (no free text in audit values), CR-3 (booking snapshots anonymised), CR-4 (active sessions list), CR-5 (admin reset via the system SMTP: FR-AUTH-05 still says tenant SMTP; US-002 too), CR-6 (staff anonymisation), CR-8, CR-10, CR-11. Test traceability is built from the requirements, so tests could be written to the weaker text. | Medium | M0 task T4 and a precedence rule (below) |
| F5 | `FR-ENF-01` (read-only allowed actions) lacks customer anonymisation and resend-confirmation (BE-1 = A). | Low | M0 task T2 |
| F6 | The incident-response plan relies on capabilities not in the plan: a global maintenance/read-only switch (devops 10.3 only assumes it), a revoke-all-sessions command, the PII-free query pack (SR-GDPR-10 is Should), `security.txt`. | Medium | M1/M6 tasks T6 to T9 |
| F7 | `deploy-staging.yml` runs on push to `main` and `jobs-cron.yml` runs hourly with `CRON_SECRET`: with no host they must not run or fail noisily; only some workflows are listed as "committed disabled". | Low | M0 task T5 |
| F8 | ABU-M6-04 mixes a staging baseline (host-dependent) with an authenticated active scan on an ephemeral `APP_ENV=ci` stack, which is **not** host-dependent and can run in M6. M6 "restore test locally" proves the dump role and ledger replay; it does not prove the provider. | Low | Clarify in the M6 test report (below) |

**Precedence rule** (binding until the requirements are updated): where `02-requisiti.md` and `08-security.md` (SR-* and decisions) differ on a security matter, the stricter text applies and tests are written to `08-security.md`. The requirements-analyst aligns `02-requisiti.md` (T4).

### 2. Checks requested

**2.1 Every mandatory M0 control is in the plan's M0** (against sign-off GATE 2 section 4; sources: plan section 3 row M0, devops section 4.3 and section 12 commits 1 to 10, test plan section 5, security ABU-M0-01..16)

| Control | Where planned | Verdict |
|---|---|---|
| Repository and branch protection, MFA | devops commit 9 (ruleset, CODEOWNERS, API output as evidence); plan section 7 (MFA on GitHub account, permission to configure) | Planned; **enforceability gap F1** |
| Secret scanning | gitleaks in Husky pre-commit (commit 2) and CI full history (commit 7); `.gitleaks.toml` limited to `INSECURE_DEV_`; ABU-M0-10 | OK (pre-commit is bypassable, CI is the control) |
| SCA | `pnpm audit --audit-level=high --prod`, OSV-Scanner, license check, Dependabot (commits 7, 9); ABU-M0-16 | OK |
| SAST | Semgrep with custom tenant-scope/route-guard/`fetch`/`Math.random` rules, each with a fixture test (commit 7); ABU-M0-06/13/14; CodeQL optional (OPS-11) | OK |
| Container and IaC | Trivy image/fs/config, zizmor, actionlint (commit 7) | OK |
| Abuse-case harness | Commit 8; route registry, fixtures, matrix generators, `guards-selftest`; ABU-M0-01..16 | OK (count F2) |
| Header/TLS test | Header test against the compose app (commit 8; ABU-M0-11/12); TLS on a real host is deferred to Gate 4 | OK for M0 |
| SBOM | Source SBOM on every main build, image SBOM at release (commit 7) | OK |
| CI hardening | SHA pinning, `contents: read`, no `pull_request_target`, environment-scoped secrets, zizmor | OK |
| Config and secrets | Zod config, `.env.example` schema test (commit 1), ABU-M0-09 production guards, seed refused in production | OK, pepper missing (F3) |
| DB roles | database-architect in M0; ABU-M0-01/02/03/07/08; compose DB bound to `127.0.0.1` | OK |
| Log hygiene | observability-engineer in M0; ABU-M0-15 canary | OK |
| Failing-then-passing evidence per control | Required in the PR (commit 7) and by the M0 Definition of Done | OK, I will ask for it |

**2.2 Each milestone has its abuse-case set and a security review**: yes. M0 16, M1 34 (35 in the security document), M2 22, M3 13, M4 7, M5 7, M6 12 are named in the plan and in the test plan section 5, with levels and suites (test plan 7.2), and the Definition of Done (plan section 4) requires the security-engineer review closed and my sign-off for every milestone; evidence file `docs/reviews/security-<milestone>.md` (test plan 10.3). OK, subject to F2.

**2.3 Hosting-dependent checks correctly deferred to GATE 4**: yes, with the following clarified.
- Deferred and to be reported as NOT VERIFIED at M6: ABU-M6-04 (staging baseline part), 05 (TLS and header scan on a real host), 06 (restore on the provider), 07 (preview environment isolation), 10 (serverless smoke); spike S1 on the real pooler and real provider role (ABU-M0-05 full volume), S2 to S4 on the target (PDF, argon2 memory, SMTP ports), S6.
- Not deferred: the authenticated active ZAP scan on the ephemeral CI stack, the local restore with ledger replay, the local S1 through PgBouncer, the cross-tenant matrix, all `I`, `D`, `C`, `E` cases.
- These items are **Gate 4 entry criteria**. A Must that is NOT VERIFIED at Gate 4 blocks the Gate (handoff protocol rule 8).

**2.4 No real personal data outside local Docker before GATE 4**: the rule is written (devops section 1 rules, SR-CFG-04, test data synthetic, seed refused outside local, deploy/backup/restore workflows committed disabled). I confirm the rule as a binding condition (section 3, C1). Real devices, UAT and any pilot use synthetic or demo data.

### 3. Conditions

**Before or at M0 close**
- C1 Real customer or staff data exists only in local Docker, CI fixtures and demo seeds until GATE 4.
- C2 Branch protection is **enforced**, shown by evidence: API output of the ruleset **and** a negative test (a direct push to `main` is rejected; a PR with a red `ci-gate` cannot merge). Either the repository plan is changed (decision CSM-4) or the user explicitly accepts "protection by convention" (new risk R-PLAN-01).
- C3 Every control of section 2.1 shown failing then passing, with CI run links.
- C4 Spike S-FE-3 (CSP against Radix inline styles) and S1 local pass; any CSP exception is documented and approved by me.
- C5 Tasks T1 to T5 below done.

**Before M3 starts (recommended, user decision CSM-5)**: run spike S1 (RLS with `SET LOCAL` through a real transaction pooler and a role created by SQL) and S3/S4 on a free external Postgres in an EU region with synthetic data. Without it the first real check of the RLS/pooler design happens at Gate 4, after six milestones.

**Per milestone**: ABU set green; cross-tenant matrix green; Semgrep/SCA/Trivy/gitleaks green; security review report with critical/high closed and re-tested; my sign-off from evidence (CI links, review report, test report).

**Before GATE 4** (consolidated entry criteria): hosting chosen; all items in 2.3 verified; DAST (baseline on staging, active on ephemeral stack) with no high findings; TLS/header scan; restore drill on the provider; DPA package with sub-processor list and lawyer review (SEC-6); incident-response contacts, deputy, tabletop exercise and rotation drill; decisions on MFA (R-AUTH-02/03), SMTP-change controls (R-AUTH-06), CAPTCHA switch (R-APP-04), alerts (CSM-1), key custody (CSM-2), external review (CSM-3); no critical/high open; registry updated.

### 4. Tasks to add to M0 or the stated milestone (not blockers on their own)

| ID | Task | Owner | When |
|---|---|---|---|
| T1 | Add `PASSWORD_PEPPER` and `PASSWORD_PEPPER_PREVIOUS` to the config list in `03b-struttura-codice.md` and to the devops secrets inventory (custody with the KEK offline copy, per-environment, distinct from every other secret, rotation runbook `rotate-pepper.md`, boot guard, `.env.example` placeholder `INSECURE_DEV_`, gitleaks allowlist entry, "no pepper in the DB provider or backup set") | solution-architect, devops-engineer | M0 |
| T2 | Update FR-ENF-01 in `02-requisiti.md`: read-only also allows customer anonymisation and resend of the confirmation (BE-1); add the positive test to `read-only.test.ts` (ABU-M3-04 family) | requirements-analyst, qa-engineer | M0 |
| T3 | Align counts to 35 and 112 (plan, test plan sections 5 and 7, `08-security` Esito) and the meta-test | PM, qa-engineer | M0 |
| T4 | Apply the missing change requests CR-1..CR-11 of `08-security.md` §11.1 to `02-requisiti.md`, including FR-AUTH-05/US-002 (admin reset via the system SMTP) | requirements-analyst | before M1 starts |
| T5 | Workflows without a host (`deploy-staging.yml`, `jobs-cron.yml`, `nightly-backup.yml`, `restore-test.yml`, DAST on staging) are guarded by a repository variable and a dry-run mode, never failing the required checks | devops-engineer | M0 |
| T6 | Global maintenance/read-only switch honoured by all routes, with test | backend-developer | M1 |
| T7 | Revoke-all-sessions command (all realms) and per-tenant revoke, audited | backend-developer | M1 |
| T8 | PII-free query pack for breach scoping (SR-GDPR-10) raised to Must | observability-engineer, backend-developer | M6 |
| T9 | `security.txt` and a monitored security contact in the go-live pack | devops-engineer, technical-writer | M6 |
| T10 | Rotation runbooks for KEK, pepper, session secret, cron secret, DB, SMTP, S3 and age key, with one rotation rehearsal (KEK and pepper) | devops-engineer, technical-writer | M0 write, M6 rehearse |

### 5. Residual and new risks

New in this gate (full rows in `registro-rischi.md` section 3.8): R-PLAN-01 branch protection not enforced; R-PLAN-02 late verification of host-dependent properties; R-PLAN-03 documentation drift between requirements and security requirements; R-PLAN-04 pepper custody; R-PLAN-05 incident capabilities missing in the product.
Still open from earlier gates and **not yet explicitly accepted in the acceptance log**: R-AUTH-01 (bespoke auth, with CSM-3 external review) and R-SEC-02 (KEK in the host environment). I do not need a new answer now; they go into the GATE 4 re-decision pack together with R-AUTH-02/03, R-AUTH-06, R-APP-04, R-IR-01 and R-IR-02.
**Requiring explicit user acceptance now (new)**: R-PLAN-01 (only if CSM-4 is answered B) and R-PLAN-02 (only if CSM-5 is answered B). Nothing else is new.

### 6. Outcome
**GATE 3: APPROVED WITH RISKS.** The plan is sufficient for security at the planning level: all mandatory M0 controls, per-milestone abuse-case sets and security reviews are present, hosting-dependent checks are correctly deferred as Gate 4 entry criteria, and no real personal data leaves local Docker. M0 cannot be closed unless condition C2 is met. The incident-response plan is in `docs/security/incident-response.md` (operational from GATE 4). The PM may present the plan to the user.
