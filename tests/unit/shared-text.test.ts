import { describe, expect, it } from "vitest";

import { hasControl, singleLineText } from "../../src/shared/text";

// SR-VAL-04 single-line text rules shared by the vehicle and public booking inputs.

describe("hasControl", () => {
  it("flags C0 and C1 controls, line separators and bidi overrides or isolates", () => {
    for (const ch of ["\u0000", "\t", "\n", "\u007f", "\u0085", "\u2028", "\u202a", "\u2069"]) {
      expect(hasControl(`a${ch}b`), JSON.stringify(ch)).toBe(true);
    }
  });

  it("accepts letters, accents and emoji", () => {
    expect(hasControl("Zoë Müller-Łukasz 🚗")).toBe(false);
  });
});

describe("singleLineText", () => {
  it("trims, normalises to NFC and checks the length afterwards", () => {
    expect(singleLineText(1, 4).parse("  José ")).toBe("José");
    expect(singleLineText(1, 4).safeParse("   ").success).toBe(false);
    expect(singleLineText(1, 4).safeParse("abcde").success).toBe(false);
  });
});
