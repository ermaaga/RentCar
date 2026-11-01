# ADR-0008: Email delivery through per-tenant SMTP with an outbox

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01)
- Deciders: user (GATE 2), solution-architect, security-engineer

## Context
Each tenant has its own SMTP (encrypted password); system mails use env SMTP. Sending must never block or fail a booking (FR-MAIL-05), delivery results are visible and resendable (FR-MAIL-04), and tenant-chosen SMTP hosts are an SSRF vector (security input). Serverless functions are short-lived; outbound port 25 is often blocked.

## Options considered
1. `nodemailer`, one transport per send, `EmailLog` outbox row, inline send via Next `after()`, hourly retry job.
2. Transactional email API (Resend, Postmark, SES): contradicts per-tenant SMTP requirement.
3. Queue + worker: needs infrastructure beyond need.

## Decision
Option 1. Create the log row (status `pending`) in the booking transaction, send after the response via `after()`, record `sent/failed` and a scrubbed error summary; the hourly job retries failed items (max attempts, backoff). Timeouts 5 s connect / 10 s socket. SMTP host guard: resolve DNS, reject private/loopback/link-local/metadata ranges (re-check after resolution), allow ports 25/465/587/2525, require verified TLS (dev override for Mailpit only when not production). SMTP passwords encrypted with AES-256-GCM, AAD = tenant + field, versioned key id (`APP_ENCRYPTION_KEY`); never returned to the browser. Email header values sanitised (CR/LF).
Templates are plain text + HTML from the message catalog, branded for tenant mails.

## Consequences
- Booking latency is independent of SMTP health; failures are visible in the admin.
- If the platform freezes the function before `after()` completes, the hourly retry covers it.
- Documented operational rule: use ports 465/587 on Vercel (only port 25 is blocked there, per devops input); spike S4 must prove that `after()` work completes. Devops advises awaiting the send inside the request because post-response work may be frozen: if S4 shows that, switch to awaiting with a 3 s budget behind the same `Mailer` port; the outbox retry stays.
