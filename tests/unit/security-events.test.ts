import { describe, expect, it } from "vitest";

import { ipPrefix } from "../../src/platform/security-events/recorder";

describe("ipPrefix (SR-LOG-03: coarse IP only)", () => {
  it.each([
    ["203.0.113.77", "203.0.113.0/24"],
    ["2001:db8:abcd:12::1", "2001:db8:abcd::/48"],
    ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8:0::/48"],
    ["::1", "0:0:0::/48"],
  ])("reduces %s to %s", (ip, prefix) => {
    expect(ipPrefix(ip)).toBe(prefix);
  });

  it.each([["unknown"], [""], [undefined], ["1:2:3"], ["not-an-ip"]])("drops %s", (ip) => {
    expect(ipPrefix(ip)).toBeNull();
  });
});
