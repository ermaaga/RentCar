import { describe, expect, it } from "vitest";

import { checkPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../src/modules/auth";

describe("password policy (ASVS 2.1)", () => {
  it("accepts exactly the minimum length without composition rules", () => {
    expect(checkPassword("a".repeat(PASSWORD_MIN_LENGTH))).toEqual({ ok: true });
  });

  it("rejects one character below the minimum", () => {
    expect(checkPassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      ok: false,
      problems: ["too_short"],
    });
  });

  it("accepts the maximum and rejects one above it", () => {
    expect(checkPassword("b".repeat(PASSWORD_MAX_LENGTH))).toEqual({ ok: true });
    expect(checkPassword("b".repeat(PASSWORD_MAX_LENGTH + 1))).toEqual({
      ok: false,
      problems: ["too_long"],
    });
  });

  it("counts code points, so one accented letter is one character", () => {
    expect(checkPassword("è".repeat(PASSWORD_MIN_LENGTH))).toEqual({ ok: true });
    expect(checkPassword("è".repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      ok: false,
      problems: ["too_short"],
    });
  });

  it("rejects a whitespace-only password", () => {
    const result = checkPassword(" ".repeat(20));
    expect(result).toEqual({ ok: false, problems: ["blank"] });
  });

  it("does not require digits or symbols", () => {
    expect(checkPassword("correct horse battery")).toEqual({ ok: true });
  });
});
