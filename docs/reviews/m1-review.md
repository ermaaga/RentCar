# M1 review: code and security (light review)

Version 1.0 · 2026-11-09 · Reviewer: PM (Claude), light review chosen by the user instead of the four review agents · Scope: M1 code on `main` 7c5314c (PR #20 to #36)

This is **not** the formal quality loop of `13-piano-implementazione.md` §4 (code-reviewer, security-engineer, qa-engineer, cybersecurity-manager). It records what was checked, what was fixed and what stays open, so the formal sign-off can start from it.

## 1. Method

- Re-read of the M1 entry points against `06-backend-api.md` (AUT, TEN, SUB, NTF, JOB) and `08-security.md` (SR-*, ABU-M1-*).
- Traceability of all 35 M1 abuse cases to tests (`tests/security/abuse-cases-m1.test.ts`).
- All automated checks green (see `docs/test-reports/m1.md`).

## 2. Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| R1 | High | Per-IP limits trusted the leftmost `X-Forwarded-For` value (M1-D1) | **Fixed** in this branch |
| R2 | Medium | Security traceability tests never ran (M1-D2) | **Fixed** in this branch |
| R3 | Medium | Coverage gates of the DoD are not enforced (only config is measured) | Open: change coverage scope, add domain tests |
| R4 | Medium | No route registry / `defineAction`: role and origin checks are per action, and no generated matrix proves every route (ABU-M1-01/02/17) | Open: build before M2 adds public routes |
| R5 | Medium | Password policy lacks the common-password list and the equals-username rule (ABU-M1-14, ASVS 2.1.7) | Open |
| R6 | Low | No `tenant.mismatch`, `access.denied`, `csrf.rejected`, `system.context.used` security events yet | Open |
| R7 | Low | Admin replace (AUT-18), session list and sign-out-others (AUT-09/10), key rotation command (ABU-M1-25) not built | Open (scope) |
| R8 | Info | Operator edit sends the notice to the previous address only when the email changes; name changes are not notified (consistent with SR-AUT-10) | Accepted |

## 3. What looks right

- Tenant isolation: every new query runs in `withTenantTx`/`withSystemTx`; RLS restrictive policies for deletes (migration 0014); cross-tenant tests for operators, SMTP settings and the outbox.
- Secrets: CRON secret compared in constant time on digests; SMTP password encrypted with tenant AAD and never returned; tokens hashed; IP stored as prefix + HMAC.
- SSRF: tenant SMTP host resolved and validated on save, test and every send, connection to the validated IP (ABU-M1-19/20).
- Jobs: idempotent per (job, tenant, period) with advisory try-lock; failures recorded as codes and retried.

## 4. Recommendation

M1 can be considered **functionally complete**. Before closing it formally, fix R3 and R4 (they protect every later milestone) and run the cybersecurity-manager sign-off; R5 to R7 can be scheduled.
