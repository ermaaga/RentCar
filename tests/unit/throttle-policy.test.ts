import { describe, expect, it } from "vitest";

import {
  bucketExpiry,
  retryAfterSeconds,
  windowStart,
} from "../../src/modules/auth/domain/throttle-policy";

describe("login throttle windows (SR-AUT-05)", () => {
  it("aligns to fixed 15-minute windows", () => {
    expect(windowStart(new Date("2026-11-09T10:07:31Z")).toISOString()).toBe(
      "2026-11-09T10:00:00.000Z",
    );
    expect(windowStart(new Date("2026-11-09T10:15:00Z")).toISOString()).toBe(
      "2026-11-09T10:15:00.000Z",
    );
  });

  it("keeps counters for the window plus one hour before purging", () => {
    const window = new Date("2026-11-09T10:00:00Z");
    expect(bucketExpiry(window).toISOString()).toBe("2026-11-09T11:15:00.000Z");
  });

  it("reports the seconds until the window rolls over, at least 1", () => {
    expect(retryAfterSeconds(new Date("2026-11-09T10:14:30Z"))).toBe(30);
    expect(retryAfterSeconds(new Date("2026-11-09T10:14:59.999Z"))).toBe(1);
  });
});
