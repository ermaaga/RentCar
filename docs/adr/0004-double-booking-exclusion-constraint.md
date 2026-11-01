# ADR-0004: Double-booking prevention with a PostgreSQL exclusion constraint

- Status: accepted
- Date: 2026-11-01 (accepted at GATE 2, 2026-11-01)
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
Additions after the database design (`docs/05-database.md` section 6):
- **Belt and braces**: before any insert or update on bookings, the service takes `pg_advisory_xact_lock(hashtextextended('veh:' || vehicle_id, 0))` for every vehicle involved, in ascending id order (a vehicle change locks old and new). Transaction-level only (ADR-0010). The constraint remains the guarantee that cannot be bypassed; the lock removes deadlocks and crossed waits.
- **Error mapping** in the booking repository: `23P01` -> `BookingConflict` (user sees the friendly conflict); `40P01` (deadlock) and `40001` (serialization) -> exactly one automatic retry of the whole transaction, which then sees the winner and yields `23P01`; a second failure is surfaced as `unavailable`. `23505` is distinguished by constraint name (`bookings_tenant_code_key` -> regenerate code; idempotency key -> return the existing booking).
- **Buffer snapshot semantics**: each booking stores `buffer_minutes` in force at creation; `blocked_during = tstzrange(start_at, end_at + buffer_minutes, '[)')` is set only by the BEFORE INSERT OR UPDATE OF start_at, end_at, buffer_minutes trigger (never by application code). The buffer is therefore the clean-up time *after* each booking's return; with a uniform buffer it equals the symmetric rule of A-22. A tenant changing its buffer does not alter existing bookings (AS-3); when a booking's dates or vehicle are edited, the snapshot is recomputed with the current tenant buffer in the same statement.
- Spike S5 runs with and without the advisory lock and counts `40P01`.
Idempotency (FR-BKG-11) via unique `(tenant_id, idempotency_key)`; booking code unique with retry on collision.

## Consequences
- Declarative, unbypassable by any code path, including edits and future code.
- Requires `btree_gist` (available on Neon, Supabase and standard Postgres) and raw SQL migrations (neither Drizzle nor Prisma models it natively).
- Buffer changes do not retro-apply to existing bookings (assumption AS-3, to confirm).
- Spike S5: 50 parallel conflicting inserts/edits yield exactly one winner and no deadlock.
