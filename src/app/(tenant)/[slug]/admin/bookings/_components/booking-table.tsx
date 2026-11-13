import Link from "next/link";

import { formatMessage, getTranslator } from "@/i18n";
import type { AdminBookingRow } from "@/modules/booking";

import { localLabel, money } from "../../../_components/format";
import { PaymentChip, StatusChip } from "./status-chip";

// W-D3 results: a table from the md breakpoint, cards on phones (only one is displayed, so assistive
// technology meets it once). The code links to the detail page.

interface Props {
  slug: string;
  rows: readonly AdminBookingRow[];
  currency: string;
}

const href = (slug: string, code: string) => `/${slug}/admin/bookings/${code}`;

const COLUMNS = [
  "code",
  "customer",
  "vehicle",
  "pickup",
  "return",
  "total",
  "payment",
  "status",
] as const;

function Row({ slug, row: r, currency }: { slug: string; row: AdminBookingRow; currency: string }) {
  return (
    <tr className="border-b border-border align-top">
      <th scope="row" className="px-2 py-3 font-semibold">
        <Link href={href(slug, r.code)} className="underline">
          {r.code}
        </Link>
      </th>
      <td className="px-2 py-3">{r.customerName}</td>
      <td className="px-2 py-3">{r.vehicleName}</td>
      <td className="px-2 py-3">{localLabel(r.pickup)}</td>
      <td className="px-2 py-3">{localLabel(r.return)}</td>
      <td className="px-2 py-3">{money(r.totalMinor, currency)}</td>
      <td className="px-2 py-3">
        <PaymentChip paid={r.isPaid} />
      </td>
      <td className="px-2 py-3">
        <StatusChip status={r.status} />
      </td>
    </tr>
  );
}

function Table({ slug, rows, currency }: Props) {
  const t = getTranslator();
  return (
    <table className="hidden w-full border-collapse text-left md:table">
      <thead>
        <tr className="border-b border-border">
          {COLUMNS.map((c) => (
            <th key={c} scope="col" className="px-2 py-2 font-semibold">
              {t(`bookings.column.${c}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row key={r.code} slug={slug} row={r} currency={currency} />
        ))}
      </tbody>
    </table>
  );
}

function Card({
  slug,
  row: r,
  currency,
}: {
  slug: string;
  row: AdminBookingRow;
  currency: string;
}) {
  const t = getTranslator();
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={href(slug, r.code)} className="min-h-12 content-center font-semibold underline">
          {r.code}
        </Link>
        <StatusChip status={r.status} />
      </div>
      <p>{r.customerName}</p>
      {r.phone ? (
        <a href={`tel:${r.phone}`} className="w-fit underline">
          {r.phone}
        </a>
      ) : null}
      <p>{r.vehicleName}</p>
      <p>
        {formatMessage(t("bookings.period"), {
          pickup: localLabel(r.pickup),
          return: localLabel(r.return),
        })}
      </p>
      <p>
        {formatMessage(t("bookings.amountLine"), {
          total: money(r.totalMinor, currency),
          payment: t(r.isPaid ? "bookings.paid" : "bookings.unpaid"),
        })}
      </p>
    </li>
  );
}

function Cards({ slug, rows, currency }: Props) {
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {rows.map((r) => (
        <Card key={r.code} slug={slug} row={r} currency={currency} />
      ))}
    </ul>
  );
}

export function BookingTable(props: Props) {
  return (
    <>
      <Table {...props} />
      <Cards {...props} />
    </>
  );
}
