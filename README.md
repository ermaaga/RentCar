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

> The `migrate` service is a stub until the database layer lands; it does not migrate anything yet.
