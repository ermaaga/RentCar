// Booking state machine, effective status (docs/06-backend-api.md 5.3, 05-database 5.12): the stored
// status is materialised lazily, so every read derives the status from time. Pure. The SQL twin of
// this rule lives next to the queries that filter by status (infrastructure/admin-bookings.ts).

export const BOOKING_STATUSES = ["confirmed", "active", "completed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

/** `completed` wins when both bounds have passed; cancelled and completed never move. */
export function effectiveStatus(
  stored: BookingStatus,
  startAt: Date,
  endAt: Date,
  now: Date,
): BookingStatus {
  const open = stored === "confirmed" || stored === "active";
  if (open && endAt.getTime() <= now.getTime()) return "completed";
  if (stored === "confirmed" && startAt.getTime() <= now.getTime()) return "active";
  return stored;
}

/** Amount still due (positive), settled (0) or overpaid (negative) (W-D4 balance line). */
export function balanceMinor(totalMinor: number, paidAmountMinor: number, isPaid: boolean): number {
  return totalMinor - (isPaid ? paidAmountMinor : 0);
}
