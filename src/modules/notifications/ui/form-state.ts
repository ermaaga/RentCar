import type { MessageKey } from "../../../i18n";

/** Outcome of the SMTP settings actions; `category` fills `{category}` in the message. */
export type SmtpActionState =
  | { status: "idle" }
  | {
      status: "done" | "error";
      messageKey: MessageKey;
      category?: string | undefined;
      fields?: string[] | undefined;
    };

export type SmtpAction = (state: SmtpActionState, form: FormData) => Promise<SmtpActionState>;

export const SMTP_IDLE: SmtpActionState = { status: "idle" };
