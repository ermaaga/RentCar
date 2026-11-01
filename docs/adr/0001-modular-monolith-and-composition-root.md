# ADR-0001: Modular monolith with thin layers and a manual composition root

- Status: proposed
- Date: 2026-11-01
- Deciders: user (GATE 2), solution-architect

## Context
One Next.js app, <50 tenants, no ops staff, no fixed deadline, full spec scope (AC1..AC11). Domain rules are non-trivial (pricing by calendar days, buffers, status derivation, versioned snapshots) but the system is CRUD-heavy. Requirements demand pluggable DB/storage and adapters for email, PDF, jobs, rate limit and error tracking (NFR-PLG-01/02), and tests with fakes (NFR-TST-01).

## Options considered
1. Modular monolith, feature modules, thin layers (route/action -> service -> repository), ports only at real swap points, manual DI.
2. Full hexagonal/clean architecture with an entity layer per aggregate.
3. Microservices or separate API service.
4. DI container library (tsyringe/awilix/inversify).

## Decision
Option 1. Business logic in plain TypeScript services that receive dependencies by constructor/parameters; one composition root (`src/composition/`) builds the object graph from a Zod-validated config object; no module-level singletons for DB, storage, mail or clock. Pure domain functions (pricing, availability rules, theme derivation, status derivation) have no framework imports. Architecture rules are enforced in CI (dependency-cruiser). No container library until complexity justifies it.

## Consequences
- Fast to build and test; one deployable; easy to run in Docker and on Vercel.
- Ports exist only for DB access, storage, mailer, PDF, scheduler, rate limit, error reporter, clock and ids.
- Detailed folder tree and conventions are written in `docs/03b-struttura-codice.md` after the user's choice.
- Microservices rejected: no scale, team or budget to justify them.
