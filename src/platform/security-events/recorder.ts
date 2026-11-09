import { randomUUID } from "node:crypto";
import type pg from "pg";

import { hmacHex } from "../crypto/keys";

// security_event writer (docs/06-backend-api.md 11.2, 05-database 5.19). One autocommit INSERT outside
// the caller's transaction, so a rollback never loses the event. Codes and a coarse IP only: the
// address is stored as a network prefix plus an HMAC, never in clear. Never throws: losing an event
// must not break the request that produced it (the failure is reported to the caller's logger).

type SecurityRealm = "tenant" | "system" | "public" | "job";
type SecurityOutcome = "success" | "failure" | "refused";

export interface SecurityEventInput {
  event: string;
  realm: SecurityRealm;
  outcome: SecurityOutcome;
  subjectTenantId?: string | null;
  actorId?: string | null;
  reasonCode?: string;
  ip?: string;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The eight groups of an IPv6 address (expanding `::`), or null when it is not one. */
function ipv6Groups(ip: string): string[] | null {
  if (!ip.includes(":") || !/^[0-9a-f:]+$/i.test(ip)) {
    return null;
  }
  const [head = "", tail = ""] = ip.split("::");
  const left = head.split(":").filter(Boolean);
  const right = tail.split(":").filter(Boolean);
  const groups = ip.includes("::")
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return groups.length === 8 ? groups : null;
}

/** IPv4 to /24, IPv6 to /48; anything else (including "unknown") to null. */
export function ipPrefix(ip: string | undefined): string | null {
  const v4 = IPV4.exec(ip ?? "");
  if (v4) {
    return `${v4.slice(1, 4).join(".")}.0/24`;
  }
  const v6 = ipv6Groups(ip ?? "");
  if (!v6) {
    return null;
  }
  const head = v6.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""));
  return `${head.join(":")}::/48`;
}

export async function recordSecurityEvent(
  pool: pg.Pool,
  hmacKey: Buffer,
  input: SecurityEventInput,
  now: Date,
): Promise<{ ok: boolean }> {
  const prefix = ipPrefix(input.ip);
  try {
    await pool.query(
      `INSERT INTO security_event (id, created_at, event, realm, subject_tenant_id, actor_id, outcome,
                                   reason_code, ip_prefix, ip_hmac)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        now,
        input.event,
        input.realm,
        input.subjectTenantId ?? null,
        input.actorId ?? null,
        input.outcome,
        input.reasonCode ?? null,
        prefix,
        prefix && input.ip ? hmacHex(hmacKey, `ip:${input.ip}`) : null,
      ],
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
