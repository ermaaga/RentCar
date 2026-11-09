// A valid TEN-03 input shared by unit and integration tests.
export const validTenantInput = {
  name: "Rent Roma",
  slug: "rent-roma",
  contact: { email: "info@rent.test", phone: "+39061234567" },
  title: "Rent Roma",
  countryCode: "IT",
  timeZone: "Europe/Rome",
  currency: "EUR",
  dpaSigned: true,
  subscription: {
    maxVehicles: 10,
    maxOperators: 2,
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    priceMinor: 120000,
    priceCurrency: "EUR",
  },
  admin: { displayName: "Mario Rossi", username: "Mario.Rossi", email: "mario@rent.test" },
};
