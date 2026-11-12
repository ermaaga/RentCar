import { z } from "zod";

/** Placeholder prefix committed in .env.example and compose.yaml; rejected in production-like envs. */
const PLACEHOLDER_PREFIX = "INSECURE_DEV_";

const secret = z.string().min(32, "must be at least 32 characters");

const baseSchema = z.object({
  APP_ENV: z.enum(["local", "ci", "staging", "production"]),
  HOST_KIND: z.enum(["server", "serverless"]).default("server"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: secret,
  CRON_SECRET: secret,
  PASSWORD_PEPPER: secret,
  DATABASE_URL: z.url().optional(),
  DIRECT_DATABASE_URL: z.url().optional(),
  // System SMTP (docs/06-backend-api.md 9.1, 14.2). Optional: without it, system mail is not sent.
  SYSTEM_SMTP_HOST: z.string().min(1).max(255).optional(),
  SYSTEM_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SYSTEM_SMTP_SECURITY: z.enum(["starttls", "tls", "none"]).default("starttls"),
  SYSTEM_SMTP_USER: z.string().max(254).optional(),
  SYSTEM_SMTP_PASSWORD: z.string().max(1024).optional(),
  SYSTEM_SMTP_FROM_ADDRESS: z.email().optional(),
  SYSTEM_SMTP_FROM_NAME: z.string().max(80).default("RentCar"),
  SYSTEM_ADMIN_EMAIL: z.email().optional(),
  // Proxies in front of the app that append to X-Forwarded-For (SR-RL-02). The client IP is the
  // entry added by the outermost trusted hop, never the leftmost value. Required in production.
  TRUSTED_PROXY_COUNT: z.coerce.number().int().min(1).max(5).optional(),
  // Time budget of one /api/jobs/run call; leftover work is picked up by the next call (8.1).
  JOBS_TIME_BUDGET_MS: z.coerce.number().int().min(1000).max(60000).default(8000),
  // Object storage (ADR-0009, 06-backend-api 14.2). Only the local adapter exists so far; the s3
  // adapter arrives with the production provider decision (pre-GATE 4).
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().min(1).max(500).default("./.storage"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(65_536).max(4_194_304).default(4_194_304),
  TENANT_STORAGE_QUOTA_BYTES: z.coerce.number().int().min(1_048_576).default(1_073_741_824),
  // Public pages may be indexed only when "true" (docs/09-seo.md SR-06, FR-PUB-14). Fails closed.
  PUBLIC_INDEXING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Mailpit in development only: allows a private host and plaintext SMTP. Boot fails elsewhere.
  SMTP_DEV_ALLOW_PRIVATE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

type BaseConfig = z.infer<typeof baseSchema>;

/** Cross-field rules, as [variable, message] pairs (messages never contain values). */
function configProblems(cfg: BaseConfig): [string, string][] {
  const problems: [string, string][] = [];
  if (cfg.SMTP_DEV_ALLOW_PRIVATE && cfg.APP_ENV !== "local") {
    problems.push(["SMTP_DEV_ALLOW_PRIVATE", "is allowed only when APP_ENV is local"]);
  }
  if (cfg.SYSTEM_SMTP_SECURITY === "none" && !cfg.SMTP_DEV_ALLOW_PRIVATE) {
    problems.push([
      "SYSTEM_SMTP_SECURITY",
      "none requires SMTP_DEV_ALLOW_PRIVATE (local development only)",
    ]);
  }
  problems.push(...storageProblems(cfg));
  if (cfg.APP_ENV === "staging" || cfg.APP_ENV === "production") {
    problems.push(...productionProblems(cfg));
  }
  return problems;
}

function storageProblems(cfg: BaseConfig): [string, string][] {
  if (cfg.STORAGE_PROVIDER === "s3") {
    return [["STORAGE_PROVIDER", "s3 is not available yet; use local"]];
  }
  if (cfg.HOST_KIND === "serverless") {
    return [["STORAGE_PROVIDER", "local storage needs a persistent disk (HOST_KIND=server)"]];
  }
  return [];
}

function productionProblems(cfg: BaseConfig): [string, string][] {
  const problems: [string, string][] = [];
  if (!cfg.APP_BASE_URL.startsWith("https://")) {
    problems.push(["APP_BASE_URL", "must be https in staging and production"]);
  }
  if (cfg.TRUSTED_PROXY_COUNT === undefined) {
    problems.push(["TRUSTED_PROXY_COUNT", "must be set in staging and production"]);
  }
  for (const key of ["APP_ENCRYPTION_KEY", "CRON_SECRET", "PASSWORD_PEPPER"] as const) {
    if (cfg[key].startsWith(PLACEHOLDER_PREFIX)) {
      problems.push([key, "placeholder value is not allowed in staging and production"]);
    }
  }
  return problems;
}

export const configSchema = baseSchema.superRefine((cfg, ctx) => {
  for (const [path, message] of configProblems(cfg)) {
    ctx.addIssue({ code: "custom", path: [path], message });
  }
});

export type AppConfig = Readonly<z.infer<typeof configSchema>>;
