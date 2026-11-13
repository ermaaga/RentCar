"use client";

import { useActionState } from "react";

import { formatMessage, getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";

// W-D5 step 2 (BKG-06): vehicle, customer, optional payment and notes. On an error the action sends
// back what was typed, so the fields are filled again; the conflicting booking is linked by code.

export interface VehicleChoice {
  id: string;
  label: string;
  detail: string;
  /** Why it can't be chosen ("Booked: …", "In maintenance"), or null when it is free. */
  blocked: string | null;
}

export type AdminBookingFormState =
  | { status: "idle" }
  | {
      status: "error";
      messageKey: MessageKey;
      params?: Record<string, string>;
      fields?: readonly string[];
      values?: Record<string, string>;
      conflictHref?: string;
    };

export type AdminBookingFormAction = (
  state: AdminBookingFormState,
  form: FormData,
) => Promise<AdminBookingFormState>;

const IDLE: AdminBookingFormState = { status: "idle" };

function VehicleChoices(props: {
  choices: readonly VehicleChoice[];
  selected: string | undefined;
}) {
  const t = getTranslator();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-lg font-semibold">{t("bookings.new.vehicle")}</legend>
      {props.choices.map((v) => (
        <label
          key={v.id}
          className="flex min-h-12 items-start gap-3 rounded-md border border-border p-3 has-[:disabled]:opacity-70"
        >
          <input
            type="radio"
            name="vehicleId"
            value={v.id}
            disabled={v.blocked !== null}
            defaultChecked={props.selected === v.id}
            required
            className="mt-1 size-5"
          />
          <span className="flex flex-col">
            <span className="font-semibold">{v.label}</span>
            <span>{v.blocked ?? v.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

type Invalid = (f: string) => string | undefined;

const CUSTOMER_FIELDS = [
  { name: "firstName", label: "bookings.new.firstName", type: "text", required: true },
  { name: "lastName", label: "bookings.new.lastName", type: "text", required: true },
  { name: "phone", label: "bookings.new.phone", type: "tel", required: true },
  { name: "email", label: "bookings.new.email", type: "email", required: false },
] as const;

function CustomerFields({ values, invalid }: { values: Record<string, string>; invalid: Invalid }) {
  const t = getTranslator();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-lg font-semibold">{t("bookings.new.customer")}</legend>
      <p className="text-sm">{t("bookings.new.customerHint")}</p>
      {CUSTOMER_FIELDS.map((f) => (
        <Field
          key={f.name}
          name={f.name}
          type={f.type}
          label={t(f.label)}
          defaultValue={values[f.name]}
          required={f.required}
          autoComplete="off"
          error={invalid(f.name)}
        />
      ))}
    </fieldset>
  );
}

function PaymentChoice({ paid }: { paid: string }) {
  const t = getTranslator();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-lg font-semibold">{t("bookings.new.payment")}</legend>
      {(["", "card", "cash"] as const).map((m) => (
        <label key={m} className="flex min-h-12 items-center gap-2">
          <input
            type="radio"
            name="paid"
            value={m}
            defaultChecked={paid === m}
            className="size-5"
          />
          {t(m === "" ? "bookings.new.notPaid" : `bookings.new.paid.${m}`)}
        </label>
      ))}
    </fieldset>
  );
}

function NotesField({ value, error }: { value: string | undefined; error: string | undefined }) {
  const t = getTranslator();
  const describedBy = error ? "booking-notes-hint booking-notes-error" : "booking-notes-hint";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="booking-notes" className="text-lg font-semibold">
        {t("bookings.detail.notes")}
      </label>
      <p id="booking-notes-hint" className="text-sm">
        {t("bookings.actions.cancelReasonHint")}
      </p>
      <textarea
        id="booking-notes"
        name="notes"
        maxLength={2000}
        rows={3}
        defaultValue={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-border bg-background p-3 text-foreground"
      />
      {error ? (
        <p id="booking-notes-error" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AdminBookingForm(props: {
  action: AdminBookingFormAction;
  choices: readonly VehicleChoice[];
}) {
  const t = getTranslator();
  const [state, formAction] = useActionState(props.action, IDLE);
  const error = state.status === "error" ? state : null;
  const message = error ? formatMessage(t(error.messageKey), error.params ?? {}) : null;
  const invalid = (f: string) => (error?.fields?.includes(f) ? (message ?? undefined) : undefined);
  const values = error?.values ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <VehicleChoices choices={props.choices} selected={values.vehicleId} />
      <CustomerFields values={values} invalid={invalid} />
      <PaymentChoice paid={values.paid ?? ""} />
      <NotesField value={values.notes} error={invalid("notes")} />
      {message ? (
        <div className="flex flex-col gap-2">
          <Alert kind="error">{message}</Alert>
          {error?.conflictHref ? (
            <a href={error.conflictHref} className="w-fit underline">
              {t("bookings.new.openConflict")}
            </a>
          ) : null}
        </div>
      ) : null}
      <SubmitButton label={t("bookings.new.save")} pendingLabel={t("bookings.new.saving")} />
    </form>
  );
}
