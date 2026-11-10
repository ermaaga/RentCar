import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  loadPublicTenant,
  publicPageMetadata,
  searchAllowed,
  type PublicTenant,
} from "@/app/_lib/public-tenant";
import { submitBookingAction } from "@/app/actions/public-booking";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import {
  issueFormToken,
  parseSearchQuery,
  periodQueryString,
  prepareBooking,
} from "@/modules/booking";
import { BookingForm } from "@/modules/booking/ui/booking-form";
import { Alert } from "@/ui/alert";

import { daysText, localLabel, money, searchErrorText } from "../_components/format";
import { PublicShell, UnavailablePage } from "../_components/public-shell";

// W-P3 booking page (BKG-02): re-checks the car and the price for the period, issues the signed form
// token and renders the details form. RL-21 shares the search limit (RL-01).

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(props: Props): Promise<Metadata> {
  return publicPageMetadata((await props.params).slug, "public.book.title");
}

interface Period {
  pickup: string;
  return: string;
}

function TakenNotice({ back }: { back: string }) {
  const t = getTranslator();
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert kind="error">{t("public.book.errors.VEHICLE_TAKEN")}</Alert>
      <Link href={back} className="min-h-12 content-center underline">
        {t("public.book.back")}
      </Link>
    </div>
  );
}

function Summary(props: {
  tenant: PublicTenant;
  vehicleName: string;
  period: Period;
  price: { billedDays: number; totalMinor: number };
  back: string;
}) {
  const t = getTranslator();
  const periodText = formatMessage(t("public.book.period"), {
    pickup: localLabel(props.period.pickup),
    return: localLabel(props.period.return),
  });
  const totalText = formatMessage(t("public.book.total"), {
    days: daysText(props.price.billedDays),
    total: money(props.price.totalMinor, props.tenant.currency),
  });
  return (
    <section
      aria-labelledby="summary"
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <h2 id="summary" className="text-xl font-semibold">
        {t("public.book.summaryTitle")}
      </h2>
      <p className="font-semibold">{props.vehicleName}</p>
      <p>{periodText}</p>
      <p className="font-semibold">{totalText}</p>
      <p>{t("public.book.payment")}</p>
      <Link href={props.back} className="min-h-12 content-center underline">
        {t("public.book.back")}
      </Link>
    </section>
  );
}

async function Booking(props: { tenant: PublicTenant; vehicleId: string; period: Period }) {
  const { tenant, vehicleId, period } = props;
  const t = getTranslator();
  const back = `/${tenant.slug}/vehicles?${periodQueryString(period)}`;
  if (!(await searchAllowed(tenant.tenantId))) {
    return <Alert kind="error">{searchErrorText("RATE_LIMITED", tenant.rules)}</Alert>;
  }
  const c = getContainer();
  const now = c.clock.now();
  const prepared = await prepareBooking(
    c.pool,
    { vehicleId, ...period },
    { tenantId: tenant.tenantId, now },
  );
  if (!prepared.ok) {
    if (prepared.code !== "VEHICLE_TAKEN") redirect(`/${tenant.slug}?error=${prepared.code}`);
    return <TakenNotice back={back} />;
  }
  const formToken = issueFormToken(c.formTokenKey, { tenantId: tenant.tenantId, vehicleId, now });
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Summary
        tenant={tenant}
        vehicleName={prepared.vehicle.name}
        period={period}
        price={prepared}
        back={back}
      />
      <section aria-labelledby="details" className="flex flex-col gap-4">
        <h2 id="details" className="text-xl font-semibold">
          {t("public.book.detailsTitle")}
        </h2>
        <BookingForm
          action={submitBookingAction.bind(null, tenant.slug)}
          hidden={{ formToken, vehicleId, ...period, expectedTotalMinor: prepared.totalMinor }}
        />
      </section>
    </div>
  );
}

export default async function BookPage(props: Props) {
  const [{ slug }, params] = await Promise.all([props.params, props.searchParams]);
  const tenant = await loadPublicTenant(slug);
  if (tenant.unavailable) return <UnavailablePage tenant={tenant} />;
  const t = getTranslator();
  const parsed = parseSearchQuery(params);
  const vehicleId = params.vehicle;
  if (!parsed.ok || typeof vehicleId !== "string" || !UUID.test(vehicleId)) {
    redirect(`/${tenant.slug}`);
  }
  const period = { pickup: parsed.query.pickup, return: parsed.query.return };
  return (
    <PublicShell tenant={tenant}>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("public.book.title")}</h1>
        <Booking tenant={tenant} vehicleId={vehicleId} period={period} />
      </div>
    </PublicShell>
  );
}
