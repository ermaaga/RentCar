import { createHash, randomBytes } from "node:crypto";

/** 256-bit opaque token, URL-safe. Shown to the client once; the server keeps only its hash. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of the token as bytes: the value stored in sessions.token_hash (32 bytes, 05-database 5.6). */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
