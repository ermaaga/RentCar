# ADR-0005: Authentication and sessions (in-house DB-backed sessions)

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01; amended same day for SEC-3)
- Deciders: user (GATE 2), solution-architect, security-engineer

## Context
Username + password; usernames unique per tenant (A-1); temporary password or set-password link; forced change; reset via tenant SMTP (operator/admin) or system SMTP (systemadmin); revocable sessions (deactivation, suspension, password change); lockout; separate systemadmin realm; documented extension point for OTP/biometrics (FR-AUTH-12). Security input: opaque server-side sessions, argon2id, no stateless JWT.

## Options considered
1. In-house sessions on Postgres using `node:crypto` and `@node-rs/argon2`.
2. Better Auth (username/admin/twoFactor plugins): strong extension story, but username is globally unique by default, library owns auth tables, custom hooks needed for forced change, lockout, tenant SMTP.
3. Auth.js (NextAuth v5): in maintenance mode since Sept 2025 per community sources; credentials provider is a weak fit for DB sessions plus lockout.
4. iron-session / stateless JWT cookies: cannot revoke server-side (rejected).
5. Lucia: deprecated as a library (used only as a reference pattern).

## Decision
Option 1.
- Session token: 256-bit random, SHA-256 hash stored in `session` (user, tenant, realm, created, last_seen, idle/absolute expiry, `assurance_level`).
- Cookies `__Host-rc_tenant` / `__Host-rc_system` (HttpOnly, Secure, SameSite Lax; Strict where possible); `Secure` and prefix only on HTTPS (local http exception).
- argon2id (`@node-rs/argon2`, m >= 19 MiB, t=2, p=1, tuned to ~250 ms on the target; spike S3); bcrypt >= 12 is the fallback; parameters in the encoded hash for upgrade-on-login.
- Central guard `requireRole(scope, role)` on every action, handler and page; `mustChangePassword` enforced there; Origin-check wrapper on route handlers.
- `CredentialIssuer` strategy with two implementations behind one port. **Active implementation (user decision SEC-3, 2026-11-01): `SetPasswordLinkIssuer`.** New tenant admins, new operators, replaced admins and reset requests receive a one-time set-password link: 256-bit random token, only its SHA-256 hash stored, valid 24 h, single use, consumed in the same transaction that sets the password (min length 12, ASVS V2.1.1), all other sessions of the user revoked on use, issuing a new link invalidates the previous one. No password is ever generated, shown or emailed. The link is delivered by the system SMTP (systemadmin creating a tenant admin) or the tenant SMTP (admin creating an operator). **The link is never displayed in the UI**, not even once (requirements FR-OPR-05 / A-26; this resolves the earlier contradiction in this ADR, `docs/08-security.md` CR-7). If delivery fails, the email is not retried automatically (ADR-0008 carve-out) and the creator uses "re-issue link" after fixing the email setup. This stays an assumption until the user confirms SEC-15 (option B, show once, would need a new ADR amendment). **Redemption**: `GET /set-password?token=...` only renders the form and consumes nothing (mail scanners prefetch links; `Referrer-Policy: no-referrer`, token removed from the URL after load); only `POST` consumes the token, in one transaction (`UPDATE ... SET used_at = now() WHERE hash = $1 AND used_at IS NULL AND expires_at > now()`). No state change on GET anywhere (SR-CSRF-03). `TemporaryPasswordIssuer` (spec text FR-AUTH-03/11) stays implemented as an option only if the decision is reversed; it is not wired in the composition root. Selection is by config key `CREDENTIAL_ISSUER=set_password_link` (default) and needs no schema change: both use the `credential_token` table (hash, user, purpose, expires_at, used_at). `mustChangePassword` remains for password-rotation cases (FR-AUTH-04) and is false for link-set passwords.
- Extension point: `SecondFactorVerifier` port and `assurance_level`; no implementation now. The user accepted the absence of MFA until GATE 4 (residual risk R-AUTH-02/03 recorded in `docs/security/registro-rischi.md`); the port, the `session.assurance_level` column and a `NoopSecondFactorVerifier` returning "not required" are built so adding TOTP does not change the login flow.
- Throttling via `RateLimitStore` keyed by `(tenant, username)` and hashed IP; progressive delay, identical responses.

## Consequences
- Deviation from spec §4 (temporary password) recorded: requirements FR-AUTH-03/11 are amended by the requirements-analyst (SEC-3).
- Exact fit to the requirements; about 1 to 1.5 weeks of work and a small surface (about 600 lines) that must be security-reviewed.
- TOTP for systemadmin can be added later on the port (about days) without schema change beyond a factor table.
- If MFA/passkeys for all tenants become urgent, migrating to Better Auth is a contained rewrite of the `auth` module (option B).
