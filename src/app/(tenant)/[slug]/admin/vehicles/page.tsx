import Link from "next/link";

import { requireTenantSession, tenantWriteRefusal } from "@/app/_lib/session";
import { createVehicleAction } from "@/app/actions/vehicles";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { listVehicles, vehicleUsage, type VehicleRow } from "@/modules/fleet";
import { VehicleForm } from "@/modules/fleet/ui/vehicle-form";
import { Alert } from "@/ui/alert";

export const dynamic = "force-dynamic";

function price(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
}

function VehicleList(props: {
  slug: string;
  rows: VehicleRow[];
  currency: string;
  admin: boolean;
}) {
  const t = getTranslator();
  if (props.rows.length === 0) {
    return <p>{t(props.admin ? "vehicles.empty" : "vehicles.emptyOperator")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {props.rows.map((v) => (
        <li key={v.id} className="flex flex-col gap-1 rounded-md border border-border p-4">
          <Link href={`/${props.slug}/admin/vehicles/${v.id}`} className="font-semibold underline">
            {v.name}
          </Link>
          <p>
            {formatMessage(t("vehicles.rowSummary"), {
              plate: v.plate,
              category: t(`vehicles.category.${v.category}` as "vehicles.category.city"),
            })}
          </p>
          <p>
            {formatMessage(t("vehicles.perDay"), {
              price: price(v.dailyPriceMinor, props.currency),
            })}
          </p>
          <p>{t(`vehicles.state.${v.state}`)}</p>
        </li>
      ))}
    </ul>
  );
}

function Filters(props: { slug: string; q: string; archived: boolean }) {
  const t = getTranslator();
  const base = `/${props.slug}/admin/vehicles`;
  return (
    <div className="mb-6 flex flex-col gap-2">
      <form action={base} method="get" className="flex flex-wrap items-end gap-2">
        <label htmlFor="q" className="sr-only">
          {t("vehicles.search")}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={props.q}
          placeholder={t("vehicles.search")}
          className="min-h-12 rounded-md border border-border bg-background px-3"
        />
        <button type="submit" className="min-h-12 rounded-md border border-border px-4">
          {t("vehicles.searchSubmit")}
        </button>
      </form>
      <Link href={props.archived ? base : `${base}?archived=1`} className="underline">
        {t(props.archived ? "vehicles.hideArchived" : "vehicles.showArchived")}
      </Link>
    </div>
  );
}

export default async function VehiclesPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const t = getTranslator();
  const { slug } = await props.params;
  const query = await props.searchParams;
  const { tenant, session } = await requireTenantSession(slug);
  const c = getContainer();
  const ctx = { tenantId: tenant.tenantId, now: c.clock.now() };
  const q = typeof query.q === "string" ? query.q.slice(0, 64) : "";
  const archived = query.archived === "1";
  const rows = await listVehicles(c.pool, { q, includeArchived: archived }, ctx);
  const admin = session.role === "admin";
  const usage = admin ? await vehicleUsage(c.pool, ctx) : null;
  const refusal = admin ? await tenantWriteRefusal(tenant) : null;
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href={`/${tenant.slug}/admin`} className="underline underline-offset-4">
        {t("admin.home.title")}
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">{t("vehicles.title")}</h1>
      {usage ? <p className="mb-4">{formatMessage(t("vehicles.usage"), usage)}</p> : null}
      <Filters slug={tenant.slug} q={q} archived={archived} />
      <VehicleList slug={tenant.slug} rows={rows} currency={tenant.currency} admin={admin} />
      {admin ? (
        <section aria-labelledby="add-vehicle" className="mt-8 flex flex-col gap-3">
          <h2 id="add-vehicle" className="text-xl font-semibold">
            {t("vehicles.form.addTitle")}
          </h2>
          {refusal ? (
            <Alert kind="status">{t(refusal)}</Alert>
          ) : (
            <VehicleForm action={createVehicleAction.bind(null, tenant.slug)} values={null} />
          )}
        </section>
      ) : null}
    </main>
  );
}
