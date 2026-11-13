import Link from "next/link";

import { requireTenantSession } from "@/app/_lib/session";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { listAdminBookings, PAGE_SIZE, parseAdminBookingQuery } from "@/modules/booking";
import { listVehicles } from "@/modules/fleet";

import { BookingFilters } from "./_components/booking-filters";
import { BookingTable } from "./_components/booking-table";
import { Pagination } from "./_components/pagination";

// W-D3 bookings list (BKG-11, FR-BKG-01, US-050): admin and operator; operators see customer
// contacts (REQ-11). New booking and CSV export arrive with BKG-06 and BKG-17.

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BookingsPage(props: Props) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantSession(slug);
  const query = parseAdminBookingQuery(await props.searchParams);
  const c = getContainer();
  const ctx = { tenantId: tenant.tenantId, now: c.clock.now(), timeZone: tenant.timeZone };
  const [{ rows, total }, vehicles] = await Promise.all([
    listAdminBookings(c.pool, query, ctx),
    listVehicles(c.pool, { includeArchived: true }, ctx),
  ]);
  const filtered = [query.q, query.from, query.to, query.vehicleId, query.statuses.join()].some(
    (v) => v !== null && v !== "",
  );
  const count =
    total === 1 ? t("bookings.countOne") : formatMessage(t("bookings.count"), { n: total });
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin`} className="underline underline-offset-4">
        {t("admin.home.title")}
      </Link>
      <h1 className="mt-4 mb-4 text-2xl font-semibold">{t("bookings.title")}</h1>
      <BookingFilters slug={tenant.slug} query={query} vehicles={vehicles} />
      <h2 className="mt-6 mb-3 text-lg font-semibold">
        <span role="status">{count}</span>
      </h2>
      {rows.length === 0 ? (
        <p>{t(filtered ? "bookings.emptyFiltered" : "bookings.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <BookingTable slug={tenant.slug} rows={rows} currency={tenant.currency} />
          <Pagination slug={tenant.slug} query={query} pages={Math.ceil(total / PAGE_SIZE)} />
        </div>
      )}
    </main>
  );
}
