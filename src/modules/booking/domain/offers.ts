// Offered vehicles for one period (docs/04a-ux.md W-P2/W-P2b): the same sort and filters run on the
// server (search) and in the browser (live filters on the loaded set). Pure, no imports.

export interface Offer {
  id: string;
  name: string;
  make: string;
  model: string;
  category: string;
  fuelType: string;
  seats: number;
  billedDays: number;
  dailyPriceMinor: number;
  totalMinor: number;
}

export interface OfferFilter {
  sort: "price-asc" | "price-desc";
  category: readonly string[];
  fuel?: string | undefined;
  seats?: number | undefined;
}

/** Filters, then sorts by total (price-asc default) with ties broken by name. */
export function applyOfferFilter<T extends Offer>(items: readonly T[], f: OfferFilter): T[] {
  const dir = f.sort === "price-desc" ? -1 : 1;
  return items
    .filter((o) => f.category.length === 0 || f.category.includes(o.category))
    .filter((o) => !f.fuel || o.fuelType === f.fuel)
    .filter((o) => f.seats === undefined || o.seats >= f.seats)
    .sort((a, b) => dir * (a.totalMinor - b.totalMinor) || a.name.localeCompare(b.name, "en"));
}

/** Canonical results query: period first, defaults left out, categories joined with commas. */
export function offerQueryString(
  period: { pickup: string; return: string },
  f: OfferFilter,
): string {
  const out = new URLSearchParams({ pickup: period.pickup, return: period.return });
  if (f.sort !== "price-asc") out.set("sort", f.sort);
  if (f.category.length > 0) out.set("category", f.category.join(","));
  if (f.fuel) out.set("fuel", f.fuel);
  if (f.seats !== undefined) out.set("seats", String(f.seats));
  return out.toString();
}
