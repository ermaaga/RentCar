# RentCar

Multi-tenant car rental SaaS: each tenant is an independent rental business with its own vehicles, bookings and public booking site.

> Status: under implementation (milestone M0, foundations). This README is a stub; the full guide is written at M6.

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm 10 (see `packageManager` in `package.json`)
- Docker with Compose (for the local stack, from M0 onward)

## Documentation

Project documents live in `docs/`. Start from `docs/00-stato-progetto.md`.

## Run locally (AC1 skeleton)

```sh
cp .env.example .env
docker compose up --build
```

- App: http://127.0.0.1:3000 (liveness: `/api/healthz`)
- Postgres: `127.0.0.1:5432` only

Reset everything (including the database volume): `docker compose down -v`.

- Liveness: `/api/healthz` (process up). Readiness: `/api/readyz` (database reachable, 503 otherwise).
- Migrations run automatically in the `migrate` service and are recorded in `schema_migrations`.

## Checks

```sh
pnpm install
pnpm run format:check && pnpm run lint && pnpm run typecheck
pnpm run test:coverage            # unit tests
pnpm run arch                     # run with Node 22 (dependency-cruiser)
pnpm run test:integration         # needs TEST_* database URLs (see tests/integration)
pnpm run test:e2e                 # needs the running stack
bash scripts/security/semgrep-selftest.sh
```
