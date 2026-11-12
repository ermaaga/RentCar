import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTenantSession, tenantWriteRefusal } from "@/app/_lib/session";
import {
  deletePhotoAction,
  reorderPhotosAction,
  setCoverPhotoAction,
} from "@/app/actions/vehicle-photos";
import {
  removeVehicleAction,
  setMaintenanceAction,
  updateVehicleAction,
} from "@/app/actions/vehicles";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { getVehicle, listVehiclePhotos, type VehicleRow } from "@/modules/fleet";
import { PhotoManager } from "@/modules/fleet/ui/photo-manager";
import { VehicleForm } from "@/modules/fleet/ui/vehicle-form";
import { ConsoleActionForm } from "@/modules/tenancy/ui/console-action-form";
import { Alert } from "@/ui/alert";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formValues(v: VehicleRow) {
  return {
    name: v.name,
    plate: v.plate,
    make: v.make,
    model: v.model,
    category: v.category,
    fuelType: v.fuelType,
    seats: v.seats,
    price: (v.dailyPriceMinor / 100).toFixed(2),
    notes: v.notes ?? "",
    updatedAt: v.updatedAt,
  };
}

/** The full order after moving photo `i` one place earlier (-1) or later (+1); `null` at the ends. */
function movedOrder(ids: readonly string[], i: number, step: -1 | 1): string[] | null {
  const j = i + step;
  if (j < 0 || j >= ids.length) return null;
  const next = [...ids];
  next.splice(j, 0, ...next.splice(i, 1));
  return next;
}

/** FLT-08 move earlier / later buttons for photo `i`; a single photo has nothing to reorder. */
function MoveControls({
  slug,
  vehicleId,
  ids,
  i,
}: {
  slug: string;
  vehicleId: string;
  ids: readonly string[];
  i: number;
}) {
  if (ids.length < 2) return null;
  const earlier = movedOrder(ids, i, -1);
  const later = movedOrder(ids, i, 1);
  return (
    <>
      {earlier ? (
        <ConsoleActionForm
          action={reorderPhotosAction.bind(null, slug, vehicleId, earlier)}
          submit="vehicles.photos.moveUp"
          submitParams={{ n: String(i + 1) }}
        />
      ) : null}
      {later ? (
        <ConsoleActionForm
          action={reorderPhotosAction.bind(null, slug, vehicleId, later)}
          submit="vehicles.photos.moveDown"
          submitParams={{ n: String(i + 1) }}
        />
      ) : null}
    </>
  );
}

function AdminControls({ slug, v }: { slug: string; v: VehicleRow }) {
  const inMaintenance = v.state === "maintenance";
  return (
    <section className="mt-8 flex max-w-xl flex-col gap-6">
      {v.state === "archived" ? null : (
        <ConsoleActionForm
          action={setMaintenanceAction.bind(null, slug, v.id, !inMaintenance)}
          submit={
            inMaintenance ? "vehicles.detail.maintenanceOff" : "vehicles.detail.maintenanceOn"
          }
          hint="vehicles.detail.maintenanceHint"
        />
      )}
      {v.state === "archived" ? null : (
        <ConsoleActionForm
          action={removeVehicleAction.bind(null, slug, v.id, "archive")}
          submit="vehicles.detail.archive"
          hint="vehicles.detail.archiveHint"
        />
      )}
      <ConsoleActionForm
        action={removeVehicleAction.bind(null, slug, v.id, "delete")}
        submit="vehicles.detail.delete"
        hint="vehicles.detail.deleteHint"
      />
    </section>
  );
}

async function Photos({ slug, tenantId, v }: { slug: string; tenantId: string; v: VehicleRow }) {
  const c = getContainer();
  const photos = await listVehiclePhotos(c.pool, { tenantId, vehicleId: v.id });
  const ids = photos.map((p) => p.id);
  return (
    <PhotoManager
      vehicleName={v.name}
      target={{ slug, vehicleId: v.id, maxBytes: c.uploadMaxBytes }}
      photos={photos.map((p, i) => ({
        id: p.id,
        small: p.small,
        isCover: p.isCover,
        controls: (
          <>
            <MoveControls slug={slug} vehicleId={v.id} ids={ids} i={i} />
            {p.isCover ? null : (
              <ConsoleActionForm
                action={setCoverPhotoAction.bind(null, slug, v.id, p.id)}
                submit="vehicles.photos.makeCover"
              />
            )}
            <ConsoleActionForm
              action={deletePhotoAction.bind(null, slug, v.id, p.id)}
              submit="vehicles.photos.remove"
            />
          </>
        ),
      }))}
    />
  );
}

export default async function VehiclePage(props: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const t = getTranslator();
  const { slug, id } = await props.params;
  const { tenant, session } = await requireTenantSession(slug);
  if (!UUID.test(id)) notFound();
  const c = getContainer();
  const v = await getVehicle(c.pool, id, { tenantId: tenant.tenantId, now: c.clock.now() });
  if (!v) notFound();
  const admin = session.role === "admin";
  const refusal = admin ? await tenantWriteRefusal(tenant) : null;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin/vehicles`} className="underline underline-offset-4">
        {t("vehicles.detail.back")}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">{v.name}</h1>
      <p className="mb-6">
        {formatMessage(t("vehicles.detailSummary"), {
          plate: v.plate,
          state: t(`vehicles.state.${v.state}`),
          seats: formatMessage(t("vehicles.seats"), { n: v.seats }),
        })}
      </p>
      {admin && refusal ? <Alert kind="status">{t(refusal)}</Alert> : null}
      {admin && !refusal ? (
        <>
          <h2 className="mb-3 text-xl font-semibold">{t("vehicles.form.editTitle")}</h2>
          <VehicleForm
            action={updateVehicleAction.bind(null, tenant.slug, v.id)}
            values={formValues(v)}
          />
          <Photos slug={tenant.slug} tenantId={tenant.tenantId} v={v} />
          <AdminControls slug={tenant.slug} v={v} />
        </>
      ) : null}
    </main>
  );
}
