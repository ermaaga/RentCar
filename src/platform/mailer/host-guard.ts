import { isIP } from "node:net";

// SSRF guard for tenant-chosen SMTP hosts (docs/08-security.md EM-01, ABU-M1-19). Pure checks on the
// literal host. DNS resolution and the connection-time check (DNS rebinding, ABU-M1-20) belong to the
// mailer adapter; this module refuses every host that names an internal or non-public address.

const ALLOWED_PORTS = new Set([25, 465, 587, 2525]);

/** Returns true for addresses that are not public: loopback, private, link-local, CGNAT, unspecified, multicast. */
export function isNonPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return isNonPublicIpv4(ip);
  }
  if (version === 6) {
    return isNonPublicIpv6(ip.toLowerCase());
  }
  return false;
}

const NON_PUBLIC_V4: readonly ((a: number, b: number) => boolean)[] = [
  (a) => a === 0 || a === 10 || a === 127,
  (a, b) => a === 169 && b === 254,
  (a, b) => a === 172 && b >= 16 && b <= 31,
  (a, b) => a === 192 && b === 168,
  (a, b) => a === 100 && b >= 64 && b <= 127,
  (a) => a >= 224,
];

function isNonPublicIpv4(ip: string): boolean {
  const [a = -1, b = -1] = ip.split(".").map((p) => Number(p));
  return NON_PUBLIC_V4.some((test) => test(a, b));
}

function isNonPublicIpv6(ip: string): boolean {
  if (ip === "::" || ip === "::1") {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) {
    return isNonPublicIpv4(mapped[1]);
  }
  return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff");
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
