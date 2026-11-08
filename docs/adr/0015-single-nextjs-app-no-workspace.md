# ADR-0015: Single Next.js app (no pnpm workspace), module boundaries enforced by tooling

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2 close, with `docs/03b-struttura-codice.md`)
- Deciders: user (GATE 2 choice of Option A), solution-architect

## Context
ADR-0001 fixes a modular monolith with a manual composition root. Open point: one package or a pnpm workspace with `packages/*` (domain, db, ui)? One deployable, one team, fewer than 50 tenants, and the build must run both on Vercel and in a Docker `standalone` image.

## Options considered
1. Single Next.js app, modules as folders under `src/modules/*`, boundaries enforced by dependency-cruiser and eslint-plugin-boundaries.
2. pnpm workspace: `apps/web` plus `packages/domain`, `packages/db`, `packages/ui`.

## Decision
Option 1. A workspace brings build orchestration, per-package tsconfig/exports, Vercel and Docker `standalone` tracing issues with workspace packages, and slower CI, with no second consumer (no mobile app, no separate worker) to justify it. Boundaries are protected by tooling, not by package walls. Revisit (new ADR) if a second deployable appears (for example a separate jobs worker or a mobile client sharing validation schemas).

## Consequences
- One `package.json`, one lockfile, one Docker build, simple Vercel project.
- Boundary violations are caught only by CI rules: those rules are therefore a hard gate (see 03b section 10).
- Extracting a module into a package later is mechanical because modules already expose only `index.ts`.
