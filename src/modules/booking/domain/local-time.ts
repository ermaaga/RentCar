// Tenant-local date-times (docs/06-backend-api.md 5.2, FR-PUB-12). Pure: no I/O, the time zone is an
// IANA name. A local wall-clock time is turned into an instant by solving for the zone offset; a time
// that does not exist (spring-forward gap) is refused, an ambiguous one (fall-back) takes the first.

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(instant: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const get = (type: string) =>
    Number(fmt.formatToParts(instant).find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const asUtc = (p: Parts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

/** "2026-06-01T10:00" in `timeZone` -> instant, or null when malformed or non-existent locally. */
export function parseLocal(value: string, timeZone: string): Date | null {
  const m = LOCAL.exec(value);
  if (!m) return null;
  const wanted: Parts = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  };
  const target = asUtc(wanted);
  if (Number.isNaN(target) || new Date(target).getUTCDate() !== wanted.day) return null;
  // Two passes of offset correction converge for every real zone.
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    guess = target - (asUtc(wallClock(new Date(guess), timeZone)) - guess);
  }
  if (asUtc(wallClock(new Date(guess), timeZone)) !== target) return null;
  // Fall-back hour: the same wall time also exists one hour earlier; take that first occurrence.
  const earlier = guess - 3_600_000;
  return new Date(asUtc(wallClock(new Date(earlier), timeZone)) === target ? earlier : guess);
}

/** Local calendar day number (days since 1970-01-01) of an instant in `timeZone`. */
export function localDayNumber(instant: Date, timeZone: string): number {
  const p = wallClock(instant, timeZone);
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant -> "2026-06-01T10:00" wall-clock time in `timeZone` (minutes, seconds dropped). */
export function formatLocal(instant: Date, timeZone: string): string {
  const p = wallClock(instant, timeZone);
  return `${String(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Adds whole calendar days to the date part of a local date-time string (time kept as is). */
export function addLocalDays(value: string, days: number): string {
  const m = LOCAL.exec(value);
  if (!m) return value;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.toISOString().slice(0, 10)}T${m[4] ?? "00"}:${m[5] ?? "00"}`;
}
