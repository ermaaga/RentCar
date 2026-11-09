import type pg from "pg";

import { systemClock, type Clock } from "../platform/clock";
import { getConfig } from "../platform/config";
import { deriveKey } from "../platform/crypto/keys";
import { createPool } from "../platform/db/pool";
import { cookiesMustBeSecure } from "../platform/http/session-cookie";
import type { Mailer } from "../platform/mailer/port";
import { createSmtpMailer } from "../platform/mailer/smtp-mailer";

// Composition root (docs/03b-struttura-codice.md section 5): the only place that builds adapters
// from configuration. Built once per process, lazily, so `next build` never needs the database.

export interface Container {
  clock: Clock;
  pool: pg.Pool;
  mailer: Mailer;
  peppers: readonly string[];
  hmacKey: Buffer;
  baseUrl: string;
  secureCookies: boolean;
  cronSecret: string;
  jobsBudgetMs: number;
}

let container: Container | undefined;

function build(): Container {
  const cfg = getConfig();
  if (!cfg.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to serve requests");
  }
  return {
    clock: systemClock,
    pool: createPool(cfg.DATABASE_URL),
    mailer: createSmtpMailer({
      host: cfg.SYSTEM_SMTP_HOST,
      port: cfg.SYSTEM_SMTP_PORT,
      security: cfg.SYSTEM_SMTP_SECURITY,
      user: cfg.SYSTEM_SMTP_USER,
      password: cfg.SYSTEM_SMTP_PASSWORD,
      fromAddress: cfg.SYSTEM_SMTP_FROM_ADDRESS,
      fromName: cfg.SYSTEM_SMTP_FROM_NAME,
      allowPrivate: cfg.SMTP_DEV_ALLOW_PRIVATE,
    }),
    peppers: [cfg.PASSWORD_PEPPER],
    hmacKey: deriveKey(cfg.APP_ENCRYPTION_KEY, "ratelimit"),
    baseUrl: cfg.APP_BASE_URL.replace(/\/$/, ""),
    secureCookies: cookiesMustBeSecure(cfg.APP_ENV, cfg.APP_BASE_URL),
    cronSecret: cfg.CRON_SECRET,
    jobsBudgetMs: cfg.JOBS_TIME_BUDGET_MS,
  };
}

export function getContainer(): Container {
  container ??= build();
  return container;
}
