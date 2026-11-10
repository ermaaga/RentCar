import type pg from "pg";

import type { MessageKey } from "../../../i18n";
import { withTenantTx } from "../../../platform/db/tenant-tx";
import { renderSummaryPdf } from "../../../platform/pdf/summary-pdf";
import { buildConfirmationModel, type ConfirmationData } from "../application/confirmation-model";
import { normalizeCode } from "../domain/booking-code";

// BookingDocuments.renderConfirmation (docs/06-backend-api.md 10.1, BKG-05): one short read
// transaction by (tenant, code), then the model and the render with no transaction open (SR-DB-07).
// Never stored: regenerated on every download so edits show current data (A-30).

interface Row {
  code: string;
  title: string;
  contact_email: string;
  contact_phone: string;
  vehicle: string;
  first_name: string;
  last_name: string;
  start_at: Date;
  end_at: Date;
  time_zone: string;
  currency: string;
  daily_price_minor: string;
  billed_days: number;
  total_minor: string;
}

async function load(
  pool: pg.Pool,
  tenantId: string,
  code: string,
): Promise<ConfirmationData | null> {
  const row = await withTenantTx(pool, tenantId, async (c) => {
    const res = await c.query<Row>(
      `SELECT b.code, s.title, s.contact_email, s.contact_phone, v.name AS vehicle,
              b.customer_first_name AS first_name, b.customer_last_name AS last_name,
              b.start_at, b.end_at, t.time_zone, t.currency, b.daily_price_minor, b.billed_days, b.total_minor
         FROM bookings b
         JOIN vehicles v ON v.id = b.vehicle_id
         JOIN tenants t ON t.id = b.tenant_id
         JOIN tenant_settings s ON s.tenant_id = b.tenant_id
        WHERE b.tenant_id = $1 AND b.code = $2`,
      [tenantId, code],
    );
    return res.rows[0];
  });
  if (!row) return null;
  return {
    code: row.code,
    tenantTitle: row.title,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    vehicleName: row.vehicle,
    firstName: row.first_name,
    lastName: row.last_name,
    startAt: row.start_at,
    endAt: row.end_at,
    timeZone: row.time_zone,
    currency: row.currency,
    dailyPriceMinor: Number(row.daily_price_minor),
    billedDays: row.billed_days,
    totalMinor: Number(row.total_minor),
  };
}

export type ConfirmationPdf =
  { ok: true; code: string; pdf: Buffer } | { ok: false; code: "NOT_FOUND" | "PDF_UNAVAILABLE" };

export async function renderConfirmationPdf(
  pool: pg.Pool,
  input: { tenantId: string; code: string },
  t: (key: MessageKey) => string,
): Promise<ConfirmationPdf> {
  const code = normalizeCode(input.code);
  const data = code ? await load(pool, input.tenantId, code) : null;
  if (!data) return { ok: false, code: "NOT_FOUND" };
  try {
    return {
      ok: true,
      code: data.code,
      pdf: await renderSummaryPdf(buildConfirmationModel(data, t)),
    };
  } catch {
    return { ok: false, code: "PDF_UNAVAILABLE" };
  }
}
