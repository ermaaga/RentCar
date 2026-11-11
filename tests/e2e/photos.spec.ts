import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { activatedAdmin, addVehicle, expectAccessible } from "./helpers";

// FLT-07/08/09/10 end to end (US-040, ABU-M2-14..17): the admin uploads photos on the vehicle page,
// reorders them, moves the cover and deletes one; the public results show the cover, served by /media with class M headers.

function photo(colour: string): Promise<Buffer> {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

async function upload(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  await page
    .getByLabel("Add photos")
    .setInputFiles(files.map((f) => ({ name: f.name, mimeType: "image/jpeg", buffer: f.buffer })));
  await expect(page.getByText("Photos added.")).toBeVisible();
}

/** The public results show the cover, and /media serves it with the class M headers. */
async function expectPublicCover(page: Page, slug: string): Promise<void> {
  await page.goto(`/${slug}`);
  await page.getByRole("button", { name: "Search available vehicles" }).click();
  const cover = page.getByRole("main").locator("img");
  await expect(cover).toHaveAttribute("src", /^\/media\/tenants\/.+-480\.webp$/);
  const res = await page.request.get((await cover.getAttribute("src")) ?? "");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/webp");
  expect(res.headers()["cache-control"]).toContain("immutable");
  expect(res.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect((await page.request.get("/media/private/x.zip")).status()).toBe(404);
}

test("admin manages vehicle photos and the cover shows on the public page", async ({
  page,
}, info) => {
  const slug = `e2f-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  await activatedAdmin(page, slug, `${slug}@rentcar.localhost`);
  await page.getByRole("link", { name: "Vehicles" }).click();
  await addVehicle(page, {
    name: "Fiat Panda",
    plate: "PH 001 AA",
    category: "City car",
    price: "40",
  });
  await page.getByRole("link", { name: "Fiat Panda" }).click();
  await expect(page.getByText("No photos yet.")).toBeVisible();

  await upload(page, [
    { name: "red.jpg", buffer: await photo("#c33") },
    { name: "blue.jpg", buffer: await photo("#33c") },
  ]);
  const photos = page.getByRole("region", { name: "Photos" }).getByRole("listitem");
  await expect(photos).toHaveCount(2);
  await expect(photos.first()).toContainText("Cover photo");
  await expectAccessible(page);

  await photos.nth(1).getByLabel("Position of photo 2").selectOption("1");
  await photos.nth(1).getByRole("button", { name: "Move photo 2" }).click();
  await expect(photos.first().getByRole("status")).toHaveText("Photo order saved.");
  await expect(photos.nth(1)).toContainText("Cover photo");
  await expect(photos.first()).not.toContainText("Cover photo");

  await photos.first().getByRole("button", { name: "Make cover" }).click();
  await expect(photos.first()).toContainText("Cover photo");
  await photos.nth(1).getByRole("button", { name: "Delete photo" }).click();
  await expect(photos).toHaveCount(1);

  await page.getByLabel("Add photos").setInputFiles({
    name: "fake.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
  });
  await expect(page.getByText("Use a JPEG, PNG or WebP image.")).toBeVisible();

  await expectPublicCover(page, slug);
});
