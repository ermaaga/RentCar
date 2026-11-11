// Performance fixture (docs/10-test-plan.md section 10, NFR-PERF-01): one tenant `perf-rent` with 30
// vehicles, each with a cover photo, so Lighthouse measures the public pages at the budgeted size.
// Idempotent, and refused outside local and ci like the development seed. Run after the seed (it
// needs the platform owner as the provisioning actor) with the same storage as the app.
import pg from "pg";
import sharp from "sharp";

import {
  addVehiclePhoto,
  createVehicle,
  listVehicles,
  VEHICLE_CATEGORIES,
  type PhotoDeps,
} from "../src/modules/fleet";
import { provisionTenant, resolveTenantBySlug } from "../src/modules/tenancy";
import { withSystemTx } from "../src/platform/db/system-tx";
import { createLocalStorage } from "../src/platform/storage/local";
import { assertSeedAllowed } from "./seed-guard";

export const PERF_SLUG = "perf-rent";
const VEHICLES = 30;
const MAKES = ["Fiat", "Renault", "Toyota", "Volkswagen", "Peugeot", "Jeep"] as const;

async function ownerId(pool: pg.Pool): Promise<string> {
  const res = await withSystemTx(pool, (c) =>
    c.query<{ id: string }>(
      "SELECT id FROM users WHERE tenant_id IS NULL AND username = 'owner' AND status = 'active'",
    ),
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("seed-perf refused: run the seed first (no platform owner)");
  return id;
}

async function ensureTenant(pool: pg.Pool, now: Date): Promise<string> {
  const existing = await resolveTenantBySlug(pool, PERF_SLUG);
  if (existing) return existing.tenantId;
  const result = await provisionTenant(
    pool,
    {
      name: "Perf Rent",
      slug: PERF_SLUG,
      contact: { email: "info@perf.rentcar.localhost", phone: "+39061234567" },
      title: "Perf Rent",
      countryCode: "IT",
      timeZone: "Europe/Rome",
      currency: "EUR",
      dpaSigned: true,
      subscription: {
        maxVehicles: VEHICLES,
        maxOperators: 1,
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        priceMinor: 0,
        priceCurrency: "EUR",
      },
      admin: {
        displayName: "Perf Admin",
        username: "perf-admin",
        email: "admin@perf.rentcar.localhost",
      },
    },
    { actorUserId: await ownerId(pool), now },
  );
  if (!result.ok) throw new Error(`seed-perf: tenant not created (${result.code})`);
  return result.tenantId;
}

/** A 3000×2000 JPEG in a colour of its own, like a phone photo before the pipeline. */
function photo(i: number): Promise<Buffer> {
  const hue = (i * 37) % 360;
  return sharp({
    create: { width: 3000, height: 2000, channels: 3, background: `hsl(${String(hue)},55%,45%)` },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function addVehicles(deps: PhotoDeps, tenantId: string, now: Date): Promise<number> {
  const ctx = { tenantId, now };
  const have = (await listVehicles(deps.pool, {}, ctx)).length;
  for (let i = have; i < VEHICLES; i += 1) {
    const make = MAKES[i % MAKES.length] ?? "Fiat";
    const created = await createVehicle(
      deps.pool,
      {
        name: `${make} model ${String(i + 1)}`,
        plate: `PF ${String(100 + i)} AA`,
        make,
        model: `Model ${String(i + 1)}`,
        category: VEHICLE_CATEGORIES[i % VEHICLE_CATEGORIES.length] ?? "city",
        fuelType: "petrol",
        seats: 4 + (i % 4),
        dailyPriceMinor: 3500 + i * 250,
      },
      ctx,
    );
    if (!created.ok) throw new Error(`seed-perf: vehicle not created (${created.code})`);
    const added = await addVehiclePhoto(deps, { tenantId, vehicleId: created.id }, await photo(i));
    if (!added.ok) throw new Error(`seed-perf: photo not stored (${added.code})`);
  }
  return VEHICLES - have;
}

async function main(): Promise<void> {
  assertSeedAllowed(process.env.APP_ENV);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const now = new Date();
    const tenantId = await ensureTenant(pool, now);
    const storage = createLocalStorage(process.env.STORAGE_LOCAL_DIR ?? "./.storage");
    const added = await addVehicles({ pool, storage, quotaBytes: 1_073_741_824 }, tenantId, now);
    console.log(`seed-perf: tenant '${PERF_SLUG}' ready, ${String(added)} vehicle(s) added`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
