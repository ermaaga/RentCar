import { expect, test, type Browser, type Page, type Request } from "@playwright/test";

// Deterministic performance gate of docs/07-frontend.md 13.1-13.2 (NFR-PERF-01, SEO SR-14): the
// transferred (compressed) JavaScript of each public page stays within its budget, and no request
// leaves the origin (FR-PUB-13). Runs on the `perf-rent` fixture (scripts/seed-perf.ts, 30 vehicles).
// Timings (LCP, CLS, TBT, TTFB) are measured by Lighthouse CI in the nightly perf workflow.

const SLUG = "perf-rent";
const KB = 1024;
const BUDGET = { root: 150 * KB, results: 170 * KB, book: 200 * KB };

interface Weight {
  scriptBytes: number;
  foreignHosts: string[];
  /** The loaded page, to read links for the next step. */
  page: Page;
}

/** Loads the page in a fresh context (cold cache) and sums the encoded size of every script. */
async function weigh(browser: Browser, origin: string, path: string): Promise<Weight> {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  const scripts: Promise<number>[] = [];
  const foreign = new Set<string>();
  const onRequestFinished = (request: Request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) foreign.add(url.host);
    if (request.resourceType() === "script") {
      scripts.push(request.sizes().then((s) => s.responseBodySize));
    }
  };
  page.on("requestfinished", onRequestFinished);
  await page.goto(path, { waitUntil: "networkidle" });
  page.off("requestfinished", onRequestFinished);
  const sizes = await Promise.all(scripts);
  return { scriptBytes: sizes.reduce((a, b) => a + b, 0), foreignHosts: [...foreign], page };
}

function period(): string {
  const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const back = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  return `pickup=${day}T10:00&return=${back}T10:00`;
}

test("public pages stay within the JavaScript budget", async ({
  page,
  browser,
  browserName,
}, info) => {
  test.skip(info.project.name !== "desktop", "transfer sizes do not depend on the viewport");
  test.skip(browserName !== "chromium", "encoded sizes are measured in Chromium");
  const probe = await page.request.get(`/${SLUG}`);
  test.skip(
    probe.status() === 404 && !process.env.CI,
    "run dist-scripts/seed-perf.mjs (compose profile perf) to create the fixture",
  );
  expect(probe.status(), "perf-rent fixture missing: compose profile perf").toBe(200);
  const origin = new URL(probe.url()).origin;

  const root = await weigh(browser, origin, `/${SLUG}`);
  const results = await weigh(browser, origin, `/${SLUG}/vehicles?${period()}`);
  await expect(results.page.getByRole("heading", { level: 3 })).toHaveCount(30);
  const select = results.page.getByRole("link", { name: /^Select / }).first();
  const book = await weigh(browser, origin, (await select.getAttribute("href")) ?? "");
  await expect(book.page.getByRole("heading", { level: 1 })).toBeVisible();

  const report = Object.fromEntries(
    Object.entries({ root, results, book }).map(([k, w]) => [k, w.scriptBytes]),
  );
  await info.attach("js-weight.json", { body: JSON.stringify(report, null, 2) });
  expect(root.scriptBytes, "root JS (gzip)").toBeLessThanOrEqual(BUDGET.root);
  expect(results.scriptBytes, "results JS (gzip)").toBeLessThanOrEqual(BUDGET.results);
  expect(book.scriptBytes, "booking form JS (gzip)").toBeLessThanOrEqual(BUDGET.book);
  expect([...root.foreignHosts, ...results.foreignHosts, ...book.foreignHosts]).toEqual([]);
});
