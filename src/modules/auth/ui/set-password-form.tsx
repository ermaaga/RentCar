"use client";

import { useActionState, useEffect } from "react";

import { getTranslator } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { SubmitButton } from "../../../ui/submit-button";
import { NewPasswordFields } from "./new-password-fields";
import { IDLE, type AuthAction } from "./form-state";

/**
 * The token arrives in the URL; it is kept in a hidden field and removed from the address bar on
 * mount (docs/07-frontend.md, X5), so it does not stay in history or leak through Referer.
 */
export function SetPasswordForm(props: { action: AuthAction; token: string; username: string }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, IDLE);
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.status === "error" ? <Alert kind="error">{t(state.messageKey)}</Alert> : null}
      <p>
        <span className="text-muted-foreground">{t("auth.setPassword.account")}</span>{" "}
        <strong>{props.username}</strong>
      </p>
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="username" value={props.username} autoComplete="username" />
      <NewPasswordFields />
      <SubmitButton
        label={t("auth.setPassword.submit")}
        pendingLabel={t("auth.setPassword.pending")}
      />
    </form>
  );
}
