import { createHash, timingSafeEqual } from "node:crypto";

// Shared-secret check for machine callers (docs/06-backend-api.md JOB-01). Both sides are hashed to
// SHA-256 first, so the comparison is constant-time and does not leak the secret's length.
const BEARER = /^Bearer ([\x21-\x7e]{1,512})$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** True when the Authorization header carries exactly `Bearer <secret>`. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const presented = BEARER.exec(header ?? "")?.[1] ?? "";
  const equal = timingSafeEqual(digest(presented), digest(secret));
  return equal && presented.length > 0;
}
