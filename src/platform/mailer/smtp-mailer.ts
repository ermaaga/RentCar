import { isIP } from "node:net";

import nodemailer from "nodemailer";

import { checkSmtpEndpoint } from "./host-guard";
import type { Mailer, MailMessage, SendFailure, SendResult, TenantSmtpTarget } from "./port";
import { guardedSmtpAddress, type Resolver } from "./resolve-guard";

// nodemailer adapter (docs/06-backend-api.md 9.1). System mail: TLS required unless the local-only
// Mailpit override is on. Tenant mail: the SSRF guard resolves the host and the connection goes to the
// checked address with the TLS server name set; STARTTLS is required (no plaintext fallback). The
// local override (APP_ENV=local only, enforced by the config schema) skips the guard and makes TLS
// opportunistic so the Mailpit sink works for tenant settings too.

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

interface Connection {
  address: string;
  servername?: string | undefined;
  port: number;
  security: "starttls" | "tls" | "none";
  requireTls: boolean;
  user?: string | undefined;
  password?: string | undefined;
}

/** TLS SNI takes a name only; an IP literal host connects without one. */
function sni(host: string): string | undefined {
  return isIP(host.replace(/^\[|\]$/g, "")) === 0 ? host : undefined;
}

const HEADER_UNSAFE = /[\r\n\0]/;

function hasUnsafeHeader(message: MailMessage): boolean {
  return [message.to, message.subject, message.replyTo ?? ""].some((v) => HEADER_UNSAFE.test(v));
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

async function deliver(
  conn: Connection,
  from: { name: string; address: string },
  message: MailMessage,
): Promise<SendResult> {
  if (hasUnsafeHeader(message)) {
    return { ok: false, category: "rejected" };
  }
  const transport = nodemailer.createTransport({
    host: conn.address,
    port: conn.port,
    secure: conn.security === "tls",
    requireTLS: conn.requireTls,
    ignoreTLS: conn.security === "none",
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: conn.servername },
    auth: conn.user ? { user: conn.user, pass: conn.password ?? "" } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.sendMail({ from, ...message });
    return { ok: true };
  } catch (err) {
    return { ok: false, category: categorise(err) };
  }
}

function literalGuard(host: string, port: number): SendFailure | undefined {
  const check = checkSmtpEndpoint(host, port);
  if (check.ok) return undefined;
  return check.reason === "port_not_allowed" ? "blocked_port" : "blocked_address";
}

function systemSender(s: SystemSmtpSettings) {
  return async (message: MailMessage): Promise<SendResult> => {
    const host = s.host;
    if (!host || !s.fromAddress) {
      return { ok: false, category: "no_smtp" };
    }
    const blocked = s.allowPrivate ? undefined : literalGuard(host, s.port);
    if (blocked) {
      return { ok: false, category: blocked };
    }
    const conn: Connection = {
      address: host,
      servername: sni(host),
      port: s.port,
      security: s.security,
      requireTls: s.security === "starttls",
      user: s.user,
      password: s.password,
    };
    return deliver(conn, { name: s.fromName, address: s.fromAddress }, message);
  };
}

export function createSmtpMailer(
  settings: SystemSmtpSettings,
  deps: { resolve?: Resolver } = {},
): Mailer {
  const relaxed = settings.allowPrivate;
  async function checkTenantHost(host: string, port: number) {
    if (relaxed) return { ok: true, address: host } as const;
    return guardedSmtpAddress(host, port, deps.resolve);
  }
  return {
    sendSystem: systemSender(settings),
    async checkTenantHost(host, port) {
      const guard = await checkTenantHost(host, port);
      return guard.ok ? { ok: true } : guard;
    },
    async sendTenant(target: TenantSmtpTarget, message: MailMessage) {
      const guard = await checkTenantHost(target.host, target.port);
      if (!guard.ok) {
        return guard;
      }
      const conn: Connection = {
        address: guard.address,
        servername: sni(target.host),
        port: target.port,
        security: target.security,
        requireTls: target.security === "starttls" && !relaxed,
        user: target.username,
        password: target.password,
      };
      const from = { name: target.fromName ?? "", address: target.fromAddress };
      return deliver(conn, from, message);
    },
  };
}
