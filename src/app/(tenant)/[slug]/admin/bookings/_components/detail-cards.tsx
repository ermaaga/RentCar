import { formatMessage, getTranslator } from "@/i18n";
import { balanceMinor, type AdminBookingDetail } from "@/modules/booking";

import { localLabel, money } from "../../../_components/format";

// W-D4 cards (read only in this slice): customer, rental, price and payment, notes, email, history.

const CARD = "flex flex-col gap-2 rounded-md border border-border p-4";

function Card(props: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={props.id} className={CARD}>
      <h2 id={props.id} className="text-lg font-semibold">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function Facts({ rows }: { rows: readonly [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-medium">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CustomerCard({ b }: { b: AdminBookingDetail }) {
  const t = getTranslator();
  return (
    <Card id="customer-title" title={t("bookings.detail.customer")}>
      <p>{b.customerName}</p>
      {b.phone ? (
        <a href={`tel:${b.phone}`} className="min-h-12 w-fit content-center underline">
          {formatMessage(t("bookings.detail.call"), { phone: b.phone })}
        </a>
      ) : null}
      {b.email ? (
        <a href={`mailto:${b.email}`} className="min-h-12 w-fit content-center underline">
          {formatMessage(t("bookings.detail.emailTo"), { email: b.email })}
        </a>
      ) : (
        <p>{t("bookings.detail.noEmail")}</p>
      )}
    </Card>
  );
}

export function RentalCard({ b, timeZone }: { b: AdminBookingDetail; timeZone: string }) {
  const t = getTranslator();
  return (
    <Card id="rental-title" title={t("bookings.detail.rental")}>
      <Facts
        rows={[
          [t("bookings.column.vehicle"), b.vehicleName],
          [t("bookings.detail.pickup"), localLabel(b.pickup)],
          [t("bookings.detail.return"), localLabel(b.return)],
          [t("bookings.detail.billedDays"), String(b.billedDays)],
          [
            t("bookings.detail.source"),
            t(
              b.source === "public"
                ? "bookings.detail.sourcePublic"
                : "bookings.detail.sourceAdmin",
            ),
          ],
          [t("bookings.detail.created"), localLabel(b.createdAt)],
        ]}
      />
      <p className="text-sm">{formatMessage(t("bookings.detail.timeZone"), { zone: timeZone })}</p>
    </Card>
  );
}

function balanceText(b: AdminBookingDetail, currency: string): string {
  const t = getTranslator();
  const due = balanceMinor(b.totalMinor, b.paidAmountMinor, b.isPaid);
  if (due === 0) return t("bookings.detail.balanceZero");
  const amount = money(Math.abs(due), currency);
  return formatMessage(t(due > 0 ? "bookings.detail.balanceDue" : "bookings.detail.balanceOver"), {
    amount,
  });
}

export function PriceCard({ b, currency }: { b: AdminBookingDetail; currency: string }) {
  const t = getTranslator();
  const paid =
    b.isPaid && b.paymentMethod
      ? formatMessage(t("bookings.detail.paidWith"), {
          amount: money(b.paidAmountMinor, currency),
          method: t(`bookings.detail.method.${b.paymentMethod}`),
        })
      : t("bookings.detail.notPaid");
  return (
    <Card id="price-title" title={t("bookings.detail.price")}>
      <p>
        {formatMessage(
          t(b.billedDays === 1 ? "bookings.detail.priceLineOne" : "bookings.detail.priceLine"),
          {
            days: b.billedDays,
            daily: money(b.dailyPriceMinor, currency),
            total: money(b.totalMinor, currency),
          },
        )}
      </p>
      <p>{paid}</p>
      {b.status === "cancelled" ? null : (
        <p className="font-semibold">{balanceText(b, currency)}</p>
      )}
    </Card>
  );
}

export function NotesCard({ b }: { b: AdminBookingDetail }) {
  const t = getTranslator();
  return (
    <Card id="notes-title" title={t("bookings.detail.notes")}>
      <p className="whitespace-pre-line">{b.notes ?? t("bookings.detail.noNotes")}</p>
    </Card>
  );
}

export function EmailCard({ b }: { b: AdminBookingDetail }) {
  const t = getTranslator();
  const e = b.emailStatus;
  const text = e
    ? formatMessage(
        t(`bookings.detail.emailState.${e.status}` as "bookings.detail.emailState.sent"),
        {
          at: e.at ? localLabel(e.at) : "",
        },
      )
    : t("bookings.detail.emailNone");
  return (
    <Card id="email-title" title={t("bookings.detail.email")}>
      <p>{text}</p>
    </Card>
  );
}

export function HistoryCard({ items }: { items: NonNullable<AdminBookingDetail["history"]> }) {
  const t = getTranslator();
  return (
    <Card id="history-title" title={t("bookings.detail.history")}>
      {items.length === 0 ? (
        <p>{t("bookings.detail.historyEmpty")}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((h, i) => (
            <li key={`${h.at}-${String(i)}`}>
              {formatMessage(t("bookings.detail.historyLine"), {
                at: localLabel(h.at),
                who: h.who,
                what: historyAction(h.action),
              })}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const ACTIONS = ["created", "updated", "cancelled", "status_changed", "paid", "unpaid"] as const;

function historyAction(action: string): string {
  const t = getTranslator();
  const name = action.replace(/^booking\./, "");
  return (ACTIONS as readonly string[]).includes(name)
    ? t(`bookings.detail.action.${name as (typeof ACTIONS)[number]}`)
    : action;
}
