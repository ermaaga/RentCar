import pg from "pg";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  bookingEmailSources,
  renderConfirmationPdf,
  submitPublicBooking,
} from "../../src/modules/booking";
import { dispatchDue } from "../../src/modules/notifications";
import { encryptField } from "../../src/platform/crypto/encryptor";
import type { Mailer, MailMessage } from "../../src/platform/mailer/port";
import { addShop, addVehicle, ctx, input, now } from "../support/booking-fixtures";

// Booking emails (BKG-03 step 11, RL-15) and the confirmation PDF (BKG-05, 10.1, spike S2).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const shop = () => addShop(admin);
const vehicle = (tenantId: string) => addVehicle(admin, tenantId);

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

const FIELD_KEY = Buffer.alloc(32, 3);

async function withSmtpAndAdmin(tenantId: string, notify = true): Promise<void> {
  const password = encryptField("secret", FIELD_KEY, `rc:v1:smtp_password:${tenantId}`);
  await admin.query(
    `INSERT INTO tenant_smtp_configs (tenant_id, host, port, security, username, password_enc, from_address)
     VALUES ($1, 'smtp.example.test', 587, 'starttls', 'mailer', $2, 'noreply@example.test')`,
    [tenantId, password],
  );
  await admin.query("UPDATE tenant_settings SET notify_new_booking = $2 WHERE tenant_id = $1", [
    tenantId,
    notify,
  ]);
  await admin.query(
    `INSERT INTO users (id, tenant_id, role, username, email, display_name, status, password_hash)
     VALUES ($1, $2, 'admin', 'admin1', 'owner@example.test', 'Owner', 'active', 'pv00000000$x')`,
    [randomUUID(), tenantId],
  );
}

async function outbox(tenantId: string) {
  const res = await admin.query<{
    template: string;
    recipient: string;
    status: string;
    last_error: string | null;
  }>(
    "SELECT template, recipient, status, last_error FROM email_log WHERE tenant_id = $1 ORDER BY template, created_at",
    [tenantId],
  );
  return res.rows;
}

function capturingMailer() {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    sendSystem: () => Promise.resolve({ ok: false, category: "unknown" }),
    sendTenant: (_s, message) => {
      sent.push(message);
      return Promise.resolve({ ok: true });
    },
  };
  return { sent, mailer };
}

describe.skipIf(!adminUrl || !appUrl)("public booking: emails", () => {
  it("enqueues nothing without tenant SMTP", async () => {
    const { tenantId, vehicleId } = await shop();
    const result = await submitPublicBooking(app, input(vehicleId), ctx(tenantId));
    expect(result).toMatchObject({ ok: true, emailStatus: "no_smtp" });
    expect(await outbox(tenantId)).toEqual([]);
  });

  it("queues the confirmation and the admin notice, and renders them from the booking", async () => {
    const { tenantId, vehicleId } = await shop();
    await withSmtpAndAdmin(tenantId);
    const result = await submitPublicBooking(app, input(vehicleId), ctx(tenantId));
    expect(result).toMatchObject({ ok: true, emailStatus: "queued" });
    const { sent, mailer } = capturingMailer();
    const deps = {
      pool: app,
      mailer,
      fieldKeys: [FIELD_KEY],
      t: getTranslator(),
      sources: bookingEmailSources("https://rent.example"),
    };
    expect(await dispatchDue(deps, { kind: "tenant", tenantId }, now)).toMatchObject({ sent: 2 });
    const code = result.ok ? result.code : "";
    const confirmation = sent.find((m) => m.to === "mario@example.test");
    expect(confirmation?.subject).toBe(`Booking ${code} confirmed · Shop`);
    expect(confirmation?.text).toContain(
      `https://rent.example/pb-${tenantId.slice(0, 8)}/booking/${code}`,
    );
    expect(confirmation?.text).toContain("If you did not make this booking");
    expect(confirmation?.text).not.toContain("+393331234567");
    const notice = sent.find((m) => m.to === "owner@example.test");
    expect(notice?.text).toContain("Mario Rossi, +393331234567");
  });
});

describe.skipIf(!adminUrl || !appUrl)("public booking: email limits", () => {
  it("skips the admin notice when it is off and caps confirmations at 3 a day per address", async () => {
    const { tenantId } = await shop();
    await withSmtpAndAdmin(tenantId, false);
    const statuses = [];
    for (const d of ["03", "06", "09", "12"]) {
      const car = await vehicle(tenantId);
      const period = {
        pickup: `2026-06-${d}T10:00`,
        return: `2026-06-${d}T18:00`,
        expectedTotalMinor: 4000,
      };
      const phone = `+39333000${d}00`;
      const r = await submitPublicBooking(app, input(car, { ...period, phone }), ctx(tenantId));
      statuses.push(r.ok ? r.emailStatus : r.code);
    }
    expect(statuses).toEqual(["queued", "queued", "queued", "skipped_limit"]);
    const rows = await outbox(tenantId);
    expect(rows.every((r) => r.template === "booking.confirmation")).toBe(true);
    expect(rows.filter((r) => r.last_error === "rate_limited")).toHaveLength(1);
  });
});

describe.skipIf(!adminUrl || !appUrl)("public booking: confirmation PDF (spike S2)", () => {
  it("renders a one-page PDF quickly, without the network, for its own tenant only", async () => {
    const { tenantId, vehicleId } = await shop();
    const booked = await submitPublicBooking(app, input(vehicleId), ctx(tenantId));
    const code = booked.ok ? booked.code : "";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const started = performance.now();
    const result = await renderConfirmationPdf(app, { tenantId, code }, getTranslator());
    const elapsed = performance.now() - started;
    // The layout engine loads its WASM from an inlined data: URL; nothing may leave the process.
    const urls = fetchSpy.mock.calls.map(([target]) =>
      target instanceof Request ? target.url : target.toString(),
    );
    expect(urls.filter((u) => !u.startsWith("data:"))).toEqual([]);
    fetchSpy.mockRestore();
    expect(result.ok).toBe(true);
    const pdf = result.ok ? result.pdf : Buffer.alloc(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeLessThan(200_000);
    expect(elapsed).toBeLessThan(2_000);
    const other = await shop();
    expect(
      await renderConfirmationPdf(app, { tenantId: other.tenantId, code }, getTranslator()),
    ).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
});
