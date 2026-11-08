import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../src/platform/crypto/password";

const PEPPER = "p".repeat(40);
const NEW_PEPPER = "n".repeat(40);

describe("password hashing (ASVS 2.4, SEC-14 pepper)", () => {
  it("hashes with argon2id and the OWASP parameters", async () => {
    const h = await hashPassword("correct horse battery", PEPPER);
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).toContain("m=19456,t=2,p=1");
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const h = await hashPassword("correct horse battery", PEPPER);
    expect(await verifyPassword("correct horse battery", h, [PEPPER])).toBe(true);
    expect(await verifyPassword("correct horse batterY", h, [PEPPER])).toBe(false);
  });

  it("refuses the right password under the wrong pepper", async () => {
    const h = await hashPassword("correct horse battery", PEPPER);
    expect(await verifyPassword("correct horse battery", h, [NEW_PEPPER])).toBe(false);
  });

  it("keeps old hashes valid during pepper rotation (current first, then previous)", async () => {
    const h = await hashPassword("correct horse battery", PEPPER);
    expect(await verifyPassword("correct horse battery", h, [NEW_PEPPER, PEPPER])).toBe(true);
  });

  it("salts each hash, so equal passwords give different hashes", async () => {
    const a = await hashPassword("same password here", PEPPER);
    const b = await hashPassword("same password here", PEPPER);
    expect(a).not.toBe(b);
  });
});
