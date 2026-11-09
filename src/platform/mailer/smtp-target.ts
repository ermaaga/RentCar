import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { checkSmtpEndpoint, isNonPublicIp } from "./host-guard";
import type { SendFailure } from "./port";

// guardedSmtpTarget (docs/08-security.md SR-SSRF-01..04): the only way to get a connection target for
// a tenant-chosen SMTP host. Hostname only (no IP literal), every A and AAAA record resolved within
// 3 s, every address public, then the caller connects to the validated IP with the hostname as TLS
// server name. Nothing is cached: each save, test and send resolves again (DNS rebinding).

/** Returns every address of a host (A and AAAA). Injected so tests use a fake network. */
export type HostResolver = (host: string) => Promise<string[]>;

const RESOLVE_TIMEOUT_MS = 3_000;

export const dnsResolver: HostResolver = async (host) => {
  const resolver = new Resolver({ timeout: RESOLVE_TIMEOUT_MS, tries: 1 });
  const settle = async (lookup: Promise<string[]>) => lookup.catch(() => [] as string[]);
  const [v4, v6] = await Promise.all([
    settle(resolver.resolve4(host)),
    settle(resolver.resolve6(host)),
  ]);
  return [...v4, ...v6];
};

export type SmtpTarget =
  { ok: true; ip: string; servername: string } | { ok: false; category: SendFailure };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

type HostnameCheck = { ok: true; name: string } | { ok: false; category: SendFailure };

/** Normalised ASCII hostname, or why the host or port is not acceptable. */
function asciiHostname(host: string, port: number): HostnameCheck {
  const raw = host.trim();
  const ascii = domainToASCII(raw).toLowerCase();
  const invalid = { ok: false, category: "invalid_host" } as const;
  if (ascii.length === 0 || ascii.length > 253 || raw.endsWith(".")) {
    return invalid;
  }
  if (isIP(ascii.replace(/^\[|\]$/g, "")) !== 0) {
    return invalid;
  }
  const check = checkSmtpEndpoint(ascii, port);
  if (!check.ok) {
    return check.reason === "port_not_allowed" ? { ok: false, category: "blocked_port" } : invalid;
  }
  return { ok: true, name: ascii };
}

export async function guardedSmtpTarget(
  host: string,
  port: number,
  resolve: HostResolver = dnsResolver,
): Promise<SmtpTarget> {
  const checked = asciiHostname(host, port);
  if (!checked.ok) {
    return checked;
  }
  const name = checked.name;
  const addresses = await withTimeout(
    resolve(name).catch(() => []),
    RESOLVE_TIMEOUT_MS,
  );
  if (addresses === "timeout" || addresses.length === 0) {
    return { ok: false, category: "dns_failed" };
  }
  // One bad record rejects the host (SR-SSRF-01 step 3).
  if (addresses.some((a) => isIP(a) === 0 || isNonPublicIp(a))) {
    return { ok: false, category: "blocked_address" };
  }
  return { ok: true, ip: addresses[0] ?? "", servername: name };
}
