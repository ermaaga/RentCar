// Login throttling (docs/08-security.md SR-AUT-05): 5 failed logins per (tenant, username) per 15 minutes.
// While the window holds 5 or more failures, every attempt is refused, even with the right password.
export const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_WINDOW_MINUTES = 15;

const WINDOW_MS = LOGIN_WINDOW_MINUTES * 60_000;

/** Start of the fixed 15-minute window that contains `now`. */
export function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/** Rows older than the window plus one hour are purged (5.17). */
export function bucketExpiry(window: Date): Date {
  return new Date(window.getTime() + WINDOW_MS + 60 * 60_000);
}

/** Seconds until the current window rolls over, for the Retry-After header. */
export function retryAfterSeconds(now: Date): number {
  const end = windowStart(now).getTime() + WINDOW_MS;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}
