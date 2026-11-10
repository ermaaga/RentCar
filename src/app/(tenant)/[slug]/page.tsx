import type { Metadata } from "next";

import { loadPublicTenant } from "@/app/_lib/public-tenant";
import { getContainer } from "@/composition/container";
import { getTranslator } from "@/i18n";
import { defaultPeriod, parseSearchQuery } from "@/modules/booking";
import { localDate } from "@/modules/subscriptions";

import { asSearchError, searchErrorText } from "./_components/format";
import { PublicShell, UnavailablePage } from "./_components/public-shell";
import { SearchForm } from "./_components/search-form";

// W-P1 tenant home and search (docs/04a-ux.md, FR-PUB-01/02). Indexing stays off until the SEO slice
// adds PUBLIC_INDEXING_ENABLED (FR-PUB-14 default false: every page noindex).

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const tenant = await loadPublicTenant((await props.params).slug);
  return {
    title: tenant.title,
    description: tenant.shortDescription ?? undefined,
    robots: { index: false, follow: false },
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
  return (
    <PublicShell tenant={tenant}>
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
