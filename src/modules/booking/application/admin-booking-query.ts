import { BOOKING_STATUSES, isBookingStatus, type BookingStatus } from "../domain/booking-status";

// BKG-11 listBookings query (docs/06-backend-api.md, W-D3 in docs/04a-ux.md): every filter lives in
// the URL. The page is forgiving: an unknown or malformed value falls back to its default instead of
// failing, so an old or edited link still opens a list. Pure.

export const ADMIN_BOOKING_SORTS = ["start", "end", "created", "total"] as const;
type AdminBookingSort = (typeof ADMIN_BOOKING_SORTS)[number];
export const PAGE_SIZE = 25;
const MAX_PAGE = 2000;

export interface AdminBookingQuery {
  q: string;
  statuses: BookingStatus[];
  /** Local dates (tenant zone), inclusive; a booking matches when it overlaps the range. */
  from: string | null;
  to: string | null;
  vehicleId: string | null;
  sort: AdminBookingSort;
  dir: "asc" | "desc";
  page: number;
}

type Params = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

const many = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : [v ?? ""]).flatMap((x) => x.split(",")).map((x) => x.trim());

function date(v: string | string[] | undefined): string | null {
  const s = one(v);
  return DATE.test(s) ? s : null;
}

/** `sort=<column>-<direction>`, e.g. `total-asc`; anything else is the default `start-desc`. */
function order(value: string): Pick<AdminBookingQuery, "sort" | "dir"> {
  const [column = "", direction = ""] = value.split("-");
  const sort = (ADMIN_BOOKING_SORTS as readonly string[]).includes(column)
    ? (column as AdminBookingSort)
    : "start";
  return { sort, dir: direction === "asc" ? "asc" : "desc" };
}

export function parseAdminBookingQuery(params: Params): AdminBookingQuery {
  const page = Number.parseInt(one(params.page), 10);
  const vehicle = one(params.vehicle);
  let [from, to] = [date(params.from), date(params.to)];
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: one(params.q).slice(0, 64),
    statuses: [...new Set(many(params.status).filter(isBookingStatus))].sort(
      (a, b) => BOOKING_STATUSES.indexOf(a) - BOOKING_STATUSES.indexOf(b),
    ),
    from,
    to,
    vehicleId: UUID.test(vehicle) ? vehicle.toLowerCase() : null,
    ...order(one(params.sort)),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** The canonical URL query of a list state, defaults left out; `page` 1 is never written. */
export function adminBookingQueryString(q: AdminBookingQuery, page = q.page): string {
  const out = new URLSearchParams();
  if (q.q) out.set("q", q.q);
  if (q.statuses.length > 0) out.set("status", q.statuses.join(","));
  if (q.from) out.set("from", q.from);
  if (q.to) out.set("to", q.to);
  if (q.vehicleId) out.set("vehicle", q.vehicleId);
  if (q.sort !== "start" || q.dir !== "desc") out.set("sort", `${q.sort}-${q.dir}`);
  if (page > 1) out.set("page", String(page));
  return out.toString();
}
