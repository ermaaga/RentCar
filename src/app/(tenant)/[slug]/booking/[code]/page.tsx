import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadPublicTenant, publicPageMetadata } from "@/app/_lib/public-tenant";
import { consume, limitReached, requestIp } from "@/app/_lib/security";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { getPublicConfirmation, type PublicConfirmation } from "@/modules/booking";
import { RATE_LIMITS } from "@/platform/rate-limit/postgres";

import { localLabel, money } from "../../_components/format";
import { PublicShell } from "../../_components/public-shell";

// W-P4 confirmation (BKG-04, FR-PUB-07): looked up by tenant and code only; shows the first name and
// never the phone or email (UX-7). Every miss is the same 404 and counts towards RL-03.

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string; code: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return publicPageMetadata((await props.params).slug, "public.confirmation.title");
}

function Details({ booking, currency }: { booking: PublicConfirmation; currency: string }) {
  const t = getTranslator();
  const rows: [string, string][] = [
    [t("public.confirmation.vehicle"), booking.vehicleName],
    [t("public.confirmation.pickup"), localLabel(booking.pickup)],
    [t("public.confirmation.return"), localLabel(booking.return)],
    [t("public.confirmation.total"), money(booking.totalMinor, currency)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-medium">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ConfirmationPage(props: Props) {
  const t = getTranslator();
  const { slug, code } = await props.params;
  const tenant = await loadPublicTenant(slug);
  // Same RL-03 key as the PDF route (slug and IP), so misses on both count together.
  const identity = `${tenant.slug}:${await requestIp()}`;
  if (await limitReached(RATE_LIMITS.publicCodeMiss, identity, "public")) notFound();
  const booking = await getPublicConfirmation(getContainer().pool, {
    tenantId: tenant.tenantId,
    code,
  });
  if (!booking) {
    await consume(RATE_LIMITS.publicCodeMiss, identity, "public");
    notFound();
  }
  return (
    <PublicShell tenant={tenant}>
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("public.confirmation.title")}</h1>
        <p>{formatMessage(t("public.confirmation.thanks"), { name: booking.firstName })}</p>
        <div className="rounded-md border border-border p-4">
          <p>{t("public.confirmation.code")}</p>
          <p className="font-mono text-2xl font-semibold tracking-widest">{booking.code}</p>
          <p className="text-sm">{t("public.confirmation.codeHint")}</p>
        </div>
        <Details booking={booking} currency={tenant.currency} />
        <p>{t("public.confirmation.payment")}</p>
        <a
          href={`/${tenant.slug}/booking/${booking.code}/pdf`}
          download
          className="min-h-12 content-center font-semibold underline"
        >
          {t("public.confirmation.pdf")}
        </a>
        <Link href={`/${tenant.slug}`} className="min-h-12 content-center underline">
          {t("public.confirmation.newSearch")}
        </Link>
      </div>
    </PublicShell>
  );
}
