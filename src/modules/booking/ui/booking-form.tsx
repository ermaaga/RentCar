"use client";

import { useActionState } from "react";

import { formatMessage, getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { Field } from "../../../ui/field";
import { SubmitButton } from "../../../ui/submit-button";
import type { BookingAction, BookingFormState } from "./booking-form-state";

// W-P3 booking form (docs/04a-ux.md): customer details, the acknowledgement and hidden fields that
// carry the signed form token and the price the customer saw. The honeypot is hidden from people and
// from assistive technology; bots that fill it get the decoy answer.

export interface BookingFormProps {
  action: BookingAction;
  hidden: {
    formToken: string;
    vehicleId: string;
    pickup: string;
    return: string;
    expectedTotalMinor: number;
  };
}

const IDLE: BookingFormState = { status: "idle" };

function errorText(state: BookingFormState): string | null {
  if (state.status !== "error") return null;
  const t = getTranslator();
  return formatMessage(t(`public.book.errors.${state.code}` as MessageKey), {
    total: state.total ?? "",
  });
}

function Honeypot() {
  const t = getTranslator();
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label htmlFor="website">{t("public.book.website")}</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

type Invalid = (name: string) => string | undefined;

function NameFields({ invalid }: { invalid: Invalid }) {
  const t = getTranslator();
  return (
    <>
      <Field
        name="firstName"
        label={t("public.book.firstName")}
        autoComplete="given-name"
        required
        maxLength={80}
        error={invalid("firstName")}
      />
      <Field
        name="lastName"
        label={t("public.book.lastName")}
        autoComplete="family-name"
        required
        maxLength={80}
        error={invalid("lastName")}
      />
    </>
  );
}

function ContactFields({ invalid }: { invalid: Invalid }) {
  const t = getTranslator();
  return (
    <>
      <Field
        name="phone"
        type="tel"
        label={t("public.book.phone")}
        hint={t("public.book.phoneHint")}
        autoComplete="tel"
        required
        maxLength={32}
        error={invalid("phone")}
      />
      <Field
        name="email"
        type="email"
        label={t("public.book.email")}
        hint={t("public.book.emailHint")}
        autoComplete="email"
        maxLength={254}
        error={invalid("email")}
      />
    </>
  );
}

export function BookingForm({ action, hidden }: BookingFormProps) {
  const t = getTranslator();
  const [state, formAction] = useActionState(action, IDLE);
  if (state.status === "received") {
    return <Alert kind="status">{t("public.book.received")}</Alert>;
  }
  const message = errorText(state);
  const fields = state.status === "error" ? (state.fields ?? []) : [];
  const invalid = (name: string) =>
    fields.includes(name) ? t("system.newTenant.fieldInvalid") : undefined;
  return (
    <form action={formAction} className="relative flex max-w-md flex-col gap-4" noValidate>
      {message ? <Alert kind="error">{message}</Alert> : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={String(value)} />
      ))}
      <NameFields invalid={invalid} />
      <ContactFields invalid={invalid} />
      <Honeypot />
      <label className="flex min-h-12 items-start gap-3">
        <input type="checkbox" name="acknowledge" required className="mt-1 size-5" />
        <span>{t("public.book.acknowledge")}</span>
      </label>
      <SubmitButton label={t("public.book.submit")} pendingLabel={t("public.book.pending")} />
    </form>
  );
}
