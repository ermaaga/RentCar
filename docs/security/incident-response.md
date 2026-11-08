# Incident response plan: RentCar

Version 1.0 · 2026-11-03 · Owner: cybersecurity-manager · Status: **drafted at GATE 3; operational only from GATE 4** (no production, no real personal data exists before that)
Applies to: the platform owner acting alone (no on-call, no dedicated ops staff, discovery C11, D14, G27).
Coordination: observability-engineer (`docs/12-osservabilita.md`, events and queries), devops-engineer (`docs/11-devops-deploy.md` secrets, backup, restore, rollback), security-engineer (`docs/08-security.md` SR-LOG-03, SR-GDPR-08, SR-GDPR-10).
Legal note: the notification wording and deadlines below follow GDPR Art. 33 and 34 as understood by the team. The Italian lawyer review (SEC-6, before GATE 4) must confirm this document, the DPA clauses and the templates. This is not legal advice.

---

## 1. Purpose and principles

1. Detect, contain, assess, notify and recover, in that order, with one person and no round-the-clock cover.
2. **Honest limits**: with no on-call, a night or weekend incident is handled when the owner becomes aware of it. The plan therefore sets targets measured from **awareness**, and relies on a minimal detection routine (section 4) so awareness is not left to chance.
3. Contain first, investigate second, clean up third. Rotate a leaked secret before removing it from history.
4. Never put personal data, secrets or tokens in tickets, chat, commit messages or the incident log. Use ids (tenant id, user id, request id).
5. Every decision is written in the incident log (section 9) with time and reason.

## 2. Roles and the GDPR chain

| Party | Role | Duties |
|---|---|---|
| Platform owner (the user) | Incident commander and sole responder. **Processor** for customer personal data; **controller** for staff account and security data (NFR-GDPR-01) | Run this plan; notify controllers; notify the Garante himself for incidents on his own controller data |
| Tenant (rental business) | **Controller** for its customers' data and for its staff's activity | Decides whether to notify the Garante (within 72 h of **its** awareness) and the data subjects (Art. 34); owner supports with facts |
| Deputy (named person) | Backup for account recovery and notification if the owner is unreachable | **To be named** (CSM-2, before GATE 4). Until then the owner is a single point of failure (R-IR-02) |
| Hosting, DB, storage, email providers | Sub-processors | Notify the owner of their own incidents; owner follows their instructions and notifies controllers |
| Dev-team agents | Assist with analysis, queries, patches and drafts | Do not decide on notification, do not send communications, do not hold production secrets |
| Italian lawyer | Advises on borderline cases | Contact fixed at SEC-6 |
| Garante per la protezione dei dati personali | Supervisory authority | Notified through its online data-breach procedure (check the current form and URL on garanteprivacy.it at the time; do not rely on a stored link) |

### Legal clock (summary)
- Controller (tenant): notify the Garante **without undue delay and, where feasible, within 72 hours of becoming aware**, unless the breach is unlikely to result in a risk to people (Art. 33(1)). Communicate to data subjects without undue delay if the risk is high (Art. 34).
- Processor (owner): notify the controller **without undue delay** after becoming aware (Art. 33(2)). The DPA will state a contractual target. **Internal target: 24 hours from awareness** (SR-GDPR-10) so that the tenant keeps most of its 72 hours.
- Awareness starts when the owner has reasonable certainty that a personal-data breach occurred, not when the investigation ends. If in doubt, notify early with "suspected" and update.
- Late or partial information is allowed in phases (Art. 33(4)); document the reasons for any delay.

## 3. What counts as an incident

Severity is decided at triage and can be raised or lowered later (log the reason).

| Level | Meaning | Examples | Targets (from awareness) |
|---|---|---|---|
| **SEV1** | Confirmed or probable personal-data breach, loss of control of a crown jewel, or cross-tenant exposure | Cross-tenant read; database or backup exposed; systemadmin account takeover; encryption key or SMTP secrets leaked; hosting account compromised | Contain within 4 h of awareness when the owner is reachable; notify affected tenants within 24 h; daily updates |
| **SEV2** | Likely security weakness being exploited, or exposure limited to one tenant without proof of data access | Tenant admin account takeover; mass fake-booking burst; abused tenant SMTP; leaked non-production secret | Contain within 24 h; tenant informed within 48 h if its data or accounts were touched |
| **SEV3** | Vulnerability found, no evidence of exploitation | Critical dependency CVE; failing security scan on `main`; researcher report | Triage within 3 working days; fix per severity (critical/high block the next release) |

A **personal-data breach** is any breach of security leading to accidental or unlawful destruction, loss, alteration, unauthorised disclosure of or access to personal data (Art. 4(12)). Availability-only events (outage) are not breaches unless data is lost or unavailable in a way that harms people; data loss without a usable backup is one.

## 4. Detection (no alerting, so a routine)

The product emits security events into the append-only `security_event` table (taxonomy in SR-LOG-03) and structured logs; `job_run` and `EmailLog` give further evidence. Until the minimal email alerts are decided (CSM-1, before GATE 4) detection is manual.

| Source | What to look for | How often |
|---|---|---|
| `security_event` (systemadmin console or query pack) | Bursts of `auth.login.failure` / `auth.login.throttled`; any `auth.login.success` for the systemadmin you do not recognise; `crypto.decrypt_failed`; `ssrf.blocked`; `job.auth_failed`; `tenant.mismatch`; `access.denied` spikes; `export.created` you did not expect; `system.context.used` outside known flows; `config.invalid` | Weekly 15-minute review (checklist in the incident log folder) once real tenants exist; after every release |
| `job_run`, `EmailLog` | Failed or missing runs; bounce or failure spikes (possible SMTP abuse) | Weekly |
| Backup heartbeat and restore drill (devops) | Missing success signal for more than 26 h | Daily by email once the heartbeat exists; weekly manual check in month 1 |
| Repository and CI | gitleaks finding, Dependabot or OSV critical/high, failing `security-gate` on `main` | Immediately when GitHub emails arrive |
| Hosting, DB and email providers | Provider security notices, abnormal billing, new devices or tokens | When emails arrive; monthly account review |
| Tenants and customers | Reports of strange emails, unknown bookings, data seen by the wrong person | Support mailbox; every report is logged and triaged |
| External reporters | `security.txt` contact (to be published at go-live, task in M6) | When received |

If CSM-1 is accepted, the alert emails go to the owner only and never contain personal data.

## 5. Triage (first 60 minutes after awareness)

1. Write down time of awareness (T0), who reported, and what was observed.
2. Decide: security incident or fault? Is personal data involved or possibly involved? Which tenant(s)? Which data classes (customer name/phone/email, staff accounts, SMTP credentials, business data)?
3. Set the severity (section 3). Open the incident log entry.
4. Preserve evidence before changing anything that overwrites it: export the relevant `security_event`, `audit_log`, `platform_audit`, `job_run` rows and host log windows to a private location (not the repository).
5. Choose the containment playbook (section 6).
6. Ask the dev-team agents for a scoped query using the query pack ("which tenants, users and sessions were affected between T1 and T2", SR-GDPR-10). The query pack must work without reading PII.

## 6. Containment and eradication playbooks

Each playbook ends with: verify that the attack path is closed, record in the log, decide notifications (section 7).

| Scenario | Contain | Eradicate and verify |
|---|---|---|
| **Secret in repo, CI log, artefact or client bundle** | Revoke and rotate first (runbook `rotate-<secret>`); check provider access logs for use | Remove from history only after rotation; re-run gitleaks full history; add a test or rule if it was a pattern gap |
| **Encryption key (`APP_ENCRYPTION_KEY`) or SMTP secrets exposed** | Rotate the key (new key id, re-wrap job), rotate system SMTP; ask affected tenants to re-enter their SMTP password; consider tenant mailboxes compromised; suspend outbound mail for affected tenants | Confirm old key id no longer decrypts; review `crypto.decrypt_failed`; treat as SEV1 if SMTP credentials were readable |
| **`PASSWORD_PEPPER` exposed** (hash-only attack is then easier) | Rotate with the `_PREVIOUS` mechanism; run the bulk reissue command (revokes sessions, sends one set-password link per user); check for credential stuffing | Verify no user stays on the old pepper version after the window |
| **Systemadmin account compromise** (no MFA at launch, R-AUTH-02) | Revoke all sessions, reset the systemadmin password through the break-glass procedure, rotate `SESSION_SECRET`; list `platform_audit` entries since the suspected time | Review every tenant/subscription/SMTP/admin change made in the window; re-issue admin access for tenants where the admin was replaced; reconsider MFA decision |
| **Tenant admin or operator account takeover** | Suspend the tenant (immediate session invalidation, FR-SYS-12) or deactivate the user; reset via the system SMTP | Review the tenant's `audit_log` and `export.created`; check whether the SMTP settings were changed (R-AUTH-06); inform the tenant |
| **Cross-tenant exposure (isolation defect)** | Put the app in maintenance or stop it (global switch, section 10); preserve logs | Identify affected pairs by logs and the query pack; patch; add the case to the cross-tenant matrix; SEV1, notify all affected controllers |
| **Database, backup or storage exposed; hosting/DB account compromised** | Rotate DB credentials, tokens and bucket keys; lock the provider account; contact provider security | Check backups for tampering; restore from a clean backup if needed and replay the deletion ledger (SR-GDPR-08) |
| **Tenant SMTP abused (phishing from a tenant's identity)** | Suspend outbound mail for the tenant; ask the tenant to rotate its SMTP password | Review SMTP change history; apply SEC-11 controls if the accepted risk is revisited |
| **Fake-booking flood** | Admin bulk cancel; tighten limits per environment variable; block patterns if identifiable | Review `ratelimit.exceeded` events; revisit the CAPTCHA switch decision (R-APP-04) |
| **Vulnerable or malicious dependency** | Pin or remove the dependency; hotfix release through the normal pipeline (SCA gate) | SBOM check of what shipped; rotate secrets if the package could read the environment |
| **Data loss or ransomware** | Stop writes; do not overwrite evidence | Restore per `docs/runbooks/restore.md`, replay the deletion ledger; record achieved RPO/RTO; breach assessment if data was lost or leaked |
| **Lost or stolen owner device, password manager breach** | Revoke GitHub, hosting, DB, storage, DNS and email sessions and tokens from another device; rotate everything stored on the device | Review provider logs for the period; use the deputy for recovery if locked out |

## 7. Notification decision and templates

### 7.1 Decision flow
1. Is **personal data of customers or staff** affected, or reasonably possibly affected? If no: no GDPR notification; still record, and inform tenants if their service or credentials were affected.
2. If yes: you are a processor for customer data. **Notify each affected tenant within 24 hours of awareness** (even if details are missing), using the template. For staff account data where you are controller, assess risk yourself and decide on notifying the Garante within 72 hours (Art. 33) and the persons (Art. 34).
3. Tenants decide on their own Garante notification and on informing their customers. Offer help: facts, timeline, affected counts, the export of affected records.
4. If the owner cannot assess within 72 hours: notify the Garante in phases or ask the lawyer. Document why.
5. Inform providers (sub-processors) only as needed to contain; follow their notification rules.

### 7.2 Tenant notification template (to the tenant's admin and the contact in the DPA)
Send from the owner's own mailbox, not from the platform SMTP, and not from a tenant SMTP. Translate to Italian when the lawyer has reviewed the pack (SEC-6).

```
Subject: Security incident notice - RentCar - [incident id]

Hello [name],

On [date, time, time zone] we became aware of a security incident that [affects / may affect]
personal data you process through RentCar as controller.

What happened: [short factual description, no speculation]
When: [start/end or "still being determined"]
Data involved: [categories: customer name, phone, email, booking data, staff accounts]
Approximate number of records / people for your account: [number or "being determined"]
Likely consequences: [for example risk of unsolicited contact, phishing]
What we have done: [containment and remediation steps]
What we recommend you do now: [for example inform affected people if you assess a high risk,
reset staff passwords, review recent bookings]
How we can help: [exports of affected records, timeline, logs relevant to your account]
Next update: [date/time, at most 24 h]
Contact: [owner name, email, phone]

This notice is provided under Article 33(2) GDPR and our data processing agreement. You are
responsible for deciding whether to notify the Garante (within 72 hours of your own awareness)
and the people concerned. We will send updates as we learn more.
```

### 7.3 Information to give the Garante (Art. 33(3)), if the owner notifies as controller
Nature of the breach with categories and approximate numbers of people and records; contact point; likely consequences; measures taken or proposed. Use the same facts as the incident log.

## 8. Recovery and post-incident

1. Restore normal service only after the attack path is closed and verified (an automated test or a manual check that is written in the log).
2. Re-enable features in stages; watch `security_event` for 7 days.
3. **Post-mortem within 7 days of closure** (blameless): timeline, root cause, what detected it, what slowed us down, controls added. Add or update tests (abuse case), rules, the risk register and this plan.
4. Tell affected tenants that the incident is closed and what changed.
5. Record achieved times against the targets (awareness to containment, awareness to tenant notification).

## 9. Incident log

Keep one entry per incident outside the public repository history if the repository ever becomes public; while it is private, `docs/security/incidents/INC-YYYY-NNN.md` is acceptable **without any personal data or secrets**. Fields: id, T0 (awareness), reporter, severity and changes, data classes, tenants (ids), actions with times, notification decisions with reasons, notifications sent (to whom, when), root cause, follow-ups, closure time.

Weekly review checklist (once real tenants exist): the `security_event` signals in section 4; `job_run` failures; backup heartbeat; open Dependabot/OSV alerts; provider emails; new risks for the register. Record "reviewed on [date], nothing found" so that absence of review is visible.

## 10. Capabilities the product and operations must provide (tasks)

Without these, parts of this plan are paper only. They are listed so the plan and milestones carry them.

| Capability | Why | Where in the plan | Status |
|---|---|---|---|
| Global maintenance / read-only switch (env flag or system setting) honoured by all routes | Stop writes during SEV1 (devops 10.3 assumes it) | Add to M1 (platform) | not in plan: **task** |
| Revoke all sessions (all realms) and per-tenant revoke | Account takeover response | M1 (sessions) and FR-SYS-12 for tenants | partly (tenant suspend exists) |
| Bulk reissue of credentials (revoke sessions, one set-password link per user) | Pepper or credential-store compromise | ABU-M1-35 | planned |
| Secret rotation runbooks `docs/runbooks/rotate-*.md` (KEK, pepper, session secret, cron secret, DB, SMTP, S3, age key) | Containment | devops, technical-writer in M0/M1; drilled in M6 | planned (devops 5.3) |
| Query pack for scope assessment without PII | Determine who is affected | M3 or M6 (observability + backend) | planned (SR-GDPR-10 is Should): **raise to Must for M6** |
| Break-glass recovery for systemadmin and hosting accounts | Locked-out or compromised owner | Before GATE 4 (OPS-15, CSM-2) | deferred |
| `security.txt` and a monitored security contact | External reports | M6 / go-live | **task** |
| Backup heartbeat and restore drill | Data-loss recovery | devops (committed disabled until a host exists) | planned |
| Alert emails for security events | Awareness | CSM-1, before GATE 4 | deferred |

## 11. Readiness by phase

| Phase | State |
|---|---|
| Now to M6 (local only, synthetic data) | Real personal data is not allowed outside local Docker. Relevant scenarios: secret leaks in the repository or CI, dependency CVEs, supply-chain events, lost developer device. The playbooks for secret leaks, vulnerable dependencies and lost devices apply. |
| Before GATE 4 | Name the deputy (CSM-2); decide alerts (CSM-1); lawyer reviews this plan, the DPA and templates (SEC-6); fill the contact table below; tabletop exercise for scenarios SEV1 cross-tenant exposure and systemadmin compromise; key rotation drill; restore drill; confirm the capabilities in section 10 exist. |
| After GATE 4 | Weekly review routine, post-mortems, review of this plan after each incident and at least yearly (January, with the secrets rotation review). |

## 12. Contacts (fill before GATE 4; keep the real values in the owner's password manager, not in the repository)

| Who | Contact | Notes |
|---|---|---|
| Owner (incident commander) | [name, phone, email] | |
| Deputy | [name, phone, email] | CSM-2 |
| Italian lawyer (data protection) | [name, phone, email] | SEC-6 |
| Hosting provider security/support | [portal, escalation] | decided with the hosting choice |
| Database provider | [portal] | |
| Object storage provider | [portal] | |
| System email provider | [portal] | |
| Repository host (GitHub) | support and security contacts | |
| Garante per la protezione dei dati personali | online data-breach notification procedure (verify the current URL) | |
| Tenant breach contacts | stored per tenant (contact email in the tenant record, admin email, DPA contact); verify at onboarding that the address is monitored | |
