import { describe, expect, it } from "vitest";

import {
  autoRentalJsonLd,
  jsonLdScript,
  rootDescription,
  rootRobots,
  rootTitle,
  rootUrl,
  robotsRules,
} from "../../src/app/_lib/seo";

// docs/09-seo.md: SR-03 canonical, SR-05 directives per state, SR-06/07 robots.txt, SR-11 metadata, SR-13 JSON-LD.
describe("canonical and metadata (SR-03, SR-11)", () => {
  it("builds the canonical from the configured origin only", () => {
    expect(rootUrl("https://rent.example/", "sunny-rent")).toBe("https://rent.example/sunny-rent");
    expect(rootUrl("https://rent.example", "sunny-rent")).toBe("https://rent.example/sunny-rent");
  });

  it("uses the tenant short description when stored, the generated text otherwise", () => {
    expect(rootDescription({ title: "Sunny Rent", shortDescription: "Cars in Rome." })).toBe(
      "Cars in Rome.",
    );
    const generated = rootDescription({ title: "Sunny Rent", shortDescription: null });
    expect(generated).toContain("Book a rental car with Sunny Rent.");
    expect(generated.length).toBeLessThanOrEqual(160);
  });

  it("titles the root as '<name> | Car rental'", () => {
    expect(rootTitle("Sunny Rent")).toBe("Sunny Rent | Car rental");
  });
});

describe("root robots by state (SR-05, SR-06)", () => {
  it("is noindex, nofollow everywhere while indexing is switched off", () => {
    expect(rootRobots({ indexingEnabled: false, unavailable: false, hasQuery: false })).toEqual({
      index: false,
      follow: false,
    });
  });

  it("indexes the plain root when the switch is on", () => {
    expect(rootRobots({ indexingEnabled: true, unavailable: false, hasQuery: false })).toEqual({
      index: true,
      follow: true,
    });
  });

  it("keeps query variants noindex but followable", () => {
    expect(rootRobots({ indexingEnabled: true, unavailable: false, hasQuery: true })).toEqual({
      index: false,
      follow: true,
    });
  });

  it("never indexes a tenant that cannot take bookings", () => {
    expect(rootRobots({ indexingEnabled: true, unavailable: true, hasQuery: false })).toEqual({
      index: false,
      follow: false,
    });
  });
});

describe("robots.txt (SR-07, SR-08)", () => {
  it("disallows everything while indexing is off", () => {
    expect(robotsRules(false)).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("allows the public site and keeps the API out when indexing is on, with no sitemap", () => {
    expect(robotsRules(true)).toEqual({ userAgent: "*", allow: "/", disallow: "/api/" });
  });
});

const base = {
  title: "Sunny Rent",
  contactEmail: "desk@sunny.example",
  contactPhone: "+390612345678",
  currency: "EUR",
  address: null,
};

describe("AutoRental JSON-LD (SR-13)", () => {
  it("includes only stored fields", () => {
    const data = autoRentalJsonLd(base, "https://rent.example/sunny-rent");
    expect(data).toMatchObject({
      "@type": "AutoRental",
      name: "Sunny Rent",
      url: "https://rent.example/sunny-rent",
      currenciesAccepted: "EUR",
      paymentAccepted: "Cash, Credit Card",
    });
    expect(data).not.toHaveProperty("address");
  });

  it("adds a PostalAddress only when the address is stored", () => {
    const data = autoRentalJsonLd(
      {
        ...base,
        address: { street: "Via Roma 1", postalCode: "00100", city: "Rome", countryCode: "IT" },
      },
      "https://rent.example/sunny-rent",
    );
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Via Roma 1",
      postalCode: "00100",
      addressLocality: "Rome",
      addressCountry: "IT",
    });
  });
});

describe("JSON-LD escaping (SR-13)", () => {
  it("escapes '<' so tenant text cannot close the script element", () => {
    const hostile = "</script><script>alert(1)</script>";
    const script = jsonLdScript(autoRentalJsonLd({ ...base, title: hostile }, "https://x/y"));
    expect(script).not.toContain("<");
    expect((JSON.parse(script) as { name: string }).name).toBe(hostile);
  });
});
