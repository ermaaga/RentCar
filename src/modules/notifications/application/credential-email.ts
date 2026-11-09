import { formatMessage, type MessageKey } from "../../../i18n";

// Credential email (docs/06-backend-api.md 9.2 `credential.activation` / `credential.reset`): only
// the link, its expiry and an "ignore if not you" line (SR-EML-04). The translator is passed in.

export interface CredentialEmailInput {
  purpose: "activation" | "password_reset";
  to: string;
  displayName: string;
  username: string;
  link: string;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Translate = (key: MessageKey) => string;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const KEYS = {
  activation: {
    subject: "email.credential.activation.subject",
    intro: "email.credential.activation.intro",
    action: "email.credential.activation.action",
  },
  password_reset: {
    subject: "email.credential.reset.subject",
    intro: "email.credential.reset.intro",
    action: "email.credential.reset.action",
  },
} as const satisfies Record<CredentialEmailInput["purpose"], Record<string, MessageKey>>;

export function renderCredentialEmail(input: CredentialEmailInput, t: Translate): RenderedEmail {
  const keys = KEYS[input.purpose];
  const intro = t(keys.intro);
  const action = t(keys.action);
  const ignore = t("email.credential.ignore");
  const textVars = { name: input.displayName, username: input.username };
  const htmlVars = { name: escapeHtml(input.displayName), username: escapeHtml(input.username) };
  const link = escapeHtml(input.link);
  return {
    to: input.to,
    subject: t(keys.subject),
    text: [formatMessage(intro, textVars), "", action, input.link, "", ignore].join("\n"),
    html: [
      `<p>${formatMessage(escapeHtml(intro), htmlVars)}</p>`,
      `<p>${escapeHtml(action)}</p>`,
      `<p><a href="${link}">${link}</a></p>`,
      `<p>${escapeHtml(ignore)}</p>`,
    ].join("\n"),
  };
}

/** NTF-02 test email (`smtp.test`): fixed text, sent to the acting user only (SR-SSRF-06). */
export function renderSmtpTestEmail(to: string, t: Translate): RenderedEmail {
  const body = t("email.smtpTest.body");
  return {
    to,
    subject: t("email.smtpTest.subject"),
    text: body,
    html: `<p>${escapeHtml(body)}</p>`,
  };
}
