import { describe, expect, it } from "vitest";

import { assertSeedAllowed } from "../../scripts/seed";

describe("seed guard", () => {
  it.each(["local", "ci"])("allows %s", (env) => {
    expect(() => {
      assertSeedAllowed(env);
    }).not.toThrow();
  });

  it.each(["staging", "production", undefined, ""])("refuses %s", (env) => {
    expect(() => {
      assertSeedAllowed(env);
    }).toThrow("seed refused");
  });
});
