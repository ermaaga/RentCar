import { randomUUID } from "node:crypto";
import type pg from "pg";

import type { MessageKey } from "../../../i18n";
import { enqueueEmail, type EmailSources, type OutboxRow } from "../../notifications";
import {
  renderAdminNewBooking,
  renderBookingConfirmation,
  type BookingEmailData,
} from "../application/booking-email";
import { formatLocal } from "../domain/local-time";

// BookingNotifier.bookingCreated (docs/06-backend-api.md BKG-03 step 11, 9.2): enqueues the customer
// confirmation and the admin notification in the booking transaction, through the tenant SMTP only.
// A tenant without SMTP produces no tenant mail (FR-MAIL-03). RL-15: at most 3 confirmations a day
// per recipient address; the excess is recorded as failed `rate_limited` and the booking still stands.

export type EmailStatus = "queued" | "not_requested" | "no_smtp" | "skipped_limit";

const CONFIRMATION = "booking.confirmation";
const ADMIN_NEW = "booking.admin_new_booking";
const PER_ADDRESS_PER_DAY = 3;

interface Created {
  tenantId: string;
  bookingId: string;
  customerEmail?: string | undefined;
  now: Date;
}

async function hasSmtp(c: pg.ClientBase, tenantId: string): Promise<boolean> {
  const res = await c.query("SELECT 1 FROM tenant_smtp_configs WHERE tenant_id = $1", [tenantId]);
  return (res.rowCount ?? 0) > 0;
}

async function adminRecipient(c: pg.ClientBase, tenantId: string): Promise<string | undefined> {
  const res = await c.query<{ email: string }>(
    `SELECT u.email FROM users u JOIN tenant_settings s ON s.tenant_id = u.tenant_id
      WHERE u.tenant_id = $1 AND u.role = 'admin' AND u.status = 'active' AND s.notify_new_booking`,
    [tenantId],
  );
  return res.rows[0]?.email;
}

async function overAddressLimit(c: pg.ClientBase, b: Created, to: string): Promise<boolean> {
  const res = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM email_log
      WHERE tenant_id = $1 AND template = $2 AND recipient = $3 AND created_at > $4
        AND last_error IS DISTINCT FROM 'rate_limited'`,
    [b.tenantId, CONFIRMATION, to, new Date(b.now.getTime() - 86_400_000)],
  );
  return (res.rows[0]?.n ?? 0) >= PER_ADDRESS_PER_DAY;
}

async function recordSkipped(c: pg.ClientBase, b: Created, to: string): Promise<void> {
  await c.query(
    `INSERT INTO email_log (id, tenant_id, channel, category, template, related_type, related_id,
                            recipient, status, attempts, last_error, created_at)
     VALUES ($1, $2, 'tenant_smtp', 'transactional', $3, 'booking', $4, $5, 'failed', 0, 'rate_limited', $6)`,
    [randomUUID(), b.tenantId, CONFIRMATION, b.bookingId, to, b.now],
  );
}

function enqueue(c: pg.ClientBase, b: Created, template: string, to: string) {
  return enqueueEmail(c, {
    tenantId: b.tenantId,
    channel: "tenant_smtp",
    template: template as `booking.${string}`,
    related: { type: "booking", id: b.bookingId },
    recipient: to,
    now: b.now,
  });
}

/** Runs inside the booking transaction; returns what happens to the customer confirmation. */
export async function enqueueBookingCreated(c: pg.ClientBase, b: Created): Promise<EmailStatus> {
  if (!(await hasSmtp(c, b.tenantId))) {
    return b.customerEmail ? "no_smtp" : "not_requested";
  }
  const admin = await adminRecipient(c, b.tenantId);
  if (admin) await enqueue(c, b, ADMIN_NEW, admin);
  if (!b.customerEmail) return "not_requested";
  if (await overAddressLimit(c, b, b.customerEmail)) {
    await recordSkipped(c, b, b.customerEmail);
    return "skipped_limit";
  }
  await enqueue(c, b, CONFIRMATION, b.customerEmail);
  return "queued";
}

interface EmailRow {
  code: string;
  first_name: string;
  last_name: string;
  phone: string;
  vehicle: string;
  start_at: Date;
  end_at: Date;
  total_minor: string;
  time_zone: string;
  currency: string;
  slug: string;
  title: string;
  contact_email: string;
  contact_phone: string;
}

async function loadData(c: pg.ClientBase, row: OutboxRow, baseUrl: string) {
  const res = await c.query<EmailRow>(
    `SELECT b.code, b.customer_first_name AS first_name, b.customer_last_name AS last_name, cu.phone,
            v.name AS vehicle, b.start_at, b.end_at, b.total_minor, t.time_zone, t.currency, t.slug,
            s.title, s.contact_email, s.contact_phone
       FROM bookings b
       JOIN customers cu ON cu.id = b.customer_id
       JOIN vehicles v ON v.id = b.vehicle_id
       JOIN tenants t ON t.id = b.tenant_id
       JOIN tenant_settings s ON s.tenant_id = b.tenant_id
      WHERE b.id = $1 AND b.tenant_id = $2`,
    [row.related_id, row.tenant_id],
  );
  const r = res.rows[0];
  if (!r) return null;
  const local = (d: Date) => formatLocal(d, r.time_zone).replace("T", " ");
  const total = new Intl.NumberFormat("en", { style: "currency", currency: r.currency });
  const data: BookingEmailData = {
    code: r.code,
    tenantTitle: r.title,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    vehicleName: r.vehicle,
    pickup: local(r.start_at),
    return: local(r.end_at),
    total: total.format(Number(r.total_minor) / 100),
    link: `${baseUrl}/${r.slug}/booking/${r.code}`,
  };
  return data;
}

/** The booking templates for the outbox, registered in composition (notifications never imports booking). */
export function bookingEmailSources(baseUrl: string): EmailSources {
  const source = (
    render: (
      to: string,
      d: BookingEmailData,
      t: (k: MessageKey) => string,
    ) => ReturnType<typeof renderAdminNewBooking>,
  ) => ({
    async load(c: pg.ClientBase, row: OutboxRow, t: (k: MessageKey) => string) {
      const data = await loadData(c, row, baseUrl);
      return data && row.recipient ? render(row.recipient, data, t) : null;
    },
  });
  return {
    [CONFIRMATION]: source(renderBookingConfirmation),
    [ADMIN_NEW]: source(renderAdminNewBooking),
  };
}
