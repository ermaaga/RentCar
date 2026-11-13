import Link from "next/link";

import { requireTenantSession } from "@/app/_lib/session";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { getAdminBooking, type AdminBookingDetail } from "@/modules/booking";

import {
  CustomerCard,
  EmailCard,
  HistoryCard,
  NotesCard,
  PriceCard,
  RentalCard,
} from "../_components/detail-cards";
import { PaymentChip, StatusChip } from "../_components/status-chip";
import { localLabel } from "../../../_components/format";

// W-D4 booking detail (BKG-12, FR-BKG-02/14), read only in this slice: actions (payment, status,
// edit, resend) arrive with BKG-08..10/15. A code of another tenant is the same "not found".
// Operators: contacts yes (REQ-11), history and PDF no.

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

function Header({ b, pdf }: { b: AdminBookingDetail; pdf: string | null }) {
  const t = getTranslator();
  const cancelled = b.cancelledAt ? localLabel(b.cancelledAt) : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{b.code}</h1>
        <StatusChip status={b.status} />
        <PaymentChip paid={b.isPaid} />
      </div>
      {cancelled ? (
        <p role="note">
          {b.cancelReason
            ? formatMessage(t("bookings.detail.cancelledReason"), {
                at: cancelled,
                reason: b.cancelReason,
              })
            : formatMessage(t("bookings.detail.cancelledNotice"), { at: cancelled })}
        </p>
      ) : null}
      {pdf ? (
        <a href={pdf} className="min-h-12 w-fit content-center underline">
          {t("bookings.detail.pdf")}
        </a>
      ) : null}
    </>
  );
}

export default async function BookingDetailPage(props: Props) {
  const t = getTranslator();
  const { slug, code } = await props.params;
  const { tenant, session } = await requireTenantSession(slug);
  const admin = session.role === "admin";
  const c = getContainer();
  const ctx = { tenantId: tenant.tenantId, now: c.clock.now(), timeZone: tenant.timeZone };
  const b = await getAdminBooking(c.pool, { code, withHistory: admin }, ctx);
  const back = (
    <Link href={`/${tenant.slug}/admin/bookings`} className="underline underline-offset-4">
      {t("bookings.detail.back")}
    </Link>
  );
  if (!b) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        {back}
        <h1 className="mt-4 text-2xl font-semibold">{t("bookings.detail.notFound")}</h1>
      </main>
    );
  }
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      {back}
      <Header b={b} pdf={admin ? `/${tenant.slug}/booking/${b.code}/pdf` : null} />
      <CustomerCard b={b} />
      <RentalCard b={b} timeZone={tenant.timeZone} />
      <PriceCard b={b} currency={tenant.currency} />
      <NotesCard b={b} />
      <EmailCard b={b} />
      {b.history ? <HistoryCard items={b.history} /> : null}
    </main>
  );
}
