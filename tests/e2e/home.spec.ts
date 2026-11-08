import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page renders and is accessible (WCAG 2.2 AA)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "RentCar" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("home page has no horizontal scroll at phone width", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("responses carry the security headers", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("liveness endpoint answers without touching the database", async ({ request }) => {
  const res = await request.get("/api/healthz");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("readiness endpoint reports the database as reachable", async ({ request }) => {
  const res = await request.get("/api/readyz");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ready" });
});
