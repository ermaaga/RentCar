// Mailer port (docs/06-backend-api.md 9.1). One message, one recipient; the result carries a failure
// category only, never the provider's error text.

interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: readonly MailAttachment[] | undefined;
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

/** A tenant's own SMTP server (docs/05-database.md 5.3), password already decrypted. */
export interface TenantSmtpSettings {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  password: string;
  fromAddress: string;
  fromName?: string | null | undefined;
  replyTo?: string | null | undefined;
}

export interface Mailer {
  sendSystem(message: MailMessage): Promise<SendResult>;
  /** Sends through the tenant's SMTP after the SSRF guard (resolve, validate, connect to the IP). */
  sendTenant(settings: TenantSmtpSettings, message: MailMessage): Promise<SendResult>;
}
