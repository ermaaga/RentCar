import { formatMessage, type MessageKey } from "../../../i18n";
import { escapeHtml } from "./credential-email";

// Renewal reminders (docs/06-backend-api.md 9.2 `subscription.renewal_reminder_owner|admin`, US-017).
// Rendered at send time from the subscription and tenant; no link (the console is the owner's own).

export type RenewalTemplate =
  "subscription.renewal_reminder_owner" | "subscription.renewal_reminder_admin";

export function isRenewalTemplate(value: string): value is RenewalTemplate {
  return (
    value === "subscription.renewal_reminder_owner" ||
    value === "subscription.renewal_reminder_admin"
  );
}

export function renderRenewal(
  template: RenewalTemplate,
  input: { to: string; tenantName: string; slug: string; endDate: string },
  t: (key: MessageKey) => string,
) {
  const owner = template === "subscription.renewal_reminder_owner";
  const subject = t(owner ? "email.renewal.ownerSubject" : "email.renewal.adminSubject");
  const body = t(owner ? "email.renewal.ownerBody" : "email.renewal.adminBody");
  const vars = { tenant: input.tenantName, slug: input.slug, date: input.endDate };
  const htmlVars = {
    tenant: escapeHtml(input.tenantName),
    slug: escapeHtml(input.slug),
    date: escapeHtml(input.endDate),
  };
  return {
    to: input.to,
    subject: formatMessage(subject, vars),
    text: formatMessage(body, vars),
    html: `<p>${formatMessage(escapeHtml(body), htmlVars)}</p>`,
  };
}
