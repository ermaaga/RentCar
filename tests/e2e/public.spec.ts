import { expect, test, type Page } from "@playwright/test";

import { activatedAdmin, addVehicle, expectAccessible } from "./helpers";

// W-P1/W-P2 end to end (AC3 first half, FR-PUB-01..04): a customer without an account searches the
// default period, sees the available vehicles with the total, filters and sorts with the URL kept.

/** On the results page: sorts by price, filters SUVs and checks the URL keeps both after reload. */
async function sortAndFilter(page: Page, slug: string): Promise<void> {
  const names = page.getByRole("heading", { level: 3 });
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
}

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

  await sortAndFilter(page, slug);

  await page.goto(`/${slug}/vehicles?pickup=2020-01-01T10:00&return=2020-01-02T10:00`);
  await expect(page).toHaveURL(new RegExp(`/${slug}\\?pickup=.*&error=PICKUP_IN_PAST`));
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Pickup can't be in the past.",
  );
  expect((await page.goto("/no-such-tenant"))?.status()).toBe(404);
});

/** W-P3 form: details, the acknowledgement and the 3 s minimum fill time before submitting. */
async function fillBookingForm(page: Page, phone: string): Promise<void> {
  await page.getByLabel("First name").fill("Mario");
  await page.getByLabel("Last name").fill("Rossi");
  await page.getByLabel("Mobile phone").fill(phone);
  await page.getByLabel("Email (optional)").fill("mario@rentcar.localhost");
  await page.getByLabel("I have read the rental conditions and the privacy notice.").check();
  await page.waitForTimeout(3_100);
}

test("a customer books a car and sees the confirmation with the code", async ({ page }, info) => {
  const slug = `e2b-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  await activatedAdmin(page, slug, `${slug}@rentcar.localhost`);
  await page.getByRole("link", { name: "Vehicles" }).click();
  await addVehicle(page, {
    name: "Fiat Panda",
    plate: "PB 003 CC",
    category: "City car",
    price: "40",
  });

  await page.goto(`/${slug}`);
  await page.getByRole("button", { name: "Search available vehicles" }).click();
  await page.getByRole("link", { name: "Select Fiat Panda" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your booking" })).toBeVisible();
  await expect(page.getByText("Total for 3 days: €120.00")).toBeVisible();
  await expectAccessible(page);

  await fillBookingForm(page, "333 123 4567");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Booking confirmed" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${slug}/booking/[0-9A-Z]{10}$`));
  await expect(page.getByText("Thank you, Mario. Your booking is confirmed.")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("mario@rentcar.localhost");
  await expectAccessible(page);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download the confirmation (PDF)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^booking-[0-9A-Z]{10}\.pdf$/);

  await page.goBack();
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This car was just booked by someone else. Choose another car.",
  );
  expect((await page.goto(`/${slug}/booking/0000000000`))?.status()).toBe(404);
});
