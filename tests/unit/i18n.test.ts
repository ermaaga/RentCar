import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";

describe("message catalog", () => {
  const t = getTranslator("en");

  it("returns the English text for a known key", () => {
    expect(t("home.title")).toBe("RentCar");
  });

  it("refuses an unknown key at compile time (checked by tsc), and at run time", () => {
    // @ts-expect-error: "home.missing" is not a catalog key, so it must not type-check.
    expect(() => t("home.missing")).toThrow("missing message key: home.missing");
  });
});
