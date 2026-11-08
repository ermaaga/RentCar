// Session lifetimes for tenant users (docs/05-database.md 5.6; assumption A-4, SR-SES-07).
// Pure functions: time is passed in, never read from the clock here.

const TENANT_IDLE_MINUTES = 30;
const TENANT_ABSOLUTE_HOURS = 12;
/** last_seen_at is written at most once per this interval, to avoid a write per request. */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export interface SessionWindow {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export function newSessionWindow(now: Date): SessionWindow {
  return {
    idleExpiresAt: new Date(now.getTime() + TENANT_IDLE_MINUTES * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + TENANT_ABSOLUTE_HOURS * 3_600_000),
  };
}

/** Idle window is extended on activity, but never beyond the absolute expiry. */
export function extendIdle(window: SessionWindow, now: Date): Date {
  const idle = new Date(now.getTime() + TENANT_IDLE_MINUTES * 60_000);
  return idle.getTime() > window.absoluteExpiresAt.getTime() ? window.absoluteExpiresAt : idle;
}
