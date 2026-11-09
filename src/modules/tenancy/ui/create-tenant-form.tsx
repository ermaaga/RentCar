"use client";

import { useActionState } from "react";

import { getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";
import { CREATE_TENANT_IDLE, type CreateTenantState } from "./form-state";

type Action = (state: CreateTenantState, form: FormData) => Promise<CreateTenantState>;

interface FieldDef {
  name: string;
  label: MessageKey;
  type?: string;
  hint?: MessageKey;
  defaultValue?: string;
  autoComplete?: string;
}

const BUSINESS: readonly FieldDef[] = [
  { name: "name", label: "system.newTenant.name", autoComplete: "organization" },
  { name: "slug", label: "system.newTenant.slug", hint: "system.newTenant.slugHint" },
  { name: "title", label: "system.newTenant.siteTitle" },
  { name: "contact.email", label: "system.newTenant.contactEmail", type: "email" },
  { name: "contact.phone", label: "system.newTenant.contactPhone", type: "tel" },
  { name: "countryCode", label: "system.newTenant.countryCode", defaultValue: "IT" },
  { name: "timeZone", label: "system.newTenant.timeZone", defaultValue: "Europe/Rome" },
  { name: "currency", label: "system.newTenant.currency", defaultValue: "EUR" },
];

const SUBSCRIPTION: readonly FieldDef[] = [
  {
    name: "subscription.maxVehicles",
    label: "system.newTenant.maxVehicles",
    type: "number",
    defaultValue: "10",
  },
  {
    name: "subscription.maxOperators",
    label: "system.newTenant.maxOperators",
    type: "number",
    defaultValue: "2",
  },
  { name: "subscription.startDate", label: "system.newTenant.startDate", type: "date" },
  { name: "subscription.endDate", label: "system.newTenant.endDate", type: "date" },
  {
    name: "subscription.priceMinor",
    label: "system.newTenant.price",
    type: "number",
    defaultValue: "0",
  },
  { name: "subscription.priceCurrency", label: "system.newTenant.currency", defaultValue: "EUR" },
];

const ADMIN: readonly FieldDef[] = [
  { name: "admin.displayName", label: "system.newTenant.adminName", autoComplete: "off" },
  { name: "admin.username", label: "system.newTenant.adminUsername", autoComplete: "off" },
  { name: "admin.email", label: "system.newTenant.adminEmail", type: "email", autoComplete: "off" },
];

function Group(props: {
  legend: string;
  fields: readonly FieldDef[];
  invalid: ReadonlySet<string>;
}) {
  const t = getTranslator();
  return (
    <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
      <legend className="px-1 text-lg font-semibold">{props.legend}</legend>
      {props.fields.map((f) => (
        <Field
          key={f.name}
          name={f.name}
          label={t(f.label)}
          type={f.type ?? "text"}
          hint={f.hint ? t(f.hint) : undefined}
          error={props.invalid.has(f.name) ? t("system.newTenant.fieldInvalid") : undefined}
          defaultValue={f.defaultValue}
          autoComplete={f.autoComplete}
          required
        />
      ))}
    </fieldset>
  );
}

function Outcome({ state }: { state: CreateTenantState }) {
  const t = getTranslator();
  if (state.status === "error") {
    return <Alert kind="error">{t(state.messageKey)}</Alert>;
  }
  if (state.status === "created") {
    return (
      <Alert kind="status">
        {t("system.newTenant.created")}{" "}
        {state.emailSent ? t("system.newTenant.emailSent") : t("system.newTenant.emailFailed")}
      </Alert>
    );
  }
  return null;
}

export function CreateTenantForm({ action }: { action: Action }) {
  const t = getTranslator();
  const [state, formAction] = useActionState(action, CREATE_TENANT_IDLE);
  const invalid = new Set(state.status === "error" ? state.fields : []);
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <Outcome state={state} />
      <Group legend={t("system.newTenant.business")} fields={BUSINESS} invalid={invalid} />
      <Group legend={t("system.newTenant.subscription")} fields={SUBSCRIPTION} invalid={invalid} />
      <Group legend={t("system.newTenant.admin")} fields={ADMIN} invalid={invalid} />
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" name="dpaSigned" className="size-6" />
        <span>{t("system.newTenant.dpa")}</span>
      </label>
      <SubmitButton
        label={t("system.newTenant.submit")}
        pendingLabel={t("system.newTenant.pending")}
      />
    </form>
  );
}
