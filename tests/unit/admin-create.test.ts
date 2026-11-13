import { describe, expect, it } from "vitest";

import { adminBookingInput } from "../../src/modules/booking/application/admin-booking-input";
import { checkPeriod } from "../../src/modules/booking/domain/period-rules";
import { notesText } from "../../src/shared/text";

// BKG-06 pure rules: staff period exceptions (A-24), notes text, the strict staff form.
const rules = { minRentalDays: 1, maxRentalDays: 30, leadTimeMinutes: 120 };
const now = new Date("2026-06-01T08:00:00Z");
const ctx = { now, timeZone: "Europe/Rome" };
const at = (iso: string) => new Date(iso);

describe("checkPeriod for staff", () => {
  it("accepts a past pickup without lead time, but keeps the lead time for future pickups", () => {
    const past = { start: at("2026-05-20T08:00:00Z"), end: at("2026-05-22T08:00:00Z") };
    expect(checkPeriod(past, rules, ctx)).toEqual({ ok: false, code: "PICKUP_IN_PAST" });
    expect(checkPeriod(past, rules, { ...ctx, staff: true })).toEqual({ ok: true, billedDays: 3 });
    const soon = { start: at("2026-06-01T09:00:00Z"), end: at("2026-06-02T09:00:00Z") };
    expect(checkPeriod(soon, rules, { ...ctx, staff: true })).toEqual({
      ok: false,
      code: "LEAD_TIME_NOT_MET",
    });
  });

  it("still applies the duration rules", () => {
    const long = { start: at("2026-05-01T08:00:00Z"), end: at("2026-05-31T08:00:00Z") };
    expect(checkPeriod(long, rules, { ...ctx, staff: true })).toEqual({
      ok: false,
      code: "DURATION_TOO_LONG",
    });
  });
});

describe("notesText", () => {
  it("keeps line breaks, normalises CRLF and refuses controls and card numbers", () => {
    expect(notesText(100).parse(" Child seat\r\nRoof box ")).toBe("Child seat\nRoof box");
    expect(notesText(100).safeParse("a\u0000b").success).toBe(false);
    expect(notesText(100).safeParse("card 4111 1111 1111 1111").success).toBe(false);
    expect(notesText(5).safeParse("123456").success).toBe(false);
  });
});

describe("adminBookingInput", () => {
  const valid = {
    vehicleId: "00000000-0000-4000-8000-000000000001",
    firstName: " Anna ",
    lastName: "Bianchi",
    phone: "333 765 4321",
    email: "",
    paid: "card",
    notes: "",
  };

  it("parses the staff form with an optional payment and empty notes", () => {
    expect(adminBookingInput.parse(valid)).toEqual({
      vehicleId: valid.vehicleId,
      firstName: "Anna",
      lastName: "Bianchi",
      phone: "333 765 4321",
      email: undefined,
      paid: "card",
      notes: null,
    });
    expect(adminBookingInput.parse({ ...valid, paid: "" }).paid).toBeNull();
  });

  it("refuses unknown keys, a bad payment method and a client-chosen status", () => {
    expect(adminBookingInput.safeParse({ ...valid, paid: "cheque" }).success).toBe(false);
    expect(adminBookingInput.safeParse({ ...valid, status: "completed" }).success).toBe(false);
  });
});
