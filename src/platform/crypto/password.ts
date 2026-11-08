import { createHmac } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

// Argon2id with the OWASP minimum parameters (19 MiB, 2 iterations, 1 lane).
// The password is first HMAC-ed with the pepper (SEC-14), so a database leak alone is not enough
// to run an offline guessing attack. Argon2 receives the fixed-length HMAC, never the raw password.
const ARGON2 = {
  algorithm: 2, // Argon2id (the const enum is not usable under verbatimModuleSyntax)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

function peppered(password: string, pepper: string): string {
  return createHmac("sha256", pepper).update(password, "utf8").digest("base64");
}

export async function hashPassword(password: string, pepper: string): Promise<string> {
  return hash(peppered(password, pepper), ARGON2);
}

/**
 * Verifies against the current pepper first, then any previous ones (rotation).
 * Returns true when the password matches under any of the given peppers.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  peppers: readonly string[],
): Promise<boolean> {
  for (const pepper of peppers) {
    if (await verify(storedHash, peppered(password, pepper))) {
      return true;
    }
  }
  return false;
}
