// Mailer port (docs/06-backend-api.md 9.1). One message, one recipient; the result carries a failure
// category only, never the provider's error text.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
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

export interface Mailer {
  sendSystem(message: MailMessage): Promise<SendResult>;
}
