"use client";

import Link from "next/link";
import { useActionState } from "react";

import { getTranslator } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";
import { IDLE, type AuthAction } from "./form-state";

export function LoginForm(props: { action: AuthAction; forgotHref: string; notice?: boolean }) {
  const { action, notice } = props;
  const t = getTranslator();
  const [state, formAction] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {notice && state.status === "idle" ? (
        <Alert kind="status">{t("auth.login.passwordSet")}</Alert>
      ) : null}
      {state.status === "error" ? <Alert kind="error">{t(state.messageKey)}</Alert> : null}
      <Field
        name="username"
        label={t("auth.login.username")}
        autoComplete="username"
        autoCapitalize="none"
        required
      />
      <Field
        name="password"
        type="password"
        label={t("auth.login.password")}
        autoComplete="current-password"
        required
      />
      <SubmitButton label={t("auth.login.submit")} pendingLabel={t("auth.login.pending")} />
      <Link href={props.forgotHref} className="underline underline-offset-4">
        {t("auth.forgot.link")}
      </Link>
    </form>
  );
}
