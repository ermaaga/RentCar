// Session lifetimes (docs/06-backend-api.md 4.1; assumption A-4, SR-SES-07): tenant staff 30 min idle
// and 12 h absolute; the systemadmin 15 min idle and 8 h absolute. Pure: time is passed in.

export type RealmKind = "tenant" | "system";

const LIFETIMES: Record<RealmKind, { idleMinutes: number; absoluteHours: number }> = {
  tenant: { idleMinutes: 30, absoluteHours: 12 },
  system: { idleMinutes: 15, absoluteHours: 8 },
};

/** last_seen_at is written at most once per this interval, to avoid a write per request. */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export interface SessionWindow {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export function newSessionWindow(now: Date, realm: RealmKind = "tenant"): SessionWindow {
  const life = LIFETIMES[realm];
  return {
    idleExpiresAt: new Date(now.getTime() + life.idleMinutes * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + life.absoluteHours * 3_600_000),
  };
}

/** Idle window is extended on activity, but never beyond the absolute expiry. */
export function extendIdle(window: SessionWindow, now: Date, realm: RealmKind = "tenant"): Date {
  const idle = new Date(now.getTime() + LIFETIMES[realm].idleMinutes * 60_000);
  return idle.getTime() > window.absoluteExpiresAt.getTime() ? window.absoluteExpiresAt : idle;
}
