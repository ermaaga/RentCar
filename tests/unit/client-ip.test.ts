import { describe, expect, it } from "vitest";

import { clientIp } from "../../src/platform/host/client-ip";

// SR-RL-02 / PB-08 / ABU-M1-06: the client IP is the entry added by the outermost trusted hop.
const h = (xff: string | null) => ({ get: () => xff });

describe("clientIp", () => {
  it("never trusts the leftmost value the client sent", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(h("1.1.1.1, 2.2.2.2, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });

  it("rotating spoofed values keeps the same key", () => {
    const keys = ["1.1.1.1", "9.9.9.9", "garbage"].map((spoof) =>
      clientIp(h(`${spoof}, 198.51.100.7`), 1),
    );
    expect(new Set(keys)).toEqual(new Set(["198.51.100.7"]));
  });

  it("with two trusted hops takes the entry the outer proxy added", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
  });

  it("falls back to one shared unknown bucket", () => {
    expect(clientIp(h(null), 1)).toBe("unknown");
    expect(clientIp(h("not an ip"), 1)).toBe("unknown");
    expect(clientIp(h("203.0.113.9"), 3)).toBe("unknown");
  });
});
