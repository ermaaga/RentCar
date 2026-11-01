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
