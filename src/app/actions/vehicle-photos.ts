"use server";

import { revalidatePath } from "next/cache";

import { tenantAction } from "@/app/_lib/define-action";
import { getContainer } from "@/composition/container";
import type { MessageKey } from "@/i18n";
import {
  deletePhoto,
  moveTo,
  parseOrderedIds,
  reorderPhotos,
  setCoverPhoto,
} from "@/modules/fleet";
import type { ConsoleActionState } from "@/modules/tenancy/ui/console-action-form";

// FLT-08 reorderPhotos, FLT-09 setCoverPhoto and FLT-10 deletePhoto (docs/06-backend-api.md): tenant
// admin only, refused while read-only. Ids come from the bound arguments; a photo of another vehicle
// or tenant is a miss. A reorder that is not a permutation of the current photos (a stale page, or a
// tampered list) is refused and asks for a reload.

const ADMIN_WRITE = {
  minRole: "admin",
  writeClass: "write",
  onRefused: (messageKey: MessageKey): ConsoleActionState => ({ status: "error", messageKey }),
} as const;

const MISSING: ConsoleActionState = { status: "error", messageKey: "vehicles.photos.notFound" };

export const setCoverPhotoAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant }, vehicleId: string, photoId: string): Promise<ConsoleActionState> => {
    const photos = await setCoverPhoto(
      getContainer().pool,
      { tenantId: tenant.tenantId, vehicleId },
      photoId,
    );
    if (!photos) return MISSING;
    revalidatePath(`/${tenant.slug}/admin/vehicles/${vehicleId}`);
    return { status: "done", messageKey: "vehicles.photos.coverSet" };
  },
);

export const deletePhotoAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant }, vehicleId: string, photoId: string): Promise<ConsoleActionState> => {
    const c = getContainer();
    const photos = await deletePhoto(
      { pool: c.pool, storage: c.storage, quotaBytes: c.storageQuotaBytes },
      { tenantId: tenant.tenantId, vehicleId },
      photoId,
    );
    if (!photos) return MISSING;
    revalidatePath(`/${tenant.slug}/admin/vehicles/${vehicleId}`);
    return { status: "done", messageKey: "vehicles.photos.removed" };
  },
);

const STALE: ConsoleActionState = { status: "error", messageKey: "vehicles.photos.orderStale" };

/** What the vehicle page binds for one photo's position form (FLT-08). */
export interface PhotoMove {
  vehicleId: string;
  /** The order the page showed. */
  seenIds: unknown;
  photoId: string;
}

/** The bound move, checked: bound arguments come from the client and can be anything. */
function parseMove(value: unknown): { vehicleId: string; photoId: string; seen: string[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const move = value as Partial<Record<keyof PhotoMove, unknown>>;
  const ids = parseOrderedIds([move.vehicleId, move.photoId]);
  const seen = parseOrderedIds(move.seenIds);
  const [vehicleId, photoId] = ids ?? [];
  return vehicleId && photoId && seen ? { vehicleId, photoId, seen } : null;
}

/**
 * FLT-08 from the vehicle page: the form names the new position (1-based) of `photoId` in the order
 * the page showed. The resulting order must still be a permutation of the vehicle's photos.
 */
export const reorderPhotosAction = tenantAction(
  ADMIN_WRITE,
  async (
    { tenant },
    bound: PhotoMove,
    _: ConsoleActionState,
    form: FormData,
  ): Promise<ConsoleActionState> => {
    const move = parseMove(bound);
    if (!move) return STALE;
    const order = moveTo(
      move.seen,
      move.seen.indexOf(move.photoId),
      Number(form.get("position")) - 1,
    );
    if (!order) return STALE;
    const { vehicleId } = move;
    const result = await reorderPhotos(
      getContainer().pool,
      { tenantId: tenant.tenantId, vehicleId },
      order,
    );
    if (!result.ok) return result.code === "NOT_FOUND" ? MISSING : STALE;
    revalidatePath(`/${tenant.slug}/admin/vehicles/${vehicleId}`);
    return { status: "done", messageKey: "vehicles.photos.moved" };
  },
);
