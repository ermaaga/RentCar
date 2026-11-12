"use server";

import { revalidatePath } from "next/cache";

import { tenantAction } from "@/app/_lib/define-action";
import { getContainer } from "@/composition/container";
import type { MessageKey } from "@/i18n";
import { deletePhoto, reorderPhotos, setCoverPhoto } from "@/modules/fleet";
import type { ConsoleActionState } from "@/modules/tenancy/ui/console-action-form";

// FLT-08 reorderPhotos, FLT-09 setCoverPhoto and FLT-10 deletePhoto (docs/06-backend-api.md): tenant admin only, refused
// while read-only. Ids come from the bound arguments; a photo of another vehicle or tenant is a miss.

const ADMIN_WRITE = {
  minRole: "admin",
  writeClass: "write",
  onRefused: (messageKey: MessageKey): ConsoleActionState => ({ status: "error", messageKey }),
} as const;

const MISSING: ConsoleActionState = { status: "error", messageKey: "vehicles.photos.notFound" };
const REORDER_FAILED: ConsoleActionState = {
  status: "error",
  messageKey: "vehicles.photos.reorderFailed",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FLT-08: the caller sends the full new order; anything but a permutation of the photos is refused. */
export const reorderPhotosAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant }, vehicleId: string, orderedIds: string[]): Promise<ConsoleActionState> => {
    if (!Array.isArray(orderedIds) || !orderedIds.every((id) => UUID.test(id))) {
      return REORDER_FAILED;
    }
    const outcome = await reorderPhotos(
      getContainer().pool,
      { tenantId: tenant.tenantId, vehicleId },
      orderedIds,
    );
    if (outcome === "NOT_FOUND") return MISSING;
    if (outcome === "NOT_A_PERMUTATION") return REORDER_FAILED;
    revalidatePath(`/${tenant.slug}/admin/vehicles/${vehicleId}`);
    return { status: "done", messageKey: "vehicles.photos.reordered" };
  },
);

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
