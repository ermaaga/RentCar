import { defineConfig, devices } from "@playwright/test";

// E2E runs against the running stack (docker compose up) or CI's compose override.
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-375",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 667 } },
    },
    {
      name: "mobile-320",
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 640 } },
    },
  ],
});
