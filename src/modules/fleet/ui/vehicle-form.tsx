"use client";

import { useActionState } from "react";

import { getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SelectField } from "../../../ui/select-field";
import { SubmitButton } from "../../../ui/submit-button";
import { FUEL_TYPES, VEHICLE_CATEGORIES } from "../application/vehicle-input";

export type VehicleFormState =
  | { status: "idle" }
  | { status: "done" | "error"; messageKey: MessageKey; fields?: readonly string[] };

export type VehicleFormAction = (
  state: VehicleFormState,
  form: FormData,
) => Promise<VehicleFormState>;

export interface VehicleFormValues {
  name: string;
  plate: string;
  make: string;
  model: string;
  category: string;
  fuelType: string;
  seats: number;
  price: string;
  notes: string;
  updatedAt: string;
}

const IDLE: VehicleFormState = { status: "idle" };
type Errors = (name: string) => string | undefined;

function IdentityFields({ v, invalid }: { v: VehicleFormValues | null; invalid: Errors }) {
  const t = getTranslator();
  return (
    <>
      <Field
        name="name"
        label={t("vehicles.form.name")}
        defaultValue={v?.name}
        required
        error={invalid("name")}
      />
      <Field
        name="plate"
        label={t("vehicles.form.plate")}
        defaultValue={v?.plate}
        required
        autoComplete="off"
        error={invalid("plate")}
      />
      <Field
        name="make"
        label={t("vehicles.form.make")}
        defaultValue={v?.make}
        required
        error={invalid("make")}
      />
      <Field
        name="model"
        label={t("vehicles.form.model")}
        defaultValue={v?.model}
        required
        error={invalid("model")}
      />
    </>
  );
}

function KindFields({ v, invalid }: { v: VehicleFormValues | null; invalid: Errors }) {
  const t = getTranslator();
  return (
    <>
      <SelectField
        name="category"
        label={t("vehicles.form.category")}
        defaultValue={v?.category ?? "city"}
        error={invalid("category")}
        options={VEHICLE_CATEGORIES.map((c) => ({ value: c, label: t(`vehicles.category.${c}`) }))}
      />
      <SelectField
        name="fuelType"
        label={t("vehicles.form.fuelType")}
        defaultValue={v?.fuelType ?? "petrol"}
        error={invalid("fuelType")}
        options={FUEL_TYPES.map((f) => ({ value: f, label: t(`vehicles.fuel.${f}`) }))}
      />
    </>
  );
}

function PriceFields({ v, invalid }: { v: VehicleFormValues | null; invalid: Errors }) {
  const t = getTranslator();
  return (
    <>
      <Field
        name="seats"
        type="number"
        inputMode="numeric"
        min={1}
        max={20}
        label={t("vehicles.form.seats")}
        defaultValue={v?.seats ?? 5}
        required
        error={invalid("seats")}
      />
      <Field
        name="price"
        inputMode="decimal"
        label={t("vehicles.form.price")}
        hint={t("vehicles.form.priceHint")}
        defaultValue={v?.price}
        required
        error={invalid("dailyPriceMinor")}
      />
      <Field
        name="notes"
        label={t("vehicles.form.notes")}
        hint={t("vehicles.form.notesHint")}
        defaultValue={v?.notes}
        error={invalid("notes")}
      />
    </>
  );
}

/** FLT-01/02 form; editing sends the version it was loaded with (stale saves are refused). */
export function VehicleForm(props: {
  action: VehicleFormAction;
  values: VehicleFormValues | null;
}) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, IDLE);
  const invalid: Errors = (name) =>
    state.status === "error" && state.fields?.includes(name) ? t(state.messageKey) : undefined;
  const label = props.values ? t("vehicles.form.save") : t("vehicles.form.add");
  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      {props.values ? (
        <input type="hidden" name="expectedUpdatedAt" value={props.values.updatedAt} />
      ) : null}
      <IdentityFields v={props.values} invalid={invalid} />
      <KindFields v={props.values} invalid={invalid} />
      <PriceFields v={props.values} invalid={invalid} />
      <SubmitButton label={label} pendingLabel={t("vehicles.form.saving")} />
      {state.status === "idle" ? null : (
        <Alert kind={state.status === "error" ? "error" : "status"}>{t(state.messageKey)}</Alert>
      )}
    </form>
  );
}
