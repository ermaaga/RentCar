import { describe, expect, it } from "vitest";

import {
  isBookingCodePath,
  lowercaseSlugPath,
  NOINDEX,
  NOINDEX_FOLLOW,
  robotsHeader,
} from "../../src/app/_lib/robots-policy";
import {
  autoRentalJsonLd,
  canonicalUrl,
  DESCRIPTION_MAX,
  e164,
  rootDescription,
  serializeJsonLd,
} from "../../src/modules/tenancy/domain/public-seo";

// docs/09-seo.md sections 3-8: canonical, robots per page class, description and JSON-LD.

describe("canonicalUrl (SR-03)", () => {
  it("joins the configured origin and the slug without a trailing slash", () => {
    expect(canonicalUrl("https://rent.example", "sunny-rent")).toBe(
      "https://rent.example/sunny-rent",
    );
    expect(canonicalUrl("https://rent.example//", "sunny-rent")).toBe(
      "https://rent.example/sunny-rent",
    );
  });
});

describe("robotsHeader (section 5, SR-05/SR-06)", () => {
  it("marks every response noindex when indexing is disabled", () => {
    for (const path of ["/", "/sunny-rent", "/sunny-rent/vehicles", "/system", "/api/healthz"]) {
      expect(robotsHeader(path, false, false)).toBe(NOINDEX);
    }
  });

  it("leaves the tenant root without a query to the page", () => {
    expect(robotsHeader("/sunny-rent", false, true)).toBeNull();
    expect(robotsHeader("/sunny-rent/", false, true)).toBeNull();
  });

  it("keeps follow on the root with a query and on the results", () => {
    expect(robotsHeader("/sunny-rent", true, true)).toBe(NOINDEX_FOLLOW);
    expect(robotsHeader("/sunny-rent/vehicles", true, true)).toBe(NOINDEX_FOLLOW);
  });

  it("never indexes admin, system, api, flow pages or unknown paths", () => {
    for (const path of [
      "/",
      "/system",
      "/system/login",
      "/api/jobs/run",
      "/sunny-rent/admin",
      "/sunny-rent/admin/login",
      "/sunny-rent/book",
      "/sunny-rent/booking/ABCDEFGHJK",
      "/sunny-rent/vehicles/extra",
      "/Not_A_Slug",
    ]) {
      expect(robotsHeader(path, false, true)).toBe(NOINDEX);
    }
  });
});

describe("lowercaseSlugPath (SR-04)", () => {
  it("lowercases an uppercase slug and keeps the rest of the path", () => {
    expect(lowercaseSlugPath("/Sunny-Rent")).toBe("/sunny-rent");
    expect(lowercaseSlugPath("/SUNNY-RENT/vehicles")).toBe("/sunny-rent/vehicles");
  });

  it("does nothing for lowercase, reserved, malformed or empty paths", () => {
    expect(lowercaseSlugPath("/sunny-rent")).toBeNull();
    expect(lowercaseSlugPath("/System")).toBeNull();
    expect(lowercaseSlugPath("/Bad_Slug")).toBeNull();
    expect(lowercaseSlugPath("/")).toBeNull();
  });
});

describe("isBookingCodePath (SR-16)", () => {
  it("matches the confirmation page and its PDF only", () => {
    expect(isBookingCodePath("/sunny-rent/booking/ABCDEFGHJK")).toBe(true);
    expect(isBookingCodePath("/sunny-rent/booking/ABCDEFGHJK/pdf")).toBe(true);
    expect(isBookingCodePath("/sunny-rent/book")).toBe(false);
    expect(isBookingCodePath("/sunny-rent/booking")).toBe(false);
  });
});

describe("rootDescription (SR-11)", () => {
  it("prefers the tenant's own description", () => {
    expect(rootDescription("  City cars in Bari.  ", "fallback")).toBe("City cars in Bari.");
  });

  it("falls back on a missing or blank description", () => {
    expect(rootDescription(null, "fallback")).toBe("fallback");
    expect(rootDescription("   ", "fallback")).toBe("fallback");
  });

  it("never exceeds 160 characters", () => {
    const text = rootDescription(null, "x".repeat(200));
    expect(text).toHaveLength(DESCRIPTION_MAX);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("e164", () => {
  it("normalises international numbers and rejects local ones", () => {
    expect(e164("+39 080 123 4567")).toBe("+390801234567");
    expect(e164("0039 080 123 4567")).toBe("+390801234567");
    expect(e164("080 123 4567")).toBeNull();
    expect(e164("+12")).toBeNull();
  });
});

describe("autoRentalJsonLd (SR-13)", () => {
  const base = {
    title: "Sunny Rent",
    canonical: "https://rent.example/sunny-rent",
    currency: "EUR",
    contactPhone: "+39 080 123 4567",
    contactEmail: "info@sunny.example",
    address: null,
  };

  it("includes only the fields that exist", () => {
    expect(autoRentalJsonLd({ ...base, contactPhone: "080 123" })).toEqual({
      "@context": "https://schema.org",
      "@type": "AutoRental",
      name: "Sunny Rent",
      url: "https://rent.example/sunny-rent",
      email: "info@sunny.example",
      currenciesAccepted: "EUR",
      paymentAccepted: "Cash, Credit Card",
    });
  });

  it("adds the telephone and the postal address when stored", () => {
    const data = autoRentalJsonLd({
      ...base,
      address: { street: "Via Roma 1", postalCode: "70121", city: "Bari", countryCode: "IT" },
    });
    expect(data.telephone).toBe("+390801234567");
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Via Roma 1",
      postalCode: "70121",
      addressLocality: "Bari",
      addressCountry: "IT",
    });
  });
});

describe("serializeJsonLd", () => {
  it("cannot close the script element and still parses to the same data", () => {
    const data = { name: "</script><script>alert(1)</script>", note: "a\u2028b\u2029c" };
    const text = serializeJsonLd(data);
    expect(text).not.toContain("<");
    expect(text).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual(data);
  });
});
