import { describe, expect, it } from "vitest";

import { checkFormToken, issueFormToken, publicBookingInput } from "../../src/modules/booking";
import { normalizePhone } from "../../src/modules/booking/domain/phone";

const key = Buffer.alloc(32, 7);
const tenantId = "00000000-0000-4000-8000-000000000001";
const vehicleId = "00000000-0000-4000-8000-000000000002";
const t0 = new Date("2026-06-01T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("phone normalisation (E.164)", () => {
  it("keeps international numbers and reads 00 as +", () => {
    expect(normalizePhone("+39 333 123 4567")).toBe("+393331234567");
    expect(normalizePhone("0039 (333) 123-4567")).toBe("+393331234567");
  });

  it("adds the tenant calling code to national numbers", () => {
    expect(normalizePhone("333 1234567", "IT")).toBe("+393331234567");
    expect(normalizePhone("06 1234 5678", "IT")).toBe("+390612345678");
    expect(normalizePhone("07700 900123", "GB")).toBe("+447700900123");
  });

  it("refuses numbers it cannot place or that are not E.164", () => {
    expect(normalizePhone("3331234567")).toBeNull();
    expect(normalizePhone("3331234567", "US")).toBeNull();
    expect(normalizePhone("+0123")).toBeNull();
    expect(normalizePhone("+39 abc")).toBeNull();
  });
});

describe("booking form token", () => {
  const token = issueFormToken(key, { tenantId, vehicleId, now: t0 });

  it("accepts its own token after the minimum fill time and carries an idempotency key", () => {
    const check = checkFormToken(key, token, { tenantId, vehicleId, now: at(5_000) });
    expect(check.ok).toBe(true);
    expect(check.ok && check.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("flags a submit faster than 3 s and a token older than 2 h", () => {
    expect(checkFormToken(key, token, { tenantId, vehicleId, now: at(1_000) })).toEqual({
      ok: false,
      reason: "too_fast",
    });
    expect(checkFormToken(key, token, { tenantId, vehicleId, now: at(3 * 3_600_000) })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses another tenant, another vehicle, another key and a modified token", () => {
    const now = at(5_000);
    const invalid = { ok: false, reason: "invalid" };
    expect(checkFormToken(key, token, { tenantId: vehicleId, vehicleId, now })).toEqual(invalid);
    expect(checkFormToken(key, token, { tenantId, vehicleId: tenantId, now })).toEqual(invalid);
    expect(checkFormToken(Buffer.alloc(32, 8), token, { tenantId, vehicleId, now })).toEqual(
      invalid,
    );
    expect(checkFormToken(key, `x${token}`, { tenantId, vehicleId, now })).toEqual(invalid);
    expect(checkFormToken(key, "garbage", { tenantId, vehicleId, now })).toEqual(invalid);
  });
});

describe("public booking input", () => {
  const valid = {
    formToken: "t",
    vehicleId,
    pickup: "2026-06-03T10:00",
    return: "2026-06-05T10:00",
    expectedTotalMinor: "8000",
    firstName: " Mario ",
    lastName: "Rossi",
    phone: "+39 333 1234567",
    email: "",
    acknowledge: true,
  };

  it("trims names, coerces the total and drops an empty email", () => {
    const parsed = publicBookingInput.parse(valid);
    expect(parsed.firstName).toBe("Mario");
    expect(parsed.expectedTotalMinor).toBe(8000);
    expect(parsed.email).toBeUndefined();
    expect(publicBookingInput.parse({ ...valid, email: "A@B.test" }).email).toBe("a@b.test");
  });

  it("normalises names to NFC and refuses control and bidi characters (ABU-M2-05)", () => {
    const decomposed = "Jose\u0301";
    expect(publicBookingInput.parse({ ...valid, firstName: decomposed }).firstName).toBe(
      "Jos\u00e9",
    );
    for (const bad of ["a\u0000b", "a\r\nBcc: x@y.test", "x\u202ey", "a\u2066b", "a\u0085b"]) {
      expect(publicBookingInput.safeParse({ ...valid, lastName: bad }).success, bad).toBe(false);
    }
    expect(publicBookingInput.safeParse({ ...valid, firstName: "x".repeat(10_000) }).success).toBe(
      false,
    );
    expect(publicBookingInput.safeParse({ ...valid, phone: ["+39", "333"] }).success).toBe(false);
    expect(publicBookingInput.parse({ ...valid, firstName: "Zoë 🚗" }).firstName).toBe("Zoë 🚗");
  });

  it("requires the acknowledgement and refuses unknown keys", () => {
    expect(publicBookingInput.safeParse({ ...valid, acknowledge: false }).success).toBe(false);
    expect(publicBookingInput.safeParse({ ...valid, website: "x" }).success).toBe(false);
  });
});
