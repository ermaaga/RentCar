import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

// SSRF guard for tenant-chosen SMTP hosts (docs/08-security.md EM-01, ABU-M1-19). Pure checks on the
// literal host. DNS resolution and the connection-time check (DNS rebinding, ABU-M1-20) belong to the
// mailer adapter; this module refuses every host that names an internal or non-public address.

const ALLOWED_PORTS = new Set([25, 465, 587, 2525]);

/** IPv6 forms that carry an IPv4 address (SR-SSRF-02): the embedded address decides. */
function embeddedIpv4(addr: ipaddr.IPv6): ipaddr.IPv4 | null {
  const range = addr.range();
  if (range === "ipv4Mapped") {
    return addr.toIPv4Address();
  }
  const bytes = addr.toByteArray();
  if (range === "rfc6052") {
    return ipaddr.fromByteArray(bytes.slice(12, 16)) as ipaddr.IPv4;
  }
  if (range === "6to4") {
    return ipaddr.fromByteArray(bytes.slice(2, 6)) as ipaddr.IPv4;
  }
  return null;
}

/**
 * True for every address that is not plain public unicast (docs/08-security.md SR-SSRF-02):
 * loopback, private, link-local, CGNAT, documentation and benchmarking nets, multicast, reserved,
 * unique-local, Teredo, and IPv6 forms whose embedded IPv4 address is any of those. Classification by
 * ipaddr.js, not by hand-written patterns. Not an IP at all: false (the hostname checks apply).
 */
export function isNonPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip) || isIP(ip) === 0) {
    return false;
  }
  const addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6") {
    const v4 = embeddedIpv4(addr as ipaddr.IPv6);
    if (v4) {
      return v4.range() !== "unicast";
    }
  }
  return addr.range() !== "unicast";
}

const RESERVED_NAMES = /(^|\.)(localhost|localdomain|internal|local|home\.arpa)$/i;

export type HostCheck =
  { ok: true } | { ok: false; reason: "invalid_host" | "non_public_address" | "port_not_allowed" };

const NUMERIC_LABEL = /^(0x[0-9a-f]*|\d+)$/i;

/** A host made only of numeric labels (decimal, hex or octal IPv4 forms) is refused, not resolved. */
function isNumericForm(host: string): boolean {
  return host.split(".").every((label) => NUMERIC_LABEL.test(label));
}

function checkHostname(host: string): HostCheck {
  if (host.length === 0 || host.length > 255 || !/^[A-Za-z0-9.-]+$/.test(host)) {
    return { ok: false, reason: "invalid_host" };
  }
  if (isNumericForm(host) || RESERVED_NAMES.test(host) || !host.includes(".")) {
    return { ok: false, reason: "invalid_host" };
  }
  return { ok: true };
}

/** Validates host and port for save, test and send. */
export function checkSmtpEndpoint(host: string, port: number): HostCheck {
  if (!ALLOWED_PORTS.has(port)) {
    return { ok: false, reason: "port_not_allowed" };
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) {
    return isNonPublicIp(bare) ? { ok: false, reason: "non_public_address" } : { ok: true };
  }
  return checkHostname(bare);
}
