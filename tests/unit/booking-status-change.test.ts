import { describe, expect, it } from "vitest";

import { decidePayment, decideStatusChange } from "../../src/modules/booking/domain/status-change";

// BKG-09/10 rules (docs/06-backend-api.md 5.3): transitions from the effective status, early
// completion re-pricing in the tenant zone, payment at the current total.
const zone = "Europe/Rome";
const booking = {
  status: "confirmed" as const,
  startAt: new Date("2026-06-03T08:00:00Z"), // 10:00 in Rome
  endAt: new Date("2026-06-06T08:00:00Z"),
  dailyPriceMinor: 4000,
  isPaid: false,
};
const before = new Date("2026-06-02T08:00:00Z");
const during = new Date("2026-06-04T12:00:00Z");
const after = new Date("2026-06-07T08:00:00Z");

describe("decideStatusChange", () => {
  it("marks a future booking active and refuses to complete it before the start", () => {
    expect(decideStatusChange(booking, "active", before, zone)).toMatchObject({
      kind: "change",
      effective: "confirmed",
      status: "active",
    });
    expect(decideStatusChange(booking, "complete", before, zone)).toEqual({
      kind: "error",
      code: "BOOKING_COMPLETE_BEFORE_START",
    });
  });

  it("completes early with the days touched so far at the booking's own price", () => {
    expect(decideStatusChange(booking, "complete", during, zone)).toMatchObject({
      kind: "change",
      effective: "active",
      status: "completed",
      shortened: { endAt: during, billedDays: 2, totalMinor: 8000 },
    });
  });
});

describe("decideStatusChange: no-ops and refusals", () => {
  it("is a no-op when the target is already the effective status", () => {
    expect(decideStatusChange(booking, "active", during, zone)).toEqual({
      kind: "noop",
      effective: "active",
    });
    expect(decideStatusChange(booking, "complete", after, zone)).toEqual({
      kind: "noop",
      effective: "completed",
    });
  });

  it("cancels open bookings only, and warns about refunds when paid", () => {
    expect(decideStatusChange({ ...booking, isPaid: true }, "cancel", during, zone)).toMatchObject({
      kind: "change",
      status: "cancelled",
      refundOutsideSystem: true,
    });
    expect(decideStatusChange(booking, "cancel", after, zone)).toEqual({
      kind: "error",
      code: "BOOKING_INVALID_TRANSITION",
    });
    expect(decideStatusChange(booking, "active", after, zone)).toEqual({
      kind: "error",
      code: "BOOKING_INVALID_TRANSITION",
    });
    expect(decideStatusChange({ ...booking, status: "cancelled" }, "active", before, zone)).toEqual(
      {
        kind: "error",
        code: "BOOKING_NOT_EDITABLE",
      },
    );
  });
});

describe("decidePayment", () => {
  it("records the current total, needs a confirmation to clear, and refuses cancelled bookings", () => {
    const open = { status: "active" as const, totalMinor: 12000 };
    expect(decidePayment(open, { paid: true, method: "cash" })).toEqual({
      kind: "set",
      isPaid: true,
      method: "cash",
      paidAmountMinor: 12000,
    });
    expect(decidePayment(open, { paid: false, confirm: false })).toEqual({
      kind: "error",
      code: "PAYMENT_CONFIRMATION_REQUIRED",
    });
    expect(decidePayment(open, { paid: false, confirm: true })).toMatchObject({
      isPaid: false,
      paidAmountMinor: 0,
    });
    expect(
      decidePayment({ status: "cancelled", totalMinor: 1 }, { paid: true, method: "card" }),
    ).toEqual({
      kind: "error",
      code: "BOOKING_NOT_EDITABLE",
    });
  });
});
