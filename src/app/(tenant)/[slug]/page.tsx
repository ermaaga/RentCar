import type { Metadata } from "next";

import { loadPublicTenant } from "@/app/_lib/public-tenant";
import {
  autoRentalJsonLd,
  jsonLdScript,
  rootDescription,
  rootRobots,
  rootTitle,
  rootUrl,
} from "@/app/_lib/seo";
import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { defaultPeriod, parseSearchQuery } from "@/modules/booking";
import { localDate } from "@/modules/subscriptions";

import { asSearchError, searchErrorText } from "./_components/format";
import { PublicShell, UnavailablePage } from "./_components/public-shell";
import { SearchForm } from "./_components/search-form";

// W-P1 tenant home and search (docs/04a-ux.md, FR-PUB-01/02). The root is the only indexable page and
// only when PUBLIC_INDEXING_ENABLED is on (docs/09-seo.md SR-05/SR-06, FR-PUB-14).

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([props.params, props.searchParams]);
  const tenant = await loadPublicTenant(slug);
  const c = getContainer();
  const url = rootUrl(c.baseUrl, tenant.slug);
  const title = rootTitle(tenant.title);
  const description = rootDescription(tenant);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: rootRobots({
      indexingEnabled: c.publicIndexing,
      unavailable: tenant.unavailable !== null,
      hasQuery: Object.keys(query).length > 0,
    }),
    openGraph: { type: "website", siteName: tenant.title, title, description, url },
    twitter: { card: "summary" },
  };
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
  const url = rootUrl(getContainer().baseUrl, tenant.slug);
  return (
    <PublicShell tenant={tenant}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(autoRentalJsonLd(tenant, url)) }}
      />
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
