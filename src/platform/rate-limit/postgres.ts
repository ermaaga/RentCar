import type pg from "pg";

import { hmacHex } from "../crypto/keys";

// Fixed-window counters in rate_limit_buckets (ADR-0013, docs/06-backend-api.md 3.9). The key is an
// HMAC of `scope:identity`, so no plain identity is stored. One round trip per hit (atomic upsert).

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowMs: number;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

function windowOf(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Counts one hit and decides; the hit that crosses the limit is refused (fail closed on errors). */
export async function hitRateLimit(
  pool: pg.Pool,
  input: { hmacKey: Buffer; rule: RateLimitRule; identity: string; now: Date },
): Promise<RateDecision> {
  const { rule, now } = input;
  const start = windowOf(now, rule.windowMs);
  const key = hmacHex(input.hmacKey, `${rule.scope}:${input.identity}`);
  const res = await pool.query<{ count: number }>(
    `INSERT INTO rate_limit_buckets (key, window_start, count, expires_at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
     RETURNING count`,
    [key, start, new Date(start.getTime() + rule.windowMs + 3_600_000)],
  );
  if ((res.rows[0]?.count ?? Number.MAX_SAFE_INTEGER) <= rule.limit) {
    return { allowed: true };
  }
  const end = start.getTime() + rule.windowMs;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((end - now.getTime()) / 1000)),
  };
}

/** True when the identity already used up the current window (reads only, counts nothing). */
export async function isRateLimited(
  pool: pg.Pool,
  input: { hmacKey: Buffer; rule: RateLimitRule; identity: string; now: Date },
): Promise<boolean> {
  const { rule } = input;
  const res = await pool.query<{ count: number }>(
    "SELECT count FROM rate_limit_buckets WHERE key = $1 AND window_start = $2",
    [hmacHex(input.hmacKey, `${rule.scope}:${input.identity}`), windowOf(input.now, rule.windowMs)],
  );
  return (res.rows[0]?.count ?? 0) >= rule.limit;
}

const HOUR = 3_600_000;

/** Named limits used by the entry points (06-backend-api 3.9). */
export const RATE_LIMITS = {
  resetAccount: { scope: "auth.reset.account", limit: 3, windowMs: HOUR },
  resetIp: { scope: "auth.reset.ip", limit: 10, windowMs: HOUR },
  setPasswordIp: { scope: "auth.setpassword_failure.ip", limit: 10, windowMs: HOUR },
  loginIp: { scope: "auth.login_failure.ip", limit: 20, windowMs: 15 * 60_000 },
  loginIpSystem: { scope: "auth.login_failure.ip.system", limit: 10, windowMs: 15 * 60_000 },
  credentialIssued: { scope: "auth.credential_issued", limit: 20, windowMs: HOUR },
  smtpTest: { scope: "notify.smtp_test", limit: 5, windowMs: HOUR },
  credentialPeekIp: { scope: "auth.credential_peek.ip", limit: 60, windowMs: HOUR },
  publicSearch: { scope: "public.search", limit: 5, windowMs: 60_000 },
  jobAuthFailureIp: { scope: "job.auth_failure.ip", limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;
