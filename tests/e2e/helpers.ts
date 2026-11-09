import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Shared steps of the end-to-end specs: owner sign-in, tenant creation, mailed links, axe checks.
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "INSECURE_DEV_owner_password";
export const ADMIN_PASSWORD = "a long admin passphrase";
export const NEW_ADMIN_PASSWORD = "an even longer admin passphrase";

export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

export async function signInOwner(page: Page): Promise<void> {
  await page.goto("/system/login");
  await expectAccessible(page);
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tenants" })).toBeVisible();
}

export async function createTenant(page: Page, slug: string, email: string): Promise<void> {
  await page.goto("/system/tenants/new");
  const values: Record<string, string> = {
    name: `Rent ${slug}`,
    slug,
    title: "Rent test",
    "contact.email": "info@rentcar.localhost",
    "contact.phone": "+39061234567",
    "subscription.startDate": "2026-01-01",
    "subscription.endDate": "2099-12-31",
    "admin.displayName": "Test Admin",
    "admin.username": "admin1",
    "admin.email": email,
  };
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`[name="${name}"]`).fill(value);
  }
  await page.getByLabel("The data processing agreement is signed").check();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Create tenant" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "activation email was sent",
  );
}

/** Latest link of the given page (`activate` or `reset-password`) mailed to the address. */
export async function mailedLink(page: Page, email: string, kind: string): Promise<string> {
  let link = "";
  await expect(async () => {
    const query = encodeURIComponent(`to:${email}`);
    const search = await page.request.get(`${MAILPIT}/api/v1/search?query=${query}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const { ID } of messages) {
      const message = await page.request.get(`${MAILPIT}/api/v1/message/${ID}`);
      const { Text } = (await message.json()) as { Text: string };
      link = new RegExp(`https?://\\S+/admin/${kind}\\?token=\\S+`).exec(Text)?.[0] ?? "";
      if (link) break;
    }
    expect(link).not.toBe("");
  }).toPass({ timeout: 10_000 });
  return link;
}
/** Owner creates a tenant; its admin activates from the email and lands on the dashboard. */
export async function activatedAdmin(page: Page, slug: string, email: string): Promise<void> {
  await signInOwner(page);
  await createTenant(page, slug, email);
  await page.goto(await mailedLink(page, email, "activate"));
  await page.getByLabel("New password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeVisible();
}

/** On the admin vehicles page: adds one vehicle through the "Add vehicle" form. */
export async function addVehicle(
  page: Page,
  v: { name: string; plate: string; category: string; price: string },
): Promise<void> {
  const add = page.getByRole("region", { name: "Add vehicle" });
  await add.getByLabel("Name shown to customers").fill(v.name);
  await add.getByLabel("Plate").fill(v.plate);
  await add.getByLabel("Make").fill(v.name.split(" ")[0] ?? v.name);
  await add.getByLabel("Model").fill(v.name.split(" ")[1] ?? v.name);
  await add.getByLabel("Category").selectOption({ label: v.category });
  await add.getByLabel("Price per day").fill(v.price);
  await add.getByRole("button", { name: "Add vehicle" }).click();
  await expect(add.getByRole("status")).toContainText("Vehicle added");
}
