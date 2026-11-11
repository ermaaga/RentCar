import { headers } from "next/headers";

import { getContainer } from "@/composition/container";
import { clientIp } from "@/platform/host/client-ip";
import { hitRateLimit, isRateLimited, type RateLimitRule } from "@/platform/rate-limit/postgres";
import { recordSecurityEvent, type SecurityEventInput } from "@/platform/security-events/recorder";

// Request-side helpers for entry points (docs/06-backend-api.md 3.9 and 11.2): the client IP, rate
// limits keyed by it or by another identity, and security events that carry the IP as a prefix + HMAC.

export async function requestIp(): Promise<string> {
  return clientIp(await headers(), getContainer().trustedProxyCount);
}

/**
 * Records one security event with the request IP (or `ip` when the caller captured it earlier, e.g.
 * before `after()`). Never throws.
 */
export async function securityEvent(
  input: Omit<SecurityEventInput, "ip">,
  ip?: string,
): Promise<void> {
  const c = getContainer();
  const address = ip ?? (await requestIp());
  await recordSecurityEvent(c.pool, c.hmacKey, { ...input, ip: address }, c.clock.now());
}

async function exceeded(rule: RateLimitRule, realm: SecurityEventInput["realm"]): Promise<void> {
  await securityEvent({
    event: "ratelimit.exceeded",
    realm,
    outcome: "refused",
    reasonCode: rule.scope,
  });
}

/** True (and a `ratelimit.exceeded` event) when the identity used up the window; counts nothing. */
export async function limitReached(
  rule: RateLimitRule,
  identity: string,
  realm: SecurityEventInput["realm"],
): Promise<boolean> {
  const c = getContainer();
  const limited = await isRateLimited(c.pool, {
    hmacKey: c.hmacKey,
    rule,
    identity,
    now: c.clock.now(),
  });
  if (limited) {
    await exceeded(rule, realm);
  }
  return limited;
}

/** Counts one hit; false (and a `ratelimit.exceeded` event) when this hit crossed the limit. */
export async function consume(
  rule: RateLimitRule,
  identity: string,
  realm: SecurityEventInput["realm"],
): Promise<boolean> {
  const c = getContainer();
  const decision = await hitRateLimit(c.pool, {
    hmacKey: c.hmacKey,
    rule,
    identity,
    now: c.clock.now(),
  });
  if (!decision.allowed) {
    await exceeded(rule, realm);
  }
  return decision.allowed;
}

/** `auth.token.issued` for a credential link (purpose only, never the token). */
export async function tokenIssued(input: {
  realm: SecurityEventInput["realm"];
  reasonCode: "activation" | "admin_access" | "password_reset";
  actorId?: string | null;
  subjectTenantId?: string | null;
  ip?: string;
}): Promise<void> {
  const { ip, ...event } = input;
  await securityEvent({ event: "auth.token.issued", outcome: "success", ...event }, ip);
}

/**
 * Same-origin check for route handlers that change state (docs/06-backend-api.md 10.3 step 1; server
 * actions get the framework's own check): the Origin header must equal APP_BASE_URL's origin.
 */
export function sameOrigin(requestHeaders: Headers): boolean {
  const origin = requestHeaders.get("origin");
  return origin !== null && origin === new URL(getContainer().baseUrl).origin;
}
