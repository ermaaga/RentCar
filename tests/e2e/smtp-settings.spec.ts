import { expect, test } from "@playwright/test";

import { activateAdmin, createTenant, expectAccessible, MAILPIT, signInOwner } from "./helpers";

// NTF-01/02 end to end: the admin saves the tenant SMTP (the local Mailpit sink) and the test email
// reaches the admin's own mailbox.
test("admin saves the email settings and the test email arrives", async ({ page }, info) => {
  const slug = `e2s-${info.project.name}-${Date.now().toString(36)}`.slice(0, 40);
  const email = `${slug}@rentcar.localhost`;
  await signInOwner(page);
  await createTenant(page, slug, email);
  await activateAdmin(page, email);

  await page.getByRole("link", { name: "Email settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Email settings" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("SMTP server").fill("mailpit");
  await page.getByLabel("Port").selectOption("2525");
  await page.getByLabel("Username").fill("mailer");
  await page.getByLabel("Password").fill("mailer password");
  await page.getByLabel("Sender address").fill(`noreply-${slug}@rentcar.localhost`);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.getByRole("button", { name: "Send a test email" }).click();
  await expect(page.getByText("Test email sent.")).toBeVisible();
  await expectAccessible(page);
  await expect(async () => {
    const query = encodeURIComponent(`to:${email} subject:"RentCar test email"`);
    const res = await page.request.get(`${MAILPIT}/api/v1/search?query=${query}`);
    const { messages } = (await res.json()) as { messages: unknown[] };
    expect(messages).toHaveLength(1);
  }).toPass({ timeout: 10_000 });
});
