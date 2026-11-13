import type { ReactNode } from "react";

import {
  changeBookingStatusAction,
  clearPaymentAction,
  recordPaymentAction,
  type BookingRef,
} from "@/app/actions/bookings";
import { formatMessage, getTranslator } from "@/i18n";
import { decideStatusChange, formatLocal, type AdminBookingDetail } from "@/modules/booking";
import { ConsoleActionForm } from "@/modules/tenancy/ui/console-action-form";

import { localLabel, money } from "../../../_components/format";

// W-D4 admin actions (BKG-09/10), allowed in read-only. Each one is a disclosure with its own
// confirmation text and form, so it works without JavaScript and keyboard order follows the page;
// the outcome is announced inside the form. Bound arguments carry the code and the version shown.

interface Props {
  slug: string;
  b: AdminBookingDetail;
  currency: string;
  timeZone: string;
  now: Date;
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-md border border-border p-4">
      <summary className="min-h-12 cursor-pointer content-center font-semibold">
        {props.title}
      </summary>
      <div className="mt-3 flex flex-col gap-3">{props.children}</div>
    </details>
  );
}

function PaymentPanel({ slug, b, currency }: Props) {
  const t = getTranslator();
  const ref: BookingRef = { code: b.code, version: b.version };
  const total = money(b.totalMinor, currency);
  const title = b.isPaid
    ? formatMessage(t("bookings.actions.updatePayment"), { total })
    : t("bookings.actions.recordPayment");
  return (
    <Panel title={title}>
      <ConsoleActionForm
        action={recordPaymentAction.bind(null, slug, ref)}
        submit="bookings.actions.markPaid"
      >
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">{t("bookings.actions.method")}</legend>
          {(["card", "cash"] as const).map((m) => (
            <label key={m} className="flex min-h-12 items-center gap-2">
              <input
                type="radio"
                name="method"
                value={m}
                defaultChecked={m === "card"}
                className="size-5"
              />
              {t(`bookings.detail.method.${m}`)}
            </label>
          ))}
        </fieldset>
        <p>{formatMessage(t("bookings.actions.amountReceived"), { total })}</p>
      </ConsoleActionForm>
    </Panel>
  );
}

function UnpaidPanel({ slug, b }: Props) {
  const t = getTranslator();
  return (
    <Panel title={t("bookings.actions.markUnpaid")}>
      <ConsoleActionForm
        action={clearPaymentAction.bind(null, slug, { code: b.code, version: b.version })}
        submit="bookings.actions.markUnpaid"
        hint="bookings.actions.markUnpaidHint"
      >
        <input type="hidden" name="confirm" value="yes" />
      </ConsoleActionForm>
    </Panel>
  );
}

function completionText({ b, currency, timeZone, now }: Props): string {
  const t = getTranslator();
  const state = { ...b, status: b.status, dailyPriceMinor: b.dailyPriceMinor, isPaid: b.isPaid };
  const outcome = decideStatusChange(state, "complete", now, timeZone);
  const short = outcome.kind === "change" ? outcome.shortened : null;
  if (!short) return t("bookings.actions.completeOnTime");
  return formatMessage(t("bookings.actions.completeEarly"), {
    end: localLabel(formatLocal(short.endAt, timeZone)),
    fromDays: b.billedDays,
    toDays: short.billedDays,
    fromTotal: money(b.totalMinor, currency),
    toTotal: money(short.totalMinor, currency),
  });
}

function StatusPanels(props: Props) {
  const t = getTranslator();
  const { slug, b } = props;
  const ref = (target: "active" | "complete") => ({ code: b.code, version: b.version, target });
  return (
    <>
      {b.status === "confirmed" ? (
        <Panel title={t("bookings.actions.markActive")}>
          <ConsoleActionForm
            action={changeBookingStatusAction.bind(null, slug, ref("active"))}
            submit="bookings.actions.markActive"
            hint="bookings.actions.markActiveHint"
          />
        </Panel>
      ) : null}
      {b.status === "active" ? (
        <Panel title={t("bookings.actions.complete")}>
          <p>{completionText(props)}</p>
          <ConsoleActionForm
            action={changeBookingStatusAction.bind(null, slug, ref("complete"))}
            submit="bookings.actions.complete"
          />
        </Panel>
      ) : null}
    </>
  );
}

function CancelPanel({ slug, b }: Props) {
  const t = getTranslator();
  return (
    <Panel title={t("bookings.actions.cancel")}>
      <p>{t("bookings.actions.cancelEffects")}</p>
      {b.isPaid ? <p className="font-semibold">{t("bookings.actions.cancelPaid")}</p> : null}
      <ConsoleActionForm
        action={changeBookingStatusAction.bind(null, slug, {
          code: b.code,
          version: b.version,
          target: "cancel",
        })}
        submit="bookings.actions.cancelSubmit"
      >
        <label htmlFor="cancel-reason" className="font-medium">
          {t("bookings.actions.cancelReason")}
        </label>
        <input
          id="cancel-reason"
          name="reason"
          maxLength={200}
          aria-describedby="cancel-reason-hint"
          className="min-h-12 rounded-md border border-border bg-background px-3"
        />
        <p id="cancel-reason-hint" className="text-sm">
          {t("bookings.actions.cancelReasonHint")}
        </p>
      </ConsoleActionForm>
    </Panel>
  );
}

/** Nothing for a cancelled booking (W-D4); otherwise the panels its state allows. */
export function BookingActions(props: Props) {
  const t = getTranslator();
  const { b } = props;
  if (b.status === "cancelled") return null;
  const open = b.status === "confirmed" || b.status === "active";
  const paymentDue = !b.isPaid || b.paidAmountMinor !== b.totalMinor;
  return (
    <section aria-labelledby="actions-title" className="flex flex-col gap-3">
      <h2 id="actions-title" className="text-lg font-semibold">
        {t("bookings.actions.title")}
      </h2>
      {paymentDue ? <PaymentPanel {...props} /> : null}
      {b.isPaid ? <UnpaidPanel {...props} /> : null}
      <StatusPanels {...props} />
      {open ? <CancelPanel {...props} /> : null}
    </section>
  );
}
