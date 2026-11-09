import type { MessageKey } from "../../../i18n";

export type SmtpFormState =
  | { status: "idle" }
  | { status: "done" | "error"; messageKey: MessageKey; fields?: readonly string[] };

export type SmtpAction = (state: SmtpFormState, form: FormData) => Promise<SmtpFormState>;

export const SMTP_IDLE: SmtpFormState = { status: "idle" };
