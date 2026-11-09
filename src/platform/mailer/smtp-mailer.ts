import nodemailer from "nodemailer";

import { checkSmtpEndpoint } from "./host-guard";
import type { Mailer, MailMessage, SendFailure, SendResult } from "./port";

// nodemailer adapter for the system SMTP (docs/06-backend-api.md 9.1). TLS is required unless the
// local-only Mailpit override is on; the host guard runs on every send unless that override is on.

export interface SystemSmtpSettings {
  host?: string | undefined;
  port: number;
  security: "starttls" | "tls" | "none";
  user?: string | undefined;
  password?: string | undefined;
  fromAddress?: string | undefined;
  fromName: string;
  allowPrivate: boolean;
}

const HEADER_UNSAFE = /[\r\n\0]/;

function hasUnsafeHeader(message: MailMessage): boolean {
  return HEADER_UNSAFE.test(message.to) || HEADER_UNSAFE.test(message.subject);
}

function categorise(err: unknown): SendFailure {
  const e = err as { code?: string; responseCode?: number };
  if (e.code === "EAUTH") return "auth_failed";
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION") return "connect_timeout";
  if (e.code === "EDNS") return "dns_failed";
  if (e.code === "ETLS") return "tls_failed";
  if (typeof e.responseCode === "number" && e.responseCode >= 500) return "rejected";
  return "unknown";
}

function transportFor(s: SystemSmtpSettings & { host: string }) {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === "tls",
    requireTLS: s.security === "starttls",
    ignoreTLS: s.security === "none",
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: s.user ? { user: s.user, pass: s.password ?? "" } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
}

function guardFailure(s: SystemSmtpSettings & { host: string }): SendFailure | undefined {
  if (s.allowPrivate) {
    return undefined;
  }
  const check = checkSmtpEndpoint(s.host, s.port);
  if (check.ok) {
    return undefined;
  }
  return check.reason === "port_not_allowed" ? "blocked_port" : "blocked_address";
}

export function createSmtpMailer(settings: SystemSmtpSettings): Mailer {
  return {
    async sendSystem(message: MailMessage): Promise<SendResult> {
      const host = settings.host;
      if (!host || !settings.fromAddress) {
        return { ok: false, category: "no_smtp" };
      }
      if (hasUnsafeHeader(message)) {
        return { ok: false, category: "rejected" };
      }
      const blocked = guardFailure({ ...settings, host });
      if (blocked) {
        return { ok: false, category: blocked };
      }
      try {
        await transportFor({ ...settings, host }).sendMail({
          from: { name: settings.fromName, address: settings.fromAddress },
          ...message,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, category: categorise(err) };
      }
    },
  };
}
