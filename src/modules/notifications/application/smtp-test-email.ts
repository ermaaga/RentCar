import type { MessageKey } from "../../../i18n";
import type { RenderedEmail } from "./credential-email";

// `smtp.test` (docs/06-backend-api.md 9.2): a fixed text sent to the acting user's own address.

type Translate = (key: MessageKey) => string;

export function renderSmtpTestEmail(to: string, t: Translate): RenderedEmail {
  const body = t("email.smtpTest.body");
  return {
    to,
    subject: t("email.smtpTest.subject"),
    text: body,
    html: `<p>${body}</p>`,
  };
}
