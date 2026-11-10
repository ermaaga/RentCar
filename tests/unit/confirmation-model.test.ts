import { describe, expect, it } from "vitest";

import { getTranslator } from "../../src/i18n";
import {
  buildConfirmationModel,
  groupCode,
} from "../../src/modules/booking/application/confirmation-model";

const data = {
  code: "AB12CD34EF",
  tenantTitle: "Rent Roma",
  contactEmail: "info@rent.example",
  contactPhone: "+390612345678",
  vehicleName: "Fiat Panda",
  firstName: "Mario",
  lastName: "Rossi",
  startAt: new Date("2026-06-03T08:00:00Z"),
  endAt: new Date("2026-06-05T08:00:00Z"),
  timeZone: "Europe/Rome",
  currency: "EUR",
  dailyPriceMinor: 4000,
  billedDays: 3,
  totalMinor: 12000,
};

describe("confirmation PDF model", () => {
  it("groups the code in fours", () => {
    expect(groupCode("AB12CD34EF")).toBe("AB12 CD34 EF");
  });

  it("preformats dates in the tenant zone and amounts in its currency", () => {
    const model = buildConfirmationModel(data, getTranslator("en"));
    expect(model.code).toBe("AB12 CD34 EF");
    expect(Object.fromEntries(model.rows)).toEqual({
      Customer: "Mario Rossi",
      Car: "Fiat Panda",
      Pickup: "03 Jun 2026, 10:00",
      Return: "05 Jun 2026, 10:00",
      "Daily price": "€40.00",
      "Billed days": "3",
      Total: "€120.00",
    });
    expect(model.notes).toEqual([
      "Times are in Europe/Rome.",
      "Pay on site by card or cash.",
      "This document is a booking summary, not an invoice or receipt.",
    ]);
    expect(model.tenantContact).toBe("info@rent.example · +390612345678");
  });
});
