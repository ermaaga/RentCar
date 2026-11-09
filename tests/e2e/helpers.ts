import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Shared E2E steps: owner sign-in, tenant creation, mail lookup in Mailpit, admin activation.
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
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

/** Opens the mailed activation link and sets the admin password; ends on the dashboard. */
export async function activateAdmin(page: Page, email: string): Promise<string> {
  const link = await mailedLink(page, email, "activate");
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeVisible();
  return link;
}
