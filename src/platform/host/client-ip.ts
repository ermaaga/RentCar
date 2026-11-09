// The only place that reads host-specific request headers (03b section 2; docs/08-security.md SR-RL-02,
// PB-08). Each trusted hop appends the address it saw to X-Forwarded-For, so the client is the entry
// added by the outermost trusted hop: `trustedHops` from the right. The leftmost value is whatever the
// client sent and is never trusted. Anything missing or malformed is "unknown", which still shares
// one rate-limit bucket (fail closed, not open).
const IP = /^[0-9a-f.:]{2,45}$/i;

export function clientIp(headers: { get(name: string): string | null }, trustedHops = 1): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  const candidate = entries[entries.length - Math.max(1, trustedHops)] ?? "";
  return IP.test(candidate) ? candidate : "unknown";
}
