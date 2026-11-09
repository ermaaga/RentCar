// The only place that reads host-specific request headers (03b section 2). Behind the Next.js server
// or a single trusted proxy, the client is the first `x-forwarded-for` entry; anything malformed is
// "unknown", which still shares one rate-limit bucket (fail closed, not open).
const IP = /^[0-9a-f.:]{2,45}$/i;

export function clientIp(headers: { get(name: string): string | null }): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return IP.test(first) ? first : "unknown";
}
