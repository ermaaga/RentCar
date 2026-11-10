import { randomUUID } from "node:crypto";
import type pg from "pg";

import { publicBookingInput } from "../../src/modules/booking";

// Fixtures for the public booking integration tests: a tenant in Europe/Rome with one car, and the
// submit input and context the entry point would build.

export const now = new Date("2026-06-01T06:00:00Z");

export async function addVehicle(admin: pg.Pool, tenantId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO vehicles (id, tenant_id, name, plate, make, model, category, fuel_type, seats, daily_price_minor)
     VALUES ($1, $2, 'Fiat Panda', $3, 'Fiat', 'Panda', 'city', 'petrol', 4, 4000)`,
    [id, tenantId, `P${id.slice(0, 6)}`],
  );
  return id;
}

export async function addShop(admin: pg.Pool): Promise<{ tenantId: string; vehicleId: string }> {
  const tenantId = randomUUID();
  await admin.query(
    "INSERT INTO tenants (id, slug, name, time_zone) VALUES ($1, $2, 'Shop', 'Europe/Rome')",
    [tenantId, `pb-${tenantId.slice(0, 8)}`],
  );
  await admin.query(
    `INSERT INTO tenant_settings (tenant_id, contact_email, contact_phone, title, lead_time_minutes)
     VALUES ($1, 'a@example.test', '+390612345678', 'Shop', 60)`,
    [tenantId],
  );
  return { tenantId, vehicleId: await addVehicle(admin, tenantId) };
}

export function input(vehicleId: string, extra: Record<string, unknown> = {}) {
  return publicBookingInput.parse({
    formToken: "checked-by-the-entry-point",
    vehicleId,
    pickup: "2026-06-03T10:00",
    return: "2026-06-05T10:00",
    expectedTotalMinor: 12000,
    firstName: "Mario",
    lastName: "Rossi",
    phone: "333 123 4567",
    email: "mario@example.test",
    acknowledge: true,
    ...extra,
  });
}

export const ctx = (tenantId: string, idempotencyKey = randomUUID()) => ({
  tenantId,
  idempotencyKey,
  now,
});
