import { describe, expect, it } from "vitest";

import {
  adminBookingQueryString,
  parseAdminBookingQuery,
} from "../../src/modules/booking/application/admin-booking-query";
import { balanceMinor, effectiveStatus } from "../../src/modules/booking/domain/booking-status";

// Booking state machine (06-backend-api 5.3) and the W-D3 list query.

describe("effectiveStatus", () => {
  const start = new Date("2026-06-03T08:00:00Z");
  const end = new Date("2026-06-05T08:00:00Z");
  const at = (iso: string) => new Date(iso);

  it("derives active and completed from time for open bookings", () => {
    expect(effectiveStatus("confirmed", start, end, at("2026-06-02T00:00:00Z"))).toBe("confirmed");
    expect(effectiveStatus("confirmed", start, end, start)).toBe("active");
    expect(effectiveStatus("confirmed", start, end, end)).toBe("completed");
    expect(effectiveStatus("active", start, end, at("2026-06-01T00:00:00Z"))).toBe("active");
    expect(effectiveStatus("active", start, end, end)).toBe("completed");
  });

  it("never moves cancelled or completed bookings", () => {
    expect(effectiveStatus("cancelled", start, end, end)).toBe("cancelled");
    expect(effectiveStatus("completed", start, end, at("2026-06-01T00:00:00Z"))).toBe("completed");
  });
});

describe("balanceMinor", () => {
  it("is the total when unpaid, and due, zero or overpaid when paid", () => {
    expect(balanceMinor(12000, 0, false)).toBe(12000);
    expect(balanceMinor(12000, 8000, true)).toBe(4000);
    expect(balanceMinor(12000, 12000, true)).toBe(0);
    expect(balanceMinor(8000, 12000, true)).toBe(-4000);
  });
});

describe("parseAdminBookingQuery", () => {
  it("reads every filter and writes the same canonical query back", () => {
    const q = parseAdminBookingQuery({
      q: " Rossi ",
      status: ["active", "confirmed,active"],
      from: "2026-06-01",
      to: "2026-06-30",
      vehicle: "0000000A-0000-4000-8000-000000000000",
      sort: "total-asc",
      page: "3",
    });
    expect(q).toEqual({
      q: "Rossi",
      statuses: ["confirmed", "active"],
      from: "2026-06-01",
      to: "2026-06-30",
      vehicleId: "0000000a-0000-4000-8000-000000000000",
      sort: "total",
      dir: "asc",
      page: 3,
    });
    expect(
      parseAdminBookingQuery(Object.fromEntries(new URLSearchParams(adminBookingQueryString(q)))),
    ).toEqual(q);
  });
});

describe("parseAdminBookingQuery: defaults", () => {
  it("falls back to the defaults for unknown or malformed values", () => {
    const q = parseAdminBookingQuery({
      status: "lost",
      from: "2026-13-01",
      vehicle: "x",
      sort: "price; DROP TABLE bookings",
      page: "-2",
      q: "x".repeat(100),
    });
    expect(q).toMatchObject({
      statuses: [],
      from: null,
      vehicleId: null,
      sort: "start",
      dir: "desc",
      page: 1,
    });
    expect(q.q).toHaveLength(64);
    expect(adminBookingQueryString(parseAdminBookingQuery({}))).toBe("");
  });
});

describe("parseAdminBookingQuery: ranges", () => {
  it("swaps a reversed date range and caps the page", () => {
    const q = parseAdminBookingQuery({ from: "2026-07-01", to: "2026-06-01", page: "999999" });
    expect([q.from, q.to, q.page]).toEqual(["2026-06-01", "2026-07-01", 2000]);
  });
});
