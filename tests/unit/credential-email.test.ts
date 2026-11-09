import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import { renderCredentialEmail } from "../../src/modules/notifications";

const t = getTranslator("en");
const link = "http://localhost:3000/rent-roma/admin/activate?token=abc";

describe("credential email", () => {
  it("contains only the link, the expiry and the ignore line", () => {
    const mail = renderCredentialEmail(
      { purpose: "activation", to: "a@b.test", displayName: "Mario", username: "mario", link },
      t,
    );
    expect(mail.subject).toBe("Set your RentCar password");
    expect(mail.text).toContain(link);
    expect(mail.text).toContain("24 hours");
    expect(mail.text).toContain("ignore");
    expect(mail.html).toContain(`href="${link}"`);
  });

  it("escapes user-provided values in the HTML part", () => {
    const mail = renderCredentialEmail(
      {
        purpose: "password_reset",
        to: "a@b.test",
        displayName: "<script>x</script>",
        username: "mario",
        link,
      },
      t,
    );
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).toContain("60 minutes");
  });
});
