import { z } from "zod";

/** Placeholder prefix committed in .env.example and compose.yaml; rejected in production-like envs. */
const PLACEHOLDER_PREFIX = "INSECURE_DEV_";

const secret = z.string().min(32, "must be at least 32 characters");

export const configSchema = z
  .object({
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
    // Time budget of one /api/jobs/run call; leftover work is picked up by the next call (8.1).
    JOBS_TIME_BUDGET_MS: z.coerce.number().int().min(1000).max(60000).default(8000),
    // Mailpit in development only: allows a private host and plaintext SMTP. Boot fails elsewhere.
    SMTP_DEV_ALLOW_PRIVATE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.SMTP_DEV_ALLOW_PRIVATE && cfg.APP_ENV !== "local") {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_DEV_ALLOW_PRIVATE"],
        message: "is allowed only when APP_ENV is local",
      });
    }
    if (cfg.SYSTEM_SMTP_SECURITY === "none" && !cfg.SMTP_DEV_ALLOW_PRIVATE) {
      ctx.addIssue({
        code: "custom",
        path: ["SYSTEM_SMTP_SECURITY"],
        message: "none requires SMTP_DEV_ALLOW_PRIVATE (local development only)",
      });
    }
    const productionLike = cfg.APP_ENV === "staging" || cfg.APP_ENV === "production";
    if (!productionLike) {
      return;
    }
    if (!cfg.APP_BASE_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must be https in staging and production",
      });
    }
    for (const key of ["APP_ENCRYPTION_KEY", "CRON_SECRET", "PASSWORD_PEPPER"] as const) {
      if (cfg[key].startsWith(PLACEHOLDER_PREFIX)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "placeholder value is not allowed in staging and production",
        });
      }
    }
  });

export type AppConfig = Readonly<z.infer<typeof configSchema>>;
