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
    DATABASE_URL: z.url().optional(),
    DIRECT_DATABASE_URL: z.url().optional(),
  })
  .superRefine((cfg, ctx) => {
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
    for (const key of ["APP_ENCRYPTION_KEY", "CRON_SECRET"] as const) {
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
