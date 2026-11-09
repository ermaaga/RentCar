// Mailer port (docs/06-backend-api.md 9.1). One message, one recipient; the result carries a failure
// category only, never the provider's error text.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | undefined;
}

export type SendFailure =
  | "invalid_host"
  | "blocked_address"
  | "blocked_port"
  | "dns_failed"
  | "connect_timeout"
  | "tls_failed"
  | "auth_failed"
  | "rejected"
  | "no_smtp"
  | "unknown";

export type SendResult = { ok: true } | { ok: false; category: SendFailure };

/** A tenant SMTP server, password already decrypted (only in memory, only for one send). */
export interface TenantSmtpTarget {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  password: string;
  fromAddress: string;
  fromName?: string | null | undefined;
}

export interface Mailer {
  sendSystem(message: MailMessage): Promise<SendResult>;
  /** Tenant mail: the SSRF guard (literal host and every resolved address) runs before connecting. */
  sendTenant(target: TenantSmtpTarget, message: MailMessage): Promise<SendResult>;
  /** The same guard alone, for the settings save (NTF-01). */
  checkTenantHost(host: string, port: number): Promise<SendResult>;
}
