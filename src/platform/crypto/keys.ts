import { createHmac, hkdfSync } from "node:crypto";

/** Derives a purpose-specific key from the master encryption key (HKDF-SHA-256, SR-CRY-02). */
export function deriveKey(master: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.alloc(0), `rentcar:${purpose}`, 32),
  );
}

/** HMAC-SHA256 hex of a value (64 characters): used for rate-limit keys so no plain identity is stored. */
export function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}
