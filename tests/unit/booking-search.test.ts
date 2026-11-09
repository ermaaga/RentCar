import { describe, expect, it } from "vitest";

import {
  defaultPeriod,
  parseSearchQuery,
  periodQueryString,
  searchQueryString,
} from "../../src/modules/booking/application/search-query";
import { addLocalDays, formatLocal } from "../../src/modules/booking/domain/local-time";
import { applyOfferFilter, type Offer } from "../../src/modules/booking/domain/offers";

const ROME = "Europe/Rome";
const RULES = { minRentalDays: 1, maxRentalDays: 30, leadTimeMinutes: 0 };

describe("public search query (W-P1/W-P2 URL)", () => {
  it("reads the canonical form and fills the defaults", () => {
    const r = parseSearchQuery({ pickup: "2026-06-01T10:00", return: "2026-06-03T10:30" });
    expect(r).toEqual({
      ok: true,
      query: {
        pickup: "2026-06-01T10:00",
        return: "2026-06-03T10:30",
        sort: "price-asc",
        category: [],
        fuel: undefined,
        seats: undefined,
      },
    });
  });

  it("combines the separate date and time fields of the plain search form", () => {
    const r = parseSearchQuery({
      pickupDate: "2026-06-01",
      pickupTime: "10:00",
      returnDate: "2026-06-03",
      returnTime: "09:45",
    });
    expect(r.ok && [r.query.pickup, r.query.return]).toEqual([
      "2026-06-01T10:00",
      "2026-06-03T09:45",
    ]);
  });
});

describe("public search query: filters", () => {
  it("accepts categories comma-joined or repeated, and filters", () => {
    const r = parseSearchQuery({
      pickup: "2026-06-01T10:00",
      return: "2026-06-03T10:00",
      category: ["suv,van", "suv"],
      fuel: "diesel",
      seats: "5",
      sort: "price-desc",
      utm_source: "flyer",
    });
    expect(r.ok && r.query).toMatchObject({
      category: ["suv", "van"],
      fuel: "diesel",
      seats: 5,
      sort: "price-desc",
    });
  });
});

describe("public search query: refusals and canonical URL", () => {
  it.each([
    [{ return: "2026-06-03T10:00" }, "MISSING_PERIOD"],
    [{ pickup: "2026-06-01 10:00", return: "2026-06-03T10:00" }, "MISSING_PERIOD"],
    [{ pickupDate: "2026-06-01", returnDate: "2026-06-03", returnTime: "10:00" }, "MISSING_PERIOD"],
    [{ pickup: ["2026-06-01T10:00", "x"], return: "2026-06-03T10:00" }, "INVALID_QUERY"],
    [{ pickup: "2026-06-01T10:00", return: "2026-06-03T10:00", category: "boat" }, "INVALID_QUERY"],
    [{ pickup: "2026-06-01T10:00", return: "2026-06-03T10:00", fuel: "coal" }, "INVALID_QUERY"],
    [{ pickup: "2026-06-01T10:00", return: "2026-06-03T10:00", seats: "99" }, "INVALID_QUERY"],
    [{ pickup: "2026-06-01T10:00", return: "2026-06-03T10:00", sort: "name" }, "INVALID_QUERY"],
  ])("refuses %j with %s", (params, code) => {
    expect(parseSearchQuery(params)).toEqual({ ok: false, code });
  });

  it("writes the canonical URL without defaults and round-trips it", () => {
    const base = { pickup: "2026-06-01T10:00", return: "2026-06-03T10:00" };
    const plain = { ...base, sort: "price-asc" as const, category: [] };
    expect(searchQueryString(plain)).toBe("pickup=2026-06-01T10%3A00&return=2026-06-03T10%3A00");
    const full = {
      ...base,
      sort: "price-desc" as const,
      category: ["suv" as const, "van" as const],
    };
    const qs = searchQueryString({ ...full, fuel: "diesel", seats: 4 });
    const back = parseSearchQuery(Object.fromEntries(new URLSearchParams(qs)));
    expect(back.ok && back.query).toMatchObject({ ...full, fuel: "diesel", seats: 4 });
    expect(periodQueryString(full)).toBe("pickup=2026-06-01T10%3A00&return=2026-06-03T10%3A00");
  });
});

describe("default search period (UX-2)", () => {
  const now = new Date("2026-06-01T08:00:00Z"); // 10:00 in Rome

  it("is tomorrow 10:00 to two days later", () => {
    expect(defaultPeriod(now, ROME, RULES)).toEqual({
      pickup: "2026-06-02T10:00",
      return: "2026-06-04T10:00",
    });
  });

  it("moves to the earliest pickup the lead time allows, rounded up to 15 minutes", () => {
    const lead = { ...RULES, leadTimeMinutes: 26 * 60 + 5 }; // 12:05 tomorrow -> 12:15
    expect(defaultPeriod(now, ROME, lead).pickup).toBe("2026-06-02T12:15");
  });

  it("stays within the rental-day limits", () => {
    expect(defaultPeriod(now, ROME, { ...RULES, minRentalDays: 6 }).return).toBe(
      "2026-06-07T10:00",
    );
    expect(defaultPeriod(now, ROME, { ...RULES, maxRentalDays: 2 }).return).toBe(
      "2026-06-03T10:00",
    );
  });
});

describe("local date-time helpers", () => {
  it("formats an instant in the tenant zone and adds calendar days", () => {
    expect(formatLocal(new Date("2026-06-01T22:30:00Z"), ROME)).toBe("2026-06-02T00:30");
    expect(addLocalDays("2026-02-27T09:15", 2)).toBe("2026-03-01T09:15");
    expect(addLocalDays("not a date", 2)).toBe("not a date");
  });
});

describe("offer filter (W-P2b)", () => {
  const offer = (o: Partial<Offer> & Pick<Offer, "id" | "totalMinor">): Offer => ({
    name: o.id,
    make: "M",
    model: "X",
    category: "city",
    fuelType: "petrol",
    seats: 4,
    billedDays: 2,
    dailyPriceMinor: o.totalMinor / 2,
    ...o,
  });
  const offers = [
    offer({ id: "b", totalMinor: 100 }),
    offer({ id: "a", totalMinor: 100, category: "suv", fuelType: "diesel", seats: 7 }),
    offer({ id: "c", totalMinor: 300, category: "van", seats: 9 }),
  ];
  const ids = (list: Offer[]) => list.map((o) => o.id);

  it("sorts by total, ties by name, in both directions", () => {
    expect(ids(applyOfferFilter(offers, { sort: "price-asc", category: [] }))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ids(applyOfferFilter(offers, { sort: "price-desc", category: [] }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("applies category, fuel and minimum seats together", () => {
    const f = { sort: "price-asc" as const, category: ["suv", "van"] };
    expect(ids(applyOfferFilter(offers, f))).toEqual(["a", "c"]);
    expect(ids(applyOfferFilter(offers, { ...f, fuel: "petrol" }))).toEqual(["c"]);
    expect(ids(applyOfferFilter(offers, { ...f, seats: 8 }))).toEqual(["c"]);
  });
});
