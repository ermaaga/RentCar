import Link from "next/link";

import { requireTenantAdmin, tenantWriteRefusal } from "@/app/_lib/session";
import { createAdminBookingAction } from "@/app/actions/bookings";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import {
  newIdempotencyKey,
  parseSearchQuery,
  staffVehicleOptions,
  type StaffVehicleOption,
} from "@/modules/booking";
import { AdminBookingForm, type VehicleChoice } from "@/modules/booking/ui/admin-booking-form";
import { getPublicTenantSettings } from "@/modules/tenancy";
import { Alert } from "@/ui/alert";

import { localLabel, money, searchErrorText } from "../../../_components/format";
import { DatesForm } from "../_components/dates-form";

// W-D5 new booking (BKG-06, FR-BKG-06/08, US-051/055): step 1 picks the dates (GET, in the URL),
// step 2 shows every live vehicle for them with the reason it can't be booked, then the customer,
// optional payment and notes. Admin only; refused while the tenant is read-only.

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function choice(o: StaffVehicleOption, currency: string): VehicleChoice {
  const t = getTranslator();
  const blocked =
    o.state === "maintenance"
      ? t("bookings.new.blockedMaintenance")
      : o.conflict
        ? formatMessage(t("bookings.new.blockedBooked"), {
            code: o.conflict.code,
            pickup: localLabel(o.conflict.pickup),
            return: localLabel(o.conflict.return),
          })
        : null;
  return {
    id: o.id,
    label: o.name,
    detail: formatMessage(t("bookings.new.vehicleDetail"), {
      plate: o.plate,
      daily: money(o.dailyPriceMinor, currency),
      total: money(o.totalMinor, currency),
    }),
    blocked,
  };
}

async function VehicleStep(props: {
  slug: string;
  tenantId: string;
  currency: string;
  timeZone: string;
  period: { pickup: string; return: string };
}) {
  const t = getTranslator();
  const c = getContainer();
  const result = await staffVehicleOptions(c.pool, props.period, {
    tenantId: props.tenantId,
    now: c.clock.now(),
  });
  if (!result.ok) {
    const settings = await getPublicTenantSettings(c.pool, props.tenantId);
    const rules = settings?.rules ?? { minRentalDays: 1, maxRentalDays: 30, leadTimeMinutes: 0 };
    return <Alert kind="error">{searchErrorText(result.code, rules)}</Alert>;
  }
  if (result.options.length === 0) return <p>{t("bookings.new.noVehicles")}</p>;
  const choices = result.options.map((o) => choice(o, props.currency));
  const bound = { ...props.period, idempotencyKey: newIdempotencyKey() };
  return (
    <div className="flex flex-col gap-4">
      <p role="status">
        {result.billedDays === 1
          ? t("bookings.new.billedOne")
          : formatMessage(t("bookings.new.billed"), { days: result.billedDays })}{" "}
        {formatMessage(t("bookings.new.timeZone"), { zone: props.timeZone })}
      </p>
      {result.past ? <p>{t("bookings.new.past")}</p> : null}
      {choices.every((v) => v.blocked) ? <p>{t("bookings.new.noneFree")}</p> : null}
      <AdminBookingForm
        action={createAdminBookingAction.bind(null, props.slug, bound)}
        choices={choices}
      />
    </div>
  );
}

export default async function NewBookingPage(props: Props) {
  const t = getTranslator();
  const { slug } = await props.params;
  const { tenant } = await requireTenantAdmin(slug);
  const refusal = await tenantWriteRefusal(tenant);
  const parsed = parseSearchQuery(await props.searchParams);
  const period = parsed.ok ? { pickup: parsed.query.pickup, return: parsed.query.return } : null;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <Link href={`/${tenant.slug}/admin/bookings`} className="underline underline-offset-4">
        {t("bookings.new.cancel")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("bookings.new.title")}</h1>
      {refusal ? (
        <Alert kind="status">{t("bookings.new.readOnly")}</Alert>
      ) : (
        <>
          <DatesForm slug={tenant.slug} period={period} />
          {period ? (
            <VehicleStep
              slug={tenant.slug}
              tenantId={tenant.tenantId}
              currency={tenant.currency}
              timeZone={tenant.timeZone}
              period={period}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
