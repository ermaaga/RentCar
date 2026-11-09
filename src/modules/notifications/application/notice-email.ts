import { formatMessage, type MessageKey } from "../../../i18n";
import { escapeHtml } from "./credential-email";

// Account notices (docs/06-backend-api.md 9.2 `notice.*`, SR-AUT-10): no secret and no link, only what
// happened and whom to contact. Rendered at send time from the account's display name; the content is
// never stored in the outbox.

const NOTICE_TEMPLATES = [
  "notice.password_changed",
  "notice.password_reset_completed",
  "notice.admin_access_changed",
  "notice.email_changed",
] as const;

export type NoticeTemplate = (typeof NOTICE_TEMPLATES)[number];

const KEYS: Record<NoticeTemplate, { subject: MessageKey; body: MessageKey }> = {
  "notice.password_changed": {
    subject: "email.notice.passwordChanged.subject",
    body: "email.notice.passwordChanged.body",
  },
  "notice.password_reset_completed": {
    subject: "email.notice.passwordResetCompleted.subject",
    body: "email.notice.passwordResetCompleted.body",
  },
  "notice.admin_access_changed": {
    subject: "email.notice.adminAccessChanged.subject",
    body: "email.notice.adminAccessChanged.body",
  },
  "notice.email_changed": {
    subject: "email.notice.emailChanged.subject",
    body: "email.notice.emailChanged.body",
  },
};

export function isNoticeTemplate(value: string): value is NoticeTemplate {
  return (NOTICE_TEMPLATES as readonly string[]).includes(value);
}

export function renderNotice(
  template: NoticeTemplate,
  input: { to: string; displayName: string },
  t: (key: MessageKey) => string,
) {
  const keys = KEYS[template];
  const body = t(keys.body);
  const notYou = t("email.notice.notYou");
  return {
    to: input.to,
    subject: t(keys.subject),
    text: [formatMessage(body, { name: input.displayName }), "", notYou].join("\n"),
    html: [
      `<p>${formatMessage(escapeHtml(body), { name: escapeHtml(input.displayName) })}</p>`,
      `<p>${escapeHtml(notYou)}</p>`,
    ].join("\n"),
  };
}
