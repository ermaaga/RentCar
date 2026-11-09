import { expect, test, type Page } from "@playwright/test";

import {
  ADMIN_PASSWORD,
  createTenant,
  expectAccessible,
  mailedLink,
  NEW_ADMIN_PASSWORD,
  signInOwner,
} from "./helpers";

// AC1/AC2 end to end: the owner signs in, creates a tenant, the admin receives the activation email
// (Mailpit), sets a password, lands on the dashboard and can sign in again.
test("owner creates a tenant and its admin activates the account", async ({ page }, info) => {
  const slug = `e2e-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  const email = `${slug}@rentcar.localhost`;
  await signInOwner(page);
  await createTenant(page, slug, email);

  const link = await mailedLink(page, email, "activate");
  expect(link).not.toBe("");
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await expectAccessible(page);
  await page.getByLabel("New password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Username").fill("admin1");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeVisible();

  await page.goto(link);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("already been used");

  await resetAdminPassword(page, slug, email);
  await changeAdminPassword(page);
});

async function changeAdminPassword(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Current password").fill(NEW_ADMIN_PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Password changed");
}

async function resetAdminPassword(page: Page, slug: string, email: string): Promise<void> {
  await page.goto(`/${slug}/admin/login`);
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expectAccessible(page);
  await page.getByLabel("Username or email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("If an account matches");
  await page.goto(await mailedLink(page, email, "reset-password"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a new password" }),
  ).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(NEW_ADMIN_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(NEW_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Password set");
  await page.getByLabel("Username").fill("admin1");
  await page.getByLabel("Password").fill(NEW_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeVisible();
}

test("an unknown account gives the generic message", async ({ page }, info) => {
  // Never a real account here: failures count towards the lockout of that username.
  await page.goto("/system/login");
  await page.getByLabel("Username").fill(`nobody-${info.project.name}-${Date.now().toString(36)}`);
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Incorrect username or password.",
  );
});

test("the console requires a session and unknown tenants are a plain 404", async ({ page }) => {
  await page.goto("/system");
  await expect(page).toHaveURL(/\/system\/login$/);
  const res = await page.goto("/no-such-tenant/admin/login");
  expect(res?.status()).toBe(404);
});

test("owner suspends, reactivates, renews and re-sends the admin access link", async ({
  page,
}, info) => {
  const slug = `e2l-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  const email = `${slug}@rentcar.localhost`;
  await signInOwner(page);
  await createTenant(page, slug, email);
  await page.goto("/system");
  await page.getByRole("link", { name: `Rent ${slug}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Rent ${slug}` })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("button", { name: "Suspend tenant" }).click();
  await expect(page.getByRole("button", { name: "Reactivate tenant" })).toBeVisible();
  await page.getByRole("button", { name: "Reactivate tenant" }).click();
  await expect(page.getByRole("button", { name: "Suspend tenant" })).toBeVisible();

  await page.getByLabel("New end date").fill("2100-06-30");
  await page.getByRole("button", { name: "Save end date" }).click();
  await expect(page.getByText("2026-01-01 – 2100-06-30")).toBeVisible();

  await page.getByRole("button", { name: "Send a new access link" }).click();
  await expect(page.getByText("A new access link was emailed to the administrator.")).toBeVisible();
  expect(await mailedLink(page, email, "activate")).toContain("/admin/activate?token=");
});
