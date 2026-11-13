import { effectiveStatus, type BookingStatus } from "./booking-status";
import { billedDays } from "./pricing";

// BKG-09 and BKG-10 rules (docs/06-backend-api.md 5.3 table, FR-BKG-03/04/07/09): what a staff
// status change or payment change does to a booking, decided from its stored state and the time.
// Pure; the transaction applies the outcome and writes the audit rows.

export type StatusTarget = "active" | "complete" | "cancel";

export interface BookingState {
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  dailyPriceMinor: number;
  isPaid: boolean;
}

export type StatusError =
  "BOOKING_INVALID_TRANSITION" | "BOOKING_COMPLETE_BEFORE_START" | "BOOKING_NOT_EDITABLE";

export type StatusOutcome =
  | { kind: "noop"; effective: BookingStatus }
  | {
      kind: "change";
      effective: BookingStatus;
      status: BookingStatus;
      /** Early completion: the rental ends now and is billed for the days it touched. */
      shortened: { endAt: Date; billedDays: number; totalMinor: number } | null;
      /** Cancelling a paid booking: the UI says refunds happen outside RentCar. */
      refundOutsideSystem: boolean;
    };

const TARGET_STATUS: Record<StatusTarget, BookingStatus> = {
  active: "active",
  complete: "completed",
  cancel: "cancelled",
};

/** Which effective statuses each target can start from. */
const ALLOWED_FROM: Record<StatusTarget, readonly BookingStatus[]> = {
  active: ["confirmed"],
  complete: ["active"],
  cancel: ["confirmed", "active"],
};

function shortenedIfEarly(b: BookingState, now: Date, timeZone: string) {
  if (now.getTime() >= b.endAt.getTime()) return null;
  const days = billedDays(b.startAt, now, timeZone);
  return { endAt: now, billedDays: days, totalMinor: days * b.dailyPriceMinor };
}

export function decideStatusChange(
  b: BookingState,
  target: StatusTarget,
  now: Date,
  timeZone: string,
): StatusOutcome | { kind: "error"; code: StatusError } {
  const effective = effectiveStatus(b.status, b.startAt, b.endAt, now);
  if (effective === "cancelled") return { kind: "error", code: "BOOKING_NOT_EDITABLE" };
  if (effective === TARGET_STATUS[target]) return { kind: "noop", effective };
  if (target === "complete" && effective === "confirmed") {
    return { kind: "error", code: "BOOKING_COMPLETE_BEFORE_START" };
  }
  if (!ALLOWED_FROM[target].includes(effective)) {
    return { kind: "error", code: "BOOKING_INVALID_TRANSITION" };
  }
  return {
    kind: "change",
    effective,
    status: TARGET_STATUS[target],
    shortened: target === "complete" ? shortenedIfEarly(b, now, timeZone) : null,
    refundOutsideSystem: target === "cancel" && b.isPaid,
  };
}

export type PaymentChange =
  { paid: true; method: "card" | "cash" } | { paid: false; confirm: boolean };

export type PaymentOutcome =
  | { kind: "error"; code: "BOOKING_NOT_EDITABLE" | "PAYMENT_CONFIRMATION_REQUIRED" }
  | { kind: "set"; isPaid: boolean; method: "card" | "cash" | null; paidAmountMinor: number };

/** BKG-10: paid means paid in full at the current total (US-143); clearing needs a confirmation. */
export function decidePayment(
  b: { status: BookingStatus; totalMinor: number },
  change: PaymentChange,
): PaymentOutcome {
  if (b.status === "cancelled") return { kind: "error", code: "BOOKING_NOT_EDITABLE" };
  if (change.paid) {
    return { kind: "set", isPaid: true, method: change.method, paidAmountMinor: b.totalMinor };
  }
  if (!change.confirm) return { kind: "error", code: "PAYMENT_CONFIRMATION_REQUIRED" };
  return { kind: "set", isPaid: false, method: null, paidAmountMinor: 0 };
}
