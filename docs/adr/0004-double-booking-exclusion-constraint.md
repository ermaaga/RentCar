# ADR-0004: Double-booking prevention with a PostgreSQL exclusion constraint

- Status: proposed
- Date: 2026-11-01
- Deciders: user (GATE 2), solution-architect, database-architect

## Context
AC4 and KPI-3: zero overlapping non-cancelled bookings per vehicle under concurrency, including admin creation and every kind of edit (FR-BKG-08, FR-BKG-16/17), with a per-tenant symmetric buffer (A-22) and half-open periods `[start, end)`.

## Options considered
1. Exclusion constraint on `(vehicle_id, tstzrange)` using `btree_gist`.
2. SERIALIZABLE transactions with retry.
3. `SELECT ... FOR UPDATE` on the vehicle row, or advisory lock per vehicle, then check-and-insert.
4. Check-then-insert without locking (rejected: race).

## Decision
Option 1.
`booking.blocked_during tstzrange = [start_at, end_at + buffer_minutes)` (buffer snapshotted on the booking); `EXCLUDE USING gist (vehicle_id WITH =, blocked_during WITH &&) WHERE (status <> 'cancelled')`. With a symmetric buffer `b`, two ranges overlap exactly when `s1 < e2 + b` and `s2 < e1 + b`, which matches A-22. `blocked_during` is maintained by a BEFORE INSERT/UPDATE trigger (generated columns cannot use the STABLE `timestamptz + interval` expression). The service maps SQLSTATE `23P01` to `BookingConflictError`; availability search uses the same range predicate with a GiST index for reads. Maintenance and archive checks stay in the service (benign races).
Idempotency (FR-BKG-11) via unique `(tenant_id, idempotency_key)`; booking code unique with retry on collision.

## Consequences
- Declarative, unbypassable by any code path, including edits and future code.
- Requires `btree_gist` (available on Neon, Supabase and standard Postgres) and raw SQL migrations (neither Drizzle nor Prisma models it natively).
- Buffer changes do not retro-apply to existing bookings (assumption AS-3, to confirm).
- Spike S5: 50 parallel conflicting inserts/edits yield exactly one winner and no deadlock.
