import * as crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { runRequest } from "../../src/modules/jobs";
import { dayKey, expiryKey, hourKey, lockKey } from "../../src/modules/jobs/domain/catalogue";
import { bearerMatches } from "../../src/platform/crypto/bearer";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "s".repeat(40);

describe("bearerMatches (ABU-M1-26, ABU-M1-27)", () => {
  it("accepts exactly the configured secret", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["no header", null],
    ["empty header", ""],
    ["wrong secret", "Bearer wrong"],
    ["secret without scheme", SECRET],
    ["lower-case scheme", `bearer ${SECRET}`],
    ["basic scheme", `Basic ${SECRET}`],
    ["trailing data", `Bearer ${SECRET} x`],
    ["prefix of the secret", `Bearer ${SECRET.slice(0, 20)}`],
  ])("refuses %s", (_label, header) => {
    expect(bearerMatches(header, SECRET)).toBe(false);
  });

  it("compares equal-length SHA-256 digests with timingSafeEqual", () => {
    const spy = vi.mocked(crypto.timingSafeEqual);
    spy.mockClear();
    bearerMatches("Bearer short", SECRET);
    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0] ?? [];
    expect((a as Buffer).length).toBe(32);
    expect((b as Buffer).length).toBe(32);
  });
});

describe("job period keys", () => {
  const now = new Date("2026-11-09T14:35:10Z");

  it("uses UTC hour and day keys", () => {
    expect(hourKey(now)).toBe("2026-11-09T14");
    expect(dayKey(now)).toBe("2026-11-09");
  });

  it("gives a renewed subscription a new expiry key", () => {
    expect(expiryKey("a", "2026-10-31")).not.toBe(expiryKey("a", "2027-10-31"));
  });

  it("locks per tenant so two tenants never skip each other", () => {
    expect(lockKey("retention_hourly", "t1", "k")).not.toBe(lockKey("retention_hourly", "t2", "k"));
    expect(lockKey("retention_hourly", null, "k")).toBe("job:retention_hourly:platform:k");
  });
});

describe("runRequest", () => {
  it("accepts an empty body and a named job list", () => {
    expect(runRequest.safeParse({}).success).toBe(true);
    expect(
      runRequest.safeParse({ jobs: ["retention_daily"], tenantSlug: "rent-roma" }).success,
    ).toBe(true);
  });

  it.each([
    [{ jobs: ["drop_tables"] }],
    [{ jobs: [] }],
    [{ tenantSlug: "Rent Roma" }],
    [{ secret: "x" }],
  ])("rejects %j", (body) => {
    expect(runRequest.safeParse(body).success).toBe(false);
  });
});
