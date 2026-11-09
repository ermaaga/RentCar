import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { checkSmtpEndpoint, isNonPublicIp } from "./host-guard";
import type { SendFailure } from "./port";

// Connection-time SSRF guard (docs/08-security.md SR-SSRF-01..04, ABU-M1-20): the literal check, then
// every A/AAAA record must be public. The caller connects to the returned address (with the TLS
// server name set to the host), so a second DNS answer cannot redirect the connection.

export type Resolver = (host: string) => Promise<string[]>;

const DNS_TIMEOUT_MS = 3_000;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, order: "verbatim" })).map((a) => a.address);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("dns timeout"));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export type GuardedAddress = { ok: true; address: string } | { ok: false; category: SendFailure };

export async function guardedSmtpAddress(
  host: string,
  port: number,
  resolve: Resolver = systemResolver,
): Promise<GuardedAddress> {
  const literal = checkSmtpEndpoint(host, port);
  if (!literal.ok) {
    const category: Record<typeof literal.reason, SendFailure> = {
      invalid_host: "invalid_host",
      non_public_address: "blocked_address",
      port_not_allowed: "blocked_port",
    };
    return { ok: false, category: category[literal.reason] };
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) {
    return { ok: true, address: bare };
  }
  let addresses: string[];
  try {
    addresses = await withTimeout(resolve(bare), DNS_TIMEOUT_MS);
  } catch {
    return { ok: false, category: "dns_failed" };
  }
  const [first] = addresses;
  if (first === undefined) {
    return { ok: false, category: "dns_failed" };
  }
  if (addresses.some(isNonPublicIp)) {
    return { ok: false, category: "blocked_address" };
  }
  return { ok: true, address: first };
}
