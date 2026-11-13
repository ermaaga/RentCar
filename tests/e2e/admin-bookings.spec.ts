import { expect, test, type Page } from "@playwright/test";

import { activatedAdmin, addVehicle, expectAccessible } from "./helpers";

// W-D5 new booking end to end (BKG-06, FR-BKG-06/08, US-051): the admin picks the dates, a free car,
// enters the customer and a card payment; the same car then shows the conflict for those dates.

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function pickDates(page: Page, slug: string): Promise<void> {
  await page.goto(`/${slug}/admin/bookings`);
  await page.getByRole("link", { name: "New booking" }).click();
  await page.getByLabel("Pickup date").fill(day(10));
  await page.getByLabel("Return date").fill(day(12));
  await page.getByRole("button", { name: "Show vehicles for these dates" }).click();
  await expect(page.getByRole("status")).toContainText("Billed as 3 days.");
}

test("an admin creates a paid booking and the car then shows the conflict", async ({
  page,
}, info) => {
  const slug = `e2n-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  await activatedAdmin(page, slug, `${slug}@rentcar.localhost`);
  await page.getByRole("link", { name: "Vehicles" }).click();
  await addVehicle(page, {
    name: "Fiat Panda",
    plate: "PN 004 DD",
    category: "City car",
    price: "40",
  });

  await pickDates(page, slug);
  await expectAccessible(page);
  await page.getByRole("radio", { name: /Fiat Panda/ }).check();
  await page.getByLabel("First name").fill("Anna");
  await page.getByLabel("Last name").fill("Bianchi");
  await page.getByLabel("Phone").fill("+39 333 765 4321");
  await page.getByLabel("Paid in full by card").check();
  await page.getByRole("button", { name: "Save booking" }).click();

  await expect(page.getByText("Booking saved.")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Anna Bianchi");
  await expect(page.getByRole("main")).toContainText("Paid €120.00 (Card)");
  await expect(page.getByRole("main")).toContainText("Created by staff");
  const code = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";

  await pickDates(page, slug);
  const car = page.getByRole("radio", { name: /Fiat Panda/ });
  await expect(car).toBeDisabled();
  await expect(page.getByRole("main")).toContainText(`conflicts with booking ${code}`);
  await expect(page.getByText("No vehicles are free for these dates.")).toBeVisible();
});
