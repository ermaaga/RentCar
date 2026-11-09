import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  isNoticeTemplate,
  renderNotice,
} from "../../src/modules/notifications/application/notice-email";
import {
  isRenewalTemplate,
  renderRenewal,
} from "../../src/modules/notifications/application/renewal-email";
import { smtpSettingsInput } from "../../src/modules/notifications";
import { renderSmtpTestEmail } from "../../src/modules/notifications/application/credential-email";

const t = getTranslator();

describe("account notices (SR-AUT-10)", () => {
  it("knows its templates", () => {
    expect(isNoticeTemplate("notice.password_changed")).toBe(true);
    expect(isNoticeTemplate("booking.confirmation")).toBe(false);
  });

  it.each([
    "notice.password_changed",
    "notice.password_reset_completed",
    "notice.admin_access_changed",
    "notice.email_changed",
  ] as const)("renders %s with the escaped name, no link and the contact line", (template) => {
    const mail = renderNotice(template, { to: "a@example.test", displayName: "<Ann>" }, t);
    expect(mail.to).toBe("a@example.test");
    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.text).toContain("<Ann>");
    expect(mail.html).toContain("&lt;Ann&gt;");
    expect(mail.html).not.toContain("<Ann>");
    expect(`${mail.text}${mail.html}`).not.toMatch(/https?:\/\//);
  });
});

describe("renewal reminders (US-017)", () => {
  const input = {
    to: "o@example.test",
    tenantName: "Rent & Go",
    slug: "rent-go",
    endDate: "2027-01-31",
  };

  it("knows its templates", () => {
    expect(isRenewalTemplate("subscription.renewal_reminder_owner")).toBe(true);
    expect(isRenewalTemplate("subscription.renewal_reminder_admin")).toBe(true);
    expect(isRenewalTemplate("notice.password_changed")).toBe(false);
  });

  it("tells the owner which tenant and when, escaping HTML", () => {
    const mail = renderRenewal("subscription.renewal_reminder_owner", input, t);
    expect(mail.subject).toBe("Subscription of Rent & Go ends on 2027-01-31");
    expect(mail.text).toContain("(rent-go)");
    expect(mail.html).toContain("Rent &amp; Go");
  });

  it("tells the admin about the grace period", () => {
    const mail = renderRenewal("subscription.renewal_reminder_admin", input, t);
    expect(mail.subject).toBe("Your RentCar subscription ends on 2027-01-31");
    expect(mail.text).toContain("7 more days");
  });
});

describe("smtpSettingsInput (NTF-01)", () => {
  const ok = {
    host: "smtp.example.com",
    port: "587",
    security: "starttls",
    username: "mailer",
    fromAddress: "noreply@example.com",
  };

  it("accepts the form shape and coerces the port", () => {
    expect(smtpSettingsInput.parse(ok).port).toBe(587);
  });

  it.each([
    [{ port: "22" }],
    [{ security: "none" }],
    [{ host: "" }],
    [{ username: "a\r\nb" }],
    [{ fromName: "x\nBcc: y" }],
    [{ fromAddress: "not-an-email" }],
  ])("rejects %j", (patch) => {
    expect(smtpSettingsInput.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe("SMTP test email (NTF-02)", () => {
  it("is a fixed text to the given address", () => {
    const mail = renderSmtpTestEmail("me@example.test", t);
    expect(mail).toMatchObject({ to: "me@example.test", subject: "RentCar test email" });
    expect(mail.html).toContain("<p>");
  });
});
