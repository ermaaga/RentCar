import { describe, expect, it } from "vitest";

import { codeFromBytes, normalizeCode } from "../../src/modules/booking/domain/booking-code";
import { localDayNumber, parseLocal } from "../../src/modules/booking/domain/local-time";
import { checkPeriod } from "../../src/modules/booking/domain/period-rules";
import { billedDays, price } from "../../src/modules/booking/domain/pricing";

const ROME = "Europe/Rome";
const at = (local: string) => {
  const d = parseLocal(local, ROME);
  if (!d) throw new Error(`bad local time ${local}`);
  return d;
};

describe("parseLocal", () => {
  it("converts a Rome wall-clock time in summer and in winter", () => {
    expect(at("2026-06-01T10:00").toISOString()).toBe("2026-06-01T08:00:00.000Z");
    expect(at("2026-12-01T10:00").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("refuses a time skipped by the spring-forward change and malformed input", () => {
    expect(parseLocal("2026-03-29T02:30", ROME)).toBeNull();
    expect(parseLocal("2026-02-30T10:00", ROME)).toBeNull();
    expect(parseLocal("2026-06-01 10:00", ROME)).toBeNull();
    expect(parseLocal("", ROME)).toBeNull();
  });

  it("takes the first instant of an ambiguous fall-back time", () => {
    expect(at("2026-10-25T02:30").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("counts local days, not UTC days", () => {
    const lateEvening = new Date("2026-06-01T23:30:00Z"); // 01:30 on 2 June in Rome
    expect(localDayNumber(lateEvening, ROME) - localDayNumber(lateEvening, "UTC")).toBe(1);
  });
});

describe("billed days (REQ-1, A-11)", () => {
  it.each([
    ["2026-06-01T10:00", "2026-06-03T10:30", 3], // REQ-1 example
    ["2026-06-01T10:00", "2026-06-01T18:00", 1], // same day
    ["2026-06-01T10:00", "2026-06-02T00:00", 1], // return at 00:00 does not touch the new day
    ["2026-06-01T10:00", "2026-06-02T00:01", 2],
    ["2026-03-28T10:00", "2026-03-30T09:00", 3], // across the DST change
  ])("%s -> %s is %i days", (from, to, days) => {
    expect(billedDays(at(from), at(to), ROME)).toBe(days);
  });

  it("multiplies the days by the daily price", () => {
    expect(
      price({ start: at("2026-06-01T10:00"), end: at("2026-06-03T10:30") }, 4550, ROME),
    ).toEqual({
      billedDays: 3,
      dailyPriceMinor: 4550,
      totalMinor: 13650,
    });
  });
});

describe("booking codes", () => {
  it("maps 10 bytes to 10 Crockford symbols", () => {
    expect(codeFromBytes(new Uint8Array([0, 1, 2, 31, 32, 63, 10, 18, 22, 255]))).toBe(
      "012Z0ZAJPZ",
    );
    expect(() => codeFromBytes(new Uint8Array(5))).toThrow();
  });

  it("normalises user input (case, separators, O, I and L)", () => {
    expect(normalizeCode("k7m2-9qxa0o")).toBe("K7M29QXA00");
    expect(normalizeCode("abc-def-ghil")).toBe("ABCDEFGH11");
    expect(normalizeCode("too short")).toBeNull();
    expect(normalizeCode("UUUUUUUUUU")).toBeNull();
  });
});

describe("period rules (06-backend-api 5.2)", () => {
  const rules = { minRentalDays: 2, maxRentalDays: 5, leadTimeMinutes: 120 };
  const ctx = { now: at("2026-06-01T08:00"), timeZone: ROME };
  const check = (from: string, to: string) =>
    checkPeriod({ start: at(from), end: at(to) }, rules, ctx);

  it.each([
    ["2026-06-02T10:00", "2026-06-02T09:00", "RETURN_BEFORE_PICKUP"],
    ["2026-06-01T07:00", "2026-06-03T10:00", "PICKUP_IN_PAST"],
    ["2026-06-01T09:00", "2026-06-03T10:00", "LEAD_TIME_NOT_MET"],
    ["2028-07-01T10:00", "2028-07-03T10:00", "PERIOD_TOO_FAR"],
    ["2026-06-02T10:00", "2026-06-02T18:00", "DURATION_TOO_SHORT"],
    ["2026-06-02T10:00", "2026-06-08T10:00", "DURATION_TOO_LONG"],
  ])("%s -> %s gives %s", (from, to, code) => {
    expect(check(from, to)).toEqual({ ok: false, code });
  });

  it("accepts a valid period with its billed days", () => {
    expect(check("2026-06-01T10:00", "2026-06-03T09:00")).toEqual({ ok: true, billedDays: 3 });
  });
});
