import nodemailer from "nodemailer";

import { checkSmtpEndpoint } from "./host-guard";
import type { Mailer, MailMessage, SendFailure, SendResult, TenantSmtpSettings } from "./port";
import { dnsResolver, guardedSmtpTarget, type HostResolver } from "./smtp-target";

// nodemailer adapter (docs/06-backend-api.md 9.1). System SMTP: TLS required unless the local-only
// Mailpit override is on. Tenant SMTP: the SSRF guard resolves and validates the host on every send and
// the connection goes to the validated IP, with the hostname kept for certificate checks (SR-SSRF-*).

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
  host: string;
  servername?: string;
  port: number;
  security: "starttls" | "tls" | "none";
  user?: string | undefined;
  password?: string | undefined;
}

const HEADER_UNSAFE = /[\r\n\0]/;

function hasUnsafeHeader(message: MailMessage, extra: readonly string[] = []): boolean {
  return [message.to, message.subject, ...extra].some((v) => HEADER_UNSAFE.test(v));
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

function transportFor(c: Connection) {
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.security === "tls",
    requireTLS: c.security === "starttls",
    ignoreTLS: c.security === "none",
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      ...(c.servername ? { servername: c.servername } : {}),
    },
    auth: c.user ? { user: c.user, pass: c.password ?? "" } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

async function deliver(
  connection: Connection,
  from: { name: string; address: string },
  message: MailMessage,
  replyTo?: string,
): Promise<SendResult> {
  try {
    await transportFor(connection).sendMail({
      from,
      ...message,
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true };
  } catch (err) {
    // Category only: banners and server text never leave this function (SR-SSRF-05).
    return { ok: false, category: categorise(err) };
  }
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

/** Where a tenant send connects: the validated IP, or (local Mailpit override only) the host as is. */
async function tenantConnection(
  s: TenantSmtpSettings,
  allowPrivate: boolean,
  resolve: HostResolver,
): Promise<Connection | SendFailure> {
  const credentials = { user: s.username, password: s.password };
  if (allowPrivate) {
    // Local development only (SR-SSRF-07, refused at boot elsewhere): Mailpit has no TLS.
    return { host: s.host, port: s.port, security: "none", ...credentials };
  }
  const target = await guardedSmtpTarget(s.host, s.port, resolve);
  if (!target.ok) {
    return target.category;
  }
  return {
    host: target.ip,
    servername: target.servername,
    port: s.port,
    security: s.security,
    ...credentials,
  };
}

async function sendThroughSystem(
  settings: SystemSmtpSettings,
  message: MailMessage,
): Promise<SendResult> {
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
  return deliver(
    { ...settings, host },
    { name: settings.fromName, address: settings.fromAddress },
    message,
  );
}

export function createSmtpMailer(
  settings: SystemSmtpSettings,
  options: { resolve?: HostResolver } = {},
): Mailer {
  const resolve = options.resolve ?? dnsResolver;
  return {
    sendSystem: (message) => sendThroughSystem(settings, message),

    async sendTenant(tenant: TenantSmtpSettings, message: MailMessage): Promise<SendResult> {
      const headerValues = [tenant.fromAddress, tenant.fromName ?? "", tenant.replyTo ?? ""];
      if (hasUnsafeHeader(message, headerValues)) {
        return { ok: false, category: "rejected" };
      }
      const connection = await tenantConnection(tenant, settings.allowPrivate, resolve);
      if (typeof connection === "string") {
        return { ok: false, category: connection };
      }
      return deliver(
        connection,
        { name: tenant.fromName ?? "", address: tenant.fromAddress },
        message,
        tenant.replyTo ?? undefined,
      );
    },
  };
}
