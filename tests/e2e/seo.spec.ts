import { expect, test } from "@playwright/test";

import { createTenant, signInOwner } from "./helpers";

// docs/09-seo.md section 15 checks that hold in every non-production stack (PUBLIC_INDEXING_ENABLED
// unset, so it fails closed): X-Robots-Tag on every class, robots.txt disallows all, the root
// carries its title, canonical and AutoRental data, uppercase slugs redirect and unknown slugs 404.
// Headers do not depend on the viewport, so this runs in the desktop project only.

test("public pages carry the SEO baseline and stay out of the index", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "headers and metadata do not depend on the viewport");
  const slug = `e2s-${Date.now().toString(36)}`;
  await signInOwner(page);
  await createTenant(page, slug, `${slug}@rentcar.localhost`);

  const robotsTxt = await page.request.get("/robots.txt");
  expect(await robotsTxt.text()).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/);

  for (const path of [`/${slug}`, `/${slug}/admin/login`, "/system/login", "/api/healthz"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
  }

  await page.goto(`/${slug}`);
  await expect(page).toHaveTitle("Rent test | Car rental");
  const head = page.locator("head");
  await expect(head.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    new RegExp(`^https?://[^/]+/${slug}$`),
  );
  await expect(head.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    new RegExp(`/${slug}$`),
  );
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(jsonLd ?? "{}")).toMatchObject({
    "@type": "AutoRental",
    name: "Rent test",
    telephone: "+39061234567",
  });

  const upper = await page.request.get(`/${slug.toUpperCase()}`, { maxRedirects: 0 });
  expect(upper.status()).toBe(301);
  expect(upper.headers().location).toMatch(new RegExp(`/${slug}$`));
  expect((await page.request.get(`/${slug}x-unknown`)).status()).toBe(404);

  const confirmation = await page.request.get(`/${slug}/booking/ABCDEFGHJK`);
  expect(confirmation.headers()["referrer-policy"]).toBe("no-referrer");
});
