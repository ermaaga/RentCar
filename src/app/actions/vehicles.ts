"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { tenantAction } from "@/app/_lib/define-action";
import { getContainer } from "@/composition/container";
import type { MessageKey } from "@/i18n";
import {
  createVehicle,
  parsePriceToMinor,
  removePhotoObjects,
  removeVehicle,
  setMaintenance,
  updateVehicle,
  vehicleInput,
} from "@/modules/fleet";
import type { VehicleFormState } from "@/modules/fleet/ui/vehicle-form";
import type { ConsoleActionState } from "@/modules/tenancy/ui/console-action-form";

// FLT-01..04 entry points (docs/06-backend-api.md): tenant admin only, refused while read-only.
// Vehicles are not audited (A-35).

const err = (messageKey: MessageKey, fields?: readonly string[]) => ({
  status: "error" as const,
  messageKey,
  ...(fields ? { fields } : {}),
});

const ADMIN_WRITE = {
  minRole: "admin",
  writeClass: "write",
  onRefused: (messageKey: MessageKey) => err(messageKey),
} as const;

const SAVE_ERRORS = {
  PLATE_TAKEN: err("vehicles.form.plateTaken", ["plate"]),
  PLAN_LIMIT_REACHED: err("vehicles.form.limitReached"),
  NOT_FOUND: err("vehicles.detail.notFound"),
  STALE_RECORD: err("vehicles.form.stale"),
} as const;

function parseVehicle(form: FormData) {
  const value = (key: string) => {
    const raw = form.get(key);
    return typeof raw === "string" ? raw.slice(0, 1000) : "";
  };
  return vehicleInput.safeParse({
    name: value("name"),
    plate: value("plate"),
    make: value("make"),
    model: value("model"),
    category: value("category"),
    fuelType: value("fuelType"),
    seats: value("seats"),
    dailyPriceMinor: parsePriceToMinor(value("price")),
    notes: value("notes"),
  });
}

const invalid = (issues: { path: PropertyKey[] }[]) =>
  err(
    "vehicles.form.invalid",
    issues.map((i) => i.path.map(String).join(".")),
  );

export const createVehicleAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant }, _: VehicleFormState, form: FormData): Promise<VehicleFormState> => {
    const parsed = parseVehicle(form);
    if (!parsed.success) return invalid(parsed.error.issues);
    const c = getContainer();
    const result = await createVehicle(c.pool, parsed.data, {
      tenantId: tenant.tenantId,
      now: c.clock.now(),
    });
    revalidatePath(`/${tenant.slug}/admin/vehicles`);
    return result.ok
      ? { status: "done", messageKey: "vehicles.form.added" }
      : SAVE_ERRORS[result.code];
  },
);

export const updateVehicleAction = tenantAction(
  ADMIN_WRITE,
  async (
    { tenant },
    id: string,
    _: VehicleFormState,
    form: FormData,
  ): Promise<VehicleFormState> => {
    const parsed = parseVehicle(form);
    if (!parsed.success) return invalid(parsed.error.issues);
    const expected = form.get("expectedUpdatedAt");
    const c = getContainer();
    const result = await updateVehicle(
      c.pool,
      { ...parsed.data, id, expectedUpdatedAt: typeof expected === "string" ? expected : "" },
      { tenantId: tenant.tenantId, now: c.clock.now() },
    );
    revalidatePath(`/${tenant.slug}/admin/vehicles/${id}`);
    return result.ok
      ? { status: "done", messageKey: "vehicles.form.saved" }
      : SAVE_ERRORS[result.code];
  },
);

export const setMaintenanceAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant }, id: string, on: boolean): Promise<ConsoleActionState> => {
    const c = getContainer();
    const result = await setMaintenance(
      c.pool,
      { id, on },
      {
        tenantId: tenant.tenantId,
        now: c.clock.now(),
      },
    );
    revalidatePath(`/${tenant.slug}/admin/vehicles/${id}`);
    if (!result.ok) return err("vehicles.detail.notFound");
    if (!on) return { status: "done", messageKey: "vehicles.detail.maintenanceEnded" };
    return result.affected.length === 0
      ? { status: "done", messageKey: "vehicles.detail.maintenanceSet" }
      : { status: "done", messageKey: "vehicles.detail.maintenanceAffected" };
  },
);

export const removeVehicleAction = tenantAction(
  ADMIN_WRITE,
  async ({ tenant }, id: string, mode: "delete" | "archive"): Promise<ConsoleActionState> => {
    const c = getContainer();
    const result = await removeVehicle(
      c.pool,
      { id, mode },
      {
        tenantId: tenant.tenantId,
        now: c.clock.now(),
      },
    );
    if (!result.ok) {
      return err(
        result.code === "NOT_FOUND" ? "vehicles.detail.notFound" : "vehicles.detail.hasHistory",
      );
    }
    await removePhotoObjects(c.storage, result.photoKeys);
    revalidatePath(`/${tenant.slug}/admin/vehicles`);
    redirect(`/${tenant.slug}/admin/vehicles`);
  },
);
