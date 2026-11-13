import Link from "next/link";

import { formatMessage, getTranslator } from "@/i18n";
import { adminBookingQueryString, type AdminBookingQuery } from "@/modules/booking";

// W-D3 pagination: Previous · Page n of m · Next, the page in the URL with the other filters kept.

export function Pagination(props: { slug: string; query: AdminBookingQuery; pages: number }) {
  const t = getTranslator();
  const { query, pages } = props;
  if (pages <= 1) return null;
  const link = (page: number) => {
    const qs = adminBookingQueryString(query, page);
    return `/${props.slug}/admin/bookings${qs ? `?${qs}` : ""}`;
  };
  const step = "min-h-12 content-center underline";
  return (
    <nav aria-label={t("bookings.pagination")} className="flex flex-wrap items-center gap-6">
      {query.page > 1 ? (
        <Link href={link(query.page - 1)} className={step}>
          {t("bookings.previous")}
        </Link>
      ) : null}
      <p aria-current="page">{formatMessage(t("bookings.pageOf"), { page: query.page, pages })}</p>
      {query.page < pages ? (
        <Link href={link(query.page + 1)} className={step}>
          {t("bookings.next")}
        </Link>
      ) : null}
    </nav>
  );
}
