"use client";

import { useActionState } from "react";

import { getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";

export type OperatorFormState =
  | { status: "idle" }
  | { status: "done" | "error"; messageKey: MessageKey; fields?: readonly string[] };

export type OperatorFormAction = (
  state: OperatorFormState,
  form: FormData,
) => Promise<OperatorFormState>;

const IDLE: OperatorFormState = { status: "idle" };

function Outcome({ state }: { state: OperatorFormState }) {
  const t = getTranslator();
  if (state.status === "idle") {
    return null;
  }
  return <Alert kind={state.status === "error" ? "error" : "status"}>{t(state.messageKey)}</Alert>;
}

/** AUT-12 form (W-D9): the link is emailed, never shown (A-26). */
export function AddOperatorForm(props: { action: OperatorFormAction; disabledReason?: string }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, IDLE);
  const invalid = (name: string) =>
    state.status === "error" && state.fields?.includes(name) ? t(state.messageKey) : undefined;
  if (props.disabledReason) {
    return <Alert kind="status">{props.disabledReason}</Alert>;
  }
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      <p className="text-muted-foreground">{t("operators.add.helper")}</p>
      <Field
        name="displayName"
        label={t("operators.add.name")}
        required
        autoComplete="off"
        error={invalid("displayName")}
      />
      <Field
        name="username"
        label={t("operators.add.username")}
        required
        autoComplete="off"
        hint={t("operators.add.usernameHint")}
        error={invalid("username")}
      />
      <Field
        name="email"
        type="email"
        label={t("operators.add.email")}
        required
        autoComplete="off"
        error={invalid("email")}
      />
      <SubmitButton label={t("operators.add.submit")} pendingLabel={t("operators.add.pending")} />
      <Outcome state={state} />
    </form>
  );
}
