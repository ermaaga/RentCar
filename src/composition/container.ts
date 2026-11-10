import type pg from "pg";

import { bookingEmailSources } from "../modules/booking";
import type { EmailSources } from "../modules/notifications";

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
  /** Field encryption keys (SR-CRY-01); the first one encrypts, all of them decrypt. */
  fieldKeys: readonly Buffer[];
  /** Local Mailpit override for SMTP (APP_ENV=local only, checked at boot). */
  smtpAllowPrivate: boolean;
  /** SYSTEM_ADMIN_EMAIL: the platform owner's address for platform mail (optional). */
  ownerEmail: string | undefined;
  /** Trusted hops for the client IP (SR-RL-02); 1 when unset outside production. */
  trustedProxyCount: number;
  /** Signs the public booking form token (BKG-02/03). */
  formTokenKey: Buffer;
  /** Outbox templates rendered by other modules (docs/06-backend-api.md 3.x item 1). */
  emailSources: EmailSources;
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
    fieldKeys: [deriveKey(cfg.APP_ENCRYPTION_KEY, "field-encryption")],
    smtpAllowPrivate: cfg.SMTP_DEV_ALLOW_PRIVATE,
    ownerEmail: cfg.SYSTEM_ADMIN_EMAIL,
    trustedProxyCount: cfg.TRUSTED_PROXY_COUNT ?? 1,
    formTokenKey: deriveKey(cfg.APP_ENCRYPTION_KEY, "form-token"),
    emailSources: bookingEmailSources(cfg.APP_BASE_URL.replace(/\/$/, "")),
  };
}

export function getContainer(): Container {
  container ??= build();
  return container;
}
