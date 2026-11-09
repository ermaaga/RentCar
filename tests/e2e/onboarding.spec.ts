import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// AC1/AC2 end to end: the owner signs in, creates a tenant, the admin receives the activation email
// (Mailpit), sets a password, lands on the dashboard and can sign in again.
const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "INSECURE_DEV_owner_password";
const ADMIN_PASSWORD = "a long admin passphrase";
const NEW_ADMIN_PASSWORD = "an even longer admin passphrase";

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function signInOwner(page: Page): Promise<void> {
  await page.goto("/system/login");
  await expectAccessible(page);
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tenants" })).toBeVisible();
}

async function createTenant(page: Page, slug: string, email: string): Promise<void> {
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
async function mailedLink(page: Page, email: string, kind: string): Promise<string> {
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

/** Owner creates a tenant; its admin activates from the email and lands on the dashboard. */
async function activatedAdmin(page: Page, slug: string, email: string): Promise<void> {
  await signInOwner(page);
  await createTenant(page, slug, email);
  await page.goto(await mailedLink(page, email, "activate"));
  await page.getByLabel("New password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Dashboard/ })).toBeVisible();
}

test("admin saves email settings and manages an operator", async ({ page }, info) => {
  const slug = `e2o-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  await activatedAdmin(page, slug, `${slug}@rentcar.localhost`);

  // Mailpit does not listen on 587: the settings save (local override) but delivery fails, which
  // is the "Activation not delivered" path of W-D9.
  await page.getByRole("link", { name: "Email settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Email settings" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Mail server (SMTP host)").fill("mailpit");
  await page.getByLabel("Username", { exact: true }).fill("mailer");
  await page.getByLabel("Password", { exact: true }).fill("smtp password");
  await page.getByLabel("Sender address").fill("noreply@rentcar.localhost");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Email settings saved");

  // Stay on the host of the emailed link (APP_BASE_URL): the session cookie belongs to it.
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("link", { name: "Operators" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Operators" })).toBeVisible();
  await expect(page.getByText("0 of 2 operators")).toBeVisible();
  await expectAccessible(page);
  const add = page.getByRole("region", { name: "Add operator" });
  await add.getByLabel("Name", { exact: true }).fill("Sara Bianchi");
  await add.getByLabel("Username", { exact: true }).fill("sara");
  await add.getByLabel("Email", { exact: true }).fill(`sara-${slug}@rentcar.localhost`);
  await add.getByRole("button", { name: "Add operator" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("couldn't be sent");
  await expect(page.getByText("Activation not delivered")).toBeVisible();
  await expect(page.getByText("1 of 2 operators")).toBeVisible();

  const row = page.getByRole("listitem");
  await row.getByLabel("Email", { exact: true }).fill(`sara2-${slug}@rentcar.localhost`);
  await page.getByRole("button", { name: "Save Sara Bianchi" }).click();
  await expect(page.getByText("previous email address was told")).toBeVisible();

  await page.getByRole("button", { name: "Deactivate Sara Bianchi" }).click();
  await expect(page.getByRole("button", { name: "Reactivate Sara Bianchi" })).toBeVisible();
  await expect(page.getByText("0 of 2 operators")).toBeVisible();
  await expectAccessible(page);
});

test("admin adds, edits, puts in maintenance and archives a vehicle", async ({ page }, info) => {
  const slug = `e2v-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  await activatedAdmin(page, slug, `${slug}@rentcar.localhost`);

  await page.getByRole("link", { name: "Vehicles" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vehicles" })).toBeVisible();
  await expect(page.getByText("0 of 10 vehicles")).toBeVisible();
  await expectAccessible(page);
  const add = page.getByRole("region", { name: "Add vehicle" });
  await add.getByLabel("Name shown to customers").fill("Fiat Panda");
  await add.getByLabel("Plate").fill("AB 123 CD");
  await add.getByLabel("Make").fill("Fiat");
  await add.getByLabel("Model").fill("Panda");
  await add.getByLabel("Price per day").fill("45.50");
  await add.getByRole("button", { name: "Add vehicle" }).click();
  await expect(add.getByRole("status")).toContainText("Vehicle added");
  await expect(page.getByText("1 of 10 vehicles")).toBeVisible();

  await page.getByRole("link", { name: "Fiat Panda" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Fiat Panda" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Price per day").fill("50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.getByRole("button", { name: "Put in maintenance" }).click();
  await expect(page.getByRole("button", { name: "End maintenance" })).toBeVisible();
  await page.getByRole("button", { name: "Archive vehicle" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vehicles" })).toBeVisible();
  await expect(page.getByText("0 of 10 vehicles")).toBeVisible();
});
