// Lighthouse CI for NFR-PERF-01 (docs/07-frontend.md 13.1, docs/10-test-plan.md section 10): the public
// root and results of the `perf-rent` fixture (30 vehicles, scripts/seed-perf.ts), Lighthouse's
// default mobile profile (simulated slow 4G, 4x CPU), median of 5 runs. Reports stay on disk: nothing
// is uploaded to a third party. TBT stands in for INP in the lab.
const base = process.env.LHCI_BASE_URL ?? "http://127.0.0.1:3000";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const period = `pickup=${day(7)}T10:00&return=${day(10)}T10:00`;

module.exports = {
  ci: {
    collect: {
      url: [`${base}/perf-rent`, `${base}/perf-rent/vehicles?${period}`],
      numberOfRuns: 5,
      settings: { chromeFlags: "--headless=new --no-sandbox" },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": [
          "error",
          { maxNumericValue: 2500, aggregationMethod: "median" },
        ],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
        "total-blocking-time": ["error", { maxNumericValue: 200, aggregationMethod: "median" }],
        "server-response-time": ["error", { maxNumericValue: 800, aggregationMethod: "median" }],
        "categories:accessibility": ["warn", { minScore: 0.95, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: "lighthouse-report" },
  },
};
