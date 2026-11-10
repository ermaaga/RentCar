import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  renderAdminNewBooking,
  renderBookingConfirmation,
} from "../../src/modules/booking/application/booking-email";

const data = {
  code: "AB12CD34EF",
  tenantTitle: "Rent <Roma>",
  contactEmail: "info@rent.example",
  contactPhone: "+390612345678",
  firstName: "Mario",
  lastName: "Rossi",
  phone: "+393331234567",
  vehicleName: "Fiat <b>Panda</b>",
  pickup: "2026-06-03 10:00",
  return: "2026-06-05 10:00",
  total: "€120.00",
  link: "https://rent.example/roma/booking/AB12CD34EF",
};
const t = getTranslator("en");

describe("booking emails", () => {
  it("confirms to the customer with the link, contact and ignore line, without the phone", () => {
    const mail = renderBookingConfirmation("mario@example.test", data, t);
    expect(mail.subject).toBe("Booking AB12CD34EF confirmed · Rent <Roma>");
    expect(mail.text).toContain(data.link);
    expect(mail.text).toContain("Contact: info@rent.example, +390612345678");
    expect(mail.text).toContain("If you did not make this booking, ignore this email");
    expect(mail.text).not.toContain(data.phone);
    expect(mail.html).toContain("Fiat &lt;b&gt;Panda&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>");
  });

  it("tells the admin the customer name and phone", () => {
    const mail = renderAdminNewBooking("owner@example.test", data, t);
    expect(mail.subject).toBe("New booking AB12CD34EF");
    expect(mail.text).toContain("Customer: Mario Rossi, +393331234567");
  });
});
