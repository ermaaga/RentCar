import type { MessageKey } from "../../../i18n";

/** State returned by auth server actions to their forms. Success redirects, so it has no state. */
export type AuthFormState =
  | { status: "idle" }
  | { status: "error"; messageKey: MessageKey }
  | { status: "done"; messageKey: MessageKey };

export const IDLE: AuthFormState = { status: "idle" };

/** Signature of an auth server action bound to a form with useActionState. */
export type AuthAction = (state: AuthFormState, form: FormData) => Promise<AuthFormState>;
