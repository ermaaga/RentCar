# ADR-0005: Authentication and sessions (in-house DB-backed sessions)

- Status: proposed
- Date: 2026-11-01
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
- `CredentialIssuer` strategy: temporary password (spec) or one-time set-password link (SEC-3); both stored hashed, single use, expiring.
- Extension point: `SecondFactorVerifier` port and `assurance_level`; no implementation now.
- Throttling via `RateLimitStore` keyed by `(tenant, username)` and hashed IP; progressive delay, identical responses.

## Consequences
- Exact fit to the requirements; about 1 to 1.5 weeks of work and a small surface (about 600 lines) that must be security-reviewed.
- TOTP for systemadmin can be added later on the port (about days) without schema change beyond a factor table.
- If MFA/passkeys for all tenants become urgent, migrating to Better Auth is a contained rewrite of the `auth` module (option B).
