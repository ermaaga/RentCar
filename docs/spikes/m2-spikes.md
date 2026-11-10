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

Date 2026-11-10 · `@react-pdf/renderer` 4.9.0 · Next.js standalone image (`compose.yaml` app service,
Node 22) on a laptop Docker host. Target from 03-architettura (S2): one-page PDF <= 2 s, <= 512 MB.
Kept as permanent checks: `tests/integration/booking-documents.test.ts` (time, size, no network,
tenant scope) and the E2E download in `tests/e2e/public.spec.ts`.

| Case | Result |
|---|---|
| Cold start: first PDF after a container restart | 0.30 s |
| Warm: 10 sequential downloads | 0.037–0.068 s each, 11,984 bytes |
| 20 downloads at concurrency 4 (renderer semaphore 2) | slowest 0.17 s |
| Container memory: idle after restart -> after the burst | 60 MiB -> 154 MiB (peak observed 211 MiB) |
| Network during render | none: the only `fetch` is the layout engine loading its WASM from an inlined `data:` URL (asserted in the integration test) |
| Fonts | Noto Sans regular and bold (Latin subset, SIL OFL) vendored in `assets/fonts`, traced into the standalone output with `outputFileTracingIncludes`; the E2E download proves they ship |
| Headers | `private, no-store`, `attachment; filename="booking-{code}.pdf"`, `noindex`, `nosniff`; unknown code and unknown tenant both a plain 404 |

**Decision**: keep react-pdf (ADR-0006). The Latin subset covers the launch languages (Western
European, euro sign); names in other scripts would need a wider font file, recorded as a follow-up
rather than shipping a 500 KB font now. Logo rendering waits for the upload slice (`StoragePort`);
attaching the PDF to the confirmation email is the next step of the email slice.
