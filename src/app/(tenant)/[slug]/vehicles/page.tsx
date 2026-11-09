import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { loadPublicTenant, searchAllowed, type PublicTenant } from "@/app/_lib/public-tenant";
import { getContainer } from "@/composition/container";
import { formatMessage, getTranslator } from "@/i18n";
import {
  parseSearchQuery,
  periodQueryString,
  searchAvailability,
  searchQueryString,
  SEAT_OPTIONS,
  type SearchQuery,
} from "@/modules/booking";
import { OfferList } from "@/modules/booking/ui/offer-list";
import { Alert } from "@/ui/alert";

import { localLabel, searchErrorText } from "../_components/format";
import { PublicShell, UnavailableNotice } from "../_components/public-shell";

// W-P2 results (docs/04a-ux.md, BKG-01, FR-PUB-03/04). The period is searched once (RL-01 counts it);
// sort and filters then run on the loaded set. Invalid input goes back to the search form with the error.

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const tenant = await loadPublicTenant((await props.params).slug);
  const t = getTranslator();
  return {
    title: `${t("public.results.title")} · ${tenant.title}`,
    robots: { index: false, follow: false },
  };
}

function backToSearch(slug: string, error: string, period?: SearchQuery): never {
  const query = new URLSearchParams(period ? periodQueryString(period) : "");
  query.set("error", error);
  redirect(`/${slug}?${query.toString()}`);
}

function ChangeDates(props: { tenant: PublicTenant; query: SearchQuery }) {
  const t = getTranslator();
  return (
    <Link
      href={`/${props.tenant.slug}?${periodQueryString(props.query)}`}
      className="min-h-12 content-center underline"
    >
      {t("public.results.changeDates")}
    </Link>
  );
}

function Summary(props: { tenant: PublicTenant; query: SearchQuery; days: number }) {
  const t = getTranslator();
  const days =
    props.days === 1
      ? t("public.results.dayOne")
      : formatMessage(t("public.results.days"), { n: props.days });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p>
        {formatMessage(t("public.results.summary"), {
          pickup: localLabel(props.query.pickup),
          return: localLabel(props.query.return),
          days,
        })}
      </p>
      <ChangeDates tenant={props.tenant} query={props.query} />
    </div>
  );
}

function NoVehicles() {
  const t = getTranslator();
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="font-semibold">{t("public.results.empty")}</p>
      <p>{t("public.results.emptyHint")}</p>
    </div>
  );
}

async function Results(props: { tenant: PublicTenant; query: SearchQuery }) {
  const { tenant, query } = props;
  if (!(await searchAllowed(tenant.tenantId))) {
    return <Alert kind="error">{searchErrorText("RATE_LIMITED", tenant.rules)}</Alert>;
  }
  const c = getContainer();
  const result = await searchAvailability(
    c.pool,
    { pickup: query.pickup, return: query.return },
    { tenantId: tenant.tenantId, now: c.clock.now() },
  ).catch(() => null);
  if (!result) {
    return <Alert kind="error">{searchErrorText("FAILED", tenant.rules)}</Alert>;
  }
  if (!result.ok) {
    backToSearch(tenant.slug, result.code, query);
  }
  return (
    <div className="flex flex-col gap-4">
      <Summary tenant={tenant} query={query} days={result.billedDays} />
      {result.items.length === 0 ? (
        <NoVehicles />
      ) : (
        <OfferList
          slug={tenant.slug}
          currency={tenant.currency}
          period={{ pickup: query.pickup, return: query.return }}
          offers={result.items}
          initial={query}
          seatOptions={SEAT_OPTIONS}
        />
      )}
    </div>
  );
}

export default async function ResultsPage(props: Props) {
  const t = getTranslator();
  const tenant = await loadPublicTenant((await props.params).slug);
  if (tenant.unavailable) {
    return (
      <PublicShell tenant={tenant}>
        <UnavailableNotice tenant={tenant} />
      </PublicShell>
    );
  }
  const params = await props.searchParams;
  const parsed = parseSearchQuery(params);
  if (!parsed.ok) {
    backToSearch(tenant.slug, parsed.code);
  }
  if (params.pickup === undefined) {
    // The search form sent date and time separately: move to the canonical, bookmarkable URL.
    redirect(`/${tenant.slug}/vehicles?${searchQueryString(parsed.query)}`);
  }
  return (
    <PublicShell tenant={tenant}>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("public.results.title")}</h1>
        <Results tenant={tenant} query={parsed.query} />
      </div>
    </PublicShell>
  );
}
