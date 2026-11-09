"use client";

import { useState } from "react";

import { formatMessage, getTranslator, type MessageKey } from "../../../i18n";
import { applyOfferFilter, offerQueryString, type Offer, type OfferFilter } from "../domain/offers";

// W-P2 results and W-P2b filters (docs/04a-ux.md): the loaded set is filtered and sorted in the browser
// (no new search, so RL-01 is not spent on filter changes) with the URL kept in sync. Without
// JavaScript the same controls submit as a GET form and the server applies them.

export interface OfferListProps {
  slug: string;
  currency: string;
  period: { pickup: string; return: string };
  offers: readonly Offer[];
  initial: OfferFilter;
  seatOptions: readonly number[];
}

type SetFilter = (f: OfferFilter) => void;

const box = "min-h-12 rounded-md border border-border bg-background px-3 text-foreground";

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
}

const categoryKey = (c: string) => `vehicles.category.${c}` as MessageKey;
const fuelKey = (f: string) => `vehicles.fuel.${f}` as MessageKey;

function distinct(values: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function daysText(n: number): string {
  const t = getTranslator();
  return n === 1 ? t("public.results.dayOne") : formatMessage(t("public.results.days"), { n });
}

function OfferCard(props: { offer: Offer; href: string; currency: string }) {
  const t = getTranslator();
  const o = props.offer;
  const facts = [
    t(categoryKey(o.category)),
    t(fuelKey(o.fuelType)),
    formatMessage(t("public.results.seatsCount"), { n: o.seats }),
  ].join(" · ");
  const total = formatMessage(t("public.results.total"), {
    days: daysText(o.billedDays),
    total: money(o.totalMinor, props.currency),
  });
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-4">
      <div
        aria-hidden="true"
        className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-border text-sm"
      >
        {t("public.results.noPhoto")}
      </div>
      <h3 className="text-lg font-semibold">{o.name}</h3>
      <p className="text-sm">{facts}</p>
      <p>
        {formatMessage(t("public.results.perDay"), {
          price: money(o.dailyPriceMinor, props.currency),
        })}
      </p>
      <p className="font-semibold">{total}</p>
      <a
        href={props.href}
        aria-label={formatMessage(t("public.results.selectName"), { name: o.name })}
        className="mt-auto flex min-h-12 items-center justify-center rounded-md bg-primary px-4 font-semibold text-primary-foreground"
      >
        {t("public.results.select")}
      </a>
    </li>
  );
}

interface Option {
  value: string;
  label: string;
}

function ChoiceGroup(props: {
  legend: string;
  type: "checkbox" | "radio";
  name: string;
  options: readonly Option[];
  isChecked: (value: string) => boolean;
  onPick: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="font-semibold">{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.value} className="flex min-h-11 items-center gap-2">
          <input
            type={props.type}
            name={props.name}
            value={o.value}
            checked={props.isChecked(o.value)}
            onChange={() => {
              props.onPick(o.value);
            }}
            className="size-5"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function filterOptions(offers: readonly Offer[], seatOptions: readonly number[]) {
  const t = getTranslator();
  const any = (label: MessageKey): Option => ({ value: "", label: t(label) });
  return {
    categories: distinct(offers.map((o) => o.category)).map(([c, n]) => ({
      value: c,
      label: `${t(categoryKey(c))} (${String(n)})`,
    })),
    fuels: [
      any("public.results.anyFuel"),
      ...distinct(offers.map((o) => o.fuelType)).map(([v]) => ({ value: v, label: t(fuelKey(v)) })),
    ],
    seats: [
      any("public.results.anySeats"),
      ...seatOptions.map((n) => ({
        value: String(n),
        label: formatMessage(t("public.results.seatsMin"), { n }),
      })),
    ],
  };
}

/** The filter after one control changed (categories toggle, fuel and seats replace). */
function picked(f: OfferFilter, name: "category" | "fuel" | "seats", value: string): OfferFilter {
  if (name === "category") {
    const has = f.category.includes(value);
    return { ...f, category: has ? f.category.filter((x) => x !== value) : [...f.category, value] };
  }
  if (name === "fuel") return { ...f, fuel: value || undefined };
  return { ...f, seats: value ? Number(value) : undefined };
}

function isChecked(f: OfferFilter, name: "category" | "fuel" | "seats", value: string): boolean {
  if (name === "category") return f.category.includes(value);
  if (name === "fuel") return (f.fuel ?? "") === value;
  return (f.seats === undefined ? "" : String(f.seats)) === value;
}

function Filters(props: {
  offers: readonly Offer[];
  filter: OfferFilter;
  seatOptions: readonly number[];
  set: SetFilter;
}) {
  const t = getTranslator();
  const { categories, fuels, seats } = filterOptions(props.offers, props.seatOptions);
  const groups = [
    { name: "category", legend: t("public.results.category"), options: categories },
    { name: "fuel", legend: t("public.results.fuel"), options: fuels },
    { name: "seats", legend: t("public.results.seats"), options: seats },
  ] as const;
  return (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:gap-8">
      {groups.map((g) => (
        <ChoiceGroup
          key={g.name}
          legend={g.legend}
          type={g.name === "category" ? "checkbox" : "radio"}
          name={g.name}
          options={g.options}
          isChecked={(v) => isChecked(props.filter, g.name, v)}
          onPick={(v) => {
            props.set(picked(props.filter, g.name, v));
          }}
        />
      ))}
    </div>
  );
}

function activeCount(f: OfferFilter): number {
  return f.category.length + (f.fuel ? 1 : 0) + (f.seats === undefined ? 0 : 1);
}

function SortSelect(props: { filter: OfferFilter; set: SetFilter }) {
  const t = getTranslator();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="sort">{t("public.results.sort")}</label>
      <select
        id="sort"
        name="sort"
        value={props.filter.sort}
        onChange={(e) => {
          const sort = e.target.value === "price-desc" ? "price-desc" : "price-asc";
          props.set({ ...props.filter, sort });
        }}
        className={box}
      >
        <option value="price-asc">{t("public.results.sortAsc")}</option>
        <option value="price-desc">{t("public.results.sortDesc")}</option>
      </select>
    </div>
  );
}

function FiltersPanel(props: OfferListProps & { filter: OfferFilter; set: SetFilter }) {
  const t = getTranslator();
  const active = activeCount(props.filter);
  const label = t("public.results.filters");
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        {active > 0 ? `${label} (${String(active)})` : label}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <Filters
          offers={props.offers}
          filter={props.filter}
          seatOptions={props.seatOptions}
          set={props.set}
        />
        <noscript>
          <button type="submit" className={box}>
            {t("public.results.apply")}
          </button>
        </noscript>
      </div>
    </details>
  );
}

function Toolbar(props: OfferListProps & { filter: OfferFilter; set: SetFilter }) {
  const { filter, set } = props;
  const active = activeCount(filter);
  return (
    <form
      action={`/${props.slug}/vehicles`}
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="pickup" value={props.period.pickup} />
      <input type="hidden" name="return" value={props.period.return} />
      <div className="flex flex-wrap items-end gap-3">
        <SortSelect filter={filter} set={set} />
        {active > 0 ? (
          <ClearButton filter={filter} set={set} label="public.results.clearAll" />
        ) : null}
      </div>
      <FiltersPanel {...props} />
    </form>
  );
}

function ClearButton(props: { filter: OfferFilter; set: SetFilter; label: MessageKey }) {
  const t = getTranslator();
  return (
    <button
      type="button"
      onClick={() => {
        props.set({ sort: props.filter.sort, category: [] });
      }}
      className="min-h-12 underline"
    >
      {t(props.label)}
    </button>
  );
}

export function OfferList(props: OfferListProps) {
  const t = getTranslator();
  const [filter, setFilter] = useState<OfferFilter>(props.initial);
  const shown = applyOfferFilter(props.offers, filter);
  const set: SetFilter = (next) => {
    setFilter(next);
    const query = offerQueryString(props.period, next);
    window.history.replaceState(null, "", `/${props.slug}/vehicles?${query}`);
  };
  const book = new URLSearchParams(props.period).toString();
  const count =
    shown.length === 1
      ? t("public.results.countOne")
      : formatMessage(t("public.results.count"), { n: shown.length });
  return (
    <div className="flex flex-col gap-4">
      <Toolbar {...props} filter={filter} set={set} />
      <p role="status" className="font-semibold">
        {count}
      </p>
      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p>{t("public.results.emptyFiltered")}</p>
          <ClearButton filter={filter} set={set} label="public.results.clearFilters" />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              currency={props.currency}
              href={`/${props.slug}/book?vehicle=${o.id}&${book}`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
