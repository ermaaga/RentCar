import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addVehiclePhoto,
  deletePhoto,
  listVehiclePhotos,
  removeVehicle,
  setCoverPhoto,
  type PhotoDeps,
} from "../../src/modules/fleet";
import { createLocalStorage } from "../../src/platform/storage/local";
import type { StoragePort } from "../../src/platform/storage/port";
import { addShop, addVehicle, now } from "../support/booking-fixtures";

// Vehicle photos FLT-07/09/10 (docs/06-backend-api.md 10.3, ABU-M2-14..17) against Postgres + disk.
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
const app = new pg.Pool({ connectionString: appUrl, max: 4 });
const db = describe.skipIf(!adminUrl || !appUrl);
let dir = "";
let storage: StoragePort;
let jpeg: Buffer;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rentcar-photos-"));
  storage = createLocalStorage(dir);
  jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#c33" } })
    .jpeg()
    .toBuffer();
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end(), rm(dir, { recursive: true, force: true })]);
});

const deps = (quotaBytes = 1_000_000_000): PhotoDeps => ({ pool: app, storage, quotaBytes });
const keyOf = (url: string) => url.replace(/^\/media\//, "");

async function upload(scope: { tenantId: string; vehicleId: string }, d = deps()) {
  const result = await addVehiclePhoto(d, scope, jpeg);
  if (!result.ok) throw new Error(result.code);
  return result.photo;
}

db("vehicle photos: upload (FLT-07)", () => {
  it("stores both variants under server-built keys and makes the first photo the cover", async () => {
    const scope = await addShop(admin);
    const first = await upload(scope);
    const second = await upload(scope);
    expect(first.small).toMatch(
      new RegExp(
        `^/media/tenants/${scope.tenantId}/vehicles/${scope.vehicleId}/[0-9a-f-]{36}-480\\.webp$`,
      ),
    );
    expect([first.isCover, first.position, second.isCover, second.position]).toEqual([
      true,
      0,
      false,
      1,
    ]);
    const stored = await storage.get(keyOf(first.large));
    const meta = await sharp(stored?.body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 1280, 960]);
    const row = await admin.query(
      "SELECT byte_size, width, height FROM vehicle_photos WHERE id = $1",
      [first.id],
    );
    expect(row.rows[0]).toMatchObject({ width: 1280, height: 960 });
  });

  it("refuses an eleventh photo and leaves no object behind", async () => {
    const scope = await addShop(admin);
    for (let i = 0; i < 10; i += 1) await upload(scope);
    const before = await admin.query(
      "SELECT count(*)::int AS n FROM vehicle_photos WHERE vehicle_id = $1",
      [scope.vehicleId],
    );
    expect(before.rows[0]).toEqual({ n: 10 });
    expect(await addVehiclePhoto(deps(), scope, jpeg)).toEqual({
      ok: false,
      code: "PHOTO_LIMIT_REACHED",
    });
  });
});

db("vehicle photos: refusals (FLT-07)", () => {
  it("refuses an upload past the tenant quota and deletes the new objects", async () => {
    const scope = await addShop(admin);
    const result = await addVehiclePhoto(deps(10), scope, jpeg);
    expect(result).toEqual({ ok: false, code: "STORAGE_QUOTA_EXCEEDED" });
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(join(dir, "tenants", scope.tenantId, "vehicles", scope.vehicleId)).catch(() => []),
    );
    expect(files).toEqual([]);
  });

  it("refuses a vehicle of another tenant and a non-image", async () => {
    const a = await addShop(admin);
    const b = await addShop(admin);
    expect(
      await addVehiclePhoto(deps(), { tenantId: a.tenantId, vehicleId: b.vehicleId }, jpeg),
    ).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await addVehiclePhoto(deps(), a, Buffer.from("<svg/>"))).toEqual({
      ok: false,
      code: "UPLOAD_UNSUPPORTED_TYPE",
    });
  });
});

db("vehicle photos: cover and delete (FLT-09/10, FLT-04)", () => {
  it("moves the cover, renumbers on delete and removes the deleted objects", async () => {
    const scope = await addShop(admin);
    const [p0, p1, p2] = [await upload(scope), await upload(scope), await upload(scope)];
    const covered = await setCoverPhoto(app, scope, p2.id);
    expect(covered?.map((p) => p.isCover)).toEqual([false, false, true]);
    const other = await addShop(admin);
    expect(await setCoverPhoto(app, other, p2.id)).toBeNull();
    const left = await deletePhoto(deps(), scope, p2.id);
    expect(left?.map((p) => [p.id, p.position, p.isCover])).toEqual([
      [p0.id, 0, true],
      [p1.id, 1, false],
    ]);
    expect(await storage.get(keyOf(p2.small))).toBeNull();
    expect(await deletePhoto(deps(), scope, p2.id)).toBeNull();
    const again = await deletePhoto(deps(), scope, p0.id);
    expect(again?.map((p) => [p.id, p.position, p.isCover])).toEqual([[p1.id, 0, true]]);
  });

  it("returns the photo keys when the vehicle is deleted", async () => {
    const scope = await addShop(admin);
    const extra = await addVehicle(admin, scope.tenantId);
    await upload({ tenantId: scope.tenantId, vehicleId: extra });
    const result = await removeVehicle(
      app,
      { id: extra, mode: "delete" },
      { tenantId: scope.tenantId, now },
    );
    expect(result.ok && result.photoKeys).toHaveLength(1);
    expect(await listVehiclePhotos(app, { tenantId: scope.tenantId, vehicleId: extra })).toEqual(
      [],
    );
  });
});
