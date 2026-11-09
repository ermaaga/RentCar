export { renderCredentialEmail } from "./application/credential-email";
export { renderSmtpTestEmail } from "./application/smtp-test-email";
export { SMTP_PORTS, smtpSettingsInput } from "./application/smtp-settings-input";
export {
  getSmtpSummary,
  loadTenantSmtpTarget,
  recordSmtpTest,
  saveSmtpSettings,
} from "./infrastructure/tenant-smtp";
export type { SmtpSummary } from "./infrastructure/tenant-smtp";
