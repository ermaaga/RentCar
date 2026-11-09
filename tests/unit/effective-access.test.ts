import { describe, expect, it } from "vitest";

import {
  assertWritable,
  canTakeBookings,
  getEffectiveAccess,
  type SubscriptionPeriod,
} from "../../src/modules/subscriptions";
import { localDate } from "../../src/modules/subscriptions/domain/effective-access";

// docs/06-backend-api.md 4.4: one row per input condition, evaluated in the tenant time zone.
const tenant = { status: "active" as const, timeZone: "Europe/Rome" };
const sub = (startDate: string, endDate: string, status: "active" | "cancelled" = "active") =>
  ({ startDate, endDate, status }) satisfies SubscriptionPeriod;
// Noon in Rome on the given local date.
const on = (date: string) => new Date(`${date}T11:00:00Z`);

describe("effective access: states", () => {
  it("is active well before the end date", () => {
    expect(getEffectiveAccess(tenant, [sub("2026-01-01", "2026-12-31")], on("2026-06-01"))).toEqual(
      { state: "active" },
    );
  });

  it("is renewal_due within 14 days of the end, counting the end date itself", () => {
    const subs = [sub("2026-01-01", "2026-12-31")];
    expect(getEffectiveAccess(tenant, subs, on("2026-12-17"))).toEqual({ state: "active" });
    expect(getEffectiveAccess(tenant, subs, on("2026-12-18"))).toEqual({
      state: "renewal_due",
      daysLeft: 14,
    });
    expect(getEffectiveAccess(tenant, subs, on("2026-12-31"))).toEqual({
      state: "renewal_due",
      daysLeft: 1,
    });
  });

  it("gives 7 days of grace, then read only", () => {
    const subs = [sub("2026-01-01", "2026-12-31")];
    expect(getEffectiveAccess(tenant, subs, on("2027-01-01"))).toEqual({
      state: "grace",
      graceEndsOn: "2027-01-08",
    });
    expect(getEffectiveAccess(tenant, subs, on("2027-01-07")).state).toBe("grace");
    expect(getEffectiveAccess(tenant, subs, on("2027-01-08"))).toEqual({
      state: "read_only_expired",
    });
  });
});

describe("effective access: read-only states", () => {
  it("has no grace for a cancelled subscription and is read only without any", () => {
    const cancelled = [sub("2026-01-01", "2026-12-31", "cancelled")];
    expect(getEffectiveAccess(tenant, cancelled, on("2026-06-01")).state).toBe(
      "read_only_cancelled",
    );
    expect(getEffectiveAccess(tenant, [], on("2026-06-01")).state).toBe(
      "read_only_no_subscription",
    );
  });

  it("treats a future start as active and suspension as overriding everything", () => {
    expect(getEffectiveAccess(tenant, [sub("2027-01-01", "2027-12-31")], on("2026-06-01"))).toEqual(
      { state: "active" },
    );
    const suspended = { ...tenant, status: "suspended" as const };
    expect(
      getEffectiveAccess(suspended, [sub("2026-01-01", "2026-12-31")], on("2026-06-01")),
    ).toEqual({ state: "suspended" });
  });
});

describe("effective access: choosing the current subscription", () => {
  it("prefers the one containing today over a cancelled or a later one", () => {
    const subs = [
      sub("2025-01-01", "2025-12-31", "cancelled"),
      sub("2026-01-01", "2026-06-30"),
      sub("2026-07-01", "2026-12-31"),
    ];
    expect(getEffectiveAccess(tenant, subs, on("2026-03-01"))).toEqual({ state: "active" });
  });

  it("uses the tenant time zone at midnight", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Rome: the subscription has ended.
    const lateUtc = new Date("2026-12-31T23:30:00Z");
    expect(localDate(lateUtc, "Europe/Rome")).toBe("2027-01-01");
    expect(getEffectiveAccess(tenant, [sub("2026-01-01", "2026-12-31")], lateUtc).state).toBe(
      "grace",
    );
  });
});

describe("read-only policy", () => {
  it("blocks writes in read only, allows ro_allowed, and refuses everything when suspended", () => {
    const readOnly = { state: "read_only_expired" } as const;
    expect(assertWritable(readOnly, "write")).toEqual({ ok: false, code: "TENANT_READ_ONLY" });
    expect(assertWritable(readOnly, "ro_allowed")).toEqual({ ok: true });
    expect(assertWritable(readOnly, "read")).toEqual({ ok: true });
    expect(assertWritable({ state: "terminated" }, "read")).toEqual({
      ok: false,
      code: "TENANT_UNAVAILABLE",
    });
    expect(assertWritable({ state: "grace", graceEndsOn: "2027-01-08" }, "write")).toEqual({
      ok: true,
    });
  });

  it("takes bookings only while active, renewal due or in grace", () => {
    expect(canTakeBookings({ state: "grace", graceEndsOn: "2027-01-08" })).toBe(true);
    expect(canTakeBookings({ state: "read_only_cancelled" })).toBe(false);
    expect(canTakeBookings({ state: "suspended" })).toBe(false);
  });
});
