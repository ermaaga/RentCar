import { describe, expect, it } from "vitest";

import { checkSlug, createTenantInput } from "../../src/modules/tenancy";
import { validTenantInput } from "../support/tenant-input";

describe("tenant slug", () => {
  it("accepts a plain slug and refuses malformed or reserved ones", () => {
    expect(checkSlug("rent-roma")).toEqual({ ok: true });
    expect(checkSlug("Rent")).toEqual({ ok: false, reason: "invalid" });
    expect(checkSlug("-rent")).toEqual({ ok: false, reason: "invalid" });
    expect(checkSlug("re--nt")).toEqual({ ok: false, reason: "invalid" });
    expect(checkSlug("ab")).toEqual({ ok: false, reason: "invalid" });
    expect(checkSlug("system")).toEqual({ ok: false, reason: "reserved" });
    expect(checkSlug("api")).toEqual({ ok: false, reason: "reserved" });
  });
});

describe("create tenant input", () => {
  it("accepts a valid input and lowercases the admin username", () => {
    const parsed = createTenantInput.parse(validTenantInput);
    expect(parsed.admin.username).toBe("mario.rossi");
  });

  it("refuses unknown keys, an unknown time zone, a missing DPA and a partial address", () => {
    const bad = [
      { ...validTenantInput, extra: 1 },
      { ...validTenantInput, timeZone: "Mars/Olympus" },
      { ...validTenantInput, dpaSigned: false },
      { ...validTenantInput, address: { street: "Via Roma 1" } },
    ];
    for (const input of bad) {
      expect(createTenantInput.safeParse(input).success).toBe(false);
    }
  });
});
