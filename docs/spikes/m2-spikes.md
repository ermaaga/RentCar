# M2 spikes

## S5 — Exclusion constraint under concurrency (05-database 6.1, ADR-0004)

Date 2026-11-09 · PostgreSQL 16 (local and CI service container) · runtime role `rentcar_app`, RLS active.
Kept as a permanent test: `tests/integration/booking-exclusion.test.ts`.

| Case | Result |
|---|---|
| 50 parallel inserts on one vehicle, overlapping different ranges, **without** the per-vehicle lock | exactly 1 winner, 49 x `23P01`, no `40P01` |
| Same, **with** `pg_advisory_xact_lock(hashtextextended('veh:'||id,0))` | exactly 1 winner, 49 x `23P01`, no `40P01` |
| Two bookings swap vehicles concurrently, locks taken in ascending id order | no deadlock; the losers end with `23P01` only |
| Half-open ranges with buffer 60: next start 10:30 / 11:00 after a 10:00 return | 10:30 refused (`23P01`), 11:00 accepted |
| `blocked_during` set by hand | recomputed by the trigger (cannot be bypassed) |
| Cancellation | frees the vehicle at once |
| Another tenant / the system scope | 0 rows (no system policy on fleet and bookings, ABU-M1-28) |
| Booking pointing at another tenant's vehicle | refused by the composite FK (`23503`) |

**Decision**: keep both the constraint (the guarantee) and the ascending per-vehicle advisory lock (no
crossing waits or deadlocks on edits that change vehicle), as planned. Map `23P01` to
`BOOKING_CONFLICT`; retry once on `40P01`/`40001`.

## S2 — PDF rendering (react-pdf)

Pending: runs with the PDF slice of M2.
