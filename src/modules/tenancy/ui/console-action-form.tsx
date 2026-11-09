"use client";

import { useActionState, type ReactNode } from "react";

import { getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { SubmitButton } from "../../../ui/submit-button";

export type ConsoleActionState =
  { status: "idle" } | { status: "done" | "error"; messageKey: MessageKey };

export type ConsoleAction = (
  state: ConsoleActionState,
  form: FormData,
) => Promise<ConsoleActionState>;

const IDLE: ConsoleActionState = { status: "idle" };

/** One console command: optional fields, a submit button and the announced outcome. */
export function ConsoleActionForm(props: {
  action: ConsoleAction;
  submit: MessageKey;
  hint?: MessageKey;
  children?: ReactNode;
}) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, IDLE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {props.hint ? <p className="text-muted-foreground">{t(props.hint)}</p> : null}
      {props.children}
      <SubmitButton label={t(props.submit)} pendingLabel={t(props.submit)} />
      {state.status === "idle" ? null : (
        <Alert kind={state.status === "error" ? "error" : "status"}>{t(state.messageKey)}</Alert>
      )}
    </form>
  );
}
