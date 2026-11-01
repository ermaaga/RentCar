# Security, privacy and compliance constraints (input to GATE 2)

2026-11-01 · Author: security-engineer · Status: analysis input (not the full threat model; that is `docs/08-security.md` in Phase 4)
Sources: `docs/02-requisiti.md` (NFR-SEC/ISO/GDPR, EP-01, EP-13, EP-14), `docs/01-discovery.md`, `docs/spec/car-rental-spec.md`.
Facts about third-party platforms (Vercel plans, regions, DPF status) must be re-verified against the provider's current terms at decision time; they are marked VERIFY.

## 1. Data classification and assets

| Class | Data | Where | Impact if leaked |
|---|---|---|---|
| Personal (ordinary) | Customer first/last name, phone, optional email; operator/admin name, username, email | DB, PDFs, emails, CSV exports | Medium (GDPR breach notification; no special categories, no payment data) |
| Credentials | Password hashes, temp passwords (in transit by email), reset tokens, sessions | DB, email | High (account takeover, tenant takeover) |
| Secrets | Per-tenant SMTP credentials (encrypted), `SESSION_SECRET`, encryption key, system SMTP, S3 keys, DB URL, cron secret | DB / env | High (mail abuse as the tenant, impersonation, full data access) |
| Business confidential | Bookings, revenue, expenses, fleet per tenant | DB | Medium (competitors; cross-tenant leak is the main product risk) |
| Public | Branding, vehicle cards, tenant public pages | DB, storage | Low |

No special-category data, no card data (pay on site, recorded manually): PCI-DSS is out of scope (confirm: no card number or PAN field is ever added to notes or payment fields; see SEC-5 in the threat model phase).
Crown jewels: tenant isolation (cross-tenant read/write), systemadmin account, encryption key + SMTP secrets, tenant admin accounts.

## 2. Recommended ASVS level (candidate; final decision by cybersecurity-manager)

- **ASVS 4.0.3 Level 2 for the whole app, scoped pragmatically**: V2 (authentication), V3 (sessions), V4 (access control), V5 (validation), V6 (cryptography, SMTP secrets), V8 (data protection), V13/V14 (API, configuration) at L2; remaining chapters at L1. Rationale: multi-tenant SaaS where one flaw exposes every tenant's customers, a privileged systemadmin role, stored third-party credentials, and a public unauthenticated write endpoint. Data is not special-category, so L3 is not justified.
- This is consistent with NFR-SEC-01 (L1 minimum, L2 for auth/session/access control) and raises the rest of the chapters to L2 only where cheap (headers, logging, config). Cost difference vs "L1 + L2 for three chapters" is small; the cybersecurity-manager may keep the narrower scope.
- MFA is not in scope (spec: OTP out of scope; FR-AUTH-12 extension point). ASVS L2 V2.8 (OTP/MFA) is therefore an **accepted deviation** for tenant users; for systemadmin it is the highest-value future control (see SEC-1).

## 3. Tenant isolation

Requirement baseline: NFR-ISO-01..03, FR-PLT-04, FR-AUTH-13.

1. **Primary control (mandatory): application-level scoping through a single data-access layer.** No repository method accepts a query without a `tenantId` derived from the session or the resolved tenant; the tenant id is never taken from request body/query. Enforced by: architecture test (no direct ORM/DB client import outside the data layer, already US-121), lint rule/test that every tenant-owned model is only reachable through a tenant-bound repository factory.
2. **Defence in depth (recommended): PostgreSQL Row Level Security.**
   - Tables carry `tenant_id`; policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)` with `FORCE ROW LEVEL SECURITY`; the app connects with a **non-owner, non-superuser role** (the migration role differs from the runtime role; owners bypass RLS unless forced).
   - Each request/transaction does `SET LOCAL app.tenant_id = ...` inside a transaction. This is compatible with **transaction-mode poolers** (PgBouncer, Neon, Supabase pooler) only if `SET LOCAL` is used inside an explicit transaction; session-level `SET` is forbidden (it leaks between tenants on pooled connections). This is a direct hosting constraint (Section 11).
   - Tenant-less paths (systemadmin console, tenant resolution by slug, scheduled jobs) use an explicit, separate, audited access path (second role or policy `app.is_system`), not a bypass of the role.
   - Cost: moderate (ORM transaction wrapper per request, test setup). Benefit: a forgotten `where tenantId` becomes an empty result instead of a leak. Recommendation: adopt RLS from the first migration (retrofitting is costly). If the architect rejects it, the fallback is an ORM-level mandatory tenant scope (Prisma client extension / Drizzle wrapper) plus the tests below, recorded as an accepted risk.
3. **Cross-tenant tests (blocking in CI, NFR-ISO-01):**
   - Generated matrix: for every entity and every route/server action, authenticate as tenant A admin and request tenant B ids (read, update, delete, list, export) and expect 404/403 and zero B data.
   - Includes audit log, CSV exports, snapshots, PDFs, uploads (storage keys), booking code lookup, customer lookup by phone (de-duplication must not cross tenants, FR-CUS-08), and search responses.
   - A DB-level test connecting as the runtime role without setting `app.tenant_id` returns zero rows on every tenant table (proves RLS is active and the role is not an owner).
   - Uniqueness: slug and booking code collisions across tenants do not leak existence (booking code unique per tenant or global, but lookup always tenant-scoped).
4. **Other isolation points:** storage keys prefixed `tenants/{tenantId}/...` generated server-side only (NFR-ISO-02); presigned URLs, if used, are short-lived and issued after an authorisation check; caches/rate-limit keys include the tenant (NFR-ISO-03); `/system` routes in a separate authorisation guard (deny by default: a route without an explicit guard declaration fails an architecture test).
5. **Future custom domains (FR-PLT-04):** host-based resolution adds a spoofing surface (Host header). Resolution must use an allowlist lookup (host -> tenant) and never trust `X-Forwarded-Host` unless set by the trusted proxy; cookies host-only (no `Domain` attribute) so sessions cannot cross tenants' domains.

## 4. Authentication and sessions

| Topic | Requirement (verifiable) |
|---|---|
| Library | Use a maintained library for primitives (e.g. `@node-rs/argon2` or `argon2`; session handled by a small custom server-side session store or a mature library). No home-made crypto. Auth.js credentials flow is a weak fit for DB sessions plus lockout and forced change; the architect decides, constraint is below. |
| Password hashing | **argon2id**, OWASP baseline parameters: m=19 MiB (19456 KiB), t=2, p=1 minimum (or m=46 MiB, t=1, p=1); tune so a hash takes ~250 ms (NFR-SEC-02) **on the target runtime**. Serverless memory limits must accommodate the memory cost under concurrency (see Section 11). Per-hash random salt, parameters stored in the encoded hash for upgrade-on-login. bcrypt cost >= 12 is the accepted fallback (72-byte limit: reject or pre-hash longer inputs). Optional server-side pepper from env/KMS: not required. |
| Password policy | Min 10 (A-2); ASVS 4.0.3 says >= 12 for L2: **SEC-2** asks to raise to 12. Max length >= 64, allow all Unicode, no composition rules, check against a common/breached list locally (e.g. top 100k list, no external API call with the password). |
| Temp passwords | CSPRNG, >= 12 chars from a 62+ symbol alphabet, valid 7 days (A-2), single use, hashed like a password, `mustChangePassword` enforced in the server session check on every request (FR-AUTH-04), not only by UI redirect. Email is plaintext transport by nature: accepted risk, mitigated by forced change and 7-day expiry. Never log the temp password nor include it in audit or job payloads. Recommended alternative: send a one-time set-password link (60 min) instead of a password; see SEC-3. |
| Lockout / throttling | 5 failures per account in 15 min -> 15 min delay (A-3) **and** per-IP throttle; the response and timing are identical for unknown user/locked/deactivated; lock state keyed by `(tenant, username)`; do not allow an attacker to lock out the legitimate admin indefinitely: use progressive delay rather than hard lock, and exempt the correct password from the delay only if it is not a brute force (simplest: delay applies to all attempts). Counters in the shared store (Section 6) or DB. |
| Reset tokens | >= 128 bits CSPRNG (NFR-SEC-07), stored as SHA-256 hash, single use, 60 min expiry (A-2), bound to the user and tenant, invalidated on password change or new request, constant-time compare (comparing hash lookups is acceptable). Link built from `APP_BASE_URL`/trusted tenant host, **never from the request Host header** (host-header poisoning of reset links). Generic response and equal timing whether or not the account exists (FR-AUTH-06); send mail asynchronously/with bounded time so response time does not leak existence. Reset completion invalidates all sessions of the user. |
| Reset via tenant SMTP | The mail is sent through tenant-controlled infrastructure: a tenant admin (or an attacker who changed the SMTP host in a compromised admin account) can read the operators' reset mail. Accepted: the admin already controls the operators. Systemadmin resets always use the system SMTP (spec). Tenant admin password reset: see the attack path in Section 12. |
| Sessions | Opaque random token >= 128 bits, stored hashed server-side (DB or shared store) so logout/deactivation/suspension/password change revoke immediately (FR-AUTH-09/10, FR-SYS-12). Rotate at login and at forced password change. Idle 30 min / absolute 12 h tenant users; 15 min / 8 h systemadmin (A-4). Stateless JWT sessions are **not** recommended (revocation required). Session lookup adds a DB/store read per request: acceptable at this scale. |
| Cookie flags | `HttpOnly; Secure` (not on plain http localhost only); `SameSite=Lax` minimum, **Strict for `/system` and `/{slug}/admin`** cookies if the login flow allows; `Path=/`; use the `__Host-` prefix in production (requires Secure, Path=/, no Domain), which also blocks sibling-subdomain injection. Separate cookie names for systemadmin and tenant sessions; a tenant session is bound to its tenant and rejected on any other slug. |
| CSRF | Server actions: Next.js verifies `Origin` against `Host`/`X-Forwarded-Host`; keep `experimental.serverActions.allowedOrigins` explicit and minimal behind proxies. **Route handlers (POST/PUT/PATCH/DELETE) are not covered by that check**: require a shared wrapper that validates `Origin` (or `Sec-Fetch-Site: same-origin`) and rejects missing/foreign origins, plus SameSite. Never change state on GET (including logout, exports, job triggers). Public booking POST is anonymous: CSRF is moot but origin check + rate limit + honeypot still apply. Test: a cross-origin form POST to each mutating route returns 403. |
| Login CSRF / fixation | New session id on login; ignore any pre-login session id. |
| Enumeration | Same message/timing for unknown user, wrong password, deactivated, suspended tenant at login (the "tenant suspended" message in FR-SYS-12 reveals tenant state only after valid credentials, to keep it non-enumerating). Usernames are only unique per tenant: the login page is per slug, so slug existence is public by design. |
| Systemadmin | Separate login and cookie, shorter sessions (A-4), seed-from-env only in non-production (FR-PLT-02: ensure production refuses the seed unless explicitly flagged and that the seed password is not left in env history). Strongly recommended: TOTP MFA for systemadmin and tenant admin using the FR-AUTH-12 extension point; spec excludes it now (SEC-1). |
| Authorisation | Deny by default; role + tenant checked in a central guard on every server action/route handler/page (not only in middleware: Next.js middleware alone is not a safe sole control, cf. CVE-2025-29927 class of bypasses; re-check in the data layer). Operator is read-only: enforced at the server action/handler, not by hiding buttons (AC8). Mass assignment: schemas whitelist fields; `role`, `tenantId`, `mustChangePassword`, `active` never from input. |

## 5. Secrets and key management (SMTP encryption)

Requirement baseline: NFR-SEC-02, spec §10, FR-PLT-09.

- **Algorithm**: AES-256-GCM (or XChaCha20-Poly1305) with a unique random nonce per encryption, via Node `crypto` or a vetted library; ciphertext stored as `{version, keyId, nonce, ciphertext, tag}`. AAD = `tenantId` + field name, so a ciphertext copied to another tenant's row fails to decrypt.
- **Envelope design (recommended)**: master key (KEK) outside the DB, supplied as `APP_ENCRYPTION_KEY` (base64, 32 bytes) or a KMS reference; per-tenant data key (DEK) random, stored wrapped by the KEK in the DB. Benefits: rotating the KEK means re-wrapping N small DEKs, no bulk re-encryption; a tenant offboarding can destroy its DEK. At this scale a single KEK + per-record versioned keyId is an acceptable simplification (decision for the architect; both satisfy NFR-SEC-02).
- **Rotation procedure (to document, tested once)**: keep `APP_ENCRYPTION_KEY` plus `APP_ENCRYPTION_KEY_PREVIOUS`; decrypt by `keyId`, always encrypt with the current key; a CLI/job re-wraps all records and then retires the old key; test with a fixture. Compromise rotation: also have the owner ask tenants to rotate their SMTP passwords.
- **Never**: return the SMTP password to the browser (the edit form shows a placeholder and only replaces when a new value is submitted), log it, include it in audit values (US-130), put it in error messages or CSV, or use `SESSION_SECRET` as the encryption key (separate keys, derived via HKDF at most).
- **Key location by hosting option**: see Section 11. Generic rule: the key must not live in the same place as the DB backups (a leaked DB dump must not be decryptable) and must not be committed (`.env.example` with placeholders only; gitleaks in CI).
- **Other secrets**: `SESSION_SECRET` (if used to sign anything, >= 256 bit), cron/job secret (separate, compared in constant time), S3 keys with least-privilege policy (one bucket, no list on other buckets), DB runtime role without DDL. Rotation notes for each in the devops runbook. Startup validation fails fast without printing values (FR-PLT-09). Dev defaults must not boot in production mode (reject known placeholder values).
- **SMTP host SSRF**: the tenant admin chooses an SMTP host/port, which makes the server open outbound TCP connections to an arbitrary address (SSRF/port scanning of internal networks, cloud metadata). Require: resolve DNS and reject private/loopback/link-local/metadata ranges (re-check after resolution to prevent DNS rebinding), allow ports 25/465/587/2525 only, TLS required (STARTTLS or implicit, certificate validation on, no `rejectUnauthorized:false`), connection/send timeouts, and rate limit on the "test email" action. In local Docker, a dev override may allow Mailpit/MailHog on a private address, only when `NODE_ENV != production`.

## 6. Rate limiting and anti-abuse storage

Requirement baseline: NFR-SEC-05, FR-PUB-10, FR-AUTH-08. In-memory counters are insufficient on serverless (each instance has its own memory, cold starts reset it).

| Hosting | Store | Notes |
|---|---|---|
| Local Docker | In-process or Postgres | Single instance: either works; use the same interface (`RateLimitStore`, NFR-PLG-02). |
| Vercel + external Postgres | **Postgres table** (atomic upsert `INSERT ... ON CONFLICT DO UPDATE` on `(key, window)`) as the zero-cost, no-new-vendor default; alternative Upstash Redis (free tier, EU region selectable) adds a sub-processor and a US-company vendor | Postgres adds one query per limited request; fine at this scale (<=100 concurrent public sessions). Expired rows purged by the scheduled job; entries retained <= 24 h (NFR-GDPR-02). Vercel WAF/firewall rate limiting is a plus but is plan-dependent and a Vercel-specific API: if used, only as an extra layer behind the same adapter. |
| EU VPS / container platform | Postgres, or Redis container in the same compose | Redis container is free and EU-resident; one more component to patch. |

Rules for every option:
- **Client IP derivation**: use only the header set by the trusted edge (Vercel: `x-forwarded-for` rightmost trusted / `x-real-ip` as documented; VPS: reverse proxy sets it and the app trusts only that hop). A spoofable `X-Forwarded-For` makes every limit bypassable (Section 12 abuse case). Configure the trusted-proxy count explicitly.
- **Keys**: hash the IP (HMAC with a server key) before storing so the limit store holds no raw IP (data minimisation, 24 h expiry). Login limits keyed by both `(tenant, username)` and IP; booking limits by IP and by `(tenant, phone)` (max 3 open future bookings, REQ-7).
- **Limits** (from requirements): search 5/min/IP, booking 10/h/IP, login per A-3, password reset per account and per IP (suggest 3/h/account, 10/h/IP), SMTP test email, CSV export (concurrency 1 per tenant), upload endpoints. Responses 429 with `Retry-After`.
- **Fail mode**: if the store is unavailable, public booking and search fail **open for reads, closed for login/reset** (documented decision; the architect confirms).
- **Distributed attacker residual risk (RK-1)**: IP and phone limits do not stop a botnet or a rotating-phone attacker blocking vehicles. Mitigations not requiring CAPTCHA (REQ-7): unconfirmed-booking cap per vehicle per hour, admin alert/email on bursts, one-click bulk cancel, honeypot plus minimum fill time, and an off-by-default switch for Cloudflare Turnstile/hCaptcha per tenant if abused (privacy: third-party script, would need CSP and consent review). Recorded as an accepted risk.
- **Email abuse**: the booking form lets an anonymous user make the platform send an email (with PDF) to an arbitrary address through the tenant's SMTP. Constrain: only to the address entered once per booking, limit per email address and per IP, no user-controlled content beyond name in the template (header injection: strip CR/LF, encode names), and the tenant SMTP reputation is at stake. This also is a harassment vector (booking in someone else's name): the email must state it can be ignored and who to contact.

## 7. File upload security

Baseline: NFR-SEC-06, FR-VEH-05, FR-BRD-08, A-23.

- Allowlist JPEG/PNG/WebP only; **no SVG** (inline script, XXE, external references; SVG logos in a tenant theme are an XSS vector on the app origin), no GIF/AVIF unless re-encoded, no PDF uploads.
- Detect type by **magic bytes** (e.g. `file-type`), ignore client `Content-Type` and extension; then **re-encode** images with `sharp` (strips EXIF including GPS, neutralises polyglot payloads, enforces max 1280 px per NFR-PERF-01). Reject on decode failure or on excessive pixel count (decompression bomb: cap width x height, e.g. 40 MP, and set `sharp` `limitInputPixels`).
- Size limits enforced **before buffering the whole body**: logo 1 MB, photo 5 MB, 10 per vehicle (A-23). Constraint: Vercel serverless request body limit is about 4.5 MB, so 5 MB photos cannot be POSTed through a function; either lower the limit to ~4 MB, resize client-side, or upload directly to S3 via presigned URL (then validation moves to a post-upload step: the object stays in a quarantine prefix until the server has sniffed and re-encoded it). The architect must choose; this is a hosting-driven constraint (Section 11).
- Server generates the key `tenants/{tenantId}/vehicles/{vehicleId}/{uuid}.{ext}` (never from the filename); original filename stored only as sanitised metadata; no path traversal possible by construction; `local` provider resolves paths and verifies they stay inside the base directory.
- Serving: bucket is private or public-read only for the public asset prefix; responses set `Content-Type` from the stored (verified) type, `X-Content-Type-Options: nosniff`, and `Content-Disposition` inline only for images. Images served from a different origin than the app (S3/CDN domain) are preferred so a bypass cannot run script with app cookies. Authorisation of tenant-private files goes through the app or short-lived presigned URLs (<= 5 min).
- Malware scanning (ClamAV): not required, because files are only displayed back as re-encoded images by the same tenant to the public; revisit if documents are ever accepted.
- Delete: removing a vehicle/photo deletes the object; tenant offboarding deletes the prefix.

## 8. CSV export and spreadsheet injection

Baseline: FR-CSV-01..03.

- Neutralise any cell whose first character, after trimming leading whitespace, is `=`, `+`, `-`, `@`, **TAB (0x09) or CR (0x0D)** (the requirements list only `= + - @`; add TAB/CR and also `＝`-style full-width variants are covered by prefix-quoting every text cell that starts with a non-alphanumeric symbol, simplest safe rule: prefix `'`). Apply to **every text column** (names, notes, vehicle names, plates, descriptions, expense text), not only customer names.
- Do not blanket-prefix numeric columns: write amounts and dates from typed values (a negative amount `-12.50` must stay numeric, so format numbers explicitly and treat only string-typed fields with the sanitiser). Test with `=HYPERLINK(...)`, `@SUM(...)`, `+cmd|' /C calc'!A0`, and `-2+3`.
- Standard CSV quoting (RFC 4180: quotes doubled, fields containing comma/quote/newline quoted); UTF-8 with BOM for Excel; `Content-Disposition: attachment`, `Content-Type: text/csv`, `nosniff`.
- Authorisation: admin only (operators excluded), tenant-scoped query, audit entry (who, filters, row count, no data) before streaming; max rows / streaming for 50,000 rows (NFR-PERF-06); on serverless use streaming responses within the duration limit.
- Exports contain personal data: the privacy notice for admins should say so; filename without PII.

## 9. Security headers, CSP and per-tenant theming

Baseline: NFR-SEC-04, spec §10.2 (CSS variables per tenant, self-hosted fonts, logos from storage).

- Headers on all responses: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (preload only after a decision, SEC-8), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (admin: `same-origin` or `no-referrer`; reset links must not leak tokens via Referer: the reset page uses `no-referrer`), `Permissions-Policy` (camera, microphone, geolocation, payment all denied), `Cross-Origin-Opener-Policy: same-origin`, `frame-ancestors 'none'` via CSP plus `X-Frame-Options: DENY` for old browsers. Admin and auth responses `Cache-Control: no-store`.
- **CSP with a nonce** per request (Next.js middleware/proxy generates it): `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'` (see below); `img-src 'self' data: blob: https://<storage-host>`; `font-src 'self'`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests`. Dynamic nonce-based CSP disables full static optimisation/ISR for pages that need it: acceptable at this scale, but note the SEO/perf interplay (the public pages are the only ones where it matters; they may use hash-based or nonce via middleware, performance impact to be checked against NFR-PERF-01).
- **Per-tenant theming without `unsafe-inline`**: tenant colours are validated hex only (FR-BRD-11: regex `^#[0-9a-fA-F]{6}$`, never free text, never injected into a `<style>` string without validation). Preferred pattern: emit the CSS variables in a `<style nonce="...">` block (server-rendered, values from validated hex and an enumerated font key) **or** set them as a `style` attribute on a wrapper (`style-src-attr 'unsafe-inline'` is then needed; avoid). Do not allow tenant-supplied CSS, custom fonts, or arbitrary font names: font is an enum of three self-hosted families. Tenant title/alt text/contact info are plain text, rendered through React escaping only. The privacy-notice/terms "text" field (FR-BRD-09) is the XSS-risk field: store as plain text or restricted Markdown rendered with a sanitiser (DOMPurify/`rehype-sanitize`, links limited to `https:` and `mailto:`, `rel="noopener noreferrer nofollow"`), never raw HTML. "Link" variant: allow `https:` URLs only (no `javascript:`), open in a new tab with `noopener`.
- Tenant-supplied links and logos: images are served from the storage origin; no remote image URLs are accepted from tenants (avoids tracking pixels and mixed content and keeps `img-src` tight).
- CORS: no CORS headers by default (same-origin app). If a future mobile/API consumer is added, explicit origin allowlist, never `*` with credentials.
- Header and TLS verification: automated header test in CI (NFR-SEC-04) and ZAP baseline + testssl/SSL Labs on staging before go-live.
- Vercel note: headers set in `next.config` or middleware work on Vercel; HSTS is added by Vercel on its domains but must still be set explicitly for custom domains.

## 10. Privacy and GDPR

### 10.1 Roles and legal basis
- Per NFR-GDPR-01: **tenant = controller** of customer (and its own staff) data; **platform owner = processor** under Art. 28. For the **tenant admin/operator accounts** (login, audit), the platform owner is controller of its own account data for authentication/security and the tenant is controller for its staff's activity; document this split in the DPA ("joint situation" is not recommended; keep it simple: owner controller for account/security data of users, processor for customer data).
- Legal basis (tenant's responsibility, to put in the template): contract performance (Art. 6(1)(b)) for the booking, legitimate interest for fraud/abuse prevention (rate-limit data) and audit log; consent is **not** needed for the booking itself; the optional email is provided voluntarily and is used only for confirmation (no marketing; if marketing is ever added, separate consent).
- Owner deliverables before any tenant goes live (REQ-12): DPA (Art. 28(3) content: instructions, confidentiality, security measures, sub-processor list and change notice, assistance with data-subject requests, breach notification to controller "without undue delay", return/deletion at the end, audits), privacy-notice template, ROPA entry as processor, and a breach procedure (controller notified promptly; controller's 72 h clock to the Garante). Italian lawyer review recommended (SEC-6).
- DPIA: not required on the facts (small-scale ordinary data, no profiling, no special categories); record a short screening note.

### 10.2 Controls and requirements
- **Minimisation**: only the four public fields (NFR-GDPR-02); no date of birth, ID or licence numbers in this version (if the tenant wants them later, that is a new risk review: driving licence data would raise the class).
- **Cookies**: only the strictly necessary session cookie, set only for authenticated staff; no banner (NFR-GDPR-07). Constraint: no analytics, no third-party fonts/CDNs/maps/captcha on public pages; the CSP in Section 9 enforces this technically. If error tracking (Sentry) is added: scrub PII and cookies server-side, EU data region, and list as sub-processor; browser-side SDK would need review (IP collection).
- **Retention** (A-31, A-35, NFR-GDPR-06): customers until tenant anonymises (yearly reminder, no auto deletion); audit 24 months; logs without PII <= 30 days; rate-limit data <= 24 h; backups <= 35 days; reset tokens and expired sessions purged by the daily job; unattended tenant after cancellation: define deletion/export period (SEC-7 proposes 90 days after cancellation, then hard delete of tenant data and storage prefix).
- **Data-subject rights**: the customer contacts the tenant (controller). Platform supports: access/portability (FR-CUS-07, make it a Must in practice: the processor must "assist", and without it admins resort to SQL; recommend raising to Must), erasure via anonymisation (FR-CUS-06), rectification (edit customer). Anonymisation must also scrub: PDF copies stored in storage (if persisted), email-delivery records (FR-MAIL-04 error summaries containing addresses), audit values (FR-AUD-03 says identifiers only: add a test), search indexes/caches, and application logs (no PII by design). Open question on blocking anonymisation while a booking is open (FR-CUS-06): acceptable, but must not become a way to refuse an erasure request beyond the legal one-month deadline; document the workaround (cancel the booking first).
- **Logs**: structured logs carry request id, tenant id, user id; never names, phones, emails, temp passwords, tokens, SMTP values, full booking payloads; add an automated log-scrub test (canary values).
- **Email content**: booking PDFs sent in clear email; the tenant's SMTP must use TLS (enforced, Section 5). The PDF carries name and booking code only.
- **Transparency**: link to privacy notice and terms on the form before submit (NFR-GDPR-03); the platform template names the controller placeholder, purposes, retention, recipients (platform as processor, hosting), rights, contact and the right to complain to the Garante.
- **Data breach**: owner runbook with detection sources (logs, auth anomalies), 24 h target to notify affected controllers, template text (cybersecurity-manager owns `docs/security/incident-response.md`).
- **Offboarding**: on tenant cancellation, export for the tenant then deletion after the agreed period; DEK destruction if envelope keys are used.

### 10.3 Sub-processors and EU residency by hosting option

| Component | Local Docker | Vercel + external EU Postgres + EU S3 | EU VPS | EU container platform |
|---|---|---|---|---|
| App compute | Owner's machine (no production personal data; use synthetic data) | Vercel Inc. (US company, EU legal entity exists; functions can be pinned to an EU region, e.g. Frankfurt/Paris/Dublin, via project region setting; VERIFY the current region options per plan). Request-level data, headers, IPs and logs transit/rest per Vercel's policy | VPS provider (EU company) | EU provider |
| Edge/CDN | none | Vercel Edge Network is global: requests are terminated at the nearest edge, so personal data in requests (booking form) can transit non-EU nodes before reaching the EU function. This is a transfer question, not just a storage one | Optional (none) | Provider LB, EU |
| Database | Docker volume | External EU Postgres (e.g. Neon `aws-eu-central-1`, Supabase EU, Scaleway, OVHcloud, Aiven, Crunchy/other EU): check provider entity (US parent => SCC/DPF), DPA, EU region, backups region, PITR retention (<= 35 days, A-31), **transaction pooler available** | Postgres on the VPS (self-managed backups, patching) or managed EU DB | Managed EU DB |
| Object storage | Docker volume | EU S3-compatible (Scaleway Object Storage, OVHcloud, Hetzner, Cloudflare R2 with EU jurisdiction setting, AWS eu-*) with DPA | EU provider storage | EU provider |
| Email | Mailpit/dev | Tenant SMTP chosen by tenant (the tenant's own processor, not ours); system SMTP: choose an EU provider with DPA | same | same |
| Error tracking (optional) | none | Sentry EU region (Frankfurt) or none | same | same |
| Logs | stdout | Vercel log retention (short on lower plans) plus any log drain: no PII by design | VPS logs (rotate <= 30 days) | platform logs |

Transfers: if a US-headquartered provider processes data (Vercel, Neon/Databricks, Supabase, AWS, Cloudflare, Sentry), a transfer mechanism is needed even with EU regions because of possible remote access/support. Mechanisms: the EU-US Data Privacy Framework (adequacy decision of 10 July 2023; upheld by the EU General Court in September 2025 but under appeal; **VERIFY** that each vendor is currently DPF-certified), plus SCCs in the vendor DPA as a fallback, plus a documented Transfer Impact Assessment (short, since data is ordinary and EU-hosted). Where the same capability exists from an EU-headquartered provider at similar cost, it removes the question entirely (preferred for the DB and storage).
Sub-processor register: owner publishes the list (name, purpose, location, transfer mechanism) with the DPA and notifies tenants of changes (30 days suggested).

## 11. Hosting options: blocking constraints versus acceptable with mitigation

### Option A: Local Docker Compose (phase 1; also acceptable for pilot only with synthetic data)
Blocking: none for development.
Acceptable with mitigation: no TLS/Secure cookies on `http://localhost` (cookie `Secure` flag conditional on `APP_BASE_URL` scheme; `__Host-` prefix only on HTTPS), dev SMTP/Mailpit on a private address (SSRF allowlist override gated to non-production); seed password in `.env` (dev only; production refuses seed without flag); no real personal data; encryption key a dev placeholder rejected in production mode; containers run as non-root, DB port not published to the host interface by default (bind to 127.0.0.1), Postgres runtime role distinct from the migration role.
Not suitable for real tenants: no EU managed backups, no patching duty owner, no TLS, home IP.

### Option B: Vercel (app) + external EU Postgres + EU S3-compatible storage (stated intent)
Blocking constraints (must be solved or accepted by the user before choosing):
1. **Commercial-use plan**: the free (Hobby) plan is, per Vercel's terms, for non-commercial personal use; a SaaS with paying tenants requires a paid plan (VERIFY current terms and price). Conflicts with "avoid paid services" (discovery B6/B7) => SEC-9/ARC decision. Hosting this on Hobby would breach the provider terms and risk suspension, which is also an availability and compliance risk.
2. **Processor chain and transfers**: a US-HQ processor with a global edge. Acceptable only with: Vercel DPA (including SCCs) signed, DPF status verified, function region pinned to an EU region, DB/storage in the EU, and the sub-processor list updated. Residual: edge transit of request data and support-access risk; accepted as low-medium for ordinary data (needs owner/lawyer acknowledgement, SEC-6).
3. **Shared rate-limit store required** (Section 6): in-memory is a defect on this option.
4. **Cron**: Vercel Cron plan limits (frequency/count on the free plan; VERIFY) may not fit the jobs (FR-PLT-05). Jobs must be idempotent, protected by a secret (`Authorization: Bearer`, constant-time compare, rejected without it per US-123), not triggerable by GET from a browser, and must also be callable from an external scheduler (GitHub Actions cron). Secret in env, never the same as `SESSION_SECRET`.
5. **Request body limit (~4.5 MB)** vs 5 MB photos: lower the limit or use presigned direct upload with quarantine (Section 7).
6. **Argon2id memory cost** inside memory-limited functions with concurrent logins: ensure the function memory is sized (>= 1 GB recommended for hashing at 19 MiB x concurrent hashes) and keep concurrency low (login is rare).
7. **Database connectivity**: needs a pooled/serverless-capable endpoint. With RLS, only **transaction-mode pooling with `SET LOCAL` inside transactions** is safe (Section 3). Connections must use TLS (`sslmode=verify-full`) with a runtime role of least privilege. If the chosen DB host cannot guarantee this, RLS defence-in-depth is lost (fallback: app-level scoping only, accepted risk).
8. **Preview deployments**: must never use production DB, S3 bucket, keys or real data; previews are publicly reachable by URL unless protected (enable deployment protection); environment variable scopes separated per environment.

Acceptable with mitigation:
- Encryption key in Vercel encrypted environment variables ("sensitive" type): readable by anyone with project access, so protect the Vercel account with MFA, minimal members, no shared accounts, and keep the key out of the DB provider. KMS (e.g. an EU KMS or Scaleway Secret Manager) is stronger but adds a runtime dependency and latency; recommended later, not blocking at this scale.
- Build logs and function logs may include request data: logging policy (no PII) is the control; limit retention.
- Single provider outage (RPO/RTO 24 h, NFR-BKP-01) acceptable per discovery D14.
- Vercel-specific features (firewall, KV, Blob, Edge Config, Analytics/Speed Insights) must stay out: Analytics and Speed Insights add tracking and may require consent, so are excluded by NFR-GDPR-07.

### Option C: EU VPS (e.g. Hetzner, Scaleway, OVHcloud, with Docker Compose + reverse proxy)
Blocking: none technically; the owner must accept operational duties (no dedicated ops, discovery C11): OS patching, firewall, SSH hardening, TLS renewal, backups, monitoring. If the owner cannot commit to monthly patching, this is a risk (high) rather than a blocker.
Acceptable with mitigation: firewall allowing only 80/443 (+ SSH by key from allowlisted IPs or via VPN), automatic security updates (unattended-upgrades), Caddy/Traefik for automatic TLS + HSTS + header injection, DB on the private Docker network only, encrypted off-host backups (restic/borg to an EU object store, key held separately, restore test per NFR-BKP-01), encryption key in a root-only file or Docker secret outside the backup set, Fail2ban or equivalent on SSH, rate-limit store can be in-process (single instance) but keep the interface, trusted-proxy IP configuration (reverse proxy overwrites `X-Forwarded-For`), disk encryption not generally available (note: provider staff can access disks; acceptable for ordinary data with DPA). Best residency story: EU company, no US transfer, simple DPA/sub-processor list. Cost lowest; single point of failure accepted.

### Option D: EU container platform (managed containers + managed Postgres + object storage, e.g. Scaleway Serverless Containers/Containers, OVHcloud, Clever Cloud, Upsun in EU region)
Blocking: none identified; verify the provider offers managed Postgres with encrypted backups and a DPA.
Acceptable with mitigation: shared store for rate limits if more than one instance (Postgres table), secrets via the platform's secret manager (preferable to plain env), scheduled jobs through the platform cron (idempotent, secret-protected), image scanning in CI (Trivy) and non-root minimal images, platform edge IP handling configured for trusted proxy. Best compromise between residency (EU-only vendors) and low ops burden; typically costs more than a VPS and may be paid from day one.

Summary of recommendation from the security view (the architect weighs cost and delivery): **C or D beat B on compliance simplicity** (no US processor, no edge transit question, no plan-terms conflict); **B is acceptable** if the user accepts a paid plan, the DPA/SCC/DPF checks, EU region pinning and the mitigations above. The pluggability requirements (NFR-PLG-01, NFR-SRV-01) keep all options open, so the security constraints should be written to hold for the strictest one (serverless).

## 12. Supply chain and CI controls

Mandatory baseline (security-checklist table), to be planned at GATE 3 and active before M0 closes:
- Lockfile committed, installs with `npm ci`/`pnpm install --frozen-lockfile`; Node and package manager versions pinned (`engines`, `packageManager`); `ignore-scripts` for installs in CI unless a reviewed allowlist needs them (e.g. `sharp`, argon2 native builds); no `latest` ranges.
- SCA on every PR and weekly: `pnpm/npm audit --audit-level=high` plus OSV-Scanner; Dependabot or Renovate with grouped updates; fail on critical/high with fix available (NFR-SEC-08). Keep Next.js and React patched aggressively (Next.js has had auth-bypass-class CVEs in middleware and server actions; subscribe to its advisories).
- Secret scanning: gitleaks pre-commit + CI full-history scan; GitHub secret scanning/push protection if hosted there.
- SAST: Semgrep (OWASP/Next.js/TypeScript rulesets) or CodeQL on every PR; custom Semgrep rules for the project's invariants (raw SQL without parameters, `dangerouslySetInnerHTML`, `fetch` of user URLs, repository access without tenant scope, route handler without the guard wrapper).
- Containers/IaC: Trivy on the image and filesystem (critical fails the build), minimal base image (distroless or `node:*-slim`/alpine pinned by digest), non-root user, no secrets in layers (BuildKit secrets), read-only root filesystem where possible, Checkov/Trivy config on compose/IaC.
- SBOM (Syft/CycloneDX) archived per release build; build provenance/signing optional (cosign) when images are published.
- GitHub Actions hardening: workflow permissions `contents: read` by default; third-party actions pinned by commit SHA; no `pull_request_target` on untrusted code; deployment secrets scoped to environments with required reviewers; short-lived credentials (OIDC) where the target supports it; branch protection (PR, review, green CI, no force push); MFA for all accounts with repo, Vercel/hosting, DB, storage and DNS access; named accounts, no shared tokens.
- DAST: OWASP ZAP baseline on staging before each production release; header/TLS checks (Section 9).
- Abuse-case tests in CI (secure-coding section 9) for every protected route: 401 unauthenticated, 403 wrong role, 404 other tenant, 400 malformed input, mass assignment ignored, 429 on auth/booking/search/reset.
- Dependency choices that reduce attack surface: avoid heavy PDF engines with a browser (Puppeteer) in serverless (also a perf issue); `@react-pdf/renderer` consistent with discovery; PDF content escaped (names are data, not markup).

## 13. Attack scenarios worth an explicit test (feed to Phase 4 threat model)

1. Tenant A admin changes a booking/vehicle/customer/expense id (route param, server action argument, CSV filter) to tenant B's: expect 404 and no side effect.
2. Cross-tenant session replay: tenant A cookie used on `/{B}/admin`: rejected.
3. Spoofed `X-Forwarded-For` rotation bypasses the 10 bookings/h limit: expect limit keyed on the trusted client IP only.
4. Host-header poisoning in the password-reset request: link always uses the configured base URL.
5. Booking with customer name `=HYPERLINK("http://evil","x")`, then admin exports CSV: cell neutralised.
6. Booking with name `<img src=x onerror=...>`: rendered as text in calendar, emails, PDFs and audit log view.
7. Tenant admin sets SMTP host to `169.254.169.254`, `localhost`, an internal service or a port such as 5432 and presses "test email": rejected.
8. Tenant admin compromise: attacker changes SMTP to their own server and triggers resets for operators or captures future booking PDFs. Mitigation: audit entry plus notification of the owner/admin email on SMTP change (suggest as Should), re-authentication (password re-entry) for SMTP change, session age check.
9. Operator calls admin server actions directly with a crafted POST: 403.
10. Deactivated user, suspended tenant, or password changed with an open session: next request rejected.
11. Upload a polyglot/SVG/oversized/renamed `.php` file as logo and as photo: rejected or re-encoded; stored key independent of filename.
12. Replay the job endpoint without the secret, with a wrong secret (timing), and concurrently with the right one: 401 / 401 / no duplicate effects.
13. Booking code guessing: if a public lookup-by-code exists (check FR-PUB confirmation/lookup), rate limit it and require code + phone or email; >= 40 bits entropy (NFR-SEC-07) is borderline against unthrottled online guessing; recommend >= 50 bits or an unguessable URL token for any public view.
14. Race on reset and temp password reuse; second use of a reset link: rejected.
15. Log canary: submit a booking and a failed login with sentinel values, assert none appear in logs.

## Esito
- **Stato**: completato
- **File prodotti/modificati**: `/Users/ermaaga/Work/RentCar/docs/03-inputs/security-constraints.md`
- **Sintesi**:
  1. Candidate ASVS 4.0.3 L2 for the whole app (L1 minimum acceptable only for non-core chapters); MFA is an accepted deviation, recommended later for systemadmin/tenant admin via the FR-AUTH-12 extension point.
  2. Tenant isolation: mandatory app-level scoping through a single data layer, plus recommended Postgres RLS (non-owner runtime role, `SET LOCAL` in transactions, which requires a transaction-mode-compatible pooler); a generated cross-tenant test matrix is blocking in CI.
  3. Auth/session: opaque server-side sessions (no stateless JWT), `__Host-` HttpOnly Secure SameSite cookies, argon2id (m>=19 MiB, t=2, p=1, ~250 ms), explicit Origin check wrapper for route handlers (server actions' built-in check does not cover them), reset links built from configured base URL only, tokens hashed.
  4. SMTP secrets: AES-256-GCM with AAD, versioned keys, KEK from env/KMS (envelope with per-tenant DEK recommended), documented and tested rotation; plus SSRF controls on the tenant-chosen SMTP host, which the requirements do not yet cover.
  5. Rate limiting needs a shared store on serverless: Postgres table by default (no new vendor), hashed IPs, trusted-proxy IP derivation is a hard requirement.
  6. Uploads: magic-byte sniffing plus re-encoding with sharp, no SVG, pixel cap; Vercel's ~4.5 MB body limit conflicts with 5 MB photos. CSV: sanitise all text columns, add TAB/CR to the trigger characters. CSP: nonce-based, tenant theme only from validated hex plus enum font, privacy-notice text must be sanitised.
  7. GDPR: tenant controller / owner processor; DPA, sub-processor list, EU residency; Vercel is a US-HQ processor with a global edge (DPF/SCC needed, EU region pinning, paid plan for commercial use). EU VPS or EU container platform is simpler for compliance; Vercel is acceptable with listed mitigations.
  8. Hosting blocking constraints: Vercel = commercial plan (cost conflict), DPA/DPF/SCC verification, shared rate-limit store, upload size limit, pooler compatible with RLS, preview environments isolated from production. VPS/container = owner must accept patching/backup duties.
- **Assunzioni** (to be confirmed):
  - ASSUNZIONE: customer data is ordinary personal data only (no licence/ID numbers, no card numbers); adding those changes the classification and ASVS target.
  - ASSUNZIONE: Vercel plan terms, region options, cron limits and DPF certification are as I recall them and must be verified before GATE 2 (no web check was done in this task).
  - ASSUNZIONE: a public lookup of a booking by code does not exist beyond the confirmation screen; if it does, see scenario 13.
  - ASSUNZIONE: the owner can sign a DPA and publish a sub-processor list before the first real tenant.
- **Rischi**:
  - Tenant-chosen SMTP host as SSRF vector and as a path for exfiltration after admin compromise: alta (mitigations in Sections 5 and 13; not yet in requirements).
  - Cross-tenant leak through a missed scope without RLS: alta (mitigated by RLS plus test matrix; RLS depends on pooler choice).
  - No MFA for systemadmin (platform-wide takeover) with 15 min/8 h sessions only: media-alta (SEC-1).
  - Booking-blocking abuse by a distributed attacker (RK-1): media, accepted by REQ-7.
  - Vercel Hobby terms vs commercial use; US processor transfer exposure: media (decision at GATE 2).
  - Temp password sent by email in clear: media (7-day expiry and forced change; set-password link preferred, SEC-3).
  - Self-managed VPS patching without ops staff: media.
  - Dev-only seeding or placeholder keys reaching production: media (startup validation, FR-PLT-02).
- **Rilievi bloccanti**: nessuno (analysis only, no code reviewed)
- **Criteri non verificati**: nessuno nel perimetro (analysis). Not verified in this task: current Vercel/DB-provider terms, region lists and DPF certification status (no web lookup performed); to be checked before GATE 2.

## Domande per l'utente
| ID | Domanda | Opzioni (la prima è raccomandata) | Perché conta / impatto | Bloccante |
|---|---|---|---|---|
| SEC-1 | Vuoi l'autenticazione a due fattori (codice da app) per il systemadmin e per gli admin dei tenant? Oggi la specifica la esclude. | A (raccomandata): solo per il systemadmin, in una fase successiva (la predisposizione c'è già) / B: systemadmin e admin dei tenant subito / C: nessuna | Chi ruba la password del systemadmin controlla tutti i tenant e i dati di tutti i clienti. A costa pochi giorni di lavoro; C lascia il rischio più alto | no |
| SEC-2 | Lunghezza minima della password: 10 caratteri (come da requisiti) o 12 (livello ASVS 2)? | A (raccomandata): 12 / B: 10 | 12 è lo standard per il livello di sicurezza consigliato; costa solo un po' di comodità agli utenti | no |
| SEC-3 | Per nuovi utenti e admin sostituiti: inviare la password temporanea via email (come da spec) oppure un link monouso per scegliere la password? | A (raccomandata): link monouso valido 24 h, nessuna password in chiaro nelle email / B: password temporanea come da spec (valida 7 giorni) | Le email non sono cifrate end-to-end: con B una casella compromessa dà accesso diretto. A è una piccola deviazione dalla specifica | no |
| SEC-4 | Il livello di sicurezza consigliato è ASVS livello 2 per tutta l'app (per il cybersecurity-manager decidere). Va bene come obiettivo di lavoro? | A (raccomandata): livello 2 / B: livello 1 con livello 2 solo su login, sessioni e permessi (come da requisiti) | A aggiunge poco lavoro ma più controlli (header, log, configurazione); B è un po' più economico, con meno garanzie | no |
| SEC-5 | Possiamo escludere definitivamente dati di pagamento (numeri di carta) e documenti (patente, ID) dal prodotto, anche nei campi note? | A (raccomandata): sì, esclusi; i campi note avvisano di non inserirli / B: servono patente o documenti | Con B i dati diventano più sensibili: servono cifratura dei campi, più controlli e un'analisi d'impatto privacy (DPIA) | sì |
| SEC-6 | Chi rivede DPA, informativa privacy e trasferimenti extra-UE (es. se usi Vercel o un fornitore con casa madre USA)? | A (raccomandata): un legale italiano rivede i modelli una sola volta prima del primo cliente reale / B: uso i modelli del team senza revisione legale | Il titolare è il noleggiatore ma il contratto lo firma il proprietario: errori nel DPA espongono te. A ha un costo una tantum | sì (prima del go-live) |
| SEC-7 | Che cosa succede ai dati di un tenant dopo la disdetta? | A (raccomandata): export consegnato, cancellazione definitiva dopo 90 giorni / B: conservazione indefinita finché non richiesto / C: altro periodo | Il GDPR impone di non tenere dati senza motivo; serve una regola scritta nel contratto | no |
| SEC-8 | HSTS "preload" (il browser forza HTTPS per sempre sul dominio): lo attiviamo? | A (raccomandata): no all'inizio, solo HSTS normale; si decide dopo il go-live / B: sì subito | Il preload è difficile da annullare e si applica a tutti i sottodomini; utile solo quando il dominio definitivo è stabile | no |
| SEC-9 | Se scegli Vercel: accetti un piano a pagamento? Il piano gratuito vieta l'uso commerciale (da verificare nei termini attuali). | A (raccomandata): valuta prima un hosting UE (VPS o piattaforma container) senza costi di piano obbligatori / B: Vercel a pagamento, regione UE, con DPA firmato / C: Vercel gratuito (non consigliato per clienti paganti) | Incide su costo mensile, trasferimento dati verso un fornitore USA e rischio di sospensione dell'account | sì (per GATE 2) |
| SEC-10 | In caso di abusi sulle prenotazioni pubbliche (prenotazioni false che bloccano i veicoli), vuoi prevedere fin da subito un interruttore per attivare un controllo anti-bot (CAPTCHA) per singolo tenant? | A (raccomandata): sì, spento di default, attivabile se serve (richiede fornitore terzo e va nell'informativa) / B: no, come deciso in REQ-7 | Senza interruttore, un attacco distribuito (molte IP) non è fermato dai limiti attuali. A ha costo di sviluppo contenuto e nessun impatto finché è spento | no |
| SEC-11 | Quando un admin cambia le impostazioni SMTP, vuoi un'email di avviso all'owner/admin e la richiesta di reinserire la password? | A (raccomandata): sì a entrambe / B: nessuna delle due | Se l'account admin viene rubato, l'attaccante può deviare le email (conferme, reset) verso un proprio server | no |
