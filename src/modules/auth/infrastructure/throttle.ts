import type pg from "pg";

import { hmacHex } from "../../../platform/crypto/keys";
import { bucketExpiry, LOGIN_FAILURE_LIMIT, windowStart } from "../domain/throttle-policy";

/** Stable, non-reversible key for a (tenant, username) pair. */
export function loginKey(hmacKey: Buffer, tenantId: string, username: string): string {
  return hmacHex(hmacKey, `${tenantId}:login:${username}`);
}

/** True when the failures in the current window have reached the limit. */
export async function isThrottled(pool: pg.Pool, key: string, now: Date): Promise<boolean> {
  const res = await pool.query<{ failures: number }>(
    "SELECT COALESCE(SUM(count), 0)::int AS failures FROM rate_limit_buckets WHERE key = $1 AND window_start = $2",
    [key, windowStart(now)],
  );
  return (res.rows[0]?.failures ?? 0) >= LOGIN_FAILURE_LIMIT;
}

/** Counts one failed attempt in the current window (atomic upsert, one round trip). */
export async function recordFailure(pool: pg.Pool, key: string, now: Date): Promise<void> {
  const window = windowStart(now);
  await pool.query(
    `INSERT INTO rate_limit_buckets (key, window_start, count, expires_at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1`,
    [key, window, bucketExpiry(window)],
  );
}

/** Hourly purge of expired counters (5.17). */
export async function purgeExpired(pool: pg.Pool, now: Date): Promise<number> {
  const res = await pool.query("DELETE FROM rate_limit_buckets WHERE expires_at < $1", [now]);
  return res.rowCount ?? 0;
}
