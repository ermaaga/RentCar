import type { NextConfig } from "next";

// Security headers on every response. Strict CSP with nonces is tracked as spike S-FE-3;
// until then 'unsafe-inline' is allowed for scripts and styles (Next.js hydration), with no
// remote origins at all. HSTS is added at deployment time (only meaningful over https).
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // PDF fonts are read from disk at runtime (10.1): ship them with the standalone output.
  outputFileTracingIncludes: { "/[slug]/booking/[code]/pdf": ["./assets/fonts/*"] },
  serverExternalPackages: ["@react-pdf/renderer", "sharp"],
  reactStrictMode: true,
  headers() {
    // /media answers with its own stricter class M headers (sandboxed CSP, immutable cache).
    return Promise.resolve([{ source: "/:path((?!media/).*)", headers: securityHeaders }]);
  },
};

export default nextConfig;
