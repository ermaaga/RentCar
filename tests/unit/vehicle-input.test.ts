import { describe, expect, it } from "vitest";

import { parsePriceToMinor, vehicleInput } from "../../src/modules/fleet";

// FLT-01/02 input (docs/06-backend-api.md, SR-VAL-04/11, SEC-5).
const ok = {
  name: " Fiat Panda ",
  plate: "AB 123-CD",
  make: "Fiat",
  model: "Panda",
  category: "city",
  fuelType: "petrol",
  seats: "4",
  dailyPriceMinor: 4550,
};

describe("parsePriceToMinor", () => {
  it.each([
    ["45", 4500],
    ["45.5", 4550],
    ["45,50", 4550],
    [" 0 ", 0],
  ])("reads %j as %i minor units", (text, minor) => {
    expect(parsePriceToMinor(text)).toBe(minor);
  });

  it.each(["", "-1", "1.234", "abc", "1e3", "1234567"])("refuses %j", (text) => {
    expect(parsePriceToMinor(text)).toBeNaN();
  });
});

describe("vehicleInput", () => {
  it("trims text and coerces seats", () => {
    expect(vehicleInput.parse(ok)).toMatchObject({ name: "Fiat Panda", seats: 4 });
  });

  it.each([
    [{ plate: "A" }],
    [{ plate: "AB/123" }],
    [{ seats: "0" }],
    [{ seats: "21" }],
    [{ category: "truck" }],
    [{ fuelType: "steam" }],
    [{ dailyPriceMinor: Number.NaN }],
    [{ dailyPriceMinor: -1 }],
    [{ name: "x‮y" }],
    [{ name: "a\nb" }],
    [{ notes: "card 4111 1111 1111 1111 for deposit" }],
    [{ notes: "4111-1111-1111-1111" }],
  ])("rejects %j", (patch) => {
    expect(vehicleInput.safeParse({ ...ok, ...patch }).success).toBe(false);
  });

  it("accepts short numbers in notes", () => {
    expect(vehicleInput.safeParse({ ...ok, notes: "Km 12345, tyres 2024" }).success).toBe(true);
  });
});
