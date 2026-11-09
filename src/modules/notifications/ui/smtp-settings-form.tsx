"use client";

import { useActionState } from "react";

import { getTranslator } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SelectField } from "../../../ui/select-field";
import { SubmitButton } from "../../../ui/submit-button";
import { SMTP_IDLE, type SmtpAction } from "./form-state";

export interface SmtpFormValues {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  fromAddress: string;
  fromName: string;
  passwordSet: boolean;
}

const PORTS = ["587", "465", "2525", "25"] as const;

type Errors = (name: string) => string | undefined;

function ServerFields({ v, invalid }: { v: SmtpFormValues | null; invalid: Errors }) {
  const t = getTranslator();
  return (
    <>
      <Field
        name="host"
        label={t("settings.email.host")}
        defaultValue={v?.host}
        required
        autoComplete="off"
        error={invalid("host")}
      />
      <SelectField
        name="port"
        label={t("settings.email.port")}
        defaultValue={String(v?.port ?? 587)}
        options={PORTS.map((p) => ({ value: p, label: p }))}
        error={invalid("port")}
      />
      <SelectField
        name="security"
        label={t("settings.email.security")}
        defaultValue={v?.security ?? "starttls"}
        error={invalid("security")}
        options={[
          { value: "starttls", label: t("settings.email.securityStarttls") },
          { value: "tls", label: t("settings.email.securityTls") },
        ]}
      />
    </>
  );
}

function AccountFields({ v, invalid }: { v: SmtpFormValues | null; invalid: Errors }) {
  const t = getTranslator();
  return (
    <>
      <Field
        name="username"
        label={t("settings.email.username")}
        defaultValue={v?.username}
        required
        autoComplete="off"
        error={invalid("username")}
      />
      <Field
        name="password"
        type="password"
        label={t("settings.email.password")}
        hint={v?.passwordSet ? t("settings.email.passwordKeep") : undefined}
        autoComplete="new-password"
        error={invalid("password")}
      />
      <Field
        name="fromAddress"
        type="email"
        label={t("settings.email.fromAddress")}
        defaultValue={v?.fromAddress}
        required
        error={invalid("fromAddress")}
      />
      <Field
        name="fromName"
        label={t("settings.email.fromName")}
        defaultValue={v?.fromName}
        error={invalid("fromName")}
      />
    </>
  );
}

/** NTF-01 form: the stored password is never sent to the browser; leaving it empty keeps it. */
export function SmtpSettingsForm(props: { action: SmtpAction; values: SmtpFormValues | null }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, SMTP_IDLE);
  const invalid: Errors = (name) =>
    state.status === "error" && state.fields?.includes(name) ? t(state.messageKey) : undefined;
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      {state.status === "idle" ? null : (
        <Alert kind={state.status === "error" ? "error" : "status"}>{t(state.messageKey)}</Alert>
      )}
      <ServerFields v={props.values} invalid={invalid} />
      <AccountFields v={props.values} invalid={invalid} />
      <SubmitButton label={t("settings.email.save")} pendingLabel={t("settings.email.saving")} />
    </form>
  );
}

/** NTF-02: sends a fixed test message to the signed-in admin's own address. */
export function SmtpTestForm(props: { action: SmtpAction }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, SMTP_IDLE);
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <SubmitButton label={t("settings.email.test")} pendingLabel={t("settings.email.testing")} />
      {state.status === "idle" ? null : (
        <Alert kind={state.status === "error" ? "error" : "status"}>{t(state.messageKey)}</Alert>
      )}
    </form>
  );
}
