import { expect, test } from "@playwright/test";

import { activatedAdmin, addVehicle, expectAccessible } from "./helpers";

// W-P1/W-P2 end to end (AC3 first half, FR-PUB-01..04): a customer without an account searches the
// default period, sees the available vehicles with the total, filters and sorts with the URL kept.

test("a customer searches, filters and sorts the available vehicles", async ({ page }, info) => {
  const slug = `e2p-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  await activatedAdmin(page, slug, `${slug}@rentcar.localhost`);
  await page.getByRole("link", { name: "Vehicles" }).click();
  await addVehicle(page, {
    name: "Fiat Panda",
    plate: "PA 001 AA",
    category: "City car",
    price: "40",
  });
  await addVehicle(page, {
    name: "Jeep Compass",
    plate: "JC 002 BB",
    category: "SUV",
    price: "90",
  });

  await page.goto(`/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: "Rent test" })).toBeVisible();
  await expect(page.getByRole("search")).toContainText("Times are in Europe/Rome.");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Search available vehicles" }).click();

  await expect(page).toHaveURL(new RegExp(`/${slug}/vehicles\\?pickup=.+&return=.+`));
  await expect(page.getByRole("main").getByRole("status")).toHaveText("2 vehicles available");
  await expect(page.getByText("3 days ·", { exact: false }).first()).toBeVisible();
  const names = page.getByRole("heading", { level: 3 });
  await expect(names).toHaveText(["Fiat Panda", "Jeep Compass"]);
  await expectAccessible(page);

  await page.getByLabel("Sort").selectOption("price-desc");
  await expect(names).toHaveText(["Jeep Compass", "Fiat Panda"]);
  await page.getByText("Filters").click();
  await page.getByLabel("SUV (1)").check();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("1 vehicle available");
  await expect(page).toHaveURL(/sort=price-desc&category=suv/);
  await expectAccessible(page);

  await page.reload();
  await expect(names).toHaveText(["Jeep Compass"]);
  const select = page.getByRole("link", { name: "Select Jeep Compass" });
  await expect(select).toHaveAttribute("href", new RegExp(`^/${slug}/book\\?vehicle=`));

  await page.goto(`/${slug}/vehicles?pickup=2020-01-01T10:00&return=2020-01-02T10:00`);
  await expect(page).toHaveURL(new RegExp(`/${slug}\\?pickup=.*&error=PICKUP_IN_PAST`));
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Pickup can't be in the past.",
  );
  expect((await page.goto("/no-such-tenant"))?.status()).toBe(404);
});
