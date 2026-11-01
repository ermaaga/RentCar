# RAID log

| ID | Type | Description | Impact | Probability | Owner | Action / mitigation | Due | Status |
|---|---|---|---|---|---|---|---|---|
| A-1 | Assumption | Full spec received (sections 1–12) | high | — | PM | Saved in docs/spec/car-rental-spec.md | Phase 1 | closed |
| A-2 | Assumption | SaaS for multiple independent rental businesses | high | — | PM | Confirmed by user 2026-11-01 | Phase 1 | closed |
| R-1 | Risk | Tenant-chosen colors may break WCAG AA contrast and the UI | medium | medium | ui-designer | Derived variants + warnings on save (spec §10.2); consider blocking, not only warning | Phase 4 | open |
| R-2 | Risk | Spec gaps that change behaviour: day count rule for partial days, time zones, booking status transitions, year-end snapshot trigger, customer de-duplication | high | high | requirements-analyst | Surface as open questions in Phase 2 | Phase 2 | open |
| R-3 | Risk | Customer personal data (name, phone, email) across many tenants → GDPR controller/processor roles, retention, privacy notice | high | high | security-engineer | Address in discovery and 08-security | Phase 4 | open |
| R-4 | Risk | Per-tenant SMTP stored by the platform: credential leak = email abuse for all tenants | high | medium | security-engineer | Encryption at rest, key management, audit | Phase 4 | open |
| R-5 | Risk | Later Vercel deployment: local filesystem storage, Puppeteer PDF, cron/year-end snapshot and DB connections behave differently in serverless | high | high | solution-architect | Design serverless-compatible from day one (S3 in prod, react-pdf, job adapter, pooled connections) | Phase 3 | open |
| D-1 | Dependency | Production DB and storage providers not chosen (deferred by user) | medium | — | user | Architect proposes EU options at Gate 2; local Docker first | Phase 3 | open |
