import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Booking form token (docs/06-backend-api.md BKG-02/03, SR-RL-05): issued when the form is rendered,
// signed with a purpose key (HMAC-SHA-256), bound to the tenant and the vehicle, and carrying the
// idempotency key of this booking attempt, so a double submit replays instead of booking twice.
// A submit faster than the minimum fill time is treated as a bot (silent decoy success).

const MIN_FILL_MS = 3_000;
const MAX_AGE_MS = 2 * 3_600_000;

interface Payload {
  t: string;
  v: string;
  iat: number;
  idem: string;
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body, "utf8").digest("base64url");
}

export function issueFormToken(
  key: Buffer,
  input: { tenantId: string; vehicleId: string; now: Date },
): string {
  const payload: Payload = {
    t: input.tenantId,
    v: input.vehicleId,
    iat: input.now.getTime(),
    idem: randomUUID(),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(key, body)}`;
}

export type FormTokenCheck =
  { ok: true; idempotencyKey: string } | { ok: false; reason: "invalid" | "expired" | "too_fast" };

function parse(key: Buffer, token: string): Payload | null {
  const [body = "", mac = ""] = token.split(".");
  const expected = Buffer.from(sign(key, body));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
    const valid =
      typeof p.t === "string" &&
      typeof p.v === "string" &&
      typeof p.iat === "number" &&
      typeof p.idem === "string";
    return valid ? (p as Payload) : null;
  } catch {
    return null;
  }
}

export function checkFormToken(
  key: Buffer,
  token: string,
  ctx: { tenantId: string; vehicleId: string; now: Date },
): FormTokenCheck {
  const p = parse(key, token);
  if (p?.t !== ctx.tenantId || p.v !== ctx.vehicleId) return { ok: false, reason: "invalid" };
  const age = ctx.now.getTime() - p.iat;
  if (age > MAX_AGE_MS || age < 0) return { ok: false, reason: "expired" };
  if (age < MIN_FILL_MS) return { ok: false, reason: "too_fast" };
  return { ok: true, idempotencyKey: p.idem };
}
