import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { PAGE_SIZE, type AdminBookingQuery } from "../application/admin-booking-query";
import { normalizeCode } from "../domain/booking-code";
import { effectiveStatus, type BookingStatus } from "../domain/booking-status";
import { formatLocal, parseLocal } from "../domain/local-time";

// BKG-11 listBookings and BKG-12 getBooking (docs/06-backend-api.md; W-D3/W-D4 in docs/04a-ux.md).
// Tenant transaction only; the effective status (5.3) is computed in SQL for filters and in
// effectiveStatus() for display. Operators see customer contacts (REQ-11) but not the history.

/** SQL twin of effectiveStatus() (05-database 5.12); $1 is `now`. */
const EFFECTIVE = `CASE
    WHEN b.status IN ('confirmed', 'active') AND b.end_at <= $1 THEN 'completed'
    WHEN b.status = 'confirmed' AND b.start_at <= $1 THEN 'active'
    ELSE b.status END`;

const ORDER: Record<AdminBookingQuery["sort"], string> = {
  start: "b.start_at",
  end: "b.end_at",
  created: "b.created_at",
  total: "b.total_minor",
};

export interface Ctx {
  tenantId: string;
  now: Date;
  timeZone: string;
}

export interface AdminBookingRow {
  code: string;
  customerName: string;
  phone: string | null;
  vehicleName: string;
  pickup: string;
  return: string;
  totalMinor: number;
  isPaid: boolean;
  status: BookingStatus;
}

interface ListRow {
  code: string;
  first: string;
  last: string;
  phone: string | null;
  vehicle: string;
  start_at: Date;
  end_at: Date;
  total_minor: string;
  is_paid: boolean;
  status: BookingStatus;
  total: number;
}

const likeEscape = (q: string) => q.replace(/[\\%_]/g, "\\$&");

/** Instants bounding the local-date range (inclusive dates); null bound = open. */
function range(query: AdminBookingQuery, timeZone: string): [Date | null, Date | null] {
  const from = query.from ? parseLocal(`${query.from}T00:00`, timeZone) : null;
  const toDay = query.to ? new Date(`${query.to}T00:00:00Z`) : null;
  if (toDay) toDay.setUTCDate(toDay.getUTCDate() + 1);
  const to = toDay ? parseLocal(`${toDay.toISOString().slice(0, 10)}T00:00`, timeZone) : null;
  return [from, to];
}

const LIST_SQL = `SELECT b.code, b.customer_first_name AS first, b.customer_last_name AS last,
         cu.phone, v.name AS vehicle, b.start_at, b.end_at, b.total_minor, b.is_paid,
         ${EFFECTIVE} AS status, count(*) OVER ()::int AS total
    FROM bookings b
    JOIN vehicles v ON v.id = b.vehicle_id
    JOIN customers cu ON cu.id = b.customer_id
   WHERE b.tenant_id = $2
     AND (cardinality($3::text[]) = 0 OR ${EFFECTIVE} = ANY ($3))
     AND ($4::timestamptz IS NULL OR b.end_at > $4)
     AND ($5::timestamptz IS NULL OR b.start_at < $5)
     AND ($6::uuid IS NULL OR b.vehicle_id = $6)
     AND ($7::text = ''
          OR b.code = $8
          OR (b.customer_first_name || ' ' || b.customer_last_name) ILIKE '%' || $7 || '%'
          OR ($9::text <> '' AND cu.phone LIKE '%' || $9 || '%'))`;

/**
 * The list statement with its ORDER BY. The only interpolated parts are a column from the fixed
 * ORDER map and one of two directions, both chosen by the parsed query, never raw input; every
 * value is a parameter.
 */
function listSql(query: AdminBookingQuery): string {
  const dir = query.dir === "asc" ? "ASC" : "DESC";
  return `${LIST_SQL} ORDER BY ${ORDER[query.sort]} ${dir}, b.id LIMIT ${String(PAGE_SIZE)} OFFSET $10`;
}

function listParams(query: AdminBookingQuery, ctx: Ctx): unknown[] {
  const [from, to] = range(query, ctx.timeZone);
  const digits = query.q.replace(/\D/g, "");
  return [
    ctx.now,
    ctx.tenantId,
    query.statuses,
    from,
    to,
    query.vehicleId,
    likeEscape(query.q),
    normalizeCode(query.q) ?? "",
    digits.length >= 4 ? digits : "",
    (query.page - 1) * PAGE_SIZE,
  ];
}

function toRow(r: ListRow, timeZone: string): AdminBookingRow {
  return {
    code: r.code,
    customerName: `${r.first} ${r.last}`,
    phone: r.phone,
    vehicleName: r.vehicle,
    pickup: formatLocal(r.start_at, timeZone),
    return: formatLocal(r.end_at, timeZone),
    totalMinor: Number(r.total_minor),
    isPaid: r.is_paid,
    status: r.status,
  };
}

/** BKG-11: one page of bookings and the total count for the filters. */
export async function listAdminBookings(
  pool: pg.Pool,
  query: AdminBookingQuery,
  ctx: Ctx,
): Promise<{ rows: AdminBookingRow[]; total: number }> {
  const res = await withTenantTx(pool, ctx.tenantId, (c) =>
    c.query<ListRow>(listSql(query), listParams(query, ctx)),
  );
  return {
    total: res.rows[0]?.total ?? 0,
    rows: res.rows.map((r) => toRow(r, ctx.timeZone)),
  };
}

export interface AdminBookingDetail extends AdminBookingRow {
  id: string;
  /** Instants, for previews computed on the server (early completion). */
  startAt: Date;
  endAt: Date;
  customerId: string;
  email: string | null;
  vehicleId: string;
  billedDays: number;
  dailyPriceMinor: number;
  paymentMethod: "card" | "cash" | null;
  paidAmountMinor: number;
  source: "public" | "admin";
  createdAt: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  version: number;
  emailStatus: { status: string; at: string | null } | null;
  /** Audit entries for this booking, newest first (admin only, null for operators). */
  history: { at: string; who: string; action: string }[] | null;
}

interface DetailRow {
  id: string;
  code: string;
  first: string;
  last: string;
  email: string | null;
  phone: string | null;
  customer_id: string;
  vehicle_id: string;
  vehicle: string;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
  billed_days: number;
  daily_price_minor: string;
  total_minor: string;
  payment_method: "card" | "cash" | null;
  is_paid: boolean;
  paid_amount_minor: string;
  source: "public" | "admin";
  created_at: Date;
  notes: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  version: number;
}

async function emailStatus(
  c: pg.ClientBase,
  bookingId: string,
  timeZone: string,
): Promise<AdminBookingDetail["emailStatus"]> {
  const res = await c.query<{ status: string; at: Date | null }>(
    `SELECT status, coalesce(sent_at, last_attempt_at, created_at) AS at FROM email_log
      WHERE related_type = 'booking' AND related_id = $1 AND template = 'booking.confirmation'
      ORDER BY created_at DESC LIMIT 1`,
    [bookingId],
  );
  const row = res.rows[0];
  return row ? { status: row.status, at: row.at ? formatLocal(row.at, timeZone) : null } : null;
}

async function history(
  c: pg.ClientBase,
  bookingId: string,
  timeZone: string,
): Promise<NonNullable<AdminBookingDetail["history"]>> {
  const res = await c.query<{
    created_at: Date;
    actor_username: string | null;
    actor_type: string;
    action: string;
  }>(
    `SELECT created_at, actor_username, actor_type, action FROM audit_log
      WHERE entity_type = 'booking' AND entity_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
    [bookingId],
  );
  return res.rows.map((r) => ({
    at: formatLocal(r.created_at, timeZone),
    who: r.actor_username ?? r.actor_type,
    action: r.action,
  }));
}

function toDetail(r: DetailRow, ctx: Ctx): Omit<AdminBookingDetail, "emailStatus" | "history"> {
  return {
    id: r.id,
    code: r.code,
    customerName: `${r.first} ${r.last}`,
    customerId: r.customer_id,
    phone: r.phone,
    email: r.email,
    vehicleId: r.vehicle_id,
    vehicleName: r.vehicle,
    pickup: formatLocal(r.start_at, ctx.timeZone),
    return: formatLocal(r.end_at, ctx.timeZone),
    startAt: r.start_at,
    endAt: r.end_at,
    status: effectiveStatus(r.status, r.start_at, r.end_at, ctx.now),
    billedDays: r.billed_days,
    dailyPriceMinor: Number(r.daily_price_minor),
    totalMinor: Number(r.total_minor),
    isPaid: r.is_paid,
    paymentMethod: r.payment_method,
    paidAmountMinor: Number(r.paid_amount_minor),
    source: r.source,
    createdAt: formatLocal(r.created_at, ctx.timeZone),
    notes: r.notes,
    cancelledAt: r.cancelled_at ? formatLocal(r.cancelled_at, ctx.timeZone) : null,
    cancelReason: r.cancel_reason,
    version: r.version,
  };
}

/** BKG-12: one booking by code; a code of another tenant is the same miss as an unknown one. */
export async function getAdminBooking(
  pool: pg.Pool,
  input: { code: string; withHistory: boolean },
  ctx: Ctx,
): Promise<AdminBookingDetail | null> {
  const code = normalizeCode(input.code);
  if (!code) return null;
  return withTenantTx(pool, ctx.tenantId, async (c) => {
    const res = await c.query<DetailRow>(
      `SELECT b.id, b.code, b.customer_first_name AS first, b.customer_last_name AS last,
              b.customer_email AS email, cu.phone, b.customer_id, b.vehicle_id, v.name AS vehicle,
              b.start_at, b.end_at, b.status, b.billed_days, b.daily_price_minor, b.total_minor,
              b.payment_method, b.is_paid, b.paid_amount_minor, b.source, b.created_at, b.notes,
              b.cancelled_at, b.cancel_reason, b.version
         FROM bookings b
         JOIN vehicles v ON v.id = b.vehicle_id
         JOIN customers cu ON cu.id = b.customer_id
        WHERE b.tenant_id = $1 AND b.code = $2`,
      [ctx.tenantId, code],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      ...toDetail(row, ctx),
      emailStatus: await emailStatus(c, row.id, ctx.timeZone),
      history: input.withHistory ? await history(c, row.id, ctx.timeZone) : null,
    };
  });
}
