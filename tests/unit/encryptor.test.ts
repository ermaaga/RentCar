import { describe, expect, it } from "vitest";

import { decryptField, encryptField, keyId } from "../../src/platform/crypto/encryptor";

const KEY = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 9);
const AAD = "rc:v1:smtp_password:tenant-a";

describe("field encryption (SR-CRY-01..04)", () => {
  it("round-trips and uses the documented format", () => {
    const value = encryptField("smtp-secret-value", KEY, AAD);
    expect(value).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(value.startsWith(`v1.${keyId(KEY)}.`)).toBe(true);
    expect(decryptField(value, [KEY], AAD)).toBe("smtp-secret-value");
  });

  it("never contains the plaintext", () => {
    const value = encryptField("CANARY_SMTP_1f2e", KEY, AAD);
    expect(value).not.toContain("CANARY_SMTP_1f2e");
  });

  it("gives a different ciphertext for the same plaintext (random nonce)", () => {
    expect(encryptField("same", KEY, AAD)).not.toBe(encryptField("same", KEY, AAD));
  });

  it("refuses a ciphertext moved to another context (AAD)", () => {
    const value = encryptField("secret", KEY, AAD);
    expect(() => decryptField(value, [KEY], "rc:v1:smtp_password:tenant-b")).toThrow();
  });

  it("refuses a modified byte", () => {
    const value = encryptField("secret", KEY, AAD);
    const parts = value.split(".");
    const body = Buffer.from(parts[3] ?? "", "base64url");
    body[0] = (body[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], parts[2], body.toString("base64url")].join(".");
    expect(() => decryptField(tampered, [KEY], AAD)).toThrow();
  });

  it("fails closed for an unknown key and an unknown format", () => {
    const value = encryptField("secret", KEY, AAD);
    expect(() => decryptField(value, [OTHER], AAD)).toThrow("unknown key");
    expect(() => decryptField("plain-text", [KEY], AAD)).toThrow("unknown format");
  });

  it("decrypts with a previous key during rotation", () => {
    const value = encryptField("secret", OTHER, AAD);
    expect(decryptField(value, [KEY, OTHER], AAD)).toBe("secret");
  });
});
