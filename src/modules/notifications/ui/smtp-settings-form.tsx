"use client";

import { useActionState } from "react";

import { formatMessage, getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";
import { SMTP_IDLE, type SmtpAction, type SmtpActionState } from "./form-state";

export interface SmtpFormValues {
  host: string;
  port: number;
  security: "starttls" | "tls";
  username: string;
  fromAddress: string;
  fromName: string;
  updatedAt: string;
  passwordSet: boolean;
}

type Translate = ReturnType<typeof getTranslator>;

function SmtpOutcome({ state, t }: { state: SmtpActionState; t: Translate }) {
  if (state.status === "idle") return null;
  const text = formatMessage(t(state.messageKey), { category: state.category ?? "" });
  return <Alert kind={state.status === "error" ? "error" : "status"}>{text}</Alert>;
}

function SelectField(props: {
  name: string;
  label: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.name} className="font-medium">
        {props.label}
      </label>
      <select
        id={props.name}
        name={props.name}
        defaultValue={props.defaultValue}
        className="min-h-12 rounded-md border border-border bg-background px-3 text-foreground"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface TextDef {
  name: "host" | "username" | "fromAddress" | "fromName";
  label: MessageKey;
  hint?: MessageKey;
  type?: string;
  required?: boolean;
}

const SERVER: readonly TextDef[] = [
  { name: "host", label: "smtpSettings.host", hint: "smtpSettings.hostHint", required: true },
];
const ACCOUNT: readonly TextDef[] = [
  { name: "username", label: "smtpSettings.username", required: true },
];
const SENDER: readonly TextDef[] = [
  { name: "fromAddress", label: "smtpSettings.fromAddress", type: "email", required: true },
  { name: "fromName", label: "smtpSettings.fromName" },
];

interface FieldsProps {
  defs: readonly TextDef[];
  values: SmtpFormValues | null;
  state: SmtpActionState;
  t: Translate;
}

function errorFor(state: SmtpActionState, name: string, t: Translate): string | undefined {
  return state.status === "error" && state.fields?.includes(name)
    ? t("smtpSettings.formInvalid")
    : undefined;
}

function TextFields({ defs, values, state, t }: FieldsProps) {
  return defs.map((d) => (
    <Field
      key={d.name}
      name={d.name}
      type={d.type ?? "text"}
      label={t(d.label)}
      hint={d.hint ? t(d.hint) : undefined}
      defaultValue={values?.[d.name] ?? ""}
      error={errorFor(state, d.name, t)}
      autoComplete="off"
      required={d.required}
    />
  ));
}

function ConnectionSelects(props: { values: SmtpFormValues | null; ports: readonly number[] }) {
  const t = getTranslator();
  return (
    <>
      <SelectField
        name="port"
        label={t("smtpSettings.port")}
        defaultValue={String(props.values?.port ?? 587)}
        options={props.ports.map((p) => ({ value: String(p), label: String(p) }))}
      />
      <SelectField
        name="security"
        label={t("smtpSettings.security")}
        defaultValue={props.values?.security ?? "starttls"}
        options={[
          { value: "starttls", label: t("smtpSettings.securityStarttls") },
          { value: "tls", label: t("smtpSettings.securityTls") },
        ]}
      />
    </>
  );
}

/** NTF-01 form. The password field is always empty: a blank value keeps the stored password. */
export function SmtpSettingsForm(props: {
  action: SmtpAction;
  values: SmtpFormValues | null;
  ports: readonly number[];
}) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, SMTP_IDLE);
  const common = { values: props.values, state, t };
  const passwordHint = props.values?.passwordSet ? t("smtpSettings.passwordKeep") : undefined;
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      <SmtpOutcome state={state} t={t} />
      <input
        type="hidden"
        name="expectedUpdatedAt"
        value={props.values?.updatedAt ?? ""}
        readOnly
      />
      <TextFields defs={SERVER} {...common} />
      <ConnectionSelects values={props.values} ports={props.ports} />
      <TextFields defs={ACCOUNT} {...common} />
      <Field
        name="password"
        type="password"
        label={t("smtpSettings.password")}
        hint={passwordHint}
        error={errorFor(state, "password", t)}
        autoComplete="new-password"
      />
      <TextFields defs={SENDER} {...common} />
      <SubmitButton label={t("smtpSettings.submit")} pendingLabel={t("smtpSettings.pending")} />
    </form>
  );
}

/** NTF-02: one button; the outcome is announced. */
export function SmtpTestForm({ action }: { action: SmtpAction }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(action, SMTP_IDLE);
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <p className="text-muted-foreground">{t("smtpSettings.testHint")}</p>
      <SubmitButton
        label={t("smtpSettings.testSubmit")}
        pendingLabel={t("smtpSettings.testSubmit")}
      />
      <SmtpOutcome state={state} t={t} />
    </form>
  );
}
