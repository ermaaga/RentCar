import { randomUUID } from "node:crypto";
import type pg from "pg";

import { withTenantTx } from "../../../platform/db/tenant-tx";
import { processImage, type ImageError } from "../../../platform/image/processor";
import type { StoragePort } from "../../../platform/storage/port";

// Vehicle photos FLT-07/09/10 (docs/06-backend-api.md 10.3): the image is checked and re-encoded into
// 480 px and 1280 px WebP; keys come from server-side ids only; objects are put first, then one tenant
// transaction (vehicle row locked: at most 10 photos, tenant quota) inserts the row; a refusal or a
// failure deletes the new objects. Deleted photos lose their objects after commit.

const SIZES = [480, 1280] as const;
const MAX_PHOTOS = 10;

export interface PhotoDto {
  id: string;
  small: string;
  large: string;
  isCover: boolean;
  position: number;
}

export interface PhotoDeps {
  pool: pg.Pool;
  storage: StoragePort;
  quotaBytes: number;
}

interface Scope {
  tenantId: string;
  vehicleId: string;
}

/** `tenants/{tenantId}/vehicles/{vehicleId}/{photoId}`: the stored base, variants add `-{size}.webp`. */
function baseKey(scope: Scope, photoId: string): string {
  return `tenants/${scope.tenantId}/vehicles/${scope.vehicleId}/${photoId}`;
}

const variantKey = (base: string, size: number) => `${base}-${String(size)}.webp`;

/** Public URL of a variant (served by /media, docs/06-backend-api.md 10.3 step 8). */
export const photoUrl = (base: string, size: 480 | 1280) => `/media/${variantKey(base, size)}`;

interface PhotoRow {
  id: string;
  storage_key: string;
  is_cover: boolean;
  position: number;
}

async function rows(c: pg.ClientBase, scope: Scope): Promise<PhotoDto[]> {
  const res = await c.query<PhotoRow>(
    `SELECT id, storage_key, is_cover, position FROM vehicle_photos
      WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY position`,
    [scope.tenantId, scope.vehicleId],
  );
  return res.rows.map(toDto);
}

function toDto(r: PhotoRow): PhotoDto {
  return {
    id: r.id,
    small: photoUrl(r.storage_key, 480),
    large: photoUrl(r.storage_key, 1280),
    isCover: r.is_cover,
    position: r.position,
  };
}

export function listVehiclePhotos(pool: pg.Pool, scope: Scope): Promise<PhotoDto[]> {
  return withTenantTx(pool, scope.tenantId, (c) => rows(c, scope));
}

export type UploadResult =
  | { ok: true; photo: PhotoDto }
  | {
      ok: false;
      code: ImageError | "NOT_FOUND" | "PHOTO_LIMIT_REACHED" | "STORAGE_QUOTA_EXCEEDED";
    };

async function vehicleExists(pool: pg.Pool, scope: Scope): Promise<boolean> {
  return withTenantTx(pool, scope.tenantId, async (c) => {
    const res = await c.query("SELECT 1 FROM vehicles WHERE tenant_id = $1 AND id = $2", [
      scope.tenantId,
      scope.vehicleId,
    ]);
    return (res.rowCount ?? 0) > 0;
  });
}

interface NewPhoto {
  id: string;
  base: string;
  byteSize: number;
  width: number;
  height: number;
}

type InsertOutcome =
  | { ok: true; photo: PhotoDto }
  | { ok: false; code: "NOT_FOUND" | "PHOTO_LIMIT_REACHED" | "STORAGE_QUOTA_EXCEEDED" };

interface Usage {
  photos: number;
  next: number;
  used: string;
}

/** Called with the vehicle row locked, so concurrent uploads to the same vehicle are serialised. */
async function usageOf(c: pg.ClientBase, scope: Scope): Promise<Usage | null> {
  const locked = await c.query(
    "SELECT 1 FROM vehicles WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
    [scope.tenantId, scope.vehicleId],
  );
  if ((locked.rowCount ?? 0) === 0) return null;
  const usage = await c.query<Usage>(
    `SELECT (SELECT count(*)::int FROM vehicle_photos WHERE vehicle_id = $2) AS photos,
            (SELECT coalesce(max(position) + 1, 0)::int FROM vehicle_photos WHERE vehicle_id = $2) AS next,
            (SELECT coalesce(sum(byte_size), 0) FROM vehicle_photos WHERE tenant_id = $1) AS used`,
    [scope.tenantId, scope.vehicleId],
  );
  return usage.rows[0] ?? { photos: 0, next: 0, used: "0" };
}

async function insertPhoto(
  c: pg.ClientBase,
  scope: Scope,
  p: NewPhoto,
  quotaBytes: number,
): Promise<InsertOutcome> {
  const u = await usageOf(c, scope);
  if (!u) return { ok: false, code: "NOT_FOUND" };
  if (u.photos >= MAX_PHOTOS) return { ok: false, code: "PHOTO_LIMIT_REACHED" };
  if (Number(u.used) + p.byteSize > quotaBytes) {
    return { ok: false, code: "STORAGE_QUOTA_EXCEEDED" };
  }
  const row: PhotoRow = {
    id: p.id,
    storage_key: p.base,
    is_cover: u.photos === 0,
    position: u.next,
  };
  await c.query(
    `INSERT INTO vehicle_photos (id, tenant_id, vehicle_id, storage_key, byte_size, width, height, position, is_cover)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.id,
      scope.tenantId,
      scope.vehicleId,
      row.storage_key,
      p.byteSize,
      p.width,
      p.height,
      row.position,
      row.is_cover,
    ],
  );
  return { ok: true, photo: toDto(row) };
}

async function removeObjects(storage: StoragePort, base: string): Promise<void> {
  await Promise.all(
    SIZES.map((size) => storage.delete(variantKey(base, size)).catch(() => undefined)),
  );
}

/** After a vehicle delete committed: the variants of every photo it had (best effort). */
export async function removePhotoObjects(
  storage: StoragePort,
  bases: readonly string[],
): Promise<void> {
  await Promise.all(bases.map((base) => removeObjects(storage, base)));
}

/** FLT-07 after the entry point checks (admin, writable tenant, origin, RL-12, size cap). */
export async function addVehiclePhoto(
  deps: PhotoDeps,
  scope: Scope,
  image: Buffer,
): Promise<UploadResult> {
  if (!(await vehicleExists(deps.pool, scope))) return { ok: false, code: "NOT_FOUND" };
  const processed = await processImage(image, SIZES);
  if (!processed.ok) return processed;
  const id = randomUUID();
  const base = baseKey(scope, id);
  const large = processed.variants.find((v) => v.size === 1280) ?? processed.variants[0];
  const byteSize = processed.variants.reduce((sum, v) => sum + v.body.length, 0);
  await Promise.all(
    processed.variants.map((v) => deps.storage.put(variantKey(base, v.size), v.body, "image/webp")),
  );
  try {
    const result = await withTenantTx(deps.pool, scope.tenantId, (c) =>
      insertPhoto(
        c,
        scope,
        { id, base, byteSize, width: large?.width ?? 1, height: large?.height ?? 1 },
        deps.quotaBytes,
      ),
    );
    if (!result.ok) await removeObjects(deps.storage, base);
    return result;
  } catch (err) {
    await removeObjects(deps.storage, base);
    throw err;
  }
}

/**
 * FLT-09: one cover per vehicle (partial unique index, checked per row), so the old cover is cleared
 * before the new one is set, in the same transaction.
 */
export async function setCoverPhoto(
  pool: pg.Pool,
  scope: Scope,
  photoId: string,
): Promise<PhotoDto[] | null> {
  return withTenantTx(pool, scope.tenantId, async (c) => {
    const found = await c.query(
      "SELECT 1 FROM vehicle_photos WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 FOR UPDATE",
      [scope.tenantId, scope.vehicleId, photoId],
    );
    if ((found.rowCount ?? 0) === 0) return null;
    await c.query(
      "UPDATE vehicle_photos SET is_cover = false WHERE vehicle_id = $1 AND is_cover AND id <> $2",
      [scope.vehicleId, photoId],
    );
    await c.query("UPDATE vehicle_photos SET is_cover = true WHERE id = $1", [photoId]);
    return rows(c, scope);
  });
}

/** FLT-10: positions are renumbered from 0 and the first photo becomes the cover if needed. */
export async function deletePhoto(
  deps: PhotoDeps,
  scope: Scope,
  photoId: string,
): Promise<PhotoDto[] | null> {
  const outcome = await withTenantTx(deps.pool, scope.tenantId, async (c) => {
    const del = await c.query<{ storage_key: string }>(
      "DELETE FROM vehicle_photos WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 RETURNING storage_key",
      [scope.tenantId, scope.vehicleId, photoId],
    );
    const removed = del.rows[0];
    if (!removed) return null;
    await c.query(
      `UPDATE vehicle_photos p SET position = o.rn - 1, is_cover = (o.rn = 1 AND NOT o.has_cover) OR p.is_cover
         FROM (SELECT id, row_number() OVER (ORDER BY position)::int AS rn,
                      bool_or(is_cover) OVER () AS has_cover
                 FROM vehicle_photos WHERE vehicle_id = $1) o
        WHERE p.id = o.id`,
      [scope.vehicleId],
    );
    return { base: removed.storage_key, photos: await rows(c, scope) };
  });
  if (!outcome) return null;
  await removeObjects(deps.storage, outcome.base);
  return outcome.photos;
}
