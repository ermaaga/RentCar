"use client";

import { useActionState } from "react";

import { getTranslator } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";
import { NewPasswordFields } from "./new-password-fields";
import { IDLE, type AuthAction } from "./form-state";

export function ChangePasswordForm({ action }: { action: AuthAction }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      {state.status === "idle" ? null : (
        <Alert kind={state.status === "error" ? "error" : "status"}>{t(state.messageKey)}</Alert>
      )}
      <Field
        name="current"
        type="password"
        label={t("auth.account.current")}
        autoComplete="current-password"
        required
      />
      <NewPasswordFields />
      <SubmitButton label={t("auth.account.submit")} pendingLabel={t("auth.account.pending")} />
    </form>
  );
}
