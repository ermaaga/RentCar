export { renderCredentialEmail } from "./application/credential-email";
export { smtpSettingsInput } from "./application/smtp-input";
export { getSmtpSummary } from "./infrastructure/tenant-smtp";
export { testSmtpSettings, updateSmtpSettings } from "./infrastructure/smtp-settings-service";
export { sendTenantMail } from "./infrastructure/tenant-mail";
export {
  dispatchDue,
  enqueueEmail,
  enqueueNotice,
  failStaleCredentialRows,
} from "./infrastructure/outbox";
export type { OutboxDeps, OutboxScope } from "./infrastructure/outbox";
