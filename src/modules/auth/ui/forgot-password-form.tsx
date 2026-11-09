"use client";

import { useActionState } from "react";

import { getTranslator } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";
import { IDLE, type AuthAction } from "./form-state";

/** Always answers the same way, whether or not an account matches (US-002, SR-AUT-07). */
export function ForgotPasswordForm({ action }: { action: AuthAction }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(action, IDLE);
  if (state.status === "done") {
    return <Alert kind="status">{t(state.messageKey)}</Alert>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.status === "error" ? <Alert kind="error">{t(state.messageKey)}</Alert> : null}
      <p>{t("auth.forgot.intro")}</p>
      <Field
        name="identifier"
        label={t("auth.forgot.identifier")}
        autoComplete="username"
        autoCapitalize="none"
        required
      />
      <SubmitButton label={t("auth.forgot.submit")} pendingLabel={t("auth.forgot.pending")} />
    </form>
  );
}
