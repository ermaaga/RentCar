import type { Metadata } from "next";

import { loadPublicTenant, tenantCanonical, type PublicTenant } from "@/app/_lib/public-tenant";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import { defaultPeriod, parseSearchQuery } from "@/modules/booking";
import { localDate } from "@/modules/subscriptions";
import { autoRentalJsonLd, rootDescription, serializeJsonLd } from "@/modules/tenancy";

import { asSearchError, searchErrorText } from "./_components/format";
import { PublicShell, UnavailablePage } from "./_components/public-shell";
import { SearchForm } from "./_components/search-form";

// W-P1 tenant home and search (docs/04a-ux.md, FR-PUB-01/02). The only indexable page of the product
// (docs/09-seo.md section 5): `index, follow` only with PUBLIC_INDEXING_ENABLED, no query string and a
// tenant that takes bookings; otherwise noindex. Title, description, canonical, Open Graph (SR-11/12;
// og:image arrives with the branding OG image in M5) and JSON-LD AutoRental (SR-13).

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const t = getTranslator();
  const tenant = await loadPublicTenant((await props.params).slug);
  const hasQuery = Object.keys(await props.searchParams).length > 0;
  const canonical = tenantCanonical(tenant.slug);
  const title = formatMessage(t("public.seo.rootTitle"), { tenant: tenant.title });
  const description = rootDescription(
    tenant.shortDescription,
    formatMessage(t("public.seo.rootDescription"), { tenant: tenant.title }),
  );
  const index = getContainer().publicIndexing && !tenant.unavailable && !hasQuery;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index, follow: !tenant.unavailable },
    openGraph: { type: "website", siteName: tenant.title, title, description, url: canonical },
    twitter: { card: "summary", title, description },
  };
}

/** SR-13 structured data; React writes script text unescaped, `<` is already a Unicode escape. */
function AutoRentalData({ tenant }: { tenant: PublicTenant }) {
  const data = autoRentalJsonLd({ ...tenant, canonical: tenantCanonical(tenant.slug) });
  return <script type="application/ld+json">{serializeJsonLd(data)}</script>;
}

export default async function PublicHomePage(props: Props) {
  const t = getTranslator();
  const tenant = await loadPublicTenant((await props.params).slug);
  if (tenant.unavailable) return <UnavailablePage tenant={tenant} />;
  const params = await props.searchParams;
  const now = getContainer().clock.now();
  const parsed = parseSearchQuery(params);
  const period = parsed.ok ? parsed.query : defaultPeriod(now, tenant.timeZone, tenant.rules);
  const code = asSearchError(params.error);
  const earliest = new Date(now.getTime() + tenant.rules.leadTimeMinutes * 60_000);
  return (
    <PublicShell tenant={tenant}>
      <AutoRentalData tenant={tenant} />
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold">{tenant.title}</h1>
          {tenant.shortDescription ? <p className="mt-2">{tenant.shortDescription}</p> : null}
        </div>
        <h2 className="text-xl font-semibold">{t("public.search.title")}</h2>
        <SearchForm
          tenant={tenant}
          period={period}
          minDate={localDate(earliest, tenant.timeZone)}
          error={code ? searchErrorText(code, tenant.rules) : undefined}
        />
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li>{t("public.search.trustPay")}</li>
          <li>{t("public.search.trustNoAccount")}</li>
          <li>{t("public.search.trustVat")}</li>
        </ul>
      </div>
    </PublicShell>
  );
}
